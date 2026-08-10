/**
 * The licence signing public key, compiled into the bundle.
 *
 * The matching private key never leaves the maintainer's machine, and is not in
 * this repository or its history. Nothing here is secret: a public key is
 * public, and shipping it is the point — verification has to work offline, in a
 * browser, with no network access of any kind.
 *
 * **This is a placeholder.** It is a real, well-formed Ed25519 key, so it
 * imports cleanly and every signature checked against it simply fails — which
 * makes the safe outcome (unlicensed) the default for anyone who forgets to
 * replace it. Before publishing, generate your own keypair with
 * `scripts/license-keygen.mjs` and paste the public half here.
 */

export const PUBLIC_KEY_BYTES: Uint8Array = new Uint8Array([
  13, 175, 216, 149, 69, 252, 209, 102, 235, 255, 231, 71, 37, 32, 103, 190, 15, 80, 164, 63,
  154, 17, 21, 12, 38, 36, 127, 187, 154, 91, 192, 219,
]);
