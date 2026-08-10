import { describe, expect, it } from "vitest";

import {
  footerRepeatAt,
  headerRepeatAt,
  reservedHeightAt,
  type RepeatingTable,
} from "../src/fragment/tables.js";

const furniture = (top: number, height: number) => ({
  top,
  bottom: top + height,
  height,
  node: {} as never,
});

const table = (top: number, bottom: number, header?: number, footer?: number): RepeatingTable => ({
  top,
  bottom,
  header: header === undefined ? undefined : furniture(top, header),
  footer: footer === undefined ? undefined : furniture(bottom - footer, footer),
});

describe("headerRepeatAt", () => {
  const tables = [table(100, 900, 30)];

  it("repeats on a page starting inside the table", () => {
    expect(headerRepeatAt(tables, 400)).toHaveLength(1);
  });

  it("does not repeat on the table's first page", () => {
    // The header is already there, in its natural position.
    expect(headerRepeatAt(tables, 0)).toEqual([]);
    expect(headerRepeatAt(tables, 100)).toEqual([]);
  });

  it("does not repeat after the table has ended", () => {
    expect(headerRepeatAt(tables, 900)).toEqual([]);
    expect(headerRepeatAt(tables, 1000)).toEqual([]);
  });

  it("ignores a table with no header", () => {
    expect(headerRepeatAt([table(100, 900)], 400)).toEqual([]);
  });
});

describe("footerRepeatAt", () => {
  const tables = [table(100, 900, undefined, 20)];

  it("repeats on the table's first page, which the header rule would miss", () => {
    // tfoot is laid out once, at the very end of the table, so the first page
    // needs it repeated just as much as any other.
    expect(footerRepeatAt(tables, 0, 500)).toHaveLength(1);
  });

  it("repeats on a middle page", () => {
    expect(footerRepeatAt(tables, 500, 300)).toHaveLength(1);
  });

  it("does not repeat on the page where the table ends", () => {
    // The natural footer is painted there.
    expect(footerRepeatAt(tables, 600, 500)).toEqual([]);
  });

  it("does not repeat on a page the table never reaches", () => {
    expect(footerRepeatAt(tables, 1000, 500)).toEqual([]);
  });

  it("ignores a table with no footer", () => {
    expect(footerRepeatAt([table(100, 900, 30)], 0, 500)).toEqual([]);
  });
});

describe("reservedHeightAt", () => {
  it("charges nothing outside a table", () => {
    expect(reservedHeightAt([table(100, 900, 30, 20)], 1000, 500)).toEqual({ top: 0, bottom: 0 });
  });

  it("charges the footer but not the header on the first page", () => {
    expect(reservedHeightAt([table(100, 900, 30, 20)], 0, 500)).toEqual({ top: 0, bottom: 20 });
  });

  it("charges both on a continuation page", () => {
    expect(reservedHeightAt([table(100, 900, 30, 20)], 400, 300)).toEqual({ top: 30, bottom: 20 });
  });

  it("sums nested tables", () => {
    const tables = [table(0, 1000, 30, 0), table(100, 900, 25, 0)];
    expect(reservedHeightAt(tables, 400, 300).top).toBe(55);
  });
});
