# The job queue

`scheduler` enqueues due recurring work with **in-process cadence tracking** —
correct exactly as long as one instance holds the lease, which is why it is a
singleton. `jobs` claims, dispatches by `kind` through a registry, and
transitions on the outcome with backoff, `maxAttempts` and a `dead` terminus.

## `JobHandler` returns `JobError`, not a `String`

```rust
Database { context: &'static str, source: CratestackError }
Sql      { context: &'static str, source: sqlx::Error }   // R1-exempt queries
NoHandler{ kind: String }
Injected(String)                                           // test doubles only
```

`Job.lastError` is the **only** place an operator sees why a job died, so the
`context` prefix is load-bearing — which is why a bare `#[error(transparent)]`
`#[from]` was rejected.

The context strings live in `pub(crate) const CTX_*` next to each job, and a
table-driven test pins each against its expected wording. The earlier version
typed the literal **inside the test**, which proved the format string and
nothing about the call site: a one-character edit to a real context changed
production output while every test passed.

## The kinds that exist

| Kind               | Cadence  | Notes                                                       |
| ------------------ | -------- | ----------------------------------------------------------- |
| `expire_stale`     | frequent | `submitted` past `expiresAt`; `uncertain` past its 6h grace |
| `reap_outbox`      | hourly   | Deletes **delivered** rows past 24h; alarms on poison rows  |
| `purge_retention`  | daily    | The 90-day content purge                                    |
| `anchor_audit`     | daily    | The audit hash chain                                        |
| `grey_route_watch` | daily    | Divergence and overdue validations                          |

Not built, each blocked on infrastructure: `poll_balance`, `probe_providers`,
`reconcile_clients`, `cleanup_secrets`, `verify_backup`.

## Reap versus quarantine, decided once

> Delete delivered rows past 24h. **Alarm** on high-`attempts` rows. Never delete
> a poison row.

A row stuck retrying forever is live evidence of a subscriber bug; deleting it
erases the evidence **and** the event it was redelivering — a customer-visible
loss with no trace, strictly worse than an oversized table.

Quarantine was considered and rejected: there is no schema model behind that
table, so quarantining means a second hand-rolled policy-less table for no
benefit over logging loudly.

Checked against the vendored source before building it, rather than inherited
from prose: `drain_event_outbox` only ever increments `attempts` and records
`last_error` — **no cap anywhere, and no code path in the framework deletes a
row of that table at all.** `reap_outbox` is the entire mechanism.

Both its queries treat Postgres `42P01 undefined_table` as "nothing to reap
yet", because unlike `drain.rs` this job cannot lean on the framework having
just created the table.

## `dead → pending` is an operator action

Added for the console. `requeueJob` proposes only that edge and returns a named
`409` for anything else. `failed → pending` already exists for automatic backoff,
but `failed` is a same-tick transient state no operator poll can realistically
observe, so the procedure does not accept it as a starting state.

Gated on `job:enqueue`. And for `Job` specifically, **Layer 2 is the real
perimeter, not defence in depth** — `Job`'s `@@allow` admits `auth().kind ==
"app"` unscoped, so any provisioned client reaches the whole deployment's backlog
unless a scope stops it.

## Adding a job kind

1. A module under `backends/crates/sms-worker/src/jobs/`, with its `.md` sidecar.
2. `CTX_*` consts for every fallible step, added to the wording table.
3. Register in `jobs::default_registry()`; schedule in `scheduler::schedule()`.
4. Bound the per-run work — `reap_outbox` and `grey_route_watch` both cap their
   fetch, and self-correct on the next run rather than scanning unbounded.
5. A live suite that proves the guard **by breaking the query** — loosen the
   `WHERE`, watch the test fail, restore.
