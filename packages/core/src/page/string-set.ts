/**
 * GCPM named strings.
 *
 * `string-set: chapter content()` on a heading records that heading's text
 * under the name `chapter`; `content: string(chapter)` in a margin box prints
 * whichever value is in effect for that page. This is how a running header
 * tracks the current section, and it is the piece the brief notes almost
 * nothing on the market supports.
 *
 * No browser implements it, so — as with `@page` — the declarations are read
 * from authored CSS rather than from the CSSOM, which discards them. Matching
 * elements to selectors is delegated to `Element.matches`, so the full selector
 * language works without this module knowing anything about it.
 */

import { collectCssSources } from "./atrules.js";

/** A `string-set` declaration and the selector that carries it. */
export interface StringSetRule {
  readonly selector: string;
  /** The named string being assigned. */
  readonly name: string;
  /** The value expression, e.g. `content()` or `"Ch. " content()`. */
  readonly value: string;
  /** Source order, for resolving two rules that both match. */
  readonly order: number;
}

/** One element's assignment, in document order. */
export interface StringAssignment {
  readonly name: string;
  readonly value: string;
  /** Vertical position in the measured column, in CSS pixels. */
  readonly y: number;
}

/**
 * Which value of a named string a page should show.
 *
 * `first` — the first assignment on the page, or the entering value.
 * `start` — the value in effect as the page begins, ignoring the page's own.
 * `last`  — the last assignment on the page, or the entering value.
 */
export type StringScope = "first" | "start" | "last";

/**
 * Split a selector list on top-level commas.
 *
 * A comma inside `:is(...)` or an attribute value does not separate selectors.
 */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";

  for (const character of list) {
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
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth = Math.max(0, depth - 1);

    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Parse `string-set` declarations out of CSS text.
 *
 * Only style rules are examined; at-rules are skipped along with their blocks,
 * so a `string-set` inside a media query is not picked up. Supporting that
 * needs media evaluation this module deliberately does not do.
 */
export function parseStringSetRules(css: string, startOrder = 0): StringSetRule[] {
  const rules: StringSetRule[] = [];
  let order = startOrder;
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;

    const selector = css.slice(index, open).trim();

    // Find the end of this block, allowing for nesting.
    let depth = 0;
    let close = -1;
    for (let scan = open; scan < css.length; scan += 1) {
      if (css[scan] === "{") depth += 1;
      else if (css[scan] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = scan;
          break;
        }
      }
    }
    if (close === -1) break;

    if (!selector.startsWith("@") && selector.length > 0) {
      const body = css.slice(open + 1, close);
      const match = /(?:^|;)\s*string-set\s*:\s*([^;}]+)/i.exec(body);

      if (match) {
        for (const assignment of splitSelectors(match[1] as string)) {
          // `name value...` — the first token names the string.
          const space = assignment.search(/\s/);
          if (space === -1) continue;

          const name = assignment.slice(0, space).trim().toLowerCase();
          const value = assignment.slice(space + 1).trim();
          if (!name || !value) continue;

          for (const single of splitSelectors(selector)) {
            rules.push({ selector: single, name, value, order });
            order += 1;
          }
        }
      }
    }

    index = close + 1;
  }

  return rules;
}

/** Collect every `string-set` rule in a document. */
export function collectStringSetRules(doc: Document): StringSetRule[] {
  const rules: StringSetRule[] = [];
  let order = 0;

  for (const source of collectCssSources(doc)) {
    const parsed = parseStringSetRules(source, order);
    rules.push(...parsed);
    order += parsed.length;
  }

  return rules;
}

/**
 * Evaluate a `string-set` value against the element that matched.
 *
 * `content()` and `content(text)` take the element's text. The other content
 * arguments name pseudo-elements this pipeline does not measure, so they
 * contribute nothing rather than the wrong text.
 */
export function evaluateStringSetValue(value: string, element: Element): string {
  let out = "";
  let index = 0;
  const text = value.trim();

  while (index < text.length) {
    const character = text[index] as string;

    if (character === " " || character === "\t" || character === "\n") {
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === character) break;
        end += 1;
      }
      out += text.slice(index + 1, end);
      index = end + 1;
      continue;
    }

    const functional = /^([a-z-]+)\(([^)]*)\)/i.exec(text.slice(index));
    if (functional) {
      const name = (functional[1] as string).toLowerCase();
      const argument = (functional[2] as string).trim().toLowerCase();

      if (name === "content" && (argument === "" || argument === "text")) {
        out += (element.textContent ?? "").replaceAll(/\s+/g, " ").trim();
      }
      // before, after and first-letter refer to pseudo-elements that are not
      // measured, and any other function is unknown; both add nothing.

      index += (functional[0] as string).length;
      continue;
    }

    const keyword = /^[^\s"']+/.exec(text.slice(index))?.[0] ?? text.slice(index);
    index += keyword.length;
  }

  return out;
}

/**
 * The value of each named string for a page.
 *
 * `assignments` must be in document order. A page shows the first assignment
 * that falls on it, or — when none does — whatever was in effect when the page
 * began, which is what makes a header carry over onto continuation pages.
 */
export function stringsForPage(
  assignments: readonly StringAssignment[],
  pageTop: number,
  pageBottom: number,
  scope: StringScope = "first",
): Map<string, string> {
  const entering = new Map<string, string>();
  const onPage = new Map<string, string>();
  const lastOnPage = new Map<string, string>();

  for (const assignment of assignments) {
    if (assignment.y < pageTop) {
      entering.set(assignment.name, assignment.value);
      continue;
    }
    if (assignment.y >= pageBottom) break;

    if (!onPage.has(assignment.name)) onPage.set(assignment.name, assignment.value);
    lastOnPage.set(assignment.name, assignment.value);
  }

  const result = new Map(entering);

  if (scope === "start") return result;

  const chosen = scope === "last" ? lastOnPage : onPage;
  for (const [name, value] of chosen) result.set(name, value);

  return result;
}
