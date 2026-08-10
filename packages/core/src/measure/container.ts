/**
 * The hidden measurement container.
 *
 * Step 1 of the pipeline: give the browser a box exactly as wide as the page's
 * content area and let it lay the content out. Everything downstream reads the
 * result rather than computing it.
 *
 * Two constraints shape the implementation:
 *
 * `display: none` is not an option — it produces no layout at all, which is the
 * one thing we need. The container is therefore laid out for real and moved
 * off-screen, which costs a little paint work and gives correct geometry.
 *
 * The clone is reparented, so ancestor-dependent selectors (`.theme p`) no
 * longer match. Inherited properties are copied from the source element onto the
 * clone root to compensate, which covers font, colour and line-height — the
 * properties that actually drive text layout. Selectors that set non-inherited
 * properties through an ancestor are a known limitation.
 */

/** Properties that inherit in CSS and materially affect layout or painting. */
const INHERITED_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "white-space",
  "word-break",
  "word-spacing",
  "overflow-wrap",
  "hyphens",
  "direction",
  "writing-mode",
  "text-rendering",
  "font-kerning",
  "font-feature-settings",
  "font-variant-ligatures",
  "orphans",
  "widows",
  "tab-size",
  "quotes",
  "list-style",
] as const;

export interface MeasurementContainerOptions {
  /** Width of the page content box, in CSS pixels. */
  readonly width: number;
  /**
   * Height of the page content box, in CSS pixels.
   *
   * The container is not clipped to it — content is allowed to overflow so its
   * full height can be measured, which is what fragmentation needs to know.
   */
  readonly height?: number;
  /** Document to build in. Defaults to the element's own document. */
  readonly document?: Document;
}

/**
 * A laid-out clone of the target content, sized to the page content box.
 *
 * Always `destroy()` it — it is a real, laid-out subtree, and leaving it
 * attached costs memory and paint work on every subsequent frame.
 */
export class MeasurementContainer {
  readonly element: HTMLElement;
  readonly content: HTMLElement;
  readonly width: number;
  /**
   * Clone image to the original it was copied from.
   *
   * A cloned `<img>` starts its load again from scratch, and until it finishes
   * the browser has no intrinsic size for it. The original in the live document
   * has already loaded, so it is the one to read pixels and dimensions from.
   */
  readonly sourceImages: ReadonlyMap<Element, HTMLImageElement>;

  #destroyed = false;

  private constructor(
    element: HTMLElement,
    content: HTMLElement,
    width: number,
    sourceImages: ReadonlyMap<Element, HTMLImageElement>,
  ) {
    this.element = element;
    this.content = content;
    this.width = width;
    this.sourceImages = sourceImages;
  }

  static create(source: Element, options: MeasurementContainerOptions): MeasurementContainer {
    const doc = options.document ?? source.ownerDocument;
    if (!doc?.body) {
      throw new Error("Measurement requires a document with a body");
    }

    const container = doc.createElement("div");
    container.setAttribute("data-pkg-measure", "");

    // Off-screen rather than hidden: layout must still happen. `visibility:
    // hidden` would also lay out, but it suppresses painting in ways that can
    // change what getClientRects reports for some replaced elements.
    Object.assign(container.style, {
      position: "absolute",
      top: "0",
      // Far enough left that nothing shows, near enough that engines do not
      // start clamping coordinates.
      left: "-100000px",
      width: `${options.width}px`,
      // Height is deliberately unconstrained: fragmentation needs the natural
      // height of the content, not the height of one page.
      height: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      // A fresh containing block, so the page's own layout cannot leak in.
      contain: "none",
      boxSizing: "content-box",
      // Scrollbars would steal width and quietly change every line break.
      overflow: "visible",
      zIndex: "-1",
      pointerEvents: "none",
    });

    const clone = source.cloneNode(true) as HTMLElement;
    copyInheritedStyles(source, clone);

    // The clone must fill the container exactly: its own margins would offset
    // every measurement by an amount the page geometry does not account for.
    Object.assign(clone.style, { margin: "0", width: "100%", boxSizing: "border-box" });

    const sourceImages = pairImages(source, clone);

    container.append(clone);
    doc.body.append(container);

    return new MeasurementContainer(container, clone, options.width, sourceImages);
  }

  /** Container-relative origin, used to make every rect relative to the page. */
  get origin(): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }

  /** Full laid-out height of the content, in CSS pixels. */
  get contentHeight(): number {
    return this.content.getBoundingClientRect().height;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.element.remove();
  }
}

/**
 * Pair each cloned image with the original it came from, and give the clone an
 * intrinsic size to lay out with.
 *
 * Cloning an `<img>` restarts its load. Until that finishes the element has no
 * intrinsic size, and an engine that has not yet decoded it lays out the alt
 * text instead — Firefox measured a 120px image as 38px of alt text, and
 * captured no pixels at all, because the clone was still loading. Copying the
 * original's decoded dimensions onto the clone's `width`/`height` attributes
 * gives layout the box immediately; CSS still overrides them, exactly as it
 * would for the original.
 *
 * The two trees are structurally identical, so document order pairs them.
 */
function pairImages(source: Element, clone: Element): Map<Element, HTMLImageElement> {
  const collect = (root: Element): Element[] => {
    const images = [...root.querySelectorAll("img")];
    return root.tagName === "IMG" ? [root, ...images] : images;
  };

  const sources = collect(source);
  const clones = collect(clone);
  const pairs = new Map<Element, HTMLImageElement>();

  for (const [index, cloned] of clones.entries()) {
    const original = sources[index];
    if (!(original instanceof HTMLImageElement) || !(cloned instanceof HTMLImageElement)) {
      continue;
    }

    pairs.set(cloned, original);

    if (original.naturalWidth > 0 && !cloned.hasAttribute("width")) {
      cloned.setAttribute("width", String(original.naturalWidth));
    }
    if (original.naturalHeight > 0 && !cloned.hasAttribute("height")) {
      cloned.setAttribute("height", String(original.naturalHeight));
    }
  }

  return pairs;
}

/**
 * Copy inherited properties from the source's computed style onto the clone.
 *
 * The clone is reparented into the container, so it no longer inherits from its
 * original ancestors. Without this, content inside a themed wrapper measures at
 * the wrong font size and every line break is wrong.
 */
export function copyInheritedStyles(source: Element, clone: HTMLElement): void {
  const view = source.ownerDocument.defaultView;
  if (!view) return;

  const computed = view.getComputedStyle(source);
  for (const property of INHERITED_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) clone.style.setProperty(property, value);
  }
}

/**
 * Run `body` with a measurement container, tearing it down afterwards.
 */
export function withMeasurementContainer<T>(
  source: Element,
  options: MeasurementContainerOptions,
  body: (container: MeasurementContainer) => T,
): T {
  const container = MeasurementContainer.create(source, options);
  try {
    return body(container);
  } finally {
    container.destroy();
  }
}
