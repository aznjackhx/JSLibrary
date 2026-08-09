/**
 * Page resource dictionaries.
 *
 * The registry hands out a stable name per referenced object and reuses it, so
 * a font referenced two hundred times is one object and one resource entry.
 * Names are assigned in first-use order, which keeps output deterministic.
 */

import { PdfDict, type PdfRef, type PdfValue } from "./objects.js";

export type ResourceCategory =
  | "Font"
  | "XObject"
  | "ExtGState"
  | "Shading"
  | "Pattern"
  | "ColorSpace";

const NAME_PREFIX: Record<ResourceCategory, string> = {
  Font: "F",
  XObject: "X",
  ExtGState: "GS",
  Shading: "Sh",
  Pattern: "P",
  ColorSpace: "CS",
};

export class ResourceRegistry {
  /** category -> object key -> resource name */
  readonly #assigned = new Map<ResourceCategory, Map<string, string>>();
  /** category -> resource name -> value */
  readonly #entries = new Map<ResourceCategory, Map<string, PdfValue>>();

  #categoryMaps(category: ResourceCategory): {
    assigned: Map<string, string>;
    entries: Map<string, PdfValue>;
  } {
    let assigned = this.#assigned.get(category);
    if (!assigned) {
      assigned = new Map();
      this.#assigned.set(category, assigned);
    }
    let entries = this.#entries.get(category);
    if (!entries) {
      entries = new Map();
      this.#entries.set(category, entries);
    }
    return { assigned, entries };
  }

  /**
   * Register an indirect object and get the name to use in content streams.
   *
   * Registering the same reference again returns the same name without adding
   * a second entry.
   */
  register(category: ResourceCategory, target: PdfRef): string {
    const { assigned, entries } = this.#categoryMaps(category);

    const existing = assigned.get(target.key);
    if (existing !== undefined) return existing;

    const resourceName = `${NAME_PREFIX[category]}${entries.size + 1}`;
    assigned.set(target.key, resourceName);
    entries.set(resourceName, target);
    return resourceName;
  }

  /** Number of distinct objects registered in a category. */
  count(category: ResourceCategory): number {
    return this.#entries.get(category)?.size ?? 0;
  }

  /** The name a reference was given, if it has been registered. */
  nameFor(category: ResourceCategory, target: PdfRef): string | undefined {
    return this.#assigned.get(category)?.get(target.key);
  }

  isEmpty(): boolean {
    for (const entries of this.#entries.values()) {
      if (entries.size > 0) return false;
    }
    return true;
  }

  /** Build the `/Resources` dictionary. */
  toDict(): PdfDict {
    const resources = new PdfDict();
    // Fixed category order so the same registrations always serialise
    // identically, regardless of the order categories were first touched.
    const categories: ResourceCategory[] = [
      "ExtGState",
      "ColorSpace",
      "Pattern",
      "Shading",
      "XObject",
      "Font",
    ];

    for (const category of categories) {
      const entries = this.#entries.get(category);
      if (!entries || entries.size === 0) continue;
      resources.set(category, new PdfDict(entries));
    }

    return resources;
  }
}
