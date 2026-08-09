import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  tsconfig: "tsconfig.build.json",
  // ESM + CJS for bundlers/Node tooling, IIFE for a plain <script> tag.
  format: ["esm", "cjs", "iife"],
  globalName: "PkgCore",
  target: "es2022",
  platform: "browser",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  // The size budget in scripts/check-size.mjs is measured against these outputs.
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
