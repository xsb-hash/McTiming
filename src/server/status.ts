import "server-only";
import type { PublicStatus } from "../domain/runtime";
import { parseConfig } from "./config";
import { demoStatus } from "./demo/status";

export function getPublicStatus(): PublicStatus {
  const config = parseConfig(process.env);
  if (config.mode === "demo") return demoStatus();
  return {
    mode: "live",
    configuration: config.token ? "configured" : "missing-token",
    mcpVerification: "not-verified",
  };
}
