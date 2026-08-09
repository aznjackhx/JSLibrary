import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment for pure unit tests. Anything that needs real layout is
    // a Playwright browser test under tests/browser — jsdom does not lay out,
    // so it cannot stand in for the browser this library depends on.
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "tests/unit/**/*.test.ts"],
    reporters: ["default"],
  },
});
