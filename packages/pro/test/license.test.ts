import { webcrypto } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  encodePayload,
  formatToken,
  fromBase64Url,
  isCalendarDate,
  parseToken,
  toBase64Url,
  type LicensePayload,
} from "../src/license/token.js";
import {
  coversBuild,
  explainFailure,
  licenseCovers,
  verifyLicense,
} from "../src/license/verify.js";

/**
 * A throwaway keypair, generated per run.
 *
 * The real signing key never leaves the maintainer's machine and is not in this
 * repository, so tests cannot use it — which is the point. Verification takes
 * the public key as an option precisely so it can be tested without one.
 */
let publicKey: Uint8Array;
let privateKey: CryptoKey;

const BASE: LicensePayload = {
  licensee: "Acme Corp",
  seats: 25,
  updatesUntil: "2026-06-30",
  edition: "pro",
};

async function sign(payload: LicensePayload): Promise<string> {
  const { encoded, signedBytes } = encodePayload(payload);
  const signature = new Uint8Array(
    await webcrypto.subtle.sign({ name: "Ed25519" }, privateKey, signedBytes),
  );
  return formatToken(encoded, signature);
}

beforeAll(async () => {
  const pair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  privateKey = pair.privateKey;
  publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
});

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 62, 63, 127, 128, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it("emits no padding and none of the unsafe characters", () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 190]));
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
  });

  it("rejects input that is not base64url at all", () => {
    expect(fromBase64Url("not valid!")).toBeUndefined();
  });
});

