# McTiming 麦麦时机官

基于麦当劳 MCP 的单人餐预算与口味推荐助手。适合想在一家门店内，按预算挑选主食、饮品和可选小食的人：先排除不能接受的品类，再优先选择更合口味的组合，同等匹配程度下比较价格。

**当前版本：Live 个性化参考推荐＋模拟订单。** Live 从本次官方门店、菜单、套餐配置及无券计价生成推荐，按偏好和可比较的参考价排序；选择套餐后可进入订单核对，确认并查询本地模拟订单。参考价与最终应付金额分开，真实交易仍关闭。Demo 使用独立虚构菜单和价格。

独立参赛项目，非麦当劳官方产品；不提供营养、医疗建议。

## 能做什么

| 功能 | 当前状态 |
|---|---|
| 自取门店查询 | 真实只读验证通过；按城市和附近位置查询 |
| 菜单与套餐详情 | 有真实成功记录，也有详情失败场景；保留套餐名称与实际组成，不保证覆盖全部商品 |
| 预算、喜欢项与硬性排除 | 已实现并通过受控测试；真实组成证据不足时保守阻断，不猜配料 |
| 口味优先推荐 | Live 展示最多3份参考价在预算内的方案，按需独立展示1份更合偏好的超预算参考备选；不承诺最终支出符合预算。Demo 使用独立样例最终价 |
| 官方查询金额 | 本轮两家真实门店验证通过；显示“官方查询参考价”，附时间、偏好匹配和预算参考差额，不能进入真实核对 |
| 优惠券提示 | 已实测持有券、门店券与可领取券查询；不自动领取，不自行扣减券面金额，真实含券计价未通过 |
| Live 模拟订单 | 真实套餐 →「模拟下单」→ 第四步核对 → 明确确认 → 模拟状态；不付款、不通知门店，费用未知不补零 |
| 外送、模拟调价 | 仅独立 Demo 完成；不代表真实配送或结算能力 |
| 真实下单与支付 | 未开放；配置 Token 不会启用交易 |

## 产品展示

项目已有4张展示截图，位于 `public/showcase/`；公开前由作者确认画面内容。演示视频由作者补充，本文件不添加不存在的视频地址。

体验路径：开始推荐 → 选择样例门店 → 设置预算与口味 → 比较搭配 → 核对 → 明确确认模拟订单。也可以修改条件或选择本次不购买。

Live 路径：选择真实门店 → 查询推荐 → 点击套餐的「模拟下单」→ 第四步核对真实餐品和官方参考价 → 确认模拟订单 → 刷新模拟状态。模拟草稿从查询时间起最多保留 5 分钟，过期需重新推荐；这不是官方报价有效期保证。见 [Live 模拟订单验收](docs/LIVE_SIMULATION_ACCEPTANCE.md)。

## 安装与运行

需要 Node.js **24.x**、npm **11.x**。依赖版本固定在 `package.json` 和 `package-lock.json`。以下为 Windows PowerShell 命令，在项目根目录执行：

```powershell
npm ci
```

### Demo 模式（不需要 Token）

```powershell
$env:MCTIMING_MODE = "demo"
$env:MCD_MCP_TOKEN = " "
$env:NEXT_PUBLIC_MCD_MCP_TOKEN = " "
npm run dev
```

打开 http://127.0.0.1:3000 。页面持续显示“样例演示，不产生真实订单。”

这里两个引号之间**各有一个空格**：用进程变量覆盖 `.env.local` 中可能已有的凭证，配置解析时会去掉空白。部分 PowerShell 版本把空字符串当作移除变量，Next.js 随后可能重新读取文件中的 Token。上述操作只影响当前终端，不删除本机凭证，也不保存真实凭证到公开变量。新终端需重新设置。公开部署同样必须使用 demo，且部署环境不配置任何真实 Token。

### 本地真实 MCP 只读模式

