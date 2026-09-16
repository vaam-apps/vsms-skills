# The message state machine, in detail

## The three edges people get wrong

**`routed → uncertain`** exists because a submit can time out _after_ the
request was written. Before `ProviderError::Indeterminate`, only
`submitted → uncertain` existed and a timed-out submit was indistinguishable
from an outage — which meant a resubmit, which with no idempotency key anywhere
means a duplicate SMS.

**`uncertain` leaves the claim candidate set permanently.** `candidates()`
selects `accepted`/`queued`/`routed`/`undelivered`. It stays _resolvable_
because `providerMessageRefAlt` is stamped with `Message.id` on that path
specifically — the value sent as the provider's callback data **before** the
network call, and therefore known regardless of outcome.

**`uncertain → undelivered` is not an edge.** A retryable DLR failure arriving
in `uncertain` goes to `failed`.

## The candidate filter must include `routed`

The design doc's own illustrative sample omits it. But `take_lease` transitions
_into_ `routed`, `routed → queued` is legal, and the reclaim index is built
`WHERE state IN ('queued','routed')`. Without `routed`, a worker that crashes
between claiming and finishing leaves the row **permanently stuck**.

## Retry and validity

Backoff on retryable failures: 5s, 30s, 2m, 10m, 30m — capped by `maxAttempts`,
hard-stopped by `expiresAt`. Default validity: **15 minutes for `otp`** (a code
that arrives after the user gave up is worse than no code), 24 hours for
`notification`.

`undelivered → queued` is stamped onto `Message.leaseUntil` by `dlr::ingest_one`
and held back by the same shared `candidates()` lease filter every other claim
uses. A row whose `expiresAt` runs out first is excluded by that filter and
reaped to `expired` by `expire_stale` rather than retried past its own validity.

`uncertain` gets a 6-hour timer, then `expired`. **Never retried** — a retry
there is exactly the double-send the state exists to prevent.

## The tradeoff, stated as a product decision

> **A possibly-lost message is preferred to a duplicate.**

Right for OTP traffic. If notification traffic ever wants the opposite, the
`Indeterminate` mapping must differ per message class. It does not today.

## What is _not_ covered

Four states produce **no webhook event**: `queued`, `routed`, `undelivered`,
`rejected`. That matches §8.4's catalogue exactly and is not a gap.

`undelivered` had no driver at all for a while — nothing moved it back to
`queued`, and `expire_stale` reaps only `submitted`/`uncertain`, so a message
with exactly one retryable-failure DLR sat there forever: not delivered, not
failed, not expired, not reaped, invisible to any alert. Filed and fixed. It is
the worst-shaped bug an SMS gateway can have, and worth remembering as a
category.
