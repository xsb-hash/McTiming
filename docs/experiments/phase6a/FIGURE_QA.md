# 阶段 6A 图表检查记录

日期：2026-10-14。模式：受控模拟实验。绘图前定义见 [FIGURE_CONTRACT.md](FIGURE_CONTRACT.md)，机器检查见 [figure-qa.json](figure-qa.json)。

## 数据与视觉核对

绘图脚本从逐场景 metrics.csv 重新计算偏好、覆盖和共同有效场景金额，并断言与 summary.csv 一致；延迟读取 timings.csv，测试数量读取实际运行后生成的 test-groups.csv。没有为了绘图调整样例、结果或排序规则。

| 图 | 样本及范围 | 实际检查 |
|---|---|---|
| 01-preference | 30 个有喜欢项场景，7 个无结果计零；另 2 个无喜欢项不计算比例 | 三项指标与汇总一致，纵轴 0—100%，来源与分母明确 |
| 02-amount | 三法均有结果的相同 25 个场景 | 22.04／22.04／24.72 元；无结果未当作零元，纵轴从零开始 |
| 03-budget-coverage | 同一请求的 6 个预算点，每点每法 n=1 | 三法重合；15 元无方案、21 元及以上有方案；不能外推用户总体覆盖率 |
| 04-safety-tests | 选定 7 个测试文件共 81 项 | 全部通过；这是 180 项自动化测试的子集，不是官方接口成功率 |
| 05-latency | 每法 960 次，预热 5 轮，同进程轮换顺序 | 中位数与 P95 来自实测；菱形表示 P95，不是误差线或置信区间 |

全部五张 PNG 已逐张打开检查：标题、图例、数值标签、坐标与脚注可读，没有裁切或遮挡。三方法采用蓝／灰／棕与不同纹理，灰度下仍能区分；预算曲线重合情况已明确。所有图注明受控模式、来源、样本量和指标边界，没有显著性星号或未经计算的误差线。

## 实际执行

```powershell
python scripts/plot-experiments.py
Get-ChildItem docs/experiments/phase6a/figures -Filter *.svg | ForEach-Object {
  python E:/codex-home/skills/academic-figure/scripts/qa_figure.py --input $_.FullName
}
```

数值重算断言全部通过。五张 SVG 均通过技能 QA 的可编辑文本、禁用色、灰度与尺寸检查；可编辑文本元素数依次为 26、18、18、26、23。SVG 保留文本，PNG 按 300 dpi 导出；各文件 SHA-256 记录在 figure-qa.json。

环境使用本机已有 Python 3.10.9、matplotlib 3.10.8、numpy 1.26.4、pandas 2.3.3。复现不依赖本机技能 QA 脚本：项目绘图脚本自身执行数值核对和 SVG 文本检查；技能 QA 是本轮额外审查。

检查通过只说明这些图与受控实验一致，不证明真实麦当劳业务效果。重新运行耗时实验后应重新生成图表并同步报告中的耗时数值。
