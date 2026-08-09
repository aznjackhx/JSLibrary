/**
 * M0 browser smoke test.
 *
 * Proves the built bundle actually loads and runs in a real browser — the IIFE
 * build is what a plain `<script>` tag gets, and a broken one is invisible to
 * Node-side unit tests. From M1 these tests grow into the real pipeline checks.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type * as PkgCore from "@pkg/core";

const IIFE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

/** The injected bundle, typed. See globals.d.ts for why the cast is needed. */
type CoreGlobal = typeof PkgCore;

test.beforeEach(async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: readFileSync(IIFE_BUNDLE, "utf8") });
});

test("exposes the public surface on the global", async ({ page }) => {
  const exported = await page.evaluate(() => Object.keys(window.PkgCore as CoreGlobal).sort());
  expect(exported).toContain("render");
  expect(exported).toContain("pageGeometry");
  expect(exported).toContain("toPt");
});

test("computes page geometry in the browser", async ({ page }) => {
  const geometry = await page.evaluate(() =>
    (window.PkgCore as CoreGlobal).pageGeometry("Letter", "portrait", "1in"),
  );

  expect(geometry.size).toEqual({ width: 612, height: 792 });
  expect(geometry.content).toEqual({ x: 72, y: 72, width: 468, height: 648 });
});

test("render rejects with NotImplementedError until M4 lands", async ({ page }) => {
  const message = await page.evaluate(async () => {
    try {
      await (window.PkgCore as CoreGlobal).render(document.body);
      return "resolved";
    } catch (error) {
      return (error as Error).name;
    }
  });

  expect(message).toBe("NotImplementedError");
});

test("runs under a strict CSP with no eval", async ({ page }) => {
  // The bundle must not need `eval` or `new Function`; enterprises ship with
  // strict CSP and would otherwise be unable to load it at all.
  await page.route("**/csp-test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'" },
      body: "<!doctype html><title>csp</title><body></body>",
    }),
  );

  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") violations.push(message.text());
  });

  await page.goto("https://example.test/csp-test");
  await page.addScriptTag({ content: readFileSync(IIFE_BUNDLE, "utf8") });

  const width = await page.evaluate(() => (window.PkgCore as CoreGlobal).toPt("1in"));
  expect(width).toBe(72);
  expect(violations.filter((text) => text.includes("Content Security Policy"))).toEqual([]);
});
