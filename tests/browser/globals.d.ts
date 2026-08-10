/**
 * `window.PkgCore` is whichever IIFE bundle the test injected — the public
 * entry, the measurement module, or another internal one. They all use the same
 * global name, so the declaration is deliberately untyped and each helper casts
 * to the module it loaded.
 */
declare global {
  interface Window {
    PkgCore: unknown;
    PkgPro: unknown;
  }
}

export {};
