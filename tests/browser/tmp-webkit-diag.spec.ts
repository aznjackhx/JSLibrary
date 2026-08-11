/**
 * TEMPORARY. Diagnostic for the WebKit-only invoice failure; delete once the
 * cause is known. WebKit cannot be installed in the dev container, so CI is
 * the only place this can run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test } from "@playwright/test";

import { CORPUS } from "../fixtures/corpus/index.js";

const MEASURE_BUNDLE = resolve(
  import.meta.dirname,
  "../../packages/core/dist/measure.global.js",
);

test("WEBKIT DIAG invoice", async ({ page }) => {
  const document_ = CORPUS.find((entry) => entry.name === "invoice");
  if (!document_) throw new Error("invoice document missing");

  await page.setContent(document_.html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(MEASURE_BUNDLE, "utf8") });

  const report = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const subject = document.querySelector("#subject") as HTMLElement;

    // 1. What the live DOM reports for the two paragraphs that go missing.
    const nodes: Array<Record<string, unknown>> = [];
    for (const paragraph of [...subject.querySelectorAll("p")].slice(0, 6)) {
      const node = paragraph.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];

      // The first cluster's own bounds, which is what assignment compares to.
      const cluster = document.createRange();
      cluster.setStart(node, 0);
      cluster.setEnd(node, 1);
      const first = cluster.getBoundingClientRect();

      nodes.push({
        text: (node as Text).data.slice(0, 24),
        parentClass: paragraph.className,
        parentDisplay: getComputedStyle(paragraph).display,
        rects: rects.map(
          (r) => `${r.width.toFixed(1)}x${r.height.toFixed(1)}@${r.top.toFixed(1)}`,
        ),
        firstCluster: `${first.width.toFixed(1)}x${first.height.toFixed(1)}@${first.top.toFixed(1)}`,
      });
    }
    out["nodes"] = nodes;

    // 2. Every line measurement produced, so the stage that loses the text is
    //    unambiguous: present here means the loss is downstream of measure.
    const core = (window as never as Record<string, { measure: Function }>)["PkgCore"];
    const measured = core.measure(subject, { width: 660, precise: true }) as Record<
      string,
      Record<string, unknown>
    >;

    const lines: string[] = [];
    const visit = (candidate: Record<string, unknown>): void => {
      if (candidate["kind"] === "text") {
        for (const line of candidate["lines"] as Array<Record<string, unknown>>) {
          lines.push(String(line["text"]).slice(0, 24));
        }
        return;
      }
      for (const child of (candidate["children"] ?? []) as Array<Record<string, unknown>>) {
        visit(child);
      }
    };
    visit(measured["document"]!["root"] as never);
    out["measuredLines"] = lines.slice(0, 24);

    return out;
  });

  console.log(`WEBKITDIAG ${JSON.stringify(report)}`);
});
