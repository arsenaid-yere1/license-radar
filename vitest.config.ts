import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    sequence: {
      shuffle: true,
      seed: Number(process.env.TEST_SEED ?? 20261003),
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          sequence: { shuffle: true },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30000,
          sequence: { shuffle: true },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*", "**/database.types.ts"],
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage/unit",
    },
  },
});
