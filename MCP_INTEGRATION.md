# McTiming 的麦当劳 MCP 集成

核对日期：2026-10-16。本文件区分历史真实调用、受控模拟与尚未验证的能力；本次发布整理没有新增 MCP 调用。

## 服务、协议和实现

- 官方服务：`https://mcp.mcd.cn`；[官方接入说明](https://github.com/M-China/mcd-mcp-server)。
- 传输：Streamable HTTP，服务端 `Authorization: Bearer` 鉴权。
- 锁定依赖：`@modelcontextprotocol/client@2.3.1`；`Client`、`StreamableHTTPClientTransport` 从包根导入，`AjvJsonSchemaValidator` 从 `/validators/ajv` 导入。不是 v1 SDK 路径。
- 实现：[probe.ts](src/server/mcd/probe.ts)、[只读白名单](src/server/mcd/read-only.ts)、[真实 Adapter](src/server/mcd/adapter.ts)、[模式选择](src/server/recommend-runtime.ts)。每次连接发现工具并按真实输入 Schema 验证参数，地址固定，禁止重定向携带凭证。
- `MCD_MCP_TOKEN` 只在本机服务端/CLI 使用；Demo 拒绝非空凭证，使用独立 Adapter，连接失败不会伪装成 Demo 成功。

## 工具与真实验证边界

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

2026-10-16的菜单与失败详情使用已连接的官方 MCP 工具复核；不冒充项目 SDK 当天新完成端到端验证。见[最新套餐覆盖记录](docs/mcp/PACKAGE_COVERAGE_2026-10-16.json)。

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
