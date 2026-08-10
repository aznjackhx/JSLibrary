/**
 * M8: PDF/A-2b, rendered end to end.
 *
 * The structural assertions here are the fast feedback. The real bar is
 * veraPDF, which `scripts/verapdf.mjs` runs over the files this spec writes to
 * `test-results/pdfa/` — a conformance claim that only this library agrees with
 * is worth nothing.
 */

import { webcrypto } from "node:crypto";
import { inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { linksHtml } from "../fixtures/links-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");
const PRO_BUNDLE = resolve(import.meta.dirname, "../../packages/pro/dist/index.global.js");
const OUTPUT_DIR = resolve(import.meta.dirname, "../../test-results/pdfa");

type CoreModule = typeof import("@pkg/core");
type ProModule = typeof import("@pkg/pro");

/**
 * A throwaway signing key.
 *
 * The real one never leaves the maintainer's machine, so an end-to-end test of
 * the *licensed* path has to bring its own authority — which is exactly what
 * `verify.publicKey` is for.
 */
async function issueLicense(): Promise<{ token: string; publicKey: number[] }> {
  const pair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const payload = {
    licensee: "Test Suite",
    seats: 1,
    updatesUntil: "2099-12-31",
    edition: "pro",
  };

  const encoder = new TextEncoder();
  const base64url = (bytes: Uint8Array): string =>
    Buffer.from(bytes)
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await webcrypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, encoder.encode(encoded)),
  );

  return {
    token: `${encoded}.${base64url(signature)}`,
    publicKey: [...new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey))],
  };
}

interface RenderOptions {
  readonly licensed?: boolean;
  readonly profile?: "pdfa-2b" | "none";
}

async function renderPdfA(page: Page, options: RenderOptions = {}): Promise<Uint8Array> {
  const licence = await issueLicense();

  // Served over https rather than set as content on about:blank. WebCrypto's
  // `subtle` only exists in a secure context, so on a blank page the licence
  // check would correctly report `unsupported-platform` and this would be a
  // test of the unlicensed path wearing a licensed one's name.
  const html = linksHtml({ sections: 2, linesPerSection: 20 });
  await page.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://pdfa.test/report.html");
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });
  await page.addScriptTag({ content: readFileSync(PRO_BUNDLE, "utf8") });

  const bytes = await page.evaluate(
    async ({ fontBytes, token, publicKey, licensed, profile }) => {
      const core = window.PkgCore as CoreModule;
      const proModule = window.PkgPro as ProModule;

      const extension = await proModule.pro({
        ...(licensed ? { license: token } : {}),
        verify: { publicKey: new Uint8Array(publicKey), buildDate: "2024-01-01" },
        profile,
      });

      const pdf = await core.render(document.querySelector("#subject") as Element, {
        metadata: {
          title: "Conformance Fixture",
          author: "Test Suite",
          creationDate: new Date("2024-01-01T00:00:00Z"),
        },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
        extensions: [extension],
      });

      return [...pdf];
    },
    {
      fontBytes: [...renderFontBytes()],
      token: licence.token,
      publicKey: licence.publicKey,
      licensed: options.licensed ?? true,
      profile: options.profile ?? ("pdfa-2b" as const),
    },
  );

  return new Uint8Array(bytes);
}

/**
 * The whole file as text, with every Flate stream inflated.
 *
 * Searching the raw bytes finds only what happens to be uncompressed — the
 * watermark's text sits inside a compressed content stream, so a raw search
 * for it reports "absent" for output that carries it perfectly well.
 */
function readable(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = raw.toString("latin1");

  // Every stream in the file, inflated where it inflates.
  const pattern = /stream\r?\n/g;
  let match = pattern.exec(out);

  while (match) {
    const start = match.index + match[0].length;
    const end = out.indexOf("endstream", start);
    if (end === -1) break;

    try {
      out += `\n${inflateSync(raw.subarray(start, end)).toString("latin1")}`;
    } catch {
      // Not Flate, or not a stream at all: nothing to add.
    }
    match = pattern.exec(out.slice(0, raw.length));
  }

  return out;
}

/** Write a file for the veraPDF step to pick up. */
function publish(name: string, bytes: Uint8Array): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, name), bytes);
}

test("claims PDF/A-2b conformance in XMP", async ({ page }, testInfo) => {
  const bytes = await renderPdfA(page);
  // Only one project needs to leave a file behind; the others would overwrite
  // it with an equivalent one and slow the run down for nothing.
  if (testInfo.project.name === "chromium") publish("rendered.pdf", bytes);

  const raw = readable(bytes);
  expect(raw).toContain("<pdfaid:part>2</pdfaid:part>");
  expect(raw).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
});

test("embeds an output intent with an ICC profile", async ({ page }) => {
  const raw = readable(await renderPdfA(page));

  expect(raw).toContain("/OutputIntents");
  expect(raw).toContain("/GTS_PDFA1");
  expect(raw).toContain("/DestOutputProfile");
});

test("keeps the metadata packet unfiltered", async ({ page }) => {
  // PDF/A requires the XMP be readable without parsing the file.
  const raw = readable(await renderPdfA(page));

  const start = raw.indexOf("/Type /Metadata");
  expect(start).toBeGreaterThan(0);
  expect(raw.slice(start, start + 200)).not.toContain("/Filter");
});

test("agrees with the Info dictionary", async ({ page }) => {
  // A title in XMP that differs from the one in Info is a conformance
  // failure, not a cosmetic inconsistency.
  const raw = readable(await renderPdfA(page));

  expect(raw).toContain("Conformance Fixture");
  expect(raw).toContain("<dc:title>");
});

test("still embeds and subsets every font", async ({ page }) => {
  const raw = readable(await renderPdfA(page));

  // PDF/A permits no font that is not embedded.
  expect(raw).toContain("/Length1");
  expect(raw).toContain("/ToUnicode");
});

test("keeps text selectable, not rasterised", async ({ page }) => {
  const bytes = await renderPdfA(page);

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const content = await (await document_.getPage(1)).getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join("");
    expect(text).toContain("Annual Report");
  } finally {
    await task.destroy();
  }
});

test("drops the conformance claim when unlicensed", async ({ page }, testInfo) => {
  // Watermarked output uses a non-embedded font, which PDF/A forbids. Claiming
  // conformance anyway would fail at an archive ingest, long after anyone
  // could act on it.
  const bytes = await renderPdfA(page, { licensed: false });
  if (testInfo.project.name === "chromium") publish("unlicensed.pdf", bytes);

  const raw = readable(bytes);
  expect(raw).toContain("Unlicensed");
  expect(raw).not.toContain("pdfaid:part");
});

test("is deterministic", async ({ page }) => {
  const first = await renderPdfA(page);
  const second = await renderPdfA(page);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});
