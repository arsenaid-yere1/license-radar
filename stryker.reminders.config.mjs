import config from "./stryker.config.mjs";
const remindersConfig = {
  ...config,
  mutate: config.mutate.filter((file) => file.includes("/reminders/")),
  jsonReporter: { fileName: "reports/mutation-reminders.json" },
  htmlReporter: { fileName: "reports/mutation-reminders.html" },
};

export default remindersConfig;
