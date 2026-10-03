import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node tools/serve-covered.mjs",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    timeout: 60000,
    env: {
      NODE_V8_COVERAGE: new URL("./coverage/node", import.meta.url).pathname,
    },
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/browser-results.json" }],
  ],
});
