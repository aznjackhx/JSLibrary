import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Built only so CI can measure what the writer plus pako actually cost.
    // Not reachable from `render()` yet and not listed in package exports, so
    // it is not importable by consumers. Folds into `index` at M4, when
    // emission wires the writer up.
    pdf: "src/pdf/index.ts",
    fonts: "src/fonts/index.ts",
    measure: "src/measure/index.ts",
  },
  tsconfig: "tsconfig.build.json",
  // Each entry must be self-contained. With splitting on, shared code moves to
  // a common chunk and the per-entry size numbers stop measuring anything.
  splitting: false,
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
