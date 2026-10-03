import { test as base, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
export const test = base.extend({
  page: async ({ page }, providePage) => {
    await page.coverage.startJSCoverage({
      resetOnNavigation: false,
      reportAnonymousScripts: false,
    });
    await providePage(page);
    const entries = await page.coverage.stopJSCoverage();
    mkdirSync("coverage/browser", { recursive: true });
    writeFileSync(
      `coverage/browser/${randomUUID()}.json`,
      JSON.stringify(entries),
    );
  },
});
export { expect };
