# The live-Postgres harness

## The five rules, each learned by something breaking

- **Never cache a container handle in a `static`.** Rust never runs `Drop` for a
  `static`'s contents on any process-exit path, so every run leaked its
  container — 56 orphaned Postgres instances filled a 32 GB laptop before anyone
  noticed. There is no reaper to catch what `Drop` misses. **Nothing here may
  depend on a destructor running at exit.**
- **Cleanup is scoped by the harness's fixed Compose project name**, never by
  image or a bare name pattern. A sweep filtered by `ancestor=postgres:16-alpine`
  would cheerfully destroy a developer's unrelated running database. **Never
  `docker prune` in any form.**
- **One database per test _binary_.** Sharing one let a real `sms-worker --roles
dispatch` subprocess claim _other suites'_ leftover messages — the claim loop
  selects any eligible row, as it must in production. Passed alone, timed out
  under the full sweep.
- **The migration check fingerprints migration _content_** (stamped via `COMMENT
ON DATABASE`), not whether a table exists. The existence check silently served
  a **stale schema** from a pre-existing container after a bootstrap-only change,
  so tests reported `ok` against migrations that had never been applied.
- **The container name is fixed and global.** Two concurrent `cargo test`
  invocations on one machine fight over it and corrupt each other's runs. Real,
  not theoretical.

## Take the per-binary mutex

Tests within one binary share that binary's database, and Postgres's own
`pg_type` catalog race on first use is what the `tokio::sync::Mutex` serialises.
Two suites missed it — one added hours after the pattern landed, one shielded
only by never being run — and **both flaked in CI within hours** of the live
suites first running there.

## Isolation against a database that is never reset

- `clear_claimable_backlog` before seeding claimable rows.
- `deactivate_every_active_provider` / `disable_every_route` before seeding one a
  test's assertions depend on — otherwise a stale route from an earlier run can
  win the weighted draw and point at a provider this test never registered.
- **Derive expectations from the engine's own reported output**, not from an
  assumption about row identity. `Cuid` order is not creation order, and a test
  that assumed it failed intermittently while the property under test was, in
  fact, holding.
- `Decision.evaluations` covers **every** route, so `evaluations.len() == 1` is
  wrong the moment another test leaves a row behind.

## Seeding genuinely old data

`Message.createdAt` **can** be backdated through a delegate — a `@default`
excludes a field from the create input but not the update one, and no trigger
touches it (confirmed by reading `touch_updated_at`, not assumed from the mixin's
name). A framework-stamped column with no update policy has no such seam; shift
the job's `cutoff` argument forward instead.

**A forward shift can poison the rest of the binary.** An anchor's period start
inherits the previous anchor's period end, which only moves forward — so once one
call pushes it ahead of real time, every later test's freshly-seeded row is
already older than that floor, permanently. Confine a forward shift to exactly
one test function.

## Failures that are not your code

- `error communicating with database: expected to read 5 bytes, got 0 bytes at
EOF` inside the harness's own database creation is a dropped connection under
  load. **Re-run in isolation before concluding anything**, and report the
  isolated result.
- A missing Node toolchain or `node_modules` in `examples/node/webhook-receiver`
  is a documented environment gap, not a regression.

## Subprocess suites

Four suites spawn real processes rather than building a router in-process, and
each does so for a stated reason — "an in-memory-only test is worthless here".
They exercise real `main` entry points, which is why they are unaffected by the
rustls-provider trap that hits in-process suites.

`kill9_reclaim_live.rs` sends a genuine `SIGKILL` (`Child::kill()`), so **no Rust
destructor ever runs** — which is the whole point, and what makes it a real
crash-recovery proof rather than a simulation.
