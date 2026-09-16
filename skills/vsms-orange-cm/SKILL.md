---
name: vsms-orange-cm
description: "Orange Cameroon specifics in vsms — the OAuth2 token flow and submit envelope, the resourceURL shape captured live rather than read from a spec, why callbackData is load-bearing for DLR correlation, the classification quirks that mean this adapter never produces ProviderError::Permanent, and the fault-injecting fake. Load when touching sms-provider-orange-cm, sms-fake-orange, or debugging an Orange submit or delivery receipt."
---

# vsms-orange-cm

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

`backends/crates/sms-provider-orange-cm` — the only adapter whose wire shape was
transcribed from a real Swagger and then **corrected against a live capture**.

## The flow

- OAuth2 `client_credentials` for a bearer token, cached until expiry
  (`src/token.rs`).
- `POST .../outbound/{senderAddress}/requests` with an
  `outboundSMSMessageRequest` envelope.
- A `201` carries `resourceURL` **directly inside `outboundSMSMessageRequest`**
  — _not_ nested under a `resourceReference`. Captured live; the nesting was
  removed to match. The trailing path segment of that URL is the provider
  reference.
- DLRs arrive as `POST /dlr/orange_cm`.

## `callbackData` is load-bearing

Orange's DLR cannot otherwise be correlated to our row, so
`receiptRequest.callbackData` carries `Message.id` and comes back on the
receipt; `SubmitAck::provider_ref_alt` is what stamps it.

**This is also what makes an `Indeterminate` submit resolvable:** the value is
known _before_ the network call, so it is correct regardless of whether the call
returned. The first attempt shipped without that stamp and a later DLR had
nothing to correlate against — caught by the live test, not by review.

## Classification quirks

- A `429` is `Transient` with a **fixed 1s delay**. Nothing parses `Retry-After`.
- A `5xx` is `Unavailable`.
- **Every other 4xx becomes `Rejected`**, including a `400` that actually means
  "sender ID not approved" — Orange's response does not distinguish them.

  > Consequence: **this adapter structurally never produces
  > `ProviderError::Permanent`.** The `TryNextRoute` arm cannot be exercised
  > through it at all, which is why the failover tests use hand-rolled fakes and
  > an exact submit-call count rather than a final message state.

- A `201` with a malformed or missing `resourceURL` is **`Indeterminate`**, not
  a failure: Orange accepted it before we failed to read the reply.
- A connect refusal is **`Unavailable`**, proven against a real socket.

## Billing, because it shapes reconciliation

> **Orange bills on submission, not delivery, and does not refund
> `DeliveryImpossible`.**

The cost ledger increments at `submitted`. The delivery-rate dashboard and the
spend dashboard therefore measure genuinely different things, and neither is
wrong.

There is also a TPS ceiling; dispatch's per-tick claim budget is the **sum** of
every registered provider's ceiling.

## The fake is a participant, not a stub

`backends/crates/sms-fake-orange` answers the token and submit calls per a
`FaultPolicy`, and **independently schedules DLR deliveries as real HTTP POSTs**
back into the gateway — including a DLR that deliberately races the submit
response. `backends/apps/sms-fake-orange` runs it as a process for `just demo`.

- `FaultPolicy::Scripted` — an exact ordered sequence, for deterministic tests.
  **It silently degrades to a bare accept with no DLR once its queue empties**,
  which is fine for a test that scripts exactly what it expects and wrong for a
  long-lived server. `FaultPolicy::Always` exists for that.
- `FaultPolicy::Seeded` — a seeded PRNG drawing a realistic weighted mix, always
  reproducible by seed.

Its own **request ledger** is what proves "nothing double-sent" — the database
records what this system _believes_ it did; the ledger records what the provider
actually received.

**Out of scope:** connection-level nastiness (RST mid-response, byte-dribble).
`wiremock` can only emit a well-formed HTTP response. The connect-refused half is
covered directly, against a real socket.
