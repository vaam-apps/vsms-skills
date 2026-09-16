---
name: vsms-mtn
description: "MTN capacity in vsms, bought through a licensed aggregator rather than a direct interconnect — what the adapter genuinely implements, which parts of its wire shape are an invented placeholder awaiting a real contract, and why its Capabilities are config-driven where Orange's are constants. Load before touching sms-provider-mtn, wiring a second provider into the worker, or assuming MTN delivery works today."
---

# vsms-mtn

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

`backends/crates/sms-provider-mtn`. This targets MTN capacity **bought through a
licensed aggregator, not a direct MTN interconnect** — the posture the design
doc recommends, and the path that avoids the "do we hold our own ART title?"
question entirely.

## Read this before trusting the wire shape

> **No real aggregator contract exists, and none of this has been run against a
> live endpoint.**

The request/response JSON — `POST {base_url}/v1/messages`, Bearer API-key auth,
a `201` carrying `messageId`, a DLR echoing that same `messageId` — is an
**invented placeholder**, chosen to match the common pattern across the
aggregators the design doc names as candidates. It was **not** transcribed from
a real Swagger the way Orange's was.

**When a real contract lands: replace the request/response structs. Do not
replace the `SmsProvider` impl or the error classification around them.** Those
follow from what `reqwest` itself guarantees, not from any vendor's docs, and
are exactly as trustworthy here as in the Orange adapter.

The crate's own module doc carries the full honesty ledger. Read it first.

## What is genuinely different from Orange

- **`Capabilities` reads from config, not constants.** TPS ceiling, per-segment
  cost and alphanumeric-sender support are commercial terms of a contract. This
  is the structural difference, not just different numbers — a router that
  special-cased a provider key could not express them at all.
- **`provider_ref_alt` is always `None`.** The assumed DLR echoes back the same
  `messageId` `submit()` returns, so there is no correlation gap to work around.
  That is a property of the **assumed** shape, not a proven simplification —
  revisit it alongside `parse_dlr` when a real payload exists.
- **`401`/`403` are `Permanent`** — the API key itself is bad. Orange has no
  equivalent, since it authenticates with a separately-fetched bearer token.
- **A `429` uses a 5s fixed delay**, against Orange's 1s. Both are negotiated
  commercial facts, now parameters of the shared classifier.

  > A doc comment here once claimed the delay was "parsed opportunistically"
  > from a `Retry-After` header. ~~It never was.~~ **Corrected:** it has always
  > been the fixed constant. The doc was fixed, not the code — real header
  > parsing is a behavioural change, not a docs fix.

## It is not wired up

`backends/apps/sms-worker/src/main.rs` builds its provider registry with
**exactly one entry** (`orange_cm`). Adding MTN is a second `.insert(...)`, not
a redesign — but until then, a `Route` naming an MTN `Provider` row produces a
retryable "no adapter configured" until an operator fixes the mismatch.

Seeding an MTN provider without registering the adapter is therefore a
configuration that looks complete and moves nothing.

## No new dependency

Every crate this adapter uses was already in the workspace graph via the Orange
adapter. It makes **no database call of any kind**, so it never touches R1.
