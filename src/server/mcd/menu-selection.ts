import { candidateId, compareId, type MealRequest, type MenuOption } from "../../domain/meal";
import { RECOMMEND_LIMITS } from "../../domain/recommend";
import type { McdDetail } from "./contracts";

// Literal name matches are soft preferences only, never evidence of ingredient absence.
export function nameTags(name: string): string[] {
  return Object.entries({ chicken: /鸡/, beef: /牛肉|牛堡/, "sugar-free": /无糖/, fruit: /果汁|苹果|橙|柠檬|柠柠/, potato: /薯/, spicy: /辣/ })
    .filter(([, pattern]) => pattern.test(name)).map(([tag]) => tag);
}
export function menuHint(value?: string): number | null {
  if (!value || !/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function difference(value?: string): number | null {
  const match = value?.match(/^([+-])\s*[¥￥](\d+(?:\.\d{1,2})?)$/);
  const amount = match ? menuHint(match[2]) : null;
  return amount === null ? null : amount * (match![1] === "-" ? -1 : 1);
}
type Menu = { categories: { name: string; meals: { code: string }[] }[]; meals: Record<string, { name: string; currentPrice?: string; canWithOrder?: boolean; discountType?: string }> };
export function selectDetailCodes(menu: Menu, request: MealRequest): string[] {
  const codes = [...new Set(menu.categories.flatMap(c => c.meals.map(m => m.code)))].filter(code => menu.meals[code] && !menu.meals[code].canWithOrder && !menu.meals[code].discountType);
  const cheap = (a: string, b: string) => (menuHint(menu.meals[a].currentPrice) ?? Infinity) - (menuHint(menu.meals[b].currentPrice) ?? Infinity) || compareId(a, b);
  const preferred = (a: string, b: string) => request.likedTags.filter(t => nameTags(menu.meals[b].name).includes(t)).length - request.likedTags.filter(t => nameTags(menu.meals[a].name).includes(t)).length || cheap(a, b);
  const packages = codes.filter(code => menu.categories.some(c => /单人餐|随心配|大卡套餐/.test(c.name) && c.meals.some(m => m.code === code))).sort(cheap);
  const categories = menu.categories.map(c => c.meals.map(m => m.code).filter(code => codes.includes(code)).sort(cheap));
  const diverse: string[] = [];
  for (let i = 0; i < codes.length; i++) for (const category of categories) if (category[i]) diverse.push(category[i]);
  const streams = [packages, [...codes].sort(cheap), [...codes].sort(preferred), diverse];
  const selected = new Set<string>();
  for (let i = 0; i < codes.length && selected.size < RECOMMEND_LIMITS.detailQueries; i++) for (const stream of streams) {
    if (stream[i] && selected.size < RECOMMEND_LIMITS.detailQueries) selected.add(stream[i]);
  }
  return [...selected];
}

// Bounded exploration: defaults, preference leaders, lower price hints and single-round replacements.
// Every variant still requires its own official calculate-price response.
export function menuVariants(detail: McdDetail, request: MealRequest, map: (detail: McdDetail) => MenuOption, hint: number | null): MenuOption[] {
  const variants = new Map<string, MenuOption>();
  const add = (value: McdDetail) => {
    try {
      const option = map(value);
      const diffs = (value.rounds ?? []).flatMap(r => r.choices.filter(c => c.quantity > 0 && c.isDefault === 1).map(c => difference(c.diffPrice)));
      const adjustment = diffs.every(d => d !== null) ? diffs.reduce<number>((sum, d) => sum + d!, 0) : null;
      option.selectionHintFen = hint !== null && adjustment !== null && hint + adjustment >= 0 ? hint + adjustment : null;
      variants.set(candidateId(option.items, null), option);
    } catch { /* Unsupported configuration does not discard another valid configuration. */ }
  };
  add(detail);
  const rounds = detail.rounds;
  if (!rounds?.length || rounds.some(r => r.quantity !== 1 || r.minQuantity !== 1 || r.maxQuantity !== 1)) return [...variants.values()];
  const choices = rounds.map(r => r.choices.filter(c => c.maxQuantity === -1 || c.maxQuantity >= 1));
  if (choices.some(c => !c.length)) return [...variants.values()];
  const cheaper = (a: (typeof choices)[number][number], b: (typeof choices)[number][number]) => (difference(a.diffPrice) ?? Infinity) - (difference(b.diffPrice) ?? Infinity) || compareId(a.code, b.code);
  const preferred = choices.map(list => [...list].sort((a, b) => request.likedTags.filter(t => nameTags(b.name).includes(t)).length - request.likedTags.filter(t => nameTags(a.name).includes(t)).length || cheaper(a, b)));
  const cheapest = choices.map(list => [...list].sort(cheaper));
  const select = (selected: string[]) => add({ ...detail, rounds: rounds.map((r, index) => ({ ...r, choices: r.choices.map(c => ({ ...c, quantity: c.code === selected[index] ? 1 : 0, isDefault: c.code === selected[index] ? 1 : 0 })) })) });
  select(preferred.map(list => list[0].code));
  select(cheapest.map(list => list[0].code));
  for (let i = 0; i < rounds.length && variants.size < 8; i++) for (const choice of preferred[i]) {
    if (variants.size >= 8) break;
    select(preferred.map((list, index) => index === i ? choice.code : list[0].code));
  }
  return [...variants.values()];
}
