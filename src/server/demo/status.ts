import type { PublicStatus } from "../../domain/runtime";

export function demoStatus(): PublicStatus {
  return { mode: "demo", configuration: "demo-ready", mcpVerification: "not-verified" };
}
