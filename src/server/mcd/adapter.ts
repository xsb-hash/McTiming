import { z } from "zod";
import { candidateId, contextKey, diningContextSchema, menuOptionSchema, quoteBinding, quoteSchema, type Candidate, type DiningContext, type Item, type MealRequest, type MenuOption } from "../../domain/meal";
import { generateCandidates, hardConditions } from "../../domain/recommend";
import type { RecommendationAdapter } from "../recommend";
import { claimableSchema, detailSchema, envelopeSchema, menuSchema, ownedCouponsSchema, priceSchema, storeCouponsSchema, type McdDetail } from "./contracts";
import { menuHint, menuVariants, nameTags, selectDetailCodes } from "./menu-selection";
import { ProbeError, safeProbeError } from "./probe";

type ReadTool = "query-meals" | "query-meal-detail" | "query-my-coupons" | "query-store-coupons" | "available-coupons" | "calculate-price";
export type McdReadCall = (name: ReadTool, args: Record<string, unknown>) => Promise<unknown>;
// Exact labels in saved official details (including stage 5B); no ingredient inference.
const roles: Partial<Record<string, "main" | "drink" | "snack">> = { "主食任意选": "main", "选择主食": "main", "选择汉堡": "main", "选择小食": "snack", "选择套餐内小食": "snack", "选择套餐内饮料": "drink", "鸡肉汉堡\n/卷": "main", "巨无霸\n牛鱼肉堡": "main", "安格斯MAX\n厚牛堡": "main", "饮品": "drink", "麦咖啡™": "drink" };
function modifications(value: McdDetail["modification"], supported: boolean) {
  if (supported && !value) throw new Error("Unknown modifications");
  return (value?.items ?? []).flatMap((group) => {
    const selected = group.values.filter((v) => v.selectedQuantity > 0);
    if (selected.length < group.minValues || selected.length > group.maxValues) throw new Error("Invalid default selection");
    return group.values.flatMap((v) => {
      if (v.selectedQuantity < v.minQuantity || v.selectedQuantity > v.maxQuantity) throw new Error("Invalid quantity");
      const key = v.selectedQuantity > 0 ? v.selectedKey : v.unselectedKey;
      return key ? [{ code: v.code, key, quantity: v.selectedQuantity }] : [];
    });
  });
}

export function mapMenuOption(context: DiningContext, detail: McdDetail, categories: string[], tags: string[], productRoles: Record<string, MenuOption["components"][number]["role"]> = {}): MenuOption {
  const components: MenuOption["components"] = [];
  const component = (code: string, name: string, quantity: number, role: MenuOption["components"][number]["role"], verifiedTags: string[]) => ({ productRef: code, name, quantity, role, tags: verifiedTags, exclusionChecks: role === "unknown" ? {} : Object.fromEntries(["main", "drink", "snack"].map((key) => [key, key === role ? "present" as const : "absent" as const])) });
  const item: Item = { productRef: detail.code, quantity: 1, modifications: modifications(detail.modification, detail.supportModify), rounds: [] };
  if (detail.rounds?.length) {
    for (const round of detail.rounds) {
      const selected = round.choices.filter((choice) => choice.isDefault === 1 && choice.quantity > 0);
      const count = selected.reduce((sum, choice) => sum + choice.quantity, 0);
      if (count !== round.quantity || count < round.minQuantity || count > round.maxQuantity || !selected.length) throw new Error("Unverified composition");
      item.rounds.push({ roundRef: String(round.id), choices: selected.map((choice) => {
        if (choice.maxQuantity !== -1 && choice.quantity > choice.maxQuantity) throw new Error("Invalid choice quantity");
        components.push(component(choice.code, choice.name, choice.quantity, roles[round.name] ?? productRoles[choice.code] ?? "unknown", nameTags(choice.name)));
        return { productRef: choice.code, quantity: choice.quantity, modifications: modifications(choice.modification, choice.supportModify) };
      }) });
    }
  } else {
    // Missing rounds is not evidence that a product is a simple item.
    const knownRoles = [...new Set(categories.flatMap((name) => roles[name] ? [roles[name]] : []))];
    components.push(component(detail.code, detail.name, 1, knownRoles.length === 1 ? knownRoles[0]! : productRoles[detail.code] ?? "unknown", [...new Set([...tags, ...nameTags(detail.name)])]));
  }
  return menuOptionSchema.parse({ ref: detail.code, name: detail.name, source: "official", contextKey: contextKey(context), availability: "available", composition: detail.rounds ? "complete" : "unknown", components, items: [item], selectionHintFen: null });
}

