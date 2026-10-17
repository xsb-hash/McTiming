import "server-only";
import { parseConfig } from "./config";
import { createRecommendationSession } from "./recommend";

export async function createConfiguredRecommendationSession() {
  const config = parseConfig(process.env);
  if (config.mode === "demo") {
    const { createDemoRecommendationAdapter } = await import("./demo/recommend-adapter");
    return createRecommendationSession(createDemoRecommendationAdapter());
  }
  const { createMcdAdapter } = await import("./mcd/adapter");
  const { runProbe, ProbeError } = await import("./mcd/probe");
  return createRecommendationSession(createMcdAdapter(async (tool, args) => {
    let structured: unknown;
    await runProbe({ env: { MCTIMING_MODE: "live", MCD_MCP_TOKEN: config.token }, tool, arguments: args, onResult: (response) => { structured = response.structuredContent; } });
    if (structured === undefined) throw new ProbeError("PROTOCOL");
    return structured;
  }));
}
