import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.{ts,tsx}"],
    sequence: { shuffle: true, seed: 20261003 },
  },
});
