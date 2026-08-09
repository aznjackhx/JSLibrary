/**
 * Matching a computed `font-family` / `weight` / `style` triple to a font file.
 *
 * The weight rules are the fiddly part and are not intuitive: CSS says 400 falls
 * back to 500 before looking lighter, and 500 falls back to 400 before looking
 * heavier. Getting that wrong picks a visibly wrong face in a way nobody
 * notices until a customer's report looks bold.
 *
 * Registration is explicit here. Discovering `@font-face` rules from the
 * document needs the DOM and lands with measurement in M3.
 */

import { Font } from "./font.js";

export type FontStyle = "normal" | "italic" | "oblique";

export interface FontSource {
  readonly family: string;
  /** CSS numeric weight, 1–1000. */
  readonly weight: number;
  readonly style: FontStyle;
  readonly font: Font;
}

export interface FontRequest {
  /** Family names in preference order, as CSS lists them. */
  readonly families: readonly string[];
  readonly weight?: number;
  readonly style?: FontStyle;
}

/** Normalise a family name for comparison: CSS family matching is case-insensitive. */
function normaliseFamily(family: string): string {
  return family.trim().toLowerCase();
}

/**
 * Split a computed `font-family` value into names.
 *
 * Handles quoting, since a family with a space or a comma in its name arrives
 * quoted and splitting naively would shred it.
 */
export function parseFontFamilyList(value: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (const character of value) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === ",") {
      if (current.trim()) families.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) families.push(current.trim());
  return families;
}

/**
 * Order candidate weights by CSS preference for a desired weight.
 *
 * Implements the CSS Fonts 4 matching order, including the 400/500 special
 * case.
 */
export function orderWeights(desired: number, available: readonly number[]): number[] {
  const unique = [...new Set(available)].sort((a, b) => a - b);
  const below = unique.filter((weight) => weight < desired).sort((a, b) => b - a);
  const above = unique.filter((weight) => weight > desired).sort((a, b) => a - b);
  const exact = unique.filter((weight) => weight === desired);

  if (desired === 400) {
    // 400 prefers 500 before searching downward.
    const fiveHundred = above.filter((weight) => weight === 500);
    const rest = above.filter((weight) => weight !== 500);
    return [...exact, ...fiveHundred, ...below, ...rest];
  }

  if (desired === 500) {
    // 500 prefers 400 before searching upward.
    const fourHundred = below.filter((weight) => weight === 400);
    const rest = below.filter((weight) => weight !== 400);
    return [...exact, ...fourHundred, ...rest, ...above];
  }

  if (desired < 400) {
    // Lighter weights first, then heavier.
    return [...exact, ...below, ...above];
  }

  // Above 500: heavier weights first, then lighter.
  return [...exact, ...above, ...below];
}

/** Order candidate styles by preference for a desired style. */
function orderStyles(desired: FontStyle): FontStyle[] {
  switch (desired) {
    case "italic":
      // Oblique substitutes for italic before an upright face does.
      return ["italic", "oblique", "normal"];
    case "oblique":
      return ["oblique", "italic", "normal"];
    default:
      return ["normal", "oblique", "italic"];
  }
}

export class FontRegistry {
  /** Normalised family -> registered sources. */
  readonly #byFamily = new Map<string, FontSource[]>();

  /** Fallback used when no requested family is registered. */
  #fallback: Font | undefined;

  register(source: FontSource): this {
    const key = normaliseFamily(source.family);
    const existing = this.#byFamily.get(key);
    if (existing) existing.push(source);
    else this.#byFamily.set(key, [source]);

    this.#fallback ??= source.font;
    return this;
  }

  /** Register raw font bytes. */
  registerBytes(
    family: string,
    bytes: Uint8Array,
    options: { weight?: number; style?: FontStyle } = {},
  ): this {
    return this.register({
      family,
      weight: options.weight ?? 400,
      style: options.style ?? "normal",
      font: Font.parse(bytes),
    });
  }

  /** The font used when nothing matches. Defaults to the first registered font. */
  setFallback(font: Font): this {
    this.#fallback = font;
    return this;
  }

  get families(): string[] {
    return [...this.#byFamily.keys()];
  }

  /**
   * Resolve a request to a font.
   *
   * Families are tried in order; within a family, style is matched before
   * weight, matching CSS.
   */
  resolve(request: FontRequest): FontSource | undefined {
    const desiredWeight = request.weight ?? 400;
    const desiredStyle = request.style ?? "normal";

    for (const family of request.families) {
      const candidates = this.#byFamily.get(normaliseFamily(family));
      if (!candidates || candidates.length === 0) continue;

      for (const style of orderStyles(desiredStyle)) {
        const matchingStyle = candidates.filter((source) => source.style === style);
        if (matchingStyle.length === 0) continue;

        const weights = orderWeights(
          desiredWeight,
          matchingStyle.map((source) => source.weight),
        );

        const bestWeight = weights[0];
        if (bestWeight === undefined) continue;

        const match = matchingStyle.find((source) => source.weight === bestWeight);
        if (match) return match;
      }
    }

    return undefined;
  }

  /** Resolve, falling back rather than returning nothing. */
  resolveOrFallback(request: FontRequest): Font {
    const match = this.resolve(request);
    if (match) return match.font;

    if (!this.#fallback) {
      throw new Error(
        `No font registered for ${request.families.join(", ") || "(no family)"} and no fallback set`,
      );
    }
    return this.#fallback;
  }
}
