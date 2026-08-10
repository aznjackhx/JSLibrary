/**
 * Validate PDFs against a PDF/A flavour with veraPDF.
 *
 *   node scripts/verapdf.mjs 2b test-results/pdfa/*.pdf
 *
 * The brief's bar for the PDF/A feature is this tool: if output does not pass
 * veraPDF, the feature is not done. So this is a real validator, not a
 * structural check that agrees with whatever we happened to write.
 *
 * veraPDF is a Java library. Rather than depending on the desktop installer —
 * which is distributed as a GUI installer and is awkward to script — the
 * validation library is resolved from Maven Central and driven by a small Java
 * program in `scripts/verapdf/`. Everything is cached under `.verapdf/`, so the
 * download happens once.
 *
 * This runs in CI and on demand, never as part of `pnpm verify`: it needs a JDK
 * and a network fetch on first use, and neither belongs in the inner loop.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = resolve(ROOT, ".verapdf");
const LIB = resolve(CACHE, "lib");
const CLASSES = resolve(CACHE, "classes");
const VERSION = "1.28.2";

/** Java's classpath separator, which is not the same everywhere. */
const SEPARATOR = process.platform === "win32" ? ";" : ":";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    ...options,
  });
}

/** Fetch the validation library and its dependencies, once. */
function ensureLibrary() {
  if (existsSync(LIB) && readdirSync(LIB).some((entry) => entry.startsWith("validation-model"))) {
    return;
  }

  mkdirSync(CACHE, { recursive: true });
  const pom = resolve(CACHE, "pom.xml");

  writeFileSync(
    pom,
    `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>local</groupId>
  <artifactId>verapdf-fetch</artifactId>
  <version>1</version>
  <dependencies>
    <dependency>
      <groupId>org.verapdf</groupId>
      <artifactId>validation-model</artifactId>
      <version>${VERSION}</version>
    </dependency>
  </dependencies>
</project>
`,
  );

  console.log(`Fetching veraPDF ${VERSION} from Maven Central…`);
  run("mvn", [
    "-q",
    "-f",
    pom,
    "dependency:copy-dependencies",
    `-DoutputDirectory=${LIB}`,
    "-DincludeScope=runtime",
  ]);
}

/** Compile the driver, once. */
function ensureDriver() {
  if (existsSync(resolve(CLASSES, "Validate.class"))) return;

  mkdirSync(CLASSES, { recursive: true });
  run("javac", [
    "-cp",
    `${LIB}/*`,
    "-d",
    CLASSES,
    resolve(ROOT, "scripts/verapdf/Validate.java"),
  ]);
}

const argv = process.argv.slice(2);

/**
 * Invert the check: the named files must *fail* validation.
 *
 * A validator that passes everything is indistinguishable from no validator at
 * all, so CI asserts both directions — conformant output passes, and output
 * that should not conform is actually rejected.
 */
const expectFail = argv.includes("--expect-fail");
const [flavour = "2b", ...files] = argv.filter((entry) => entry !== "--expect-fail");

if (files.length === 0) {
  console.error("usage: node scripts/verapdf.mjs <flavour> <file>...");
  process.exit(2);
}

const missing = files.filter((file) => !existsSync(file));
if (missing.length > 0) {
  // A validator that silently passes because it was handed nothing is worse
  // than no validator at all.
  console.error(`No such file: ${missing.join(", ")}`);
  process.exit(2);
}

ensureLibrary();
ensureDriver();

let passed = true;
try {
  run("java", ["-cp", [CLASSES, `${LIB}/*`].join(SEPARATOR), "Validate", flavour, ...files]);
} catch {
  passed = false;
}

if (expectFail) {
  if (passed) {
    console.error(
      `\n✗ ${files.join(", ")} passed PDF/A-${flavour}, but was expected to fail. ` +
        "Either the output changed or the validator is not discriminating.",
    );
    process.exit(1);
  }
  console.log(`\n✓ ${files.length} file(s) correctly rejected as non-conformant`);
} else {
  if (!passed) {
    console.error(`\n✗ PDF/A-${flavour} validation failed`);
    process.exit(1);
  }
  console.log(`\n✓ ${files.length} file(s) conform to PDF/A-${flavour}`);
}
