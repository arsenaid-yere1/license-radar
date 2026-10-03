import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...typescript,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "**/database.types.ts"],
    rules: { complexity: ["error", 10] },
  },
  globalIgnores([
    ".next/**",
    ".tools/**",
    ".venv-gauntlet/**",
    ".browser-cache/**",
    "coverage/**",
    "reports/**",
    "playwright-report/**",
    "test-results/**",
    ".stryker-tmp/**",
  ]),
]);
