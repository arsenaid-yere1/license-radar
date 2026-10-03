import config from "./stryker.config.mjs";
const configOptions = {
  ...config,
  mutate: ["src/lib/practice/schema.ts"],
  vitest: { configFile: "vitest.properties.config.ts" },
  jsonReporter: { fileName: "reports/mutation-properties.json" },
  htmlReporter: { fileName: "reports/mutation-properties.html" },
};

export default configOptions;
