import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors the `paths` in tsconfig.tools.json so tests under tests/ can
      // reach core internals the public API deliberately does not expose.
      { find: /^@pkg\/core\/(.*)\.js$/, replacement: `${root}packages/core/src/$1.ts` },
      { find: /^@pkg\/core$/, replacement: `${root}packages/core/src/index.ts` },
    ],
  },
  test: {
    // Node environment for pure unit tests. Anything that needs real layout is
    // a Playwright browser test under tests/browser — jsdom does not lay out,
    // so it cannot stand in for the browser this library depends on.
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "tests/unit/**/*.test.ts"],
    reporters: ["default"],
  },
});
