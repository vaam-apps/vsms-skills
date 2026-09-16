---
name: vsms-routing
description: "Route selection in vsms — the pure sms-routing engine with its injected random draw for deterministic replay, priority bands and weighted members, the wildcard semantics of NULL predicates, two-hop failover with a per-message exclude set, provider circuit breakers, and grey-route divergence detection. Load when changing how a message picks a provider, adding a route predicate, debugging why a message was rejected with no route, or touching either circuit breaker."
---

# vsms-routing

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The engine is a pure fold

```rust
select_route(&[RouteRow], &HashMap<String, ProviderRow>, RoutingCandidate,
             exclude: &ExcludedRouteIds, draw: f64) -> Decision
```

Nothing in `backends/crates/sms-routing` touches a database, a clock or an RNG.
That purity is not aesthetic: the console's route simulator has to answer "which
route wins and why" **without sending anything**, and a client-side
reimplementation of matching would drift and then confidently show the wrong
answer.

The I/O glue lives in `backends/crates/sms-worker/src/routing.rs`, and is
**duplicated** in `backends/crates/sms-api/src/route_simulator.rs` because
`sms-api` cannot depend on `sms-worker` — the dependency runs the other way.
What is shared is the engine; ~60 lines of row conversion are not.

## Weight implies randomness; explainability implies determinism

Resolved by **injecting the draw**. Production draws once per decision at the
I/O boundary; a replay calls `select_route` again with the same `draw` and gets
a byte-identical `Decision`.

Within the winning priority band the draw maps to a cumulative-weight range per
member over `[0.0, 1.0)`. An all-zero-weight band falls back to a uniform split
rather than dividing by zero — `weight == 0` is a legal value.

## Four rules that are easy to get backwards

- **Priority is the only cross-band ordering.** There is no "more specific route
  wins" tiebreak. Three predicates do not outrank a wildcard at the same
  priority; an operator who wants that sets a higher `priority`.
- **`NULL` on a `match_*` column is a wildcard**, meaning "matches anything" —
  not "matches only a NULL value". Backwards, every route in a fresh deployment
  silently matches zero traffic.
- **`matchPrefix` is national digits**, via `Msisdn::national()` — the same
  convention `OperatorPrefixRule.prefix` uses.
- **Ordering within a band is by `id` ascending, and `Cuid` order is not
  creation order.** Never assume the route you created first takes the low share
  of the draw range. A determinism test failed intermittently on exactly that
  assumption — while the property under test was, in fact, holding.

## No routes means refuse, loudly

An `accepted` message with zero eligible routes goes to **`rejected`**, with
`stateReason` carrying a per-route summary of why each was ineligible.

Deliberate: a silent "no routes yet, pick anything" fallback would mean routing
quietly stops being explainable the moment _any_ `Route` row exists but does not
match. The cost is that a deployment **must** seed a route.

> `sms-gateway seed-dispatch` seeds a `Provider` **and** a catch-all `Route`. It
> was `seed-provider` and seeded only the former — so after routing became real,
> a deployment that followed the runbook came up healthy and **silently rejected
> every message forever**. Renamed, both halves made idempotent, and one bug
> caught mid-review: the first draft returned early on "provider already active"
> _before_ the route half ran, which is the steady-state case every upgrade hits.

**`Decision.evaluations` covers every route, always** — not just matches. A test
asserting `evaluations.len() == 1` for one seeded route is wrong the moment
another test leaves a row behind.

## Failover

See `references/failover-and-breakers.md`. The three facts to carry:

- **A failover reroute never calls `submit` inline.** It writes `routed → queued`
  with a new provider and route on the same CAS'd row and returns; the resubmit
  happens on a later claim. The lease is what prevents the double-send.
- **`Route.failoverRouteId` is not what performs the failover.** The engine is
  asked again over the whole route set with the failed route in `exclude`.
- **Capped at two hops** — "beyond that you're not routing, you're spraying."

## Grey routes

`grey_route_watch` compares delivery rates between routes that should behave
identically — same `Message.operator`, same `Message.class`, both stamped on the
message rather than read off a route's willingness to carry it. `uncertain` is
excluded from **both** sides of the ratio.

Three redundant gates, **all** of which must hold: 30 terminal messages per
side, a two-proportion z-test at 3.0, and a 15-point practical-significance
floor.

**The other half cannot be automated.** A grey route rewrites the sender ID on
the wire after we hand the message over, and the DLR still says `delivered` — no
server-side signal can see it. `RouteValidation` is append-only human evidence;
`sms-gateway record-route-validation` writes it; the overdue check is a
**staleness signal only**. A route validated yesterday and turned grey today
reports exactly as "fine".
