/**
 * Sign a licence token.
 *
 *   node scripts/sign-license.mjs \
 *     --key license-private-key.jwk.json \
 *     --licensee "Acme Corp" --seats 25 --until 2027-06-30 --edition pro
 *
 * Prints the token to give the customer. The signature covers the encoded
 * payload string byte for byte, which is what the verifier checks — see
 * packages/pro/src/license/token.ts for why that matters.
 */

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing --${name}`);
  }
  return process.argv[index + 1];
}

const keyPath = argument("key");
const payload = {
  licensee: argument("licensee"),
  seats: Number.parseInt(argument("seats"), 10),
  updatesUntil: argument("until"),
  edition: argument("edition", "pro"),
};

const features = argument("features", "");
if (features) payload.features = features.split(",").map((entry) => entry.trim());

if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.updatesUntil)) {
  throw new Error(`--until must be YYYY-MM-DD, received ${payload.updatesUntil}`);
}
if (!Number.isFinite(payload.seats)) throw new Error("--seats must be a number");

const jwk = JSON.parse(readFileSync(keyPath, "utf8"));
const key = await webcrypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);

const encoder = new TextEncoder();
const base64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const encodedPayload = base64url(encoder.encode(JSON.stringify(payload)));
const signature = new Uint8Array(
  await webcrypto.subtle.sign({ name: "Ed25519" }, key, encoder.encode(encodedPayload)),
);

console.log(`${encodedPayload}.${base64url(signature)}`);
