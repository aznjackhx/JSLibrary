# Commercial License

> **Draft — not yet reviewed by a lawyer.** This file records the commercial terms
> the engineering work assumes (perpetual use, time-limited updates, per-seat
> counting). Have counsel review and replace this text before it is offered to a
> customer.

`@pkg/core` is dual licensed. You may use it under either:

1. the **GNU Affero General Public License v3.0** (see [`LICENSE`](./LICENSE)), or
2. this **Commercial License**, purchased from the copyright holder.

`@pkg/pro` is available **only** under this Commercial License. It is never
published under an open source license.

Pick the commercial license if you cannot or do not want to comply with the
AGPL — most commonly because you distribute or host a proprietary product and
cannot release its source under a compatible license.

## 1. Grant

Subject to payment, the copyright holder grants the licensee a non-exclusive,
worldwide, **perpetual** license to use, modify and distribute the software in
object or source form as part of the licensee's own products, for the number of
seats purchased.

## 2. Perpetual use, time-limited updates

This is a perpetual license, not a subscription.

- Every release published **on or before** the `updatesUntil` date in the
  licensee's key may be used forever, including in production, including after
  the key's `updatesUntil` date passes.
- Releases published **after** that date require a renewed key.

Concretely, the software validates:

```
buildDate <= license.updatesUntil
```

It never validates `Date.now() <= license.updatesUntil`. A build that works
today keeps working indefinitely; renewal only governs access to newer releases.

## 3. Seats

A seat is one developer who works on source code that imports the software.
Build agents, CI runners, and end users of the licensee's product are not seats
and are not counted.

## 4. License keys

A key is an Ed25519-signed token carrying the licensee name, seat count,
`updatesUntil` date and edition. It is verified offline in the browser using a
public key shipped in the bundle.

The software makes **no network requests** for licensing or any other purpose:
no phone-home, no runtime revocation, no telemetry.

Keys are confidential. Do not publish one in a public repository or a public
build artifact.

## 5. Restrictions

The licensee may not:

- redistribute the software as a standalone product, SDK or library competing
  with it;
- remove or alter copyright, license or attribution notices;
- sublicense, except as embedded in the licensee's own product.

## 6. Unlicensed use of `@pkg/pro`

Running `@pkg/pro` without a valid key emits a `console.warn` and applies a
small watermark to output. It never throws and never silently corrupts output.
This is compliance hygiene, not DRM — but shipping a proprietary product on
unlicensed Pro code is a license violation regardless of whether the watermark
is removed.

## 7. Warranty and liability

The software is provided "as is", without warranty of any kind. To the maximum
extent permitted by law, the copyright holder is not liable for any damages
arising from its use.

## 8. Contact

Purchasing, seat expansion and renewals: _add contact address before release._