describe("isCalendarDate", () => {
  it("accepts a real day", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects a day that does not exist", () => {
    // Date.parse would silently roll this into March.
    expect(isCalendarDate("2025-02-30")).toBe(false);
    expect(isCalendarDate("2025-13-01")).toBe(false);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(isCalendarDate("2026-6-30")).toBe(false);
    expect(isCalendarDate("30/06/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("coversBuild", () => {
  it("accepts a build released before the licence lapses", () => {
    expect(coversBuild("2026-06-30", "2026-01-15")).toBe(true);
  });

  it("accepts a build released on the last covered day", () => {
    expect(coversBuild("2026-06-30", "2026-06-30")).toBe(true);
  });

  it("rejects a build released after the licence lapses", () => {
    expect(coversBuild("2026-06-30", "2026-07-01")).toBe(false);
  });

  it("does not consult the clock", () => {
    // The rule that makes this a perpetual licence rather than a subscription:
    // a build from 2020 keeps working in 2099, because the comparison is
    // against the build's own date and that never moves.
    //
    // If this were `Date.now() <= updatesUntil`, every customer's production
    // app would break on renewal day. The two forms look nearly identical in a
    // diff, which is why the distinction is asserted rather than assumed.
    const longExpired = "2020-01-01";
    const ancientBuild = "2019-06-01";

    expect(coversBuild(longExpired, ancientBuild)).toBe(true);
    expect(Date.now()).toBeGreaterThan(new Date(`${longExpired}T00:00:00Z`).getTime());
  });
});

describe("parseToken", () => {
  it("reads a well-formed token", async () => {
    const parsed = parseToken(await sign(BASE));
    expect(parsed?.payload).toEqual(BASE);
  });

  it("returns nothing for shapes that are not tokens", () => {
    for (const bad of ["", ".", "nodot", "a.", ".b", "a.b.c", "!!!.???"]) {
      expect(parseToken(bad), bad).toBeUndefined();
    }
  });

  it("rejects a payload missing a required field", () => {
    const { encoded } = encodePayload({ licensee: "Acme" } as unknown as LicensePayload);
    expect(parseToken(`${encoded}.AAAA`)).toBeUndefined();
  });

  it("rejects a payload whose updatesUntil is not a real date", () => {
    const { encoded } = encodePayload({ ...BASE, updatesUntil: "2026-02-30" });
    expect(parseToken(`${encoded}.AAAA`)).toBeUndefined();
  });

  it("signs the encoded payload, not a re-serialisation of it", async () => {
    // Key order differs from BASE, so a verifier that re-encoded the object
    // would compute different bytes and reject a perfectly good licence.
    const reordered = {
      edition: "pro",
      updatesUntil: "2026-06-30",
      seats: 25,
      licensee: "Acme Corp",
    } as LicensePayload;

    const token = await sign(reordered);
    const parsed = parseToken(token);

    expect(parsed).toBeDefined();
    expect(new TextDecoder().decode(parsed?.signedBytes)).toBe(token.split(".")[0]);
    await expect(verifyLicense(token, { publicKey, buildDate: "2026-01-01" })).resolves
      .toMatchObject({ valid: true });
  });
});

describe("verifyLicense", () => {
  it("accepts a signed licence covering this build", async () => {
    const status = await verifyLicense(await sign(BASE), {
      publicKey,
      buildDate: "2026-01-01",
    });

    expect(status).toEqual({ valid: true, license: BASE });
  });

  it("reports an absent licence separately from a bad one", async () => {
    await expect(verifyLicense(undefined, { publicKey })).resolves.toEqual({
      valid: false,
      reason: "absent",
    });
    await expect(verifyLicense("   ", { publicKey })).resolves.toEqual({
      valid: false,
      reason: "absent",
    });
  });

  it("rejects a token signed by the wrong key", async () => {
    const other = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const otherPublic = new Uint8Array(
      await webcrypto.subtle.exportKey("raw", other.publicKey),
    );

    const status = await verifyLicense(await sign(BASE), {
      publicKey: otherPublic,
      buildDate: "2026-01-01",
    });

    expect(status).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a payload edited after signing", async () => {
    // The attack the signature exists to stop: take a real licence, extend it.
    const token = await sign(BASE);
    const signature = token.split(".")[1] as string;
    const { encoded } = encodePayload({ ...BASE, updatesUntil: "2099-01-01", seats: 9999 });

    const status = await verifyLicense(`${encoded}.${signature}`, {
      publicKey,
      buildDate: "2026-01-01",
    });

    expect(status).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a build newer than the licence's updatesUntil", async () => {
    const status = await verifyLicense(await sign(BASE), {
      publicKey,
      buildDate: "2026-07-01",
    });

    expect(status).toEqual({ valid: false, reason: "build-newer-than-updates" });
  });

  it("keeps accepting an old build long after the licence lapsed", async () => {
    // The perpetual guarantee, end to end rather than on the comparison alone.
    const token = await sign({ ...BASE, updatesUntil: "2020-01-01" });

    await expect(
      verifyLicense(token, { publicKey, buildDate: "2019-11-30" }),
    ).resolves.toMatchObject({ valid: true });
  });

  it("checks the signature before the dates", async () => {
    // An unsigned token's dates mean nothing, so reporting on them would send
    // someone chasing an expiry that was never the problem.
    const { encoded } = encodePayload({ ...BASE, updatesUntil: "2000-01-01" });

    const status = await verifyLicense(`${encoded}.AAAA`, {
      publicKey,
      buildDate: "2026-01-01",
    });

    expect(status).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("never throws, whatever it is handed", async () => {
    for (const bad of ["", "...", "a.b", "💥.💥", "x".repeat(10_000)]) {
      const status = await verifyLicense(bad, { publicKey, buildDate: "2026-01-01" });
      expect(status.valid, bad).toBe(false);
    }
  });

  it("makes no network request", async () => {
    // An enterprise will reject a library that phones home, so this is a
    // guarantee rather than a preference.
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("network access attempted");
    }) as typeof fetch;

    try {
      await verifyLicense(await sign(BASE), { publicKey, buildDate: "2026-01-01" });
    } finally {
      globalThis.fetch = original;
    }

    expect(called).toBe(false);
  });
});

describe("licenseCovers", () => {
  it("treats an absent feature list as the whole product", () => {
    expect(licenseCovers(BASE, "pdfa")).toBe(true);
  });

  it("honours a feature list when there is one", () => {
    const limited = { ...BASE, features: ["pdfa"] };
    expect(licenseCovers(limited, "pdfa")).toBe(true);
    expect(licenseCovers(limited, "encryption")).toBe(false);
  });
});

describe("explainFailure", () => {
  it("explains that a lapsed licence still covers older builds", () => {
    // The message a customer reads when they upgrade past their maintenance
    // window. It has to say what still works, or it reads as a dead licence.
    expect(explainFailure("build-newer-than-updates")).toContain("still covers");
  });

  it("has a sentence for every reason", () => {
    for (const reason of [
      "absent",
      "malformed",
      "bad-signature",
      "build-newer-than-updates",
      "unsupported-platform",
    ] as const) {
      expect(explainFailure(reason).length, reason).toBeGreaterThan(10);
    }
  });
});
