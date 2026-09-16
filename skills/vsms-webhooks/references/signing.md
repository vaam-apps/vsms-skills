# The signature scheme

```
signature = HMAC-SHA256(secret, "v1\n{timestamp}\n{eventId}\n{sha256_hex(body)}")
header    = "v1=<hex>"
```

`sign_header`/`verify` try **every candidate secret against every presented
`v1=` value**, first match wins — that is what makes rotation work.

`generate_secret()` is the crate's one non-pure function: `whsec_<64 hex>`, 32
bytes of `OsRng`.

## Constant time is not optional

`verify` never compares raw bytes or hex strings. Every candidate goes through
`hmac::Mac::verify_slice`, which uses `subtle::ConstantTimeEq` internally. A
hex-string `==` is a timing oracle for the signature.

## Proven across languages, against a third tool

`tests/fixtures/cross_language_vectors.json` holds signatures computed by
**`openssl dgst -sha256 -hmac`** — not by the Rust crate, not by the Node
receiver. Both sides assert against that same fixture, and **both legs run in
CI**.

> The TypeScript leg had **never** run in CI while this repository claimed the
> scheme was proven on both sides. `pnpm turbo run test` reaches workspace
> packages only, and `examples/*` is outside the workspace on purpose. A
> cross-language agreement proof that only one side checks is precisely the half
> that drifts.

The Node receiver predates the Rust crate and was written against the design
doc's prose with **one flagged, honest guess** — the MAC algorithm. That guess
is now confirmed, not resolved by fiat: both are checked against the same
third-party fixture.

## `WebhookEndpoint.secret` is readable by humans, and that is the control

`@sensitive` redacts audit snapshots only — no serde attribute, so the field is
still returned by the API. The **model-level read policy is the entire
control**, and it is `owner`/`admin`/`developer`/`system`.

It was `auth().kind == "user"` — any authenticated human, including `auditor`,
`operator` and `support`, none of which hold any webhook permission. Narrowed
deliberately, and it is a **reversible product call**: the counter-argument is
that an auditor's mandate is "see everything". The reasoning taken was that
oversight is served by seeing _that_ a secret exists, was rotated, and when — not
by seeing its value. A signing secret is a credential, not a record.

The console masks it on screen as shoulder-surf discipline, **not** a security
boundary. Withholding data that already crossed the wire to an authenticated
session would be theatre.

## Creating an endpoint

`WebhookEndpoint.secret` has no `@default`, so a caller must supply one. The
console generates it (`crypto.randomBytes(32)`, matching `generate_secret`'s
format byte-for-byte) rather than asking an operator to type one, and shows a
one-time "copy it now" banner — while being honest that it is not a true
one-time secret, since an authorised read returns it again.

Both rotation and replay are gated on `webhook:manage` at Layer 2.

> Rotation enforced **only** Layer 1 for a while, while the _less_ sensitive
> replay enforced both. Fixed rather than striking `webhook:manage` from the
> vocabulary: a permission that appears in the role table and is never checked
> is worse than none, because it implies a control that does not exist.

**The trap when adding a Layer 2 gate to an existing procedure:** every test
that builds a context by hand starts failing, because `into_context()` never
populates `perms`/`scope` — only a real `GatewayAuth` does. And a
missing-permission denial is trivially confused with a missing-row `NotFound`,
because `require_permission` runs **before** the lookup.
