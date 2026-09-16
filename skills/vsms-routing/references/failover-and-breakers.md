# Failover and the two circuit breakers

## Why failover cannot double-send

A reroute writes `routed → queued` with a new `providerId`/`routeId` on the same
`if_match(version)` CAS'd row, sets `leaseUntil` to now so it is immediately
claimable, and **returns**. The resubmit happens on a later claim, through the
ordinary path.

That is only safe because the two variants that trigger failover — `Permanent`
and `Unavailable` — both mean **nothing was ever accepted by the provider**.
`Indeterminate` never reaches the failover path at all.

**Proving that needs a two-provider fixture.** A single-route fixture cannot
distinguish "correctly refused to fail over" from "tried to fail over and found
nothing eligible" — a broken implementation passed that test. The guard that
works asserts an `Indeterminate` submit stays `uncertain` **with a healthy
alternative available**.

## `Message.excludedRouteIds`

A `Permanent` failure never opens the breaker, because it is specific to this
one message. So nothing else marks that route ineligible for a second attempt by
this same message, and without remembering it, a second hop could pick the same
failing route right back and fail identically forever.

Sentinel-packed via `sms_core::pack`. The two-hop cap is checked **after** adding
the currently-failing route, so the engine is not queried once the answer could
not be acted on.

## The two breakers share one implementation

`backends/crates/sms-worker/src/breaker.rs`. Same shape on purpose rather than
two sets of semantics:

|           | Provider                                           | Webhook endpoint          |
| --------- | -------------------------------------------------- | ------------------------- |
| Threshold | 5 consecutive failures                             | 20                        |
| Cool-down | 60 seconds                                         | 15 minutes                |
| Columns   | `Provider.consecutiveFailures`, `circuitOpenUntil` | same on `WebhookEndpoint` |

Both reset the counter on success **and on trip**, so a cool-down is followed by
a fresh allowance rather than the very next failure reopening it.

Writes are best-effort `if_match` CAS. A lost race undercounts slightly —
acceptable for a heuristic that exists to stop hammering a dead endpoint and
that nothing bills against. The call sites already treat any write failure as
best-effort, so a lost CAS is now a _detected_ rather than a _silent_ miss.

**Neither is a true half-open.** Both fully reopen when `circuitOpenUntil`
passes; a genuine single-probe half-open needs cross-process coordination
neither has.

## An open circuit is treated as unavailable at routing time

`convert_provider` folds `circuit_open` into the same `available` flag as
`state != active`, so **every future message** skips that provider — not merely
the one whose failure tripped it. The test that proves this asserts the broken
provider's submit-call counter **stays flat** while a brand-new message reaches
`submitted` through the healthy alternative, rather than merely that it
eventually succeeds.

## The policy gap this uncovered

`Provider`'s own `update` `@@allow` did not admit `hasRole('system')`, so every
breaker write returned `Forbidden` — **silently absorbed** by the best-effort
handling above. Nothing looked broken except the one assertion that checked the
_effect_ on the row rather than that the surrounding calls did not panic.

Distinct in shape from the fifteen-times list/detail gap (that one fails to an
empty array; this one fails loudly and is caught by a call site designed to
shrug). Worth its own mention when auditing a new best-effort write path.
