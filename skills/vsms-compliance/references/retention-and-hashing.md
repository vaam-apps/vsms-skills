# Retention and hashing, in detail

## `purge_retention`, per column

Only **terminal** `Message` rows past 90 days, and only those not already purged.

| Purged                                                                              | Survives                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `msisdn` — **overwritten with a placeholder, not nulled**                           | `msisdnHash` — what any post-purge correlation runs on |
| `body`                                                                              | `bodyHash`                                             |
| `clientRef` **and** `idempotencyKey` (a verbatim copy — purging one purges nothing) | `senderIdValue` — the sending brand, not the recipient |
| `stateReason` — free text straight from a provider's response                       |                                                        |

`DeliveryReceipt` rows are **deleted**, not redacted, on their own `receivedAt`.
This is the first thing that has ever removed one; the "append-only" claim about
receipts is now qualified.

## Why `msisdn` stays `NOT NULL`

Making it nullable was considered and rejected: the only two production readers
can never see a row old enough to be purged, so `Option<String>` would force
`.expect()`-shaped defensive handling into two heavily-tested hot paths for a
branch that cannot be hit, with **no privacy benefit** the placeholder does not
already give. The placeholder still satisfies the column's length bound, which
update-input validation applies regardless.

A dedicated `purgedAt` marks the row. Without it, "purged" and "never had a
body" are indistinguishable, and relying on `body IS NULL` is exactly the silent
contract this codebase keeps getting bitten by. It is also the job's idempotency
guard.

## The webhook a purge must not re-fire

`Message` carries `@@emit`; the purge is a real delegate write; every worker
registers the subscribers unconditionally; four of the five terminal candidate
states map to a catalogued event. **Un-guarded, every purge attempted to enqueue
a live webhook** carrying the placeholder MSISDN and a nulled `clientRef`, about
a message reported on three months earlier.

The dedupe index happened to swallow the common case — a **coincidence of an
unrelated unique index, not a guard**, and it does not cover an endpoint
registered _after_ the original event.

Fixed at the **subscriber**, not the write site: R1 forbids going around the
delegate, so there is no seam at the write site to suppress an emit from. The
subscriber returns early on `purgedAt.is_some()` before it ever reads `msisdn`.

The test registers the endpoint **after** driving the message to `delivered` —
the one case dedupe cannot mask — and was confirmed to fail without the fix.

## Seeding genuinely old data

`Message.createdAt` **can** be backdated through a delegate: a `@default`
excludes a field from the _create_ input but not the _update_ one, and — unlike
`updatedAt` — no trigger touches it on write. Confirmed by reading
`touch_updated_at`, not assumed from the mixin's name.

`DeliveryReceipt.receivedAt` has **no such seam** (the model has no update policy
at all), so its tests shift the job's `cutoff` argument forward instead.

Five boundary points are proven: comfortably past, just past, **exactly at** (the
comparison is inclusive), just inside, comfortably inside.

## Hashing

`HashPepper` has a **hand-written `Debug`**, so it cannot leak through a struct
that derives one, and a 32-byte minimum. `Procedures::default()` is **deleted**,
so every construction site supplies one explicitly — the gateway validates it
**before the pool connects**, so a missing pepper fails at startup, never at the
first send.

`bodyHash` is peppered for the same reason as `msisdn`: a templated OTP body is
exactly as low-entropy and enumerable. That was decided only after grepping every
reader and confirming it is write-only, never cross-compared against a value
computed outside this system.

**Tests call the same `hmac_sha256_hex` production does.** A fixture that
hand-rolled a second copy of the algorithm drifted the moment the real one
changed — never reimplement a production algorithm in a test.

## Rotation is documented, not solved

Rotating the pepper **does not retroactively rehash a single stored row**. A row
still holding plaintext `msisdn` _could_ be rehashed by a job that does not
exist; a purged row never can. Until any rehashing happens, **opt-out matching
and dedupe against old rows silently stop working** — a hash under the new pepper
never equals one stored under the old, and nothing detects the mismatch.

## Out of scope

`Job` (`@@retain(days: 14)`) and `WebhookAttempt` (`@@retain(days: 30)`) carry
retention annotations that **nothing enforces**.

`ConsentRecord` carries **no `@@retain` at all**, and that is an open tension:
proof of consent plausibly needs to outlive the relationship plus a limitation
period, but keeping plaintext indefinitely reproduces the problem the purge
closed. Not resolved.
