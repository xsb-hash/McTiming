import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const forbidden = /(^|\/)(\.env(?!\.example$)(?:\.|$)|\.local\/|credentials\/|secrets\/|responses\/|logs\/|test-results\/|playwright-report\/)|\.(log|pem|key|p12|pfx)$|(^|\/)mcp-config\.json$/i;

try {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  const bad = files.filter((file) => forbidden.test(file));
  if (bad.length) throw new Error("Git 正在跟踪敏感路径；请检查暂存区（未输出文件内容）。");
  if (!files.includes("package-lock.json")) throw new Error("package-lock.json 尚未加入 Git 跟踪。");
  const paths = [".env.local", ".env.production", ".local/probe-args.json", "credentials/account.json", "responses/raw.json", "logs/probe.log"];
  const ignored = execFileSync("git", ["check-ignore", "--stdin"], { input: paths.join("\n") + "\n", encoding: "utf8" }).trim().split(/\r?\n/);
  if (ignored.length !== paths.length) throw new Error("敏感路径忽略规则不完整。");
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  let bundleCount = 0;
  for (const file of walk(".next/static")) {
    if (!/\.(js|json|map)$/.test(file)) continue;
    bundleCount++;
    if (/MCD_MCP_TOKEN|mctiming-test-secret-canary/.test(readFileSync(file, "utf8"))) {
      throw new Error("浏览器产物包含服务端凭证标记，检查失败（未输出内容）。");
    }
  }
  console.log(`PASS: ${files.length} 个 Git 跟踪路径、${paths.length} 条忽略规则、${bundleCount} 个浏览器产物检查通过。`);
  console.log("范围：敏感路径与已知标记检查；不代表任意秘密的全面检测。");
} catch (error) {
  console.error(error instanceof Error && !('status' in error) ? error.message : "检查失败：请确认已初始化 Git、跟踪 lockfile 并完成构建。");
  process.exitCode = 1;
}
