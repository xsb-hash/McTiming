import { z } from "zod";

export const modeSchema = z.enum(["demo", "live", "real"]).transform(
  (mode) => mode === "real" ? "live" as const : mode,
);

export type RuntimeMode = z.infer<typeof modeSchema>;

export type PublicStatus = {
  mode: RuntimeMode;
  configuration: "demo-ready" | "missing-token" | "configured";
  mcpVerification: "not-verified";
};
