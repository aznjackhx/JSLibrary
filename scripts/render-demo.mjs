/**
 * Render examples/demo.html to a PDF, headlessly.
 *
 *   pnpm build && node scripts/render-demo.mjs [output.pdf]
 *
 * The same page you can open in a browser and click through — this just does
 * it without the clicking, so the output can be diffed, validated, or attached
 * to a review.
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";

import { chromium } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(ROOT, process.argv[2] ?? "examples/quarterly-review.pdf");

const executablePath = process.env["PW_CHROMIUM_EXECUTABLE"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".png": "image/png",
};

/**
 * A static server over the repository root.
 *
 * The page fetches its font over the network the way any page would, and
 * `file://` cannot do that — a fetch from a null origin is blocked. Serving is
 * also what you would do to open the demo by hand, so this matches it.
 */
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
  const file = join(ROOT, path);

  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }

  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;

const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on("console", (message) => {
    if (message.type() === "error") console.error(`page error: ${message.text()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/examples/demo.html`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const result = await page.evaluate(async () => {
    const fontBytes = new Uint8Array(
      await (await fetch("../tests/fixtures/fonts/DejaVuSansMono.ttf")).arrayBuffer(),
    );

    const started = performance.now();
    const pdf = await window.PkgCore.render(document.getElementById("report"), {
      fonts: [{ family: "Demo Sans", data: fontBytes }],
      metadata: {
        title: "Quarterly Operations Review",
        author: "Northwind Analytics",
        subject: "Q3 board pack",
        // Pinned, so re-running produces byte-identical output.
        creationDate: new Date("2026-01-01T00:00:00Z"),
      },
    });

    return { bytes: [...pdf], elapsed: Math.round(performance.now() - started) };
  });

  const bytes = new Uint8Array(result.bytes);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, bytes);

  console.log(
    `${OUTPUT}\n  ${(bytes.length / 1024).toFixed(1)} KB, rendered in ${result.elapsed} ms`,
  );
} finally {
  await browser.close();
  server.close();
}
