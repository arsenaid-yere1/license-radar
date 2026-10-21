import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/helpers/server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
    include: [
      "src/lib/register/pci.test.ts",
      "src/lib/reminders/heartbeat-properties.test.ts",
      "src/lib/reminders/heartbeat.test.ts",
      "src/lib/reminders/gmail-properties.test.ts",
      "src/lib/reminders/gmail-provider.test.ts",
      "src/lib/reminders/gmail-config.test.ts",
      "src/lib/evidence/properties.test.ts",
      "src/lib/evidence/validation.test.ts",
      "src/lib/renewals/properties.test.ts",
      "src/lib/renewals/history.test.ts",
      "src/lib/reminders/properties.test.ts",
      "src/lib/reminders/recovery.test.ts",
      "src/lib/reminders/history.test.ts",
      "src/lib/sms/properties.test.ts",
      "src/lib/dashboard/properties.test.ts",
      "src/lib/calendar/properties.test.ts",
      "src/lib/practice/properties.test.ts",
      "src/lib/team/properties.test.ts",
      "src/lib/recipients/properties.test.ts",
      "src/lib/register/properties.test.ts",
      "src/lib/register/numbers.test.ts",
      "src/lib/register/dates.test.ts",
    ],
    sequence: { shuffle: true, seed: 20261004 },
  },
});
