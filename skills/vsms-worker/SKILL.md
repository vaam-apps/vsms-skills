---
name: vsms-worker
description: "The vsms worker node — six roles and their cardinality, leader election by Postgres advisory lock and the pooled-connection trap it avoids, the optimistic CAS claim loop that replaces SKIP LOCKED, the dispatch tick, and the generic job queue with its typed error boundary. Load when changing anything in sms-worker, adding a role or a job kind, or debugging a worker that is healthy and moving nothing."
---

# vsms-worker

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

**Postgres is the only coordination mechanism.** No broker, no Redis. Queues via
CAS, leader election via advisory locks, state machines via triggers.

## Six roles, one binary

`sms-worker --roles dispatch,jobs,scheduler`

| Role        | Cardinality | Body                                                                |
| ----------- | ----------- | ------------------------------------------------------------------- |
| `dispatch`  | singleton   | Claims, routes, submits                                             |
| `scheduler` | singleton   | Enqueues due recurring jobs                                         |
| `drain`     | singleton   | Periodic outbox drain — the retry trigger no writer provides        |
| `smpp`      | singleton   | **Stub.** Logs once, then genuinely idles on `std::future::pending` |
| `jobs`      | scale-to-N  | Claims and runs `Job` rows                                          |
| `hooks`     | scale-to-N  | Delivers `WebhookAttempt` rows                                      |

**Every process registers the webhook subscribers, regardless of `--roles`.**
Not optional wiring: a process that writes to `Message` without registering
**loses the event silently at commit**, because `emit` returns `Ok(())` for a
topic with zero handlers and the writer's own post-commit drain marks the row
delivered having done nothing. See `vsms-webhooks`.

## Leader election, and the trap it avoids

`lease.rs` takes a session-scoped advisory lock on a **dedicated, never-pooled
`PgConnection`**.

> It deliberately does **not** use the design doc's own illustrative
> `pool.acquire()` sample. A `PoolConnection` returns to the pool rather than
> closing on drop, so a lease dropped without an explicit `release()` — a panic,
> a `kill -9` — leaks the lock at the Postgres level **forever**, unreachable,
> on a session silently recycled to serve unrelated queries.

Verified live that the trap is real and that a dedicated connection avoids it:
dropping it closes the socket, and Postgres releases the lock when the session
ends, with no cooperation from `sqlx`.

`run_singleton` retries every 5s behind a `CancellationToken`, releases
explicitly on SIGINT/SIGTERM, and falls back to drop-triggered release on a hard
kill. Manually verified end to end: standby stands by, `kill -9` failover
reclaims within one retry cycle, SIGTERM releases before exit.

`try_acquire` stamps a `worker_id` onto the connection's `application_name`,
which is how the Workers screen answers "which node" from `pg_locks` joined
against `pg_stat_activity`.

**Postgres's exclusivity means `pg_locks` can never show two granted rows for
one role.** If that happened it would mean a bug bypassing `run_singleton`
entirely — not something that table could surface.

## The claim loop

The framework **cannot express `SKIP LOCKED`** — `skip_locked()`, `nowait()` and
`lock_mode()` are all compile errors. Optimistic CAS on `@version` instead, which
is better here anyway: **no lock is held across the provider HTTP call.**

```text
PreconditionFailed  → another worker won. Retry. Normal.
Forbidden           → LOG IT LOUDLY. Never fold into the race branch.
anything else       → propagate.
```

`Forbidden` is **ambiguous** — policy denied, or the row is gone. Swallowing it
hides a policy regression as unexplained throughput loss, which is exactly how
`Message`'s own missing `hasRole('system')` clause stayed invisible for a whole
milestone.

`Claimable` is one trait — `candidates()` plus `take_lease()` — reused by
`Message`, `Job` and `WebhookAttempt`. Crash reclaim differs per model: `Message`
resumes same-state, `Job` is a two-hop `running → pending`, `WebhookAttempt`
stays `delivering`. A same-state write needs **no row** in the transition table;
a two-hop one does.

> `take_lease` once wrote `→ routed` unconditionally regardless of the
> candidate's actual state, making the illegal edge `accepted → routed`
> reachable. And `#29`'s own live suite was **written but never run** until a
> later PR — which is when it surfaced that `Message`'s list/detail policy had
> never admitted a system context at all, so the claim query had been returning
> zero rows since it merged.

## Dispatch

Claim a batch (budget = the **sum** of every registered provider's TPS ceiling)
→ route on the `accepted` branch → resolve the adapter by `Provider.key` →
submit → classify.

Two retryable-not-fatal cases: the `Provider` row was deleted since routing ran,
and **a route naming a provider this process has no credentials for** — a real
operational case. A singleton keeps retrying until an operator fixes it, which is
correct, not a crash.

**The accepted gap:** a crash between claiming and finishing a submit produces
**two real submissions**. Pinned as a permanent regression assertion by
`kill9_reclaim_live.rs`, which sends a real `SIGKILL` so no Rust destructor runs.

## Jobs

`references/jobs.md`. The five kinds that exist: `expire_stale`, `reap_outbox`,
`purge_retention`, `anchor_audit`, `grey_route_watch`. Five more are named in the
design doc and **not built**; `cleanup_secrets` is the one with a user-visible
consequence — a webhook secret's rotation overlap window never ends on its own.