function argsFor(context: DiningContext) {
  return context.fulfillment === "pickup" ? { storeCode: context.storeRef, orderType: 1, beType: 1 } : { storeCode: context.storeRef, orderType: 2, beType: 2, beCode: context.businessRef };
}
export function priceArguments(context: DiningContext, candidate: Candidate) {
  if (candidate.coupon) throw new Error("含券计价尚未验证，拒绝构造请求。");
  const choice = (item: Item["rounds"][number]["choices"][number]) => ({ code: item.productRef, quantity: item.quantity, ...(item.modifications.length ? { modification: { values: item.modifications } } : {}) });
  return { ...argsFor(context), needTableware: context.needTableware, items: candidate.items.map((item) => ({ productCode: item.productRef, quantity: item.quantity, ...(item.modifications.length ? { modification: { values: item.modifications } } : {}), ...(item.rounds.length ? { roundList: item.rounds.map((round) => ({ round: round.roundRef, comboItemList: round.choices.map(choice) })) } : {}) })) };
}

export function createMcdAdapter(call: McdReadCall, now = Date.now): RecommendationAdapter {
  let loadedContext = "";
  let loadedOptions: MenuOption[] = [];
  let loadVersion = 0;
  const read = async <T>(schema: z.ZodType<T>, name: ReadTool, args: Record<string, unknown>) => {
    const response = await call(name, args);
    const code = z.object({ code: z.number().optional() }).safeParse(response);
    if (code.success && code.data.code === 401) throw new ProbeError("AUTH");
    if (code.success && code.data.code === 429) throw new ProbeError("RATE_LIMIT");
    const envelope = envelopeSchema.safeParse(response);
    if (!envelope.success) throw new ProbeError("TOOL_FAILURE");
    return schema.parse(envelope.data.data);
  };
  return {
    source: "official",
    async load(context, request) {
      diningContextSchema.parse(context);
      if (context.mode !== "live") throw new Error("真实 Adapter 不接受演示模式。");
      const ownVersion = ++loadVersion;
      loadedContext = "";
      loadedOptions = [];
      if (context.fulfillment === "delivery") return { source: "official", options: [], coupons: [], claimableHints: [], issues: ["阶段 2 外送链路尚未验证，真实外送推荐已阻断。"] };
      const issues = ["真实费用完整性和含券计价尚未通过验证；不提供可购买承诺。"];
      const menu = await read(menuSchema, "query-meals", argsFor(context));
      const codes = selectDetailCodes(menu, request);
      if (!Object.keys(menu.meals).length) issues.push("当前门店没有返回可售菜单。");
      if (Object.keys(menu.meals).length > codes.length) issues.push(`本轮分散检查 ${codes.length} 个商品详情，保留套餐、低价和偏好候选，不穷尽门店菜单。`);
      const productRoles: Record<string, MenuOption["components"][number]["role"]> = {};
      for (const code of Object.keys(menu.meals)) {
        const known = [...new Set(menu.categories.filter(c => c.meals.some(m => m.code === code)).flatMap(c => roles[c.name] ? [roles[c.name]] : []))];
        if (known.length === 1 && known[0]) productRoles[code] = known[0];
      }
      const options: MenuOption[] = [];
      const unavailableItems: { name: string; reason: string }[] = [];
      const details: McdDetail[] = [];
      for (const code of codes) {
        if (ownVersion !== loadVersion) break;
        const entry = menu.meals[code];
        if (!entry || entry.canWithOrder || entry.discountType) continue;
        try {
          const detail = await read(detailSchema, "query-meal-detail", { ...argsFor(context), code });
          if (detail.code !== code) throw new Error("Product mismatch");
          details.push(detail);
        } catch (error) {
          const safe = safeProbeError(error);
          if (["AUTH", "RATE_LIMIT"].includes(safe.code)) { issues.push(safe.message); break; }
          unavailableItems.push({ name: entry.name, reason: `详情读取失败（${safe.code}），未参与推荐` });
          issues.push("部分餐品详情或默认组成无法验证，已排除。");
        }
      }
      // Classify by same-store product identity, not a guessed interpretation of “蓝区/粉区”.
      // Unknown option-group names do not inherit the parent category (they may select only sauce).
      for (const detail of details) for (const round of detail.rounds ?? []) {
        const role = roles[round.name];
        if (!role) continue;
        for (const choice of round.choices) productRoles[choice.code] = productRoles[choice.code] && productRoles[choice.code] !== role ? "unknown" : role;
      }
      for (const detail of details) {
        const categories = menu.categories.filter(category => category.meals.some(item => item.code === detail.code));
        const mapped = menuVariants(detail, request, value => mapMenuOption(context, value, categories.map(v => v.name), categories.flatMap(v => v.meals.filter(item => item.code === detail.code).flatMap(item => item.tags ?? [])), productRoles), menuHint(menu.meals[detail.code].currentPrice));
        options.push(...mapped);
        if (!mapped.length || mapped.every(o => o.composition !== "complete" || o.components.some(c => c.role === "unknown"))) unavailableItems.push({ name: menu.meals[detail.code].name, reason: "组成或规格无法验证，未参与推荐" });
      }
      const couponHints: { name: string; status: "已持有" | "可领取" | "适用性未验证"; conditions: string[] }[] = [];
      try {
        const owned = await read(ownedCouponsSchema, "query-my-coupons", { page: "1", pageSize: "200" });
        for (const coupon of owned.coupons) couponHints.push({ name: coupon.title || "已有优惠券（未提供名称）", status: "已持有", conditions: [coupon.subtitle, coupon.datetimeText, coupon.tradeStartDate && coupon.tradeEndDate ? `${coupon.tradeStartDate} — ${coupon.tradeEndDate}` : undefined, ...(coupon.tags ?? []).map(t => t.label), coupon.enable === 0 ? "官方标记当前不可用" : undefined, "本单适用性未验证，未计入报价"].filter((s): s is string => !!s) });
        if (owned.totalPages > 1) issues.push("已有券仅查询第一页，不能视为完整账户券清单。");
      } catch { issues.push("已有券读取或结构验证失败，本轮不使用优惠券。"); }
      try {
        const coupons = await read(storeCouponsSchema, "query-store-coupons", argsFor(context));
        for (const coupon of coupons) couponHints.push({ name: coupon.title || "门店优惠券（未提供名称）", status: "适用性未验证", conditions: [coupon.tradeDateTime, ...(coupon.products ?? []).map(p => p.productName), "门店返回此券，不等于当前组合已核算适用"].filter((s): s is string => !!s) });
      } catch { issues.push("门店券暂不可用，无券参考推荐继续。"); }
      let claimableHints: string[] = [];
      try { claimableHints = (await read(claimableSchema, "available-coupons", {})).map((coupon) => `${coupon.couponName}：${coupon.label}（未计入报价）`); }
      catch { issues.push("可领取券提示暂不可用。请勿据此判断没有可领取券。"); }
      if (ownVersion === loadVersion) {
        loadedContext = contextKey(context);
        loadedOptions = options;
      }
      return { source: "official", options, coupons: [], claimableHints, couponHints, unavailableItems, issues: [...new Set(issues)] };
    },
    async quote(context: DiningContext, request: MealRequest, candidate: Candidate) {
      const binding = quoteBinding(context, request, candidate);
      const base = { source: "official" as const, binding, totalFen: null, fees: null, quotedAt: now(), expiresAt: null };
      if (context.mode !== "live" || context.fulfillment === "delivery" || candidate.source !== "official" || loadedContext !== contextKey(context) || candidate.contextKey !== loadedContext || !hardConditions(candidate.components, request)) throw new Error("未经验证的真实候选。");
      const selectedOptions = candidate.items.map((item) => {
        const option = loadedOptions.find((entry) => candidateId(entry.items, null) === candidateId([item], null));
        if (!option) throw new Error("商品配置不是本次已读取的默认组成。");
        return option;
      });
      const validated = generateCandidates(context, request, { source: "official", options: selectedOptions, coupons: [], claimableHints: [], issues: [] }, now());
      if (!validated.candidates.some((entry) => entry.id === candidateId(candidate.items, candidate.coupon))) throw new Error("真实组成不满足当前硬性条件。");
      const data = await read(priceSchema, "calculate-price", priceArguments(context, candidate));
      if (data.productList && (data.productList.length !== candidate.items.length || candidate.items.some(item => !data.productList!.some(product => product.productCode === item.productRef && product.quantity === item.quantity)))) throw new ProbeError("PROTOCOL");
      const completeFields = data.deliveryPrice !== undefined && data.packingPrice !== undefined && data.tablewarePrice !== undefined;
      return quoteSchema.parse({ ...base, quotedAt: now(), totalFen: data.price,
        fees: completeFields ? { productFen: data.productPrice, discountFen: data.discount, deliveryFen: data.deliveryPrice, packingFen: data.packingPrice, tablewareFen: data.tablewarePrice } : null,
        // Stage 2 did not establish pickup fee completeness or quote/order binding.
        status: "unknown", referenceBasis: "mcd-pickup-price-fen-no-coupon", reasons: [completeFields ? "费用字段存在，但完整结算语义仍待真实验证。" : "官方费用字段不完整，不将缺失项当作零元。"],
      });
    },
  };
}
