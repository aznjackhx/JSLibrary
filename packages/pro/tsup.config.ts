import { defineConfig, type Options } from "tsup";

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

const shared = {
  entry: { index: "src/index.ts" },
  tsconfig: "tsconfig.build.json",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  treeshake: true,
  minify: true,
  define: { __BUILD_DATE__: JSON.stringify(buildDate) },
} satisfies Options;

/**
 * Resolve `@pkg/core` to the global the core IIFE publishes.
 *
 * `external` does nothing for an IIFE — there is no module system to defer to,
 * so esbuild inlines the dependency instead. That produces a second copy of the
 * PDF object model in the page, and every `instanceof` the core serialiser
 * performs against pro's objects then fails. It is not theoretical: it is what
 * happened, and the symptom was an unhelpful "cannot serialise value of unknown
 * type" from deep inside the writer.
 *
 * So for the IIFE the import is rewritten to read `window.PkgCore`, which keeps
 * the "one engine per page" promise the ESM build gets from `external`.
 */
const coreFromGlobal = {
  name: "core-from-global",
  setup(build: {
    onResolve: (
      options: { filter: RegExp },
      callback: () => { path: string; namespace: string },
    ) => void;
    onLoad: (
      options: { filter: RegExp; namespace: string },
      callback: () => { contents: string; loader: "js" },
    ) => void;
  }): void {
    build.onResolve({ filter: /^@pkg\/core$/ }, () => ({
      path: "@pkg/core",
      namespace: "core-global",
    }));

    build.onLoad({ filter: /.*/, namespace: "core-global" }, () => ({
      contents: `
const core = globalThis.PkgCore;
if (!core) {
  throw new Error(
    "@pkg/pro requires @pkg/core to be loaded first: include its script tag before this one.",
  );
}
export const pdf = core.pdf;
export default core;
`,
      loader: "js",
    }));
  },
};

export default defineConfig([
  {
    ...shared,
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    // Core is a peer at runtime, never bundled in — one engine per page.
    external: ["@pkg/core"],
    outExtension({ format }) {
      return format === "cjs" ? { js: ".cjs" } : { js: ".js" };
    },
  },
  {
    ...shared,
    format: ["iife"],
    globalName: "PkgPro",
    dts: false,
    clean: false,
    esbuildPlugins: [coreFromGlobal as never],
    outExtension() {
      return { js: ".global.js" };
    },
  },
]);
