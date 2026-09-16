---
name: vsms-providers
description: "The vsms provider port — the SmsProvider trait, the six-variant ProviderError taxonomy and its compiler-checked routing consequences, the connect-versus-read transport classification that prevents duplicate sends, and how to add a new rail. Load when writing or changing a provider adapter, classifying a provider failure, or deciding what a gateway should do when a submit does not come back cleanly."
---

# vsms-providers

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

Every rail is reached through `SmsProvider`. `backends/crates/sms-provider` is
**pure** — no CrateStack, no schema types — and the trait is deliberately "HTTP
**or** SMPP", so nothing HTTP-shaped belongs in it.

## The taxonomy is the important part

> Most gateway failover bugs are really error-classification bugs: a provider
> returns a 400 that actually means "your sender ID isn't approved", and the
> router faithfully retries it on three more providers, burning credit each
> time.

Six variants, each with **exactly one** routing consequence, expressed as a
compiler-checked table (`ProviderError::routing()`) rather than a second
hand-derived one:

| Variant                    | Consequence                  | What dispatch does                                     |
| -------------------------- | ---------------------------- | ------------------------------------------------------ |
| `Transient`                | `RetryThisProvider`          | same-provider backoff, `routed → queued`               |
| `Permanent`                | `TryNextRoute`               | failover; exhausted → `failed`                         |
| `Unavailable`              | `OpenCircuitAndTryNextRoute` | record failure, failover; exhausted → backoff          |
| `Rejected` / `Unsupported` | `FailMessage`                | `routed → failed`; retrying anywhere fails identically |
| `Indeterminate`            | `HoldIndeterminate`          | `routed → uncertain`; **never failed over**            |

**`Permanent` never opens the circuit breaker** — it is specific to _this_
message, not a provider-wide outage. A test asserts exactly that.

## `Indeterminate`, and the predicate that must not be inverted

`Indeterminate` means _"the request was sent and we never learned the outcome"_.
Without it, every transport failure — including a read timeout arriving after
the provider may already have accepted — maps to `Unavailable`, whose contract
is "fail this submission over". That is a resubmit, and with **no idempotency
key anywhere**, that is a duplicate SMS.

> **The predicate is connect-versus-read, not "is it a timeout".**

`classify_transport_error` checks `is_connect()` **first** and keeps it
`Unavailable` — nothing was written, retry is safe. Only past the connect phase
(`is_timeout() || is_body()`) is the outcome genuinely unknown. A `2xx` whose
body is malformed or missing the provider reference is `Indeterminate` too: the
provider accepted before we failed to read the reply.

Getting this backwards either destroys legitimate failover or reinstates the
double-send. **Prove it by breaking it** — swap the branches, watch both tests
fail naming the wrong variant, restore.

That logic lives **once**, in `backends/crates/sms-provider-http`, shared by
every HTTP adapter. It is its own crate rather than part of `sms-provider` so a
future SMPP-only adapter does not pull in an HTTP client and its TLS stack.

`backends/crates/sms-provider-http/src/submit_status.rs` holds the
provider-agnostic half of the HTTP-status mapping (`429 → Transient`,
`5xx → Unavailable`, everything else → `Rejected`), parameterised by the retry
delay and the provider noun. Those two differ per contract; the mapping does not.

## `Capabilities` is not the same shape for every rail

Orange's is a bare function — every field is a fixed fact about a self-service
product. MTN-via-aggregator has **no such fixed facts**: TPS ceiling,
per-segment cost and alphanumeric-sender support are commercial terms of a
specific contract, so they are config fields the adapter reads back.

This is the real answer to "the routing layer must read capabilities rather than
assume parity": a router that special-cased `if key == "orange_cm"` could not
even _express_ MTN's numbers.

## Adding a rail

1. New crate `backends/crates/sms-provider-<name>`, depending on `sms-provider`
   and `sms-provider-http`.
2. Implement `submit` and `parse_dlr`. **Reuse
   `sms_provider_http::classify_transport_error`** — do not re-derive it.
3. Register in `backends/apps/sms-worker/src/main.rs`'s registry, keyed by
   `SmsProvider::key()`, which must equal `Provider.key` in the database.
4. Seed a `Provider` row and a `Route`, or nothing will reach it.
5. Prove the connect-versus-read guard by breaking it.

Note the registry has exactly **one** entry today (`orange_cm`). A `Route`
pointing at a provider this process has no adapter for is a **retryable** error,
not a crash — the correct and safe behaviour for a singleton dispatch.

## The message-class caveat, stated once

The `Indeterminate` mapping trades a possibly-lost message for never sending a
duplicate. That is a **product decision**, right for OTP and not obviously right
for bulk notification. It is uniform today.
