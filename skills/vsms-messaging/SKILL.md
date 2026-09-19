---
name: vsms-messaging
description: "The message path in vsms — the eleven-state lifecycle and why Postgres decides transitions, what sendMessage does before a row exists, GSM-7 versus UCS-2 and why segment counting is a packing loop, MSISDN parsing and addressability across countries, and inbound DLR ingestion. Load when changing anything about how a message is accepted, encoded, numbered, transitioned or reported on."
---

# vsms-messaging

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The lifecycle

Eleven states. **Rust proposes, Postgres decides** (R2): the legal edges are
rows in `message_state_transitions` and a `BEFORE UPDATE` trigger rejects
everything else with SQLSTATE `SM001`.

```text
accepted → queued → routed → submitted → delivered
                                       → undelivered → queued (retry)
                                       → uncertain
            (any) → rejected / cancelled / expired / failed
```

Terminal: `delivered`, `failed`, `expired`, `rejected`, `cancelled`.
**Terminality is data** — a terminal state has no outgoing rows, so an `UPDATE`
moving a `delivered` message anywhere raises `SM001` and aborts the transaction,
including from a migration or a `psql` session.

`cargo xtask parity` checks the table against the design doc's diagram **in both
directions**. Adding an edge is a migration with a review, not a match arm.

`references/state-machine.md` has the three edges people get wrong and the retry
schedule.

## `sendMessage`: the decision, not the delivery

Everything it does happens **before a row exists**, so a refusal is synchronous
and actionable rather than a row that sits in `queued` and is silently dropped.

Authenticate → `sms:send` → parse the recipient → classify the operator →
suppression → consent and quiet hours → encode and segment → hash under the
pepper → persist at `accepted`.

Three invariants:

- **No caller can create a message in any state but `accepted`** —
  `@default('accepted')` excludes the field from the create input entirely. That
  is the control, not a check.
- **A refusal never persists a row.**
- **`idempotencyKey` is a verbatim copy of `clientRef`.** Purging one without
  the other purges nothing.

It does **not** choose a provider — routing runs in the worker, on the
`accepted → queued` edge. And it does **not** hold a message across a
quiet-hours boundary; see `vsms-compliance` for why accept-time refusal was
chosen over deferral.

A **human caller is refused outright**: `caller_client_id` requires
`kind == "app"`, because deriving an `App` for a human has no design yet. That
is why the console's composer is one of only two places that still uses the
machine credential.

## Encoding: never divide

> A GSM-7 escape pair or a UTF-16 surrogate pair must not straddle a segment
> boundary.

```text
152 × "a" + "€" + 152 × "a"  = 306 septets
306.div_ceil(153)            = 2   ← wrong
analyse(...).segments        = 3   ← the escape pair cannot start at 153
```

**Never compute a segment count by division anywhere in this codebase.**

And: **most uppercase accented vowels are not in GSM-7 even though the lowercase
forms are** (`à` is one septet, `À` is not; only `É` made the default alphabet).
A body that is one segment in sentence case becomes UCS-2 when upper-cased —
which is exactly what a shouty confirmation code does.

`normalise` runs unconditionally and only touches typographically identical
characters (`’ → '`). `transliterate_to_gsm7` is opt-in per app and is
**perceptible** (`ç → c`) — it must never run by default.

## Numbers: addressability, not mobility

`sms-msisdn` is backed by libphonenumber metadata. **Cameroon is still the
default** — `parse` and `parse_mobile` default to `CM`.

`parse_mobile` accepts `Mobile | FixedLineOrMobile`. A `Mobile`-only check
**rejects every US and Canadian number**, because the NANP does not encode the
distinction at all. Cameroon is unaffected: CM metadata still returns
`FixedLine` for `2xx`.

Operator classification is **advisory only**. Number portability means prefix
routing must never be load-bearing, and libphonenumber ships no carrier mapper —
so `operator` is honestly `unknown` for foreign traffic. See
`vsms-multi-country` before touching any of this.

`references/encoding-and-numbers.md` has the Cameroon-specific facts worth
keeping and the masking rules.

## DLR ingestion

`POST /dlr/{providerKey}` is a **raw axum route** — a provider webhook carries
no bearer token. Match on `providerMessageRef`, falling back to
`providerMessageRefAlt`; write a `DeliveryReceipt`; drive the transition.

- **A retryable failure arriving while a message is `uncertain` must land in
  `failed`** — `uncertain → undelivered` is not a legal edge.
- **No signature verification exists** for any provider. `RawCallback` preserves
  exact bytes so verification can be added retroactively against stored evidence.
- A DLR **can arrive before the submit response is persisted**, at which instant
  neither reference is set, so it is silently dropped and the message reaches a
  terminal state via `expire_stale`. Not stuck, not wrongly `delivered`. The
  chaos suite schedules that race on purpose.
