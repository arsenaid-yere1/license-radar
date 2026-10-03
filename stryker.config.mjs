const configOptions = {
  mutate: [
    "src/lib/practice/schema.ts",
    "src/lib/practice/timezones.ts",
    "src/lib/practice/repository.ts",
    "src/lib/practice/save.ts",
    "src/lib/auth/operations.ts",
    "src/app/practice/actions.ts",
    "src/app/login/actions.ts",
  ],
  ignorePatterns: [
    "/.tools/**",
    "/.browser-cache/**",
    "/.venv-gauntlet/**",
    "/.next/**",
    "/coverage/**",
    "/test-results/**",
    "/playwright-report/**",
  ],
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  vitest: { configFile: "vitest.mutation.config.ts" },
  reporters: ["clear-text", "json", "html"],
  jsonReporter: { fileName: "reports/mutation.json" },
  htmlReporter: { fileName: "reports/mutation.html" },
  coverageAnalysis: "off",
  concurrency: 4,
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 10000,
};

export default configOptions;
