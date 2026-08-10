/**
 * Reading `@page` rules out of the document's stylesheets.
 *
 * Every other stage of this pipeline asks the browser what it decided. This one
 * cannot: no engine applies `@page` outside its own print path, and none
 * exposes it through the CSSOM in a form that can be relied on — Chromium
 * reports margin boxes as child rules, other engines do not report them at all.
 * So the rules are read from the stylesheet text and parsed here.
 *
 * The parser is deliberately small. It understands the shape of `@page` — a
 * selector, declarations, and nested margin-box blocks — and nothing else about
 * CSS. Anything it does not recognise is ignored rather than guessed at.
 */

/** The sixteen margin boxes, in the order the specification lists them. */
export const MARGIN_BOX_NAMES = [
  "top-left-corner",
  "top-left",
  "top-center",
  "top-right",
  "top-right-corner",
  "right-top",
  "right-middle",
  "right-bottom",
  "bottom-right-corner",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "bottom-left-corner",
  "left-bottom",
  "left-middle",
  "left-top",
] as const;

export type MarginBoxName = (typeof MARGIN_BOX_NAMES)[number];

const MARGIN_BOX_SET = new Set<string>(MARGIN_BOX_NAMES);

/** A parsed `@page` rule. */
export interface PageRule {
  /**
   * Pseudo-class selectors on the rule: `first`, `left`, `right`, `blank`.
   * Empty for a bare `@page`, which applies to every page.
   */
  readonly pseudos: readonly string[];
  /** Declarations on the page box itself, such as `size` and `margin`. */
  readonly declarations: ReadonlyMap<string, string>;
  /** Declarations for each margin box the rule defines. */
  readonly marginBoxes: ReadonlyMap<MarginBoxName, ReadonlyMap<string, string>>;
  /** Source order, used to break ties between rules of equal specificity. */
  readonly order: number;
}

/**
 * Split a declaration block into property/value pairs.
 *
 * Nested blocks have already been removed by the caller. Values may contain
 * strings, functions and commas, so the split is on top-level semicolons only.
 */
function parseDeclarations(text: string): Map<string, string> {
  const declarations = new Map<string, string>();

  let depth = 0;
  let quote: string | undefined;
  let current = "";
  const parts: string[] = [];

  for (const character of text) {
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);

    if (character === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }
  parts.push(current);

  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;

    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (property && value) declarations.set(property, value);
  }

  return declarations;
}

/** Find the matching close brace for the brace at `start`. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Parse the body of an `@page` rule into declarations and margin boxes.
 *
 * Exported for testing: the body is the part between the braces.
 */
export function parsePageBody(body: string): {
  declarations: Map<string, string>;
  marginBoxes: Map<MarginBoxName, Map<string, string>>;
} {
  const marginBoxes = new Map<MarginBoxName, Map<string, string>>();
  let remaining = "";
  let index = 0;

  while (index < body.length) {
    const at = body.indexOf("@", index);
    if (at === -1) {
      remaining += body.slice(index);
      break;
    }

    const open = body.indexOf("{", at);
    if (open === -1) {
      remaining += body.slice(index);
      break;
    }

    const name = body.slice(at + 1, open).trim().toLowerCase();
    const close = matchBrace(body, open);
    if (close === -1) {
      remaining += body.slice(index);
      break;
    }

    remaining += body.slice(index, at);

    if (MARGIN_BOX_SET.has(name)) {
      marginBoxes.set(name as MarginBoxName, parseDeclarations(body.slice(open + 1, close)));
    }
    // An unrecognised at-rule inside @page is skipped along with its block.

    index = close + 1;
  }

  return { declarations: parseDeclarations(remaining), marginBoxes };
}

/** Parse the selector part of `@page ...`, e.g. `:first` or `:left`. */
function parsePseudos(selector: string): string[] {
  return [...selector.matchAll(/:([a-z-]+)/gi)].map((match) =>
    (match[1] as string).toLowerCase(),
  );
}

/**
 * Extract every `@page` rule from a stylesheet's text.
 *
 * Exported so a caller can supply CSS directly, which is also how this is
 * tested without a document.
 */
export function parsePageRulesFromText(css: string, startOrder = 0): PageRule[] {
  const rules: PageRule[] = [];
  let order = startOrder;
  let index = 0;

  for (;;) {
    const at = css.toLowerCase().indexOf("@page", index);
    if (at === -1) break;

    const open = css.indexOf("{", at);
    if (open === -1) break;

    const close = matchBrace(css, open);
    if (close === -1) break;

    const selector = css.slice(at + "@page".length, open);
    const { declarations, marginBoxes } = parsePageBody(css.slice(open + 1, close));

    rules.push({
      pseudos: parsePseudos(selector),
      declarations,
      marginBoxes,
      order: order,
    });
    order += 1;

    index = close + 1;
  }

  return rules;
}

/**
 * Gather the CSS a document is built from, preferring authored source.
 *
 * The CSSOM is not a faithful record: a browser discards declarations it does
 * not understand, and every GCPM property is in that category. Probing
 * Chromium with `h2 { string-set: chapter content() }` and a margin box
 * containing `content: string(chapter)` returns `h2 { }` and
 * `@page { @top-center { } }` — both stripped to nothing.
 *
 * A `<style>` element's `textContent` is the text the author wrote, so it is
 * read in preference. Linked stylesheets have no accessible source, so their
 * rules are taken from the CSSOM and are subject to that stripping; a
 * cross-origin sheet cannot be read at all. Both limitations are inherent to
 * the platform rather than to this parser.
 */
export function collectCssSources(doc: Document): string[] {
  const sources: string[] = [];

  for (const element of doc.querySelectorAll("style")) {
    const text = element.textContent;
    if (text) sources.push(text);
  }

  for (const sheet of doc.styleSheets) {
    // Already captured above, and captured better.
    if (sheet.ownerNode instanceof doc.defaultView!.HTMLStyleElement) continue;

    let cssRules: CSSRuleList | undefined;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // Cross-origin, and unreadable by design.
    }
    if (!cssRules) continue;

    for (const rule of cssRules) sources.push(rule.cssText);
  }

  return sources;
}

/**
 * Collect every `@page` rule in a document.
 *
 * Read from authored source where available — see `collectCssSources` for why
 * the CSSOM cannot be trusted with rules a browser does not implement.
 */
export function parsePageRules(doc: Document): PageRule[] {
  const rules: PageRule[] = [];
  let order = 0;

  for (const source of collectCssSources(doc)) {
    const parsed = parsePageRulesFromText(source, order);
    rules.push(...parsed);
    order += parsed.length;
  }

  return rules;
}
