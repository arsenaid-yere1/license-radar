import config from "./stryker.config.mjs";
const configOptions = {
  ...config,
  mutate: [
    "src/lib/sms/schema.ts",
    "src/lib/dashboard/summary.ts",
    "src/lib/calendar/events.ts",
    "src/lib/calendar/dates.ts",
    "src/lib/calendar/query.ts",
    "src/lib/practice/schema.ts",
    "src/lib/team/schema.ts",
    "src/lib/recipients/schema.ts",
    "src/lib/register/schema.ts",
    "src/lib/register/dates.ts",
    "src/lib/team/invitations.ts",
  ],
  vitest: { configFile: "vitest.properties.config.ts" },
  jsonReporter: { fileName: "reports/mutation-properties.json" },
  htmlReporter: { fileName: "reports/mutation-properties.html" },
};

export default configOptions;
