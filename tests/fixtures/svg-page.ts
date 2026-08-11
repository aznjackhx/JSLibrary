/**
 * M7 fixture: inline SVG.
 *
 * Covers each shape the emitter converts, plus the things that go wrong
 * silently — a viewBox that has to be scaled, a nested transform, a fill rule
 * that changes what a self-intersecting path encloses, and a stroke with a
 * cap, join and dash pattern.
 *
 * The page is sized so the element is exactly the page content box, which lets
 * the output be compared against a screenshot of the element itself.
 */

import { renderFontDataUrl } from "./render-page.js";

/** Content box width and height, in CSS pixels. */
export const SVG_PAGE_WIDTH = 400;
export const SVG_PAGE_HEIGHT = 320;

export function svgHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${renderFontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    width: ${SVG_PAGE_WIDTH}px;
    height: ${SVG_PAGE_HEIGHT}px;
    background: rgb(255, 255, 255);
    font-family: "Test Mono";
  }
  svg { display: block; }
</style>
</head>
<body>
  <div id="subject">
    <svg id="art" width="${SVG_PAGE_WIDTH}" height="${SVG_PAGE_HEIGHT}" viewBox="0 0 200 160">
      <rect x="10" y="10" width="50" height="30" fill="rgb(200, 30, 30)"/>
      <rect x="70" y="10" width="50" height="30" rx="10" ry="10" fill="rgb(30, 120, 200)"/>
      <circle cx="150" cy="25" r="15" fill="rgb(240, 170, 20)"/>
      <ellipse cx="30" cy="70" rx="20" ry="12" fill="rgb(40, 160, 90)"/>

      <path d="M 70 55 L 110 55 L 110 85 Z" fill="rgb(120, 60, 180)"/>
      <path d="M 125 55 Q 145 45 165 55 T 195 55" fill="none"
            stroke="rgb(20, 20, 20)" stroke-width="3"/>

      <path d="M 20 100 A 20 20 0 0 1 60 100" fill="none"
            stroke="rgb(200, 30, 120)" stroke-width="4" stroke-linecap="round"/>

      <polyline points="75,110 90,95 105,110 120,95" fill="none"
                stroke="rgb(0, 130, 130)" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="140,95 160,95 150,115" fill="rgb(90, 90, 90)"/>

      <line x1="10" y1="130" x2="80" y2="130"
            stroke="rgb(20, 20, 20)" stroke-width="2" stroke-dasharray="6 3"/>

      <g transform="translate(100, 120) scale(0.5)">
        <rect x="0" y="0" width="40" height="40" fill="rgb(150, 40, 40)"/>
        <g transform="translate(60, 0) rotate(45, 20, 20)">
          <rect x="0" y="0" width="40" height="40" fill="rgb(40, 40, 150)"/>
        </g>
      </g>

      <path d="M 170 120 h 25 v 25 h -25 Z M 176 126 h 13 v 13 h -13 Z"
            fill="rgb(60, 60, 60)" fill-rule="evenodd"/>
    </svg>
  </div>
</body>
</html>`;
}

/** A minimal document with one shape, for structural assertions. */
export function singleShapeHtml(markup: string, css = ""): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject { width: 200px; height: 200px; background: rgb(255, 255, 255); }
  svg { display: block; }
  ${css}
</style>
</head>
<body>
  <div id="subject">
    <svg width="200" height="200" viewBox="0 0 100 100">
${markup}
    </svg>
  </div>
</body>
</html>`;
}

/**
 * A chart with labels, for SVG text.
 *
 * Every case here is one a real chart hits and each fails differently:
 * `text-anchor` decides where a tick label sits relative to its tick, a
 * `tspan` restyles part of a run, and a rotated axis title is the case that
 * catches a counter-flip applied on the wrong side of the rotation — the text
 * reads bottom-to-top in a browser and would read top-to-bottom if it were
 * mirrored.
 */
export function svgTextHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${renderFontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    width: ${SVG_PAGE_WIDTH}px;
    height: ${SVG_PAGE_HEIGHT}px;
    background: rgb(255, 255, 255);
    font-family: "Test Mono";
  }
  svg { display: block; font-family: "Test Mono"; }
  .tick { font-size: 9px; fill: rgb(113, 113, 122); }
</style>
</head>
<body>
  <div id="subject">
    <svg id="art" width="${SVG_PAGE_WIDTH}" height="${SVG_PAGE_HEIGHT}" viewBox="0 0 200 160">
      <rect x="30" y="10" width="160" height="100" fill="rgb(244, 244, 245)"
            stroke="rgb(212, 212, 216)" stroke-width="1"/>
      <rect x="45" y="60" width="20" height="50" fill="rgb(30, 64, 175)"/>
      <rect x="80" y="35" width="20" height="75" fill="rgb(30, 64, 175)"/>
      <rect x="115" y="80" width="20" height="30" fill="rgb(30, 64, 175)"/>

      <text class="tick" x="26" y="16" text-anchor="end">100</text>
      <text class="tick" x="26" y="112" text-anchor="end">0</text>

      <text x="55" y="124" font-size="9" text-anchor="middle" fill="rgb(24, 24, 27)">Q1</text>
      <text x="90" y="124" font-size="9" text-anchor="middle" fill="rgb(24, 24, 27)">Q2</text>
      <text x="125" y="124" font-size="9" text-anchor="middle" fill="rgb(24, 24, 27)">Q3</text>

      <text x="100" y="145" font-size="11" text-anchor="middle" fill="rgb(24, 24, 27)">Revenue</text>
      <text transform="translate(14,80) rotate(-90)" font-size="9"
            text-anchor="middle" fill="rgb(24, 24, 27)">GBP</text>
      <text x="150" y="26" font-size="9" fill="rgb(24, 24, 27)">up <tspan
        fill="rgb(153, 27, 27)">14%</tspan></text>
    </svg>
  </div>
</body>
</html>`;
}
