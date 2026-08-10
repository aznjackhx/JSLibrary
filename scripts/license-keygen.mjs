/**
 * Generate a licence signing keypair.
 *
 *   node scripts/license-keygen.mjs
 *
 * Prints the public key as the array literal to paste into
 * `packages/pro/src/license/public-key.ts`, and writes the private key to a
 * file you must keep off this machine's repository and out of its history.
 *
 * The private key never leaves your machine. It is not needed to build, test,
 * or run anything here — only to sign a customer's licence.
 */

import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "license-private-key.jwk.json";

const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);

const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const privateJwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

writeFileSync(OUT, `${JSON.stringify(privateJwk, null, 2)}\n`, { mode: 0o600 });

console.log(`Private key written to ${OUT} (mode 0600). Do not commit it.\n`);
console.log("Paste into packages/pro/src/license/public-key.ts:\n");
console.log("export const PUBLIC_KEY_BYTES: Uint8Array = new Uint8Array([");
console.log(`  ${[...publicRaw].join(", ")},`);
console.log("]);");
