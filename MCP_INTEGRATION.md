# McTiming 的麦当劳 MCP 集成

核对日期：2026-10-17。本文件区分真实只读联调、历史记录、受控模拟与尚未验证的能力。2026-10-16完成 Live 个性化参考推荐升级；2026-10-17增加真实参考套餐的本地模拟核对与订单状态。历史阶段5B记录保留于后文。

## Live 模拟订单（2026-10-17）

真实推荐现在附带会话内专用的模拟选择 ID。点击「模拟下单」后，服务端根据保存的候选和报价生成草稿，商品与价格来源仍为 official、报价状态仍为 unknown、未知费用仍为空；没有切换成 Demo 菜单或伪造最终金额。模拟创建和状态复用原 Demo 交易模拟器，使用 DEMO 前缀编号，不连接 MCP 写工具或支付链接。正式交易入口依然禁用。详细测试和实测见 [验收报告](docs/LIVE_SIMULATION_ACCEPTANCE.md) 与 [脱敏页面证据](docs/mcp/LIVE_SIMULATION_2026-10-17.json)。

## 服务、协议和实现

- 官方服务：`https://mcp.mcd.cn`；[官方接入说明](https://github.com/M-China/mcd-mcp-server)。
- 传输：Streamable HTTP，服务端 `Authorization: Bearer` 鉴权。
- 锁定依赖：`@modelcontextprotocol/client@2.3.1`；`Client`、`StreamableHTTPClientTransport` 从包根导入，`AjvJsonSchemaValidator` 从 `/validators/ajv` 导入。不是 v1 SDK 路径。
- 实现：[probe.ts](src/server/mcd/probe.ts)、[只读白名单](src/server/mcd/read-only.ts)、[真实 Adapter](src/server/mcd/adapter.ts)、[模式选择](src/server/recommend-runtime.ts)。每次连接发现工具并按真实输入 Schema 验证参数，地址固定，禁止重定向携带凭证。
- `MCD_MCP_TOKEN` 只在本机服务端/CLI 使用；Demo 拒绝非空凭证，使用独立 Adapter，连接失败不会伪装成 Demo 成功。

## 最新 Live 参考推荐（2026-10-16）

两家真实门店已通过本轮项目 SDK 链路：选店 → 当前菜单 → 详情及实际轮次/特调 → 有限候选 → 官方 `calculate-price` → 非交易参考推荐。最终验收调用109次：附近门店1、菜单3、详情72、已有券3、门店券3、可领取券3、计价24；第三轮菜单用于验证排除证据不足时阻断。另有两店真实网页操作，未拦截为模拟数据。

预算25元、喜欢鸡肉和无糖饮品时，两家门店均取得“随心配”麦香鸡＋无糖可乐的13.90元参考金额。该数值是本轮样本，不是固定推荐价或最终支付保证。完整记录、输入配置、菜单和报价字段见 [本轮脱敏证据](docs/mcp/LIVE_RECOMMENDATION_2026-10-16.json)，实际发现的字段见 [本轮只读工具Schema](docs/mcp/LIVE_TOOL_SCHEMAS_2026-10-16.json)，结论见 [验收报告](docs/LIVE_RECOMMENDATION_ACCEPTANCE.md)。

- 套餐保持官方父商品编号和实际轮次，不拆成单品加总。支持有完整Schema的单选轮次替换，最多每商品8种配置。
- 分类按已验证的轮次标签及同店商品编号关联；不把“蓝区”“粉区”或杂项分类直接猜成主食/饮品/小食。名称中的明确词语只用于软偏好，不证明配料缺失。
- 详情上限24，计价上限12，并发2；同时保留菜单低价提示、偏好与类别多样性。菜单价和差价仅引导候选选择，最终展示金额均重新询价。
- `data.price` 为整数分现价。内部 `referenceBasis=mcd-pickup-price-fen-no-coupon` 表示本轮同店、同方式、同餐具条件的无券参考口径，**不是官方字段**。字段不明的记录不计算预算差额或按价格排序。
- 参考推荐保留 `Quote.status=unknown`，使用独立 `referencePrices`；最终费用已核实的 `budgetOptions` 不混入参考记录。参考价在预算内不等于严格最终预算满足。
- 优惠券按真实名称、已持有/适用性未验证和官方条件投影；不暴露券码或资产ID。含券核算仍未放行，读取失败不阻断无券推荐。
- 条件和门店变化会使旧推荐、报价、草稿失效；旧请求不能覆盖新请求。参考记录不带真实交易授权；2026-10-17 起另提供仅限本地模拟核对的 ID，真实写 Adapter 仍禁用。

复现：配置自己的服务端凭证及 `MCTIMING_MODE=live` 后运行 `npm run mcp:live-check`，或 `npm run dev` 在网页选店。若凭证来自环境变量，保留该变量；只有确认 `.env.local` 已填入Token后，才清除终端覆盖值。测试没有调用订单、地址保存、领券、积分或支付工具。

## 历史工具与真实验证边界

2026-10-14 阶段5B通过项目 SDK 发现35个工具，进行了28次只读业务调用、涉及9种工具。成功空列表不等于后续流程可用。证据：[调用索引](docs/mcp/PHASE5B_CALL_INDEX_2026-10-14.json)、[实际 Schema](docs/mcp/TOOL_SCHEMAS_2026-10-14.json)、[阶段5B报告](docs/PHASE5B_VALIDATION.md)。

| 工具 | 作用 | 真实证据与状态 |
|---|---|---|
| now-time-info | 核实服务时间 | 真实验证通过，3次；用于探针/验证，不参与推荐排序 |
| query-nearby-stores | 查询附近门店及营业状态 | 真实验证通过，3次；使用城市和位置关键词 |
| query-meals | 获取门店菜单和套餐编码 | 真实验证通过，3次；2026-10-16另一次返回早餐菜单 |
| query-meal-detail | 获取套餐轮次、默认选项与特调 | 2026-10-14有5次成功；2026-10-16两款龙焰套餐查询失败，success=false、code=60001，不臆测错误码原因 |
| query-my-coupons | 读取已持有券 | 真实验证通过，3次；当时2张，不表示所有券均适用于当前组合 |
| query-store-coupons | 查询门店/方式下的适用券 | 真实验证通过，3次；1张已有券可在内存匹配，关联另一款咖啡商品 |
| available-coupons | 展示可领取券 | 真实验证通过，3次；7条提示，未领取、不进入报价扣减 |
| calculate-price | 按商品完整配置查询官方金额 | 无券自取真实验证通过，2次；完整费用验收未通过，含券及外送未执行 |
| delivery-query-addresses | 读取已有配送地址 | 真实验证通过，3次均为空；账户无可用于后续验证的地址 |
| delivery-query-stores | 按已有地址查询配送门店 | 当前缺少验证条件，未执行 |
| query-order | 查询已创建订单 | 未执行；只检查 Schema，没有本次真实订单号 |
| delivery-create-address / create-order | 地址保存与订单创建 | 未执行，仅审查 Schema；真实写入保持关闭 |

以下早期2026-10-16菜单与失败详情使用已连接的官方 MCP 工具复核；它们与本文件开头的新一轮项目SDK端到端证据分开记录。见[最新套餐覆盖记录](docs/mcp/PACKAGE_COVERAGE_2026-10-16.json)。

## 一条有真实证据的只读链路

2026-10-14，在用户指定的唐山市路北区，从实时返回中选取营业门店，再获取其菜单。选择“精选单人餐三件套”，按详情默认轮次构造板烧鸡腿堡、中薯条、中杯可乐各1份，并保留真实特调字段。该请求是**一个套餐商品及其三个轮次**，不是把单品价格加起来冒充套餐价格。

检查已有券与门店券后，没有对这个套餐使用不适用的咖啡券；调用无券 `calculate-price`，返回 `data.price=3450`、`productPrice=3450`、`discount=0`。Schema明确这些字段单位为整数分，所以当前查询金额为 ¥34.50。

这是一次真实报价返回，不是 Demo。但 `packingPrice`、`tablewarePrice` 等字段缺失，缺省不等于零；取餐方式与创建金额的绑定也未确认。因此 Quote 保持 unknown，**可购买推荐为空**；当前网页可以独立展示参考金额和时间，不能据此进入核对。详见[脱敏响应](docs/mcp/PHASE5B_VALIDATION_2026-10-14.json)及[金额语义审计](docs/PRICE_SEMANTICS_AUDIT.md)。历史金额不硬编码为当前价格。

MCP 提供真实门店商品、套餐组成和询价输入，推荐引擎负责模板、排除、有限候选与偏好排序。信息不可靠时阻断，不能用更强的文案或 Demo 数据补齐官方字段。最新修复支持已有证据中的“选择主食”“选择小食”轮次，并保留套餐名称；详情失败、未知配料和费用缺口仍存在，见[套餐覆盖修复](docs/PACKAGE_COVERAGE_FIX.md)。

## 本机复现

先按 [README](README.md) 使用自己的 Token 配置 `.env.local`，清除终端中旧的 Demo 环境覆盖值；不要把凭证作为命令参数传入。

```powershell
npm ci
npm run mcp:smoke
npm run mcp:phase5b -- --help
npm run mcp:phase5b -- --city 唐山市 --keyword 路北区 --budget-fen 4000
```

smoke 只握手和发现工具。phase5b 重新查营业门店、菜单、已有地址数量和券，最多抽取3个常规套餐详情及1个券关联商品，配置可靠时才询价。不沿用历史店号或商品号，不领券、不保存地址、不创建/查询订单。

脱敏结构输出到被忽略的 `.local/phase5b-validation.json` 和 `.local/phase5b-schemas.json`。退出0代表取证脚本完成，不保证产生可信推荐。时段、账户和可售配置会改变；当商品不存在、详情失败或费用未知时，应保留真实失败/阻塞，不强求复现34.50元。网页复现入口是自取门店查询与参考金额展示。

## 尚未完成与 Demo 边界

- 外送：已有地址为空；配送门店、完整配送/包装/餐具费用未形成真实证据链。Demo 地址均为虚构，不保存到 MCP。
- 优惠：已有适用券关联商品存在必选特调组为空的情况，不能构造可靠输入，未执行含券计价。券叠加规则未验证。Demo 的独立含券报价只验证本地实现。
- 排除：角色标签不等于完整配料。真实食材/口味信息不足时不能承诺符合排除条件。
- 交易：当前已保存 Schema 没有可依赖的报价绑定、预期金额或幂等键契约；超时无订单号时不能可靠恢复。不能由“未声明”推断官方绝对没有内部保护。
- `create-order` 描述声明订单ID及支付字段，但真实写入未执行，未验证支付链接。真实写 Adapter 没有传输调用入口，Token/网页参数不能开启它。
- 订单核对、并发保护、价格变化后二次确认、结果未知不重试与订单状态均通过受控模拟测试，**不等于官方交易成功**。

参赛配置 [mcp-config.example.json](mcp-config.example.json) 只含环境变量占位符；应用实际使用环境变量和 SDK，不解析该 JSON。外部客户端需自行核实其环境变量展开语法。
