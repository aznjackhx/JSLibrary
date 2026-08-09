import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  tsconfig: "tsconfig.build.json",
  format: ["esm", "cjs", "iife"],
  globalName: "PkgPro",
  target: "es2022",
  platform: "browser",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  // Core is a peer at runtime, never bundled in — one engine per page.
  external: ["@pkg/core"],
  outExtension({ format }) {
    switch (format) {
      case "cjs":
        return { js: ".cjs" };
      case "iife":
        return { js: ".global.js" };
      default:
        return { js: ".js" };
    }
  },
});