从[官方平台](https://open.mcd.cn/mcp)申请自己的 Token。若根目录还没有 `.env.local`，先复制示例；已有文件不要覆盖：

```powershell
if (-not (Test-Path -LiteralPath .env.local)) { Copy-Item .env.example .env.local }
code .env.local
```

可选择把自己的 Token 保存在 `.env.local`，或通过已有的服务端环境变量提供。不要添加 `NEXT_PUBLIC_` 前缀，不把凭证发送到聊天或提交 Git。

**如果使用 `.env.local`**，先在编辑器确认 `MCTIMING_MODE=live`、`MCD_MCP_TOKEN` 已填写，再清除之前 Demo 的进程覆盖值：

```powershell
Remove-Item Env:MCTIMING_MODE -ErrorAction SilentlyContinue
Remove-Item Env:MCD_MCP_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:NEXT_PUBLIC_MCD_MCP_TOKEN -ErrorAction SilentlyContinue
npm run mcp:smoke
npm run dev
```

**如果 Token 已由当前终端或系统环境提供**，保留 `MCD_MCP_TOKEN`，只设置 `$env:MCTIMING_MODE="live"` 后执行 `npm run mcp:smoke`、`npm run dev`。不要清除唯一的凭证来源；`.env.local` 为空时，清除环境变量会导致“未配置 Token”。

探针默认仅完成 initialize 和 tools/list，不代表推荐或交易验证通过。网页路径：到店自取 → 输入城市和位置 → 查询真实门店并选店 → 设置预算与喜欢项 → 生成搭配。可先试预算25元、喜欢鸡肉和无糖饮品、不选排除项。真实排除证据不足时会安全阻断，不能用名称猜测“不含”。

`npm run mcp:live-check -- --city 唐山市 --keyword 路北区` 可用自己的凭证复跑两店参考推荐及排除项阻断检查，脱敏结果保存在 `.local/live-recommendation-check.json`。菜单、可售规格和价格随门店及时间变化，不保证复现固定金额。

网页由 Next.js 加载环境；CLI 显式加载根目录 `.env.local`，进程变量优先。CLI 不自动读取 `.env.production` 等文件。切换模式或修改凭证后，先 Ctrl+C 停止旧服务，再重启。真实服务默认只监听 `127.0.0.1`，不要公开部署 live。

常见问题：`DEMO_BLOCKED` 表示仍在演示模式；“demo 模式不接受真实凭证”请使用上面的单空格覆盖；“未配置 Token”请清除终端旧覆盖值并检查本地文件；`AUTH` 表示鉴权/权限失败；网络错误不应被当成 Demo 成功。详见 [MCP 配置与错误说明](docs/MCP_SETUP.md)。

### 生产运行与检查

在已设置 Demo 环境的同一终端执行：

```powershell
npx next typegen
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run check:sensitive
npm start
```

Playwright 在 Windows 默认使用已安装的 Microsoft Edge，测试占用 3300–3302 端口。其他平台先执行 `npx playwright install chromium`；可用 `PLAYWRIGHT_CHANNEL=chromium` 选择 Chromium。自动截图、录像与 trace 默认关闭；已有测试截图助手仅在显式设置 `MCTIMING_CAPTURE_SCREENSHOTS=1` 时启用。发布验收不启用它。

## 技术架构

单个 Next.js App Router 应用，React、TypeScript、Tailwind CSS、Zod；不依赖数据库或额外大模型 API。

```text
src/app/                 页面和同源业务 API
src/components/          条件表单、推荐结果和订单核对
src/domain/              数据校验、候选生成、排序与报价绑定
src/server/              会话、推荐编排、草稿和交易状态机
src/server/demo/         独立虚构数据与确定性模拟交易
src/server/mcd/          官方 SDK、只读白名单、真实字段映射、禁用的写边界
scripts/                 本地探针、脱敏验证与受控实验
tests/                   Vitest 和 Playwright
experiments/phase6a/     可复现的人工实验数据及对照算法
```

模式由服务端选择。Token 只在本机服务端使用；浏览器没有通用 MCP 工具代理。会话与草稿保存在单进程内存，进程重启后失效。

## MCP 集成

连接 `https://mcp.mcd.cn`，协议 Streamable HTTP；使用锁定的 `@modelcontextprotocol/client@2.3.1`。当前真实链路为：附近门店 → 当前菜单 → 套餐及合法替换配置/单品 → 有限候选 → 无券 `calculate-price` → 偏好排序和参考预算分组。已有券与可领取券只提示，不自行扣减。最新实测见 [Live 验收报告](docs/LIVE_RECOMMENDATION_ACCEPTANCE.md)。

工具用途、实际成功/失败证据和复现命令见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md)。[mcp-config.example.json](mcp-config.example.json) 是参赛用脱敏配置示例，`${MCD_MCP_TOKEN}` 仅表示环境变量占位符；**本应用不读取这个 JSON，也不替它展开变量**。外部 MCP 客户端需按自身文档配置，不能假定它支持该语法。

配置读取方式、环境变量优先级与外部客户端兼容性见[配置兼容说明](docs/CONFIG_COMPATIBILITY.md)。源码和证据材料的具体提交范围见[提交文件说明](docs/SUBMISSION_FILES.md)。

## 推荐算法与实验

硬条件过滤 → 命中的不同喜欢项数量降序 → 同口径金额升序 → 稳定标识。Live 参考价单独分组；未知口径不做价格排序或预算差额。候选同时考虑有证据支持的套餐和单品组合；每轮有限计价，不承诺全店最低价或全局最优。

阶段6A为 **31个人工场景＋1个 Demo 场景**，不是实际用户实验或麦当劳真实优惠收益。30个有喜欢项场景包含无结果记零；平均金额取三法都有推荐的相同25个场景：

| 方法 | Top-1喜欢项匹配 | 首选平均样例金额 | 有预算内结果 |
|---|---:|---:|---:|
| A 无券价格排序 | 38.33% | ¥22.04 | 25/32 |
| B 适用券价格排序 | 38.33% | ¥22.04 | 25/32 |
| McTiming 口味优先 | 68.33% | ¥24.72 | 25/32 |

这份受控数据上，口味匹配提高但平均多花 ¥2.68，覆盖率没有提高；无喜欢项、便宜方案已匹配或预算很紧时不占优势。券后价来自对应样例报价，不是直接减券面额。完整定义与记录见 [实验报告](docs/EXPERIMENT_REPORT.md)。`npm run experiment:phase6a` 可重跑数据计算（会更新 CSV/JSON，不生成图片）。

## 当前限制与发布状态

真实报价的完整费用、外送闭环、含券计价与完整配料证据仍有缺口；部分套餐详情会失败。真实订单、真实地址保存和支付保持关闭。参考金额不能作为最终应付承诺。Demo 食物图是 AI 生成示意，非官方实物照片。

项目自有源码采用 [MIT 许可证](LICENSE)，版权署名为 McTiming contributors。第三方依赖、官方内容和另有声明的素材不被重新授权，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。发布检查及人工报名步骤见 [RELEASE_AUDIT.md](docs/RELEASE_AUDIT.md)。本地测试通过不等于已公开发布或已通过比赛资格审核。
