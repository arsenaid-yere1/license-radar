import config from "./stryker.config.mjs";
const configOptions = {
  ...config,
  mutate: [
    "src/lib/register/types.ts",
    "src/lib/reminders/heartbeat.ts",
    "src/lib/reminders/gmail-authorization.ts",
    "src/lib/reminders/gmail-config.ts",
    "src/lib/reminders/gmail-provider.ts",
    "src/lib/evidence/schema.ts",
    "src/lib/evidence/validation.ts",
    "src/lib/evidence/messages.ts",

    "src/lib/renewals/history.ts",
    "src/lib/renewals/state.ts",
    "src/lib/renewals/schema.ts",
    "src/lib/reminders/schema.ts",
    "src/lib/reminders/recovery.ts",
    "src/lib/reminders/history.ts",
    "src/lib/reminders/messages.ts",
    "src/lib/sms/schema.ts",
    "src/lib/dashboard/summary.ts",
    "src/lib/calendar/events.ts",
    "src/lib/calendar/dates.ts",
    "src/lib/calendar/query.ts",
    "src/lib/practice/schema.ts",
    "src/lib/team/schema.ts",
    "src/lib/recipients/schema.ts",
    "src/lib/register/schema.ts",
    "src/lib/register/numbers.ts",
    "src/lib/register/dates.ts",
    "src/lib/team/invitations.ts",
  ],
  vitest: { configFile: "vitest.properties.config.ts", related: false },
  jsonReporter: { fileName: "reports/mutation-properties.json" },
  htmlReporter: { fileName: "reports/mutation-properties.html" },
};

export default configOptions;
