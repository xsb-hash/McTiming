# 依赖与素材来源

核对日期：2026-10-16。此文件记录发布检查结果，不替代依赖自身 LICENSE/NOTICE，项目自有源码许可证见下文。

## 源码授权

经用户授权选择，项目自有源码采用 [MIT License](LICENSE)，版权署名为 `Copyright (c) 2026 McTiming contributors`，不使用或公开个人身份信息。MIT允许使用、修改、商业使用及再分发，要求保留版权与许可声明。许可原文依据[GitHub维护的MIT模板](https://choosealicense.com/licenses/mit/)。

该许可仅适用于项目贡献者有权授权且未另作许可声明的内容，不重新授权第三方依赖、官方文档、商标、服务或权利尚未核实的素材；这些内容继续适用各自的许可和服务条款。

## 软件依赖

来源为实际 `package-lock.json` 和本机已安装包的许可证元数据；322个依赖条目均有声明（含不同平台的可选包，不代表全部在本机运行）。源码仓库不包含 node_modules 或构建二进制。

| 组件 | 锁定版本或范围 | 许可证声明 |
|---|---|---|
| Next.js | 16.4.0 | MIT |
| React / React DOM | 19.3.0 | MIT |
| MCP TypeScript Client | 2.3.1 | Apache-2.0 |
| Zod | 4.6.6 | MIT |
| server-only | 0.0.1 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| Playwright | 1.64.0 | Apache-2.0 |
| Tailwind CSS / PostCSS 插件 | 4.3.3 | MIT |
| PostCSS | 8.5.29 | MIT |
| Vitest | 5.0.3 | MIT |
| ESLint | 10.12.0 | MIT |
| Babel core / ESLint parser | 8.0.7 | MIT |
| tsx | 4.23.15 | MIT |
| Node / React / React DOM 类型声明 | 24.19.2 / 19.3.0 / 19.3.0 | MIT |
| 其他开发及传递依赖 | 版本见 lockfile | MIT、Apache-2.0、ISC、BSD、0BSD、BlueOak 等 |
| sharp / libvips 平台依赖 | 版本见 lockfile | 部分平台含 LGPL-3.0-or-later 与组合许可 |
| lightningcss 及平台依赖 | 版本见 lockfile | MPL-2.0 |
| caniuse-lite 数据 | 版本见 lockfile | CC-BY-4.0 |

不能把整个依赖树概括为“全部 MIT”。安装后保留各包的许可证与版权文件。若另行发布 node_modules、独立二进制或修改上述组件，应另行检查对应 LGPL/MPL 源码和再分发义务、CC-BY 署名；本轮未制作这些分发物。以上是元数据核对，不是完整法律意见或权利担保。

完整322条锁定依赖及其许可证声明见[依赖清单](docs/DEPENDENCY_LICENSES.md)。该清单可按安装路径追溯到lockfile；同一组件在不同路径或不同平台出现时分别列出，没有隐藏平台二进制的许可证差异。

## 页面素材

- `public/images/demo-chicken.png`、`public/images/demo-beef.png`：前期 UI 实施生成的 AI 食物示意图；页面明确标注非实物照片，不代表麦当劳官方产品摄影。作者仍需确认生成服务条款、输入素材权利及公开使用范围；本轮未生成或编辑图像。
- `src/components/meal-art.tsx`：项目内联 SVG 示意组件；未发现单独外部素材包声明，不能仅凭这一点认定所有权。作者应确认创作来源。
- 中文字体采用系统字体回退（Arial、Microsoft YaHei、sans-serif）；仓库未分发字体文件，未使用外部字体下载。
- `docs/screenshots/` 为历史开发截图，`docs/experiments/phase6a/figures/` 为已有受控实验图；此次不制作新素材。公开前由作者检查画面中的个人信息、第三方标识和时效性。
- `public/showcase/home.png`、`preferences.png`、`recommendations.png`、`checkout.png`：当前已存在的项目展示截图。此次只记录文件和用途，未生成、修改或自动认定截图内容已经完成隐私审核；截图中的演示价格或参考金额不构成真实交易凭证。
- `docs/mcp/` 保存官方字段/Schema及脱敏验证证据；这不转移官方文档、商标或数据的权利。来源为[麦当劳 MCP](https://github.com/M-China/mcd-mcp-server)，用于说明接口集成。
- `CONTEST_DECLARATION.md` 按[官方参赛声明](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/CONTEST_DECLARATION.md)原文复制，不作原创声明。
- 本机安装的 Impeccable 等 Skill 未复制进项目分发目录；开发时使用工具不等于把工具源码作为项目原创内容。

这些权利确认应在作者接受参赛声明并公开仓库之前完成。

## 提交与再分发边界

本次交付的是项目源码、配置示例、测试及证据材料；通过npm安装第三方依赖，不把node_modules或.next作为源码附件上传。官方商标、商品名称、工具描述和外部服务不因本项目发布而改变权利归属。源码使用何种许可证与第三方包各自的许可是两件事，添加项目LICENSE也不能覆盖第三方许可。

用户已授权完善本文件及准备相关提交材料；这项授权不被写成未经核实的第三方权利证明。本文件保留能够追溯的事实和确实需要作者确认的范围。
