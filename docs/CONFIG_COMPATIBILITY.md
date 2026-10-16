# MCP 配置示例与兼容性

本项目采用服务端环境变量和SDK连接；根目录 `mcp-config.example.json` 是比赛要求的脱敏结构示例，不是McTiming启动时读取的文件。

## 哪种配置实际生效

| 使用位置 | 读取方式 | 已核对范围 |
|---|---|---|
| McTiming网页 | Next.js加载环境，服务端parseConfig读取MCTIMING_MODE和MCD_MCP_TOKEN | 本项目实际实现；Demo/缺凭证/虚构凭证边界已有自动化测试 |
| 本地mcp:smoke、mcp:phase5b脚本 | scripts/load-local-env.ts显式读取根目录.env.local，当前进程值优先 | 本项目实际实现；不会自动读JSON示例或.env.production |
| mcp-config.example.json | 只表达Server、Streamable HTTP和Authorization结构 | JSON及字段已检查；`${MCD_MCP_TOKEN}`是占位符，不是实际凭证 |
| 其他MCP客户端 | 按客户端自己的环境变量/密钥注入机制配置 | 未逐客户端验证；不能承诺VS Code、Codex、WorkBuddy等都接受同一种type值或变量语法 |

示例沿用[官方MCP说明](https://github.com/M-China/mcd-mcp-server)的 `mcpServers`、`type: streamablehttp`、`url: https://mcp.mcd.cn` 和Bearer结构。外部客户端若要求其他字段名或变量语法，应按其官方文档在本机适配；不要把真实Token写回示例并提交。

## 在本项目中运行

1. 安装Node 24.x和npm 11.x，在项目根目录执行 `npm ci`。
2. Demo无需真实凭证；PowerShell使用下列单空格覆盖，防止本机.env.local中的Token被加载：

```powershell
$env:MCTIMING_MODE='demo'
$env:MCD_MCP_TOKEN=' '
$env:NEXT_PUBLIC_MCD_MCP_TOKEN=' '
npm run dev
```

3. 使用真实只读查询时，在编辑器中把本机.env.local设为live并填写自己的Token，然后清除终端旧覆盖值再启动。具体命令见[README](../README.md)。不要通过命令参数、截图或聊天传递Token。
4. `npm run mcp:smoke`默认仅做初始化与工具发现，成功不等于报价或交易验证通过。JSON示例无需导入，也无需修改才能运行此命令。

进程环境中的单空格会覆盖文件，随后被trim为空；Windows某些PowerShell版本中空字符串会移除变量，所以文档有意使用单空格。禁止设置非空NEXT_PUBLIC_MCD_MCP_TOKEN；Token始终只在服务端使用。

## 本轮检查结论

- JSON可解析；地址、协议类型和Header结构与官方示例对应；凭证值仅为环境变量占位符。
- .env.example默认demo且Token为空；package.json与lockfile的依赖声明一致。
- 此前实际执行的缺Token探针返回MISSING_TOKEN且未发送请求；环境优先级和Demo拒绝非空凭证有现有测试覆盖。
- 本轮不连接真实MCP，也不把外部客户端尚未验证的配置标记为可直接使用。
