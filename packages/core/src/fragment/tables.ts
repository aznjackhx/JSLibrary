/**
 * Tables that span pages.
 *
 * A table broken across pages must repeat its header on every page it reaches,
 * and place its footer at the bottom of each. This is the feature the brief
 * calls the most requested missing one in competing libraries, and the reason
 * is that it is not a painting trick: repeating a header *consumes vertical
 * space* on every page after the first, so the rows that fit change, so the
 * page breaks change. Pagination has to know about it.
 *
 * The model is therefore a reservation. A table contributes, for the span it
 * covers, an amount of height that is unavailable to content on any page that
 * begins inside it. Rows remain ordinary atoms, so a row is never divided
 * unless it is taller than the space a page can offer it.
 */

import type { MeasuredElement, MeasuredNode } from "../measure/types.js";

/** A table's repeated furniture and the span over which it applies. */
export interface RepeatingTable {
  /** Top of the table's box, in measured CSS pixels. */
  readonly top: number;
  /** Bottom of the table's box. */
  readonly bottom: number;
  /** The header rows to repeat, if any. */
  readonly header: TableFurniture | undefined;
  /** The footer rows to repeat, if any. */
  readonly footer: TableFurniture | undefined;
}

export interface TableFurniture {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
  /** The measured subtree to repaint on each page. */
  readonly node: MeasuredElement;
}

function sectionOf(table: MeasuredElement, tag: string): TableFurniture | undefined {
  for (const child of table.children) {
    if (child.kind !== "element" || child.tag !== tag) continue;
    if (child.rect.height <= 0) continue;
    return {
      top: child.rect.y,
      bottom: child.rect.y + child.rect.height,
      height: child.rect.height,
      node: child,
    };
  }
  return undefined;
}

/**
 * Find every table with furniture worth repeating.
 *
 * A table with no `thead` or `tfoot`, or one short enough to fit on a page,
 * needs nothing special and is not returned — it fragments as ordinary content.
 */
export function collectRepeatingTables(root: MeasuredElement): RepeatingTable[] {
  const tables: RepeatingTable[] = [];

  const visit = (node: MeasuredNode): void => {
    if (node.kind !== "element") return;

    if (node.tag === "table" && node.rect.height > 0) {
      const header = sectionOf(node, "thead");
      const footer = sectionOf(node, "tfoot");

      if (header || footer) {
        tables.push({
          top: node.rect.y,
          bottom: node.rect.y + node.rect.height,
          header,
          footer,
        });
      }
    }

    for (const child of node.children) visit(child);
  };

  visit(root);
  tables.sort((a, b) => a.top - b.top);
  return tables;
}

/**
 * Tables whose header this page must repeat.
 *
 * A page beginning strictly inside a table shows the header again at the top.
 * The table's *first* page shows it in its natural position and pays nothing
 * extra.
 */
export function headerRepeatAt(
  tables: readonly RepeatingTable[],
  y: number,
): RepeatingTable[] {
  return tables.filter(
    (table) => table.header !== undefined && y > table.top + 0.5 && y < table.bottom - 0.5,
  );
}

/**
 * Tables whose footer this page must repeat.
 *
 * The condition is not "the page starts inside the table" — that would miss the
 * table's first page, which needs a footer just as much, since `tfoot` is laid
 * out once at the very end of the table. It is "the table reaches this page and
 * continues past it".
 *
 * Whether it continues is judged against the full page height rather than
 * against the break this reservation helps determine, which would be circular.
 * The final page of a table paints its footer in the natural position.
 */
export function footerRepeatAt(
  tables: readonly RepeatingTable[],
  y: number,
  pageHeight: number,
): RepeatingTable[] {
  const pageEnd = y + pageHeight;
  return tables.filter(
    (table) =>
      table.footer !== undefined && table.top < pageEnd - 0.5 && table.bottom > pageEnd + 0.5,
  );
}

/** Total height repeated furniture takes from a page starting at `y`. */
export function reservedHeightAt(
  tables: readonly RepeatingTable[],
  y: number,
  pageHeight: number,
): { top: number; bottom: number } {
  const top = headerRepeatAt(tables, y).reduce(
    (total, table) => total + (table.header?.height ?? 0),
    0,
  );
  const bottom = footerRepeatAt(tables, y, pageHeight).reduce(
    (total, table) => total + (table.footer?.height ?? 0),
    0,
  );
  return { top, bottom };
}
