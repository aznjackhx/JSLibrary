/**
 * Arabic joining behaviour: which form each letter takes in context.
 *
 * A cursive script draws the same letter differently depending on its
 * neighbours — alone, joined to the left, to the right, or both. Which one is
 * decided entirely by the characters around it, before any font is consulted;
 * the font is then asked for that form through `GSUB`.
 *
 * This is the part of shaping that is pure Unicode. It is small, exact, and
 * has no dependency on the font at all, which is why it lives on its own.
 */

/**
 * How a character joins to its neighbours.
 *
 * - `dual` joins on both sides — most Arabic letters.
 * - `right` joins only to the letter before it, so it ends a joined run.
 *   Alef, dal, reh, waw and friends: the reason Arabic words break into
 *   several joined pieces rather than one.
 * - `causing` joins on both sides but is not a letter — the tatweel used to
 *   stretch a word.
 * - `transparent` is skipped entirely when looking at neighbours: vowel marks
 *   sit above or below a letter and must not break the join beneath them.
 * - `none` does not join at all.
 */
export type JoiningType = "dual" | "right" | "causing" | "transparent" | "none";

/** The form a letter takes once its neighbours are known. */
export type JoiningForm = "isol" | "init" | "medi" | "fina";

/** Characters that join only to the right, so a joined run ends at them. */
const RIGHT_JOINING = new Set([
  0x06_22, 0x06_23, 0x06_24, 0x06_25, 0x06_27, 0x06_29, 0x06_2f, 0x06_30,
  0x06_31, 0x06_32, 0x06_48, 0x06_71, 0x06_72, 0x06_73, 0x06_75, 0x06_76,
  0x06_77, 0x06_88, 0x06_89, 0x06_8a, 0x06_8b, 0x06_8c, 0x06_8d, 0x06_8e,
  0x06_8f, 0x06_90, 0x06_91, 0x06_92, 0x06_93, 0x06_94, 0x06_95, 0x06_96,
  0x06_97, 0x06_98, 0x06_99, 0x06_c0, 0x06_c1, 0x06_c2, 0x06_c3, 0x06_c4,
  0x06_c5, 0x06_c6, 0x06_c7, 0x06_c8, 0x06_c9, 0x06_ca, 0x06_cb, 0x06_cd,
  0x06_cf, 0x06_d2, 0x06_d3, 0x06_d5, 0x07_10,
]);

/** Ranges of combining marks, which never break a join. */
const TRANSPARENT_RANGES: readonly (readonly [number, number])[] = [
  [0x06_10, 0x06_1a],
  [0x06_4b, 0x06_5f],
  [0x06_70, 0x06_70],
  [0x06_d6, 0x06_dc],
  [0x06_df, 0x06_e8],
  [0x06_ea, 0x06_ed],
  [0x08_00, 0x08_2d],
  [0x08_59, 0x08_5b],
  // Zero-width joiner and non-joiner are handled as joining controls below;
  // everything else in this list is a mark.
];

/** Ranges of Arabic letters that join on both sides unless listed above. */
const DUAL_RANGES: readonly (readonly [number, number])[] = [
  [0x06_20, 0x06_4a],
  [0x06_6e, 0x06_6f],
  [0x06_71, 0x06_dc],
  [0x06_ff, 0x06_ff],
  [0x07_50, 0x07_7f],
  [0x08_a0, 0x08_bd],
  // Syriac, which joins the same way.
  [0x07_12, 0x07_2f],
];

function inRanges(
  code: number,
  ranges: readonly (readonly [number, number])[],
): boolean {
  return ranges.some(([from, to]) => code >= from && code <= to);
}

export function joiningType(character: string): JoiningType {
  const code = character.codePointAt(0);
  if (code === undefined) return "none";

  // Zero-width joiner joins both ways and is never drawn; zero-width
  // non-joiner deliberately breaks a join that would otherwise happen.
  if (code === 0x20_0d) return "causing";
  if (code === 0x20_0c) return "none";
  if (code === 0x06_40) return "causing"; // tatweel

  if (inRanges(code, TRANSPARENT_RANGES)) return "transparent";
  if (RIGHT_JOINING.has(code)) return "right";
  if (inRanges(code, DUAL_RANGES)) return "dual";

  return "none";
}

/**
 * The form each character of a run takes.
 *
 * Marks are transparent — they take the form of nothing and are skipped when
 * deciding their neighbours' forms, which is why a vowel sign between two
 * letters does not break the join beneath it.
 *
 * Runs are given in logical order, which is what the DOM provides; visual
 * order is the renderer's business and does not change which form a letter
 * takes.
 */
export function joiningForms(characters: readonly string[]): JoiningForm[] {
  const types = characters.map((character) => joiningType(character));

  /** The nearest non-transparent neighbour in a direction. */
  const neighbour = (from: number, step: number): JoiningType | undefined => {
    for (let index = from + step; index >= 0 && index < types.length; index += step) {
      const type = types[index] as JoiningType;
      if (type !== "transparent") return type;
    }
    return undefined;
  };

  return types.map((type, index) => {
    if (type === "transparent" || type === "none") return "isol";

    // Joins backward when the previous letter can join forward.
    const before = neighbour(index, -1);
    const joinsBefore = before === "dual" || before === "causing";

    // Joins forward when the next letter can accept a join from the right.
    const after = neighbour(index, 1);
    const joinsAfter = after === "dual" || after === "right" || after === "causing";

    // A right-joining letter never joins to what follows, however willing the
    // next letter is — this is why Arabic words break into pieces.
    if (type === "right") return joinsBefore ? "fina" : "isol";

    if (joinsBefore && joinsAfter) return "medi";
    if (joinsBefore) return "fina";
    if (joinsAfter) return "init";
    return "isol";
  });
}
