/**
 * The `content` property of a margin box.
 *
 * A running header is a concatenation: `"Page " counter(page) " of "
 * counter(pages)`. This parses that into tokens and resolves them against a
 * page's own facts.
 *
 * `counter(pages)` is the interesting one. The brief expects a placeholder
 * patched in a second pass, because the total is unknown while pages are being
 * laid out. It is not unknown here: this engine paginates completely before it
 * paints anything, so the total is a number by the time any margin box is
 * resolved, and no patching is needed.
 */

/** A piece of a resolved `content` value. */
export type ContentToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "counter"; readonly name: string }
  | { readonly kind: "string"; readonly name: string }
  | { readonly kind: "unsupported"; readonly source: string };

export interface ContentFacts {
  /** One-based page number. */
  readonly page: number;
  /** Total page count, known because pagination completes before painting. */
  readonly pages: number;
  /** Named strings set by `string-set`, resolved for this page. */
  readonly strings?: ReadonlyMap<string, string>;
}

/** Decode a CSS string literal, honouring backslash escapes. */
function decodeString(literal: string): string {
  const quote = literal[0];
  const body = literal.slice(1, literal.length - 1);
  let out = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== "\\") {
      out += character;
      continue;
    }

    const next = body[index + 1];
    if (next === undefined) break;

    // A hex escape runs up to six digits and may be followed by one space.
    if (/[0-9a-f]/i.test(next)) {
      const hex = /^[0-9a-f]{1,6}/i.exec(body.slice(index + 1))?.[0] ?? "";
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      index += hex.length;
      if (body[index + 1] === " ") index += 1;
      continue;
    }

    out += next;
    index += 1;
  }

  void quote;
  return out;
}

/**
 * Parse a `content` value into tokens.
 *
 * Unrecognised functions become `unsupported` tokens rather than being dropped:
 * a value that cannot be honoured should be visible as a gap in behaviour, not
 * silently produce an empty header.
 */
export function parseContentValue(value: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  const text = value.trim();

  if (text === "" || text === "none" || text === "normal") return tokens;

  let index = 0;
  while (index < text.length) {
    const character = text[index] as string;

    if (character === " " || character === "\t" || character === "\n") {
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      // Find the closing quote, skipping escaped ones.
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === character) break;
        end += 1;
      }
      tokens.push({ kind: "text", value: decodeString(text.slice(index, end + 1)) });
      index = end + 1;
      continue;
    }

    const functional = /^([a-z-]+)\(([^)]*)\)/i.exec(text.slice(index));
    if (functional) {
      const name = (functional[1] as string).toLowerCase();
      // A counter may name a style as a second argument; only the name is used.
      const argument = (functional[2] as string).split(",")[0]?.trim() ?? "";

      if (name === "counter") tokens.push({ kind: "counter", name: argument.toLowerCase() });
      else if (name === "string") tokens.push({ kind: "string", name: argument.toLowerCase() });
      else tokens.push({ kind: "unsupported", source: functional[0] as string });

      index += (functional[0] as string).length;
      continue;
    }

    // A bare keyword: consume it so parsing cannot stall.
    const keyword = /^[^\s"']+/.exec(text.slice(index))?.[0] ?? text.slice(index);
    tokens.push({ kind: "unsupported", source: keyword });
    index += keyword.length;
  }

  return tokens;
}

/** Resolve parsed tokens against a page's facts. */
export function resolveContent(tokens: readonly ContentToken[], facts: ContentFacts): string {
  let out = "";

  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        out += token.value;
        break;
      case "counter":
        if (token.name === "page") out += String(facts.page);
        else if (token.name === "pages") out += String(facts.pages);
        // Any other counter needs document-wide counter tracking, which does
        // not exist yet; it contributes nothing rather than a wrong number.
        break;
      case "string":
        out += facts.strings?.get(token.name) ?? "";
        break;
      case "unsupported":
        break;
    }
  }

  return out;
}

/** Parse and resolve in one step. */
export function evaluateContent(value: string, facts: ContentFacts): string {
  return resolveContent(parseContentValue(value), facts);
}
