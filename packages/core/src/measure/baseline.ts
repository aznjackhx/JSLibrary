/**
 * Where the baseline sits inside a line box.
 *
 * `Range.getClientRects()` gives the inline box for a run of text, but PDF
 * positions text by its baseline, and the gap between the two is not something
 * to guess at. Deriving it from font metrics is tempting and wrong: engines
 * disagree about whether ascent comes from `hhea`, OS/2 `sTypo*` or OS/2
 * `usWin*`, and the disagreement is platform-specific — exactly the class of
 * difference the brief warns about with Safari.
 *
 * So the browser is asked directly. A zero-sized inline-block aligned to the
 * baseline reports its own top, and that top *is* the baseline. The offset from
 * the top of the inline box is a property of the font and size, so it is
 * measured once per combination and cached.
 */

/** Text used for the probe. Any glyph works; this one has both ascender and descender. */
const PROBE_TEXT = "Hxpg";

export interface BaselineMetrics {
  /** Distance from the top of the inline box down to the baseline, in CSS pixels. */
  readonly ascent: number;
  /** Height of the inline box the browser reported. */
  readonly inlineHeight: number;
}

/**
 * Measures and caches baseline offsets.
 *
 * One probe per distinct font shorthand, not one per line — the offset depends
 * only on the font and size.
 */
export class BaselineProbe {
  readonly #cache = new Map<string, BaselineMetrics>();
  readonly #host: HTMLElement;

  constructor(host: HTMLElement) {
    this.#host = host;
  }

  /**
   * Baseline metrics for the font of the given element.
   *
   * The cache key is the resolved font description, so two elements sharing a
   * font share a measurement.
   */
  forStyle(style: CSSStyleDeclaration): BaselineMetrics {
    const key = [
      style.fontStyle,
      style.fontWeight,
      style.fontSize,
      style.fontFamily,
      style.fontVariant,
      style.fontStretch,
    ].join("|");

    const cached = this.#cache.get(key);
    if (cached) return cached;

    const measured = this.#measure(style);
    this.#cache.set(key, measured);
    return measured;
  }

  #measure(style: CSSStyleDeclaration): BaselineMetrics {
    const doc = this.#host.ownerDocument;

    const line = doc.createElement("span");
    Object.assign(line.style, {
      position: "absolute",
      top: "0",
      left: "0",
      // The probe must not wrap or inherit spacing that shifts the box.
      whiteSpace: "nowrap",
      lineHeight: "normal",
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontVariant: style.fontVariant,
      fontStretch: style.fontStretch,
      letterSpacing: "normal",
      padding: "0",
      margin: "0",
      border: "0",
    });

    const text = doc.createTextNode(PROBE_TEXT);
    const marker = doc.createElement("span");
    Object.assign(marker.style, {
      display: "inline-block",
      width: "0",
      height: "0",
      // The whole trick: an inline-block aligned to the baseline reports a top
      // edge that sits exactly on it.
      verticalAlign: "baseline",
      padding: "0",
      margin: "0",
      border: "0",
    });

    line.append(text, marker);
    this.#host.append(line);

    try {
      // The text's own inline box, not the span's border box, which line-height
      // would inflate.
      const range = doc.createRange();
      range.selectNodeContents(text);
      const textRect = range.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      range.detach();

      const ascent = markerRect.top - textRect.top;
      return {
        ascent: Number.isFinite(ascent) ? ascent : 0,
        inlineHeight: textRect.height,
      };
    } finally {
      line.remove();
    }
  }

  /** Number of distinct fonts measured. Exposed so tests can assert caching. */
  get size(): number {
    return this.#cache.size;
  }
}
