import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Edge"],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chromium"),
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "npm run start -- --port 3300",
      url: "http://127.0.0.1:3300", reuseExistingServer: false, timeout: 60_000,
      env: { MCTIMING_MODE: "demo", MCD_MCP_TOKEN: "", NEXT_PUBLIC_MCD_MCP_TOKEN: "", NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      command: "npm run start -- --port 3301",
      url: "http://127.0.0.1:3301", reuseExistingServer: false, timeout: 60_000,
      // A fake canary only; tests on this port must never request live business data.
      env: { MCTIMING_MODE: "live", MCD_MCP_TOKEN: "mctiming-test-secret-canary", NEXT_PUBLIC_MCD_MCP_TOKEN: "", NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      command: "npm run start -- --port 3302",
      url: "http://127.0.0.1:3302", reuseExistingServer: false, timeout: 60_000,
      env: { MCTIMING_MODE: "live", MCD_MCP_TOKEN: "", NEXT_PUBLIC_MCD_MCP_TOKEN: "", NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
