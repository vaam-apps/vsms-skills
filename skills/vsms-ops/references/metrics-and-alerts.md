# Metrics and alerts

Prometheus text exposition, pull-based. **Not OTLP** — no collector exists
anywhere in `deploy/`, and a pull-based `/metrics` needed nothing new to receive
it. The `prometheus` crate with `default-features = false`, which drops the
binary-format feature nothing here speaks.

## What exists

| Metric                                              | Written by                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `sms_sm001_total{entity,from_state,to_state}`       | `map_database_error` — labels parsed from the trigger's own `RAISE` text |
| `sms_worker_singleton_lease_held{role}`             | `run_singleton`                                                          |
| `sms_dispatch_in_flight_submits{provider}`          | `dispatch::submit_one`                                                   |
| `sms_webhook_outbox_oldest_undelivered_age_seconds` | `drain::tick`                                                            |
| `sms_event_outbox_poison_rows`                      | `reap_outbox`                                                            |
| `sms_route_delivery_divergence_flagged`             | `grey_route_watch`                                                       |
| `sms_route_validation_overdue`                      | `grey_route_watch`                                                       |

**Everything else in the design doc's original §9.1 prose is still
aspirational** — submit rate and latency, delivery rate by provider×operator,
time-to-delivery percentiles, provider balance, DLR silence, webhook dead-letter
rate. §9.1 was corrected to say so rather than left stale.

## Absent versus zero

`run_singleton` only calls a role's real body from inside the branch that already
holds the lease. So the dispatch and drain gauges are **only reachable on the
process currently in charge**, and are genuinely absent from a standby's
`/metrics`.

Only `sms_worker_singleton_lease_held` is deliberately written on every outcome
— including standing by, as `0` — because that is the one gauge a process must
keep reporting while it is _not_ in charge.

The alert rules therefore check **both** `sum(...) == 0` **and** `absent(...)`:
only one is true depending on whether the role is merely unheld or nobody is
configured to attempt it.

## Two latent bugs the SM001 counter exposed

Two job write paths had a `Conflict` match arm whose comment claimed it meant "a
harmless race". Nothing on those paths produced `Conflict` without mapping
first, so the arm was **dead code** — and naively mapping _before_ the match
would have made a **genuine `SM001` fall into that arm and be silently
swallowed**, which is exactly the failure this metric exists to make loud.

The order is: check `is_illegal_transition` on the **raw** error (it reads
`db_sqlstate()` directly), then map and propagate.

## Correlation

- **Within one gateway request**: `cratestack_request_id`. `GatewayAuth` honours
  an inbound `X-Request-Id` or mints one. Before that, the generated log field
  had been **empty on every line** since the router existed, because nothing had
  called `with_request_id`.
- **Across processes**: `Message.id`. The send, the submit and the DLR each log
  an `info` event carrying it.

This is **grep-able log correlation, not distributed tracing** — no span tree, no
exporter, three log lines sharing a field. The DLR route is unauthenticated and
has no per-request context at all.

## Proving a metric

The SM001 counter's test was verified by **commenting the `record_sm001` call
out** and confirming it failed with `left: 0 / right: 1`. The lease gauge is
proven by driving the real `run_singleton` against a live Postgres — not
`RoleLease` directly — and asserting `1` while held and `0` after a graceful
shutdown.

## What the chart does not ship

No `/metrics` `Service` or `ServiceMonitor` — a deliberate scope cut. Docker
Compose is the documented deployment path, and a `ServiceMonitor` assumes a
Prometheus Operator install this chart does not otherwise depend on.
