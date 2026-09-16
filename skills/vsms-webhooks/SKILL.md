---
name: vsms-webhooks
description: "Events and outbound webhooks in vsms — what @@emit actually is and the registration trap that loses events silently at commit, the drain role, the hooks delivery ladder and per-endpoint circuit breaker, replay semantics, and the v1 HMAC signature scheme with its rotation and cross-language proof. Load when changing an event, a subscriber, the outbox, webhook delivery, or anything a customer's receiver depends on."
---

# vsms-webhooks

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## `@@emit` is a real transactional outbox — and three things it is not

The row is written inside the mutation's transaction, so it survives process
death. But:

- **Delivery is synchronous and blocks the mutation.** A slow subscriber slows
  the write.
- **It is not panic-isolated**, and it short-circuits on the first failing
  handler, retrying from the top on every drain.
- **There is no retry cap, no backoff and no dead-letter in the framework.**

So a subscriber must be **trivial, idempotent, and must not panic**.

## The registration trap

> `emit` returns `Ok(())` for a topic with **zero registered handlers**, and
> every `@@emit` mutation triggers an automatic post-commit drain **of its own
> process's runtime**.

A process that writes to `Message` without having called
`sms_api::webhooks::register_subscribers` on its own `Cratestack` instance does
**not** leave the row for `drain` to pick up. Its own drain marks it delivered
immediately, having done nothing — **the event is lost, silently, at commit**,
which is worse than stalled.

Registration is mandatory in **every writer process**. Both the gateway's
`serve` and the worker's `main` call it unconditionally, regardless of `--roles`
— every role in one process shares one event bus, and `Clone` shares the
`Arc`-backed registry rather than copying it.

What `drain` adds is the one thing no writer's own drain gives you: a
**write-independent retry trigger** for a row whose handler failed earlier.
Proven live — one instance registers an always-failing handler to leave a row
stuck, and a second instance's `tick` turns it into a real `WebhookAttempt` with
no further write in between.

## `created` and `updated` are registered together, in one function

`message.accepted` is only reachable from a `created` event — `accepted` is the
row's default state and the transition table lists it only as a `from_state`,
never a `to_state`. So registering only `updated` meant an endpoint configured
for `message.accepted` would **silently never fire, forever**.

A unit test asserting `message_event_type(accepted) == Some("message.accepted")`
passed both before and after that fix. That is the blind spot: test the
registration through a real `create`, not the mapping in isolation.

Coverage is deliberately narrow — `Message` only, mapped to the §8.4 catalogue.
`queued`, `routed`, `undelivered` and `rejected` produce **no event**, matching
the catalogue exactly. `OptOut.created` and `Provider.updated` are out of scope
because every match keys on `WebhookEndpoint.appId` and `OptOut` has none.

## Delivery

Backoff 1s, 5s, 25s, 2m, 10m, 1h, 6h, 24h — eight steps, then `dead`. 10s
timeout. `2xx` succeeds; **`410 Gone` deactivates the endpoint immediately**;
everything else retries. `maxAttempts` is a per-endpoint column.

**What gets signed is exactly what gets sent.** `build_envelope` returns **one
`String`**, and its bytes are both what is HMAC'd and what goes on the wire — a
second serialization would risk a silent sender/receiver mismatch, because
`serde_json::Value`'s map guarantees neither key order nor whitespace.

**A malformed payload must never trip an endpoint's breaker.** It is _our_ bug,
the endpoint did nothing wrong, and retrying is pointless because a stored
payload never becomes parseable. It gets its own outcome — straight to `dead`,
loud, with **no call to `record_endpoint_failure`.** The test asserts
`consecutiveFailures` stays `0` and **zero HTTP requests were made**, not merely
that the attempt reached a terminal state (which passed before the fix too).

**Replay is a same-row reset.** The dedupe index (`endpoint_id`, `aggregate_id`,
`event_type`) means a second row for one event cannot exist, so
`WebhookAttempt.id` and `sourceEventId` are **unchanged** by a replay.

`occurredAt` is a **documented approximation** — `WebhookAttempt` has no
creation timestamp, so `hooks` stamps delivery time. Accurate for a first
attempt, wrong by up to 24 hours for one that succeeds last.

## Signing

`references/signing.md`. The scheme is
`HMAC-SHA256(secret, "v1\n{ts}\n{eventId}\n{sha256_hex(body)}")`, header
`v1=<hex>`. **`verify` never compares hex strings** — every candidate goes
through `verify_slice`, which compares in constant time.

Rotation moves `secret → prevSecret` and mints a new one, inside a
`serializable` transaction **and** with `if_match`. **The overlap window never
ends on its own**: the `cleanup_secrets` job that would clear `prevSecret` is
unbuilt.
