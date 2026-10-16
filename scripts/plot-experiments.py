"""Plot measured phase 6A artifacts; no network, no embedded experiment values."""
import json
import hashlib
from pathlib import Path
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/experiments/phase6a"
OUT = DATA / "figures"
OUT.mkdir(exist_ok=True)
METHODS = ["A", "B", "McTiming"]
COLORS = ["#3B6BA5", "#8A8A8A", "#B87A4A"]
HATCHES = ["//", "..", "xx"]

def apply_pub_style():
    plt.rcParams.update({"font.family": "sans-serif", "font.sans-serif": ["Arial", "DejaVu Sans"], "font.size": 10, "axes.titlesize": 13, "axes.labelsize": 10, "xtick.labelsize": 9, "ytick.labelsize": 9, "legend.fontsize": 9, "svg.fonttype": "none", "svg.hashsalt": "mctiming-phase6a", "figure.dpi": 150, "savefig.dpi": 300, "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False})

apply_pub_style()
summary = pd.read_csv(DATA / "summary.csv").set_index("method").loc[METHODS]
metrics = pd.read_csv(DATA / "metrics.csv")
timings = pd.read_csv(DATA / "timings.csv")
tests = pd.read_csv(DATA / "test-groups.csv")
dataset = json.loads((DATA / "dataset.json").read_text(encoding="utf-8"))
metadata = json.loads((DATA / "timing.json").read_text(encoding="utf-8"))
paired_ids = metrics.groupby("caseId").top1Fen.count()
paired_ids = paired_ids[paired_ids == 3].index

# Recompute plotted values from per-case CSV, independent of the report prose.
for method in METHODS:
    group = metrics[metrics.method == method]
    assert len(group) == summary.loc[method, "cases"]
    for column in ["top1Match", "averageMatch", "top3Coverage"]:
        assert np.isclose(group[column].mean(), summary.loc[method, column])
    assert np.isclose((group.defaultCount > 0).mean(), summary.loc[method, "coverage"])
    assert np.isclose(group[group.caseId.isin(paired_ids)].top1Fen.mean(), summary.loc[method, "meanFenPaired"])

def finish(fig, name, note):
    fig.text(.02, .025, "CONTROLLED SIMULATION — not official McDonald's prices or live transactions.\n" + note, fontsize=8, va="bottom")
    fig.tight_layout(rect=(0, .17, 1, .98))
    fig.savefig(OUT / f"{name}.svg", metadata={"Date": None, "Description": note})
    fig.savefig(OUT / f"{name}.png", dpi=300)
    plt.close(fig)

n_pref = int(summary.iloc[0].withPreferences)
empty = int(summary.iloc[0]["empty"])
fig, ax = plt.subplots(figsize=(8, 4.7))
for i, method in enumerate(METHODS):
    vals = summary.loc[method, ["top1Match", "averageMatch", "top3Coverage"]].astype(float).to_numpy() * 100
    bars = ax.bar(np.arange(3) + (i - 1) * .25, vals, .23, label=method, color=COLORS[i], hatch=HATCHES[i], edgecolor="white")
    ax.bar_label(bars, fmt="%.1f", fontsize=8, padding=3)
ax.set_xticks(range(3), ["Top-1 match", "Mean displayed match", "Top-3 union coverage"])
ax.set_ylabel("Liked tags matched (%)")
ax.set_ylim(0, 100); ax.legend(ncol=3, loc="upper left")
ax.set_title("Preference-first ranking matches more liked tags in this dataset")
finish(fig, "01-preference", f"Source: metrics.csv / summary.csv; n={n_pref} preference cases, {empty} no-result cases included as 0.\nNo-preference cases excluded only from this ratio; no significance test or confidence intervals.")

fig, ax = plt.subplots(figsize=(8, 4.7))
for i, method in enumerate(METHODS):
    value = summary.loc[method, "meanFenPaired"] / 100
    bars = ax.bar(i, value, .55, color=COLORS[i], hatch=HATCHES[i], edgecolor="white")
    ax.bar_label(bars, fmt="%.2f", padding=4)
ax.set_xticks(range(3), METHODS); ax.set_ylabel("Mean Top-1 payable (CNY)")
ax.set_ylim(0, summary.meanFenPaired.max() / 100 * 1.25)
ax.set_title("Higher preference match has a price trade-off")
finish(fig, "02-amount", f"Source: differences.csv / metrics.csv; n={len(paired_ids)} identical cases with a result for all three methods.\nRemaining no-result cases are separately retained in coverage; no price imputed for them.")

sweep_ids = [case["id"] for case in dataset["cases"] if "budget-sweep" in case["tags"]]
sweep = metrics[metrics.caseId.isin(sweep_ids)]
budgets = sorted(sweep.budgetFen.unique())
fig, ax = plt.subplots(figsize=(8, 4.7))
for i, method in enumerate(METHODS):
    vals = [(sweep[(sweep.method == method) & (sweep.budgetFen == b)].defaultCount > 0).mean() * 100 for b in budgets]
    ax.bar(np.arange(len(budgets)) + (i - 1) * .25, vals, .23, label=method, color=COLORS[i], hatch=HATCHES[i], edgecolor="white")
ax.set_xticks(range(len(budgets)), [f"{b / 100:g}" for b in budgets]); ax.set_xlabel("Budget (CNY)"); ax.set_ylabel("Budget-feasible coverage (%)")
ax.set_ylim(0, 125); ax.set_yticks([0, 50, 100]); ax.legend(ncol=3, loc="upper left")
ax.set_title("Budget feasibility is identical on the fixed budget sweep")
finish(fig, "03-budget-coverage", f"Source: dataset.json budget-sweep subset + metrics.csv; {len(budgets)} budgets, n=1 request/budget/method.\nSame menu, beef + sugar-free preferences; binary scenario outcome, not population coverage.")

selected = ["probe.test.ts", "mcd-adapter.test.ts", "system-resilience.test.ts", "checkout.test.ts", "workflow-runtime.test.ts", "checkout.spec.ts", "resilience.spec.ts"]
groups = tests.set_index("file").loc[selected]
fig, ax = plt.subplots(figsize=(8, 5.1))
bars = ax.barh(range(len(groups)), groups.passed, color=COLORS[0], hatch="//", edgecolor="white")
ax.barh(range(len(groups)), groups.total - groups.passed, left=groups.passed, color=COLORS[2], hatch="xx")
ax.set_yticks(range(len(groups)), selected); ax.invert_yaxis()
for i, (_, row) in enumerate(groups.iterrows()): ax.text(row.total + .3, i, f"{row.passed}/{row.total}", va="center", fontsize=9)
ax.set_xlim(0, groups.total.max() * 1.22); ax.set_xlabel("Tests passed / total (counts, not live failure rates)")
ax.set_title("Measured safety and fault-injection checks")
finish(fig, "04-safety-tests", f"Source: actual test-groups.csv; selected {len(groups)} files, n={int(groups.total.sum())} tests.\nFull suite counts are in TEST_REPORT.md; mocked interfaces do not validate real transactions.")

fig, ax = plt.subplots(figsize=(8, 4.7))
for i, method in enumerate(METHODS):
    values = timings[timings.method == method].durationMs.to_numpy()
    median = np.sort(values)[int(np.ceil(len(values) * .5)) - 1]
    p95 = np.sort(values)[int(np.ceil(len(values) * .95)) - 1]
    bars = ax.bar(i, median, .55, color=COLORS[i], hatch=HATCHES[i], edgecolor="white")
    ax.bar_label(bars, fmt="%.4f", padding=3, fontsize=9)
    ax.plot(i, p95, "D", color="#252525", label="P95 (not a confidence interval)" if i == 0 else None)
    ax.annotate(f"{p95:.4f}", (i, p95), xytext=(8, 0), textcoords="offset points", va="center", fontsize=8)
ax.set_xticks(range(3), METHODS); ax.set_ylabel("Offline selection duration (ms)")
ax.set_ylim(bottom=0, top=max(row["p95Ms"] for row in metadata["times"]) * 1.5)
ax.legend(loc="upper left"); ax.set_title("Offline implementation timing — not MCP or page latency")
finish(fig, "05-latency", f"Source: timings.csv; n={len(timings) // 3}/method (32 cases x 30), 5 warmups; rotated order.\nSame Node process; includes validation/projection, excludes generation/network/I/O. All raw samples retained.")

checks = []
import xml.etree.ElementTree as ET
for path in sorted(OUT.glob("*.svg")):
    root = ET.parse(path).getroot(); texts = root.findall(".//{http://www.w3.org/2000/svg}text")
    assert len(texts) >= 3
    checks.append({"file": path.name, "editableTextCount": len(texts), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
qa = {"source": "CSV-derived numeric assertions + SVG structure check", "numericReconciliation": "passed", "charts": checks, "python": sys.version.split()[0], "matplotlib": matplotlib.__version__, "numpy": np.__version__, "pandas": pd.__version__}
(DATA / "figure-qa.json").write_text(json.dumps(qa, indent=2) + "\n", encoding="utf-8")
print(json.dumps(qa, indent=2))
