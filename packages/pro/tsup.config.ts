import { defineConfig } from "tsup";

/**
 * The build's release date, stamped into the bundle.
 *
 * `SOURCE_DATE_EPOCH` is honoured so a reproducible-build pipeline can pin it;
 * otherwise it is today. It must never be read at runtime — the licence check
 * compares against *this* value precisely so a customer's build keeps working
 * after their maintenance lapses.
 */
const buildDate = new Date(
  process.env["SOURCE_DATE_EPOCH"]
    ? Number(process.env["SOURCE_DATE_EPOCH"]) * 1000
    : Date.now(),
)
  .toISOString()
  .slice(0, 10);

export default defineConfig({
  define: { __BUILD_DATE__: JSON.stringify(buildDate) },
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
