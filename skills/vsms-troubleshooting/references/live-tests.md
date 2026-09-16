# Live-Postgres suites

`backends/crates/sms-test-support` manages **one** Postgres container via
`docker compose -p vsms-test-harness` and gives **each test binary its own
database** created `FROM TEMPLATE`. Live suites are `#[ignore]`d; `just
test-live` runs them.

## Five traps, each learned by something breaking

- **Never cache a container handle in a `static`.** Rust never runs `Drop` for
  a `static`'s contents on any process-exit path. 56 orphaned Postgres instances
  filled a 32 GB laptop. Nothing here may depend on a destructor at exit.
- **Cleanup is scoped by the Compose project name**, never by image or a bare
  name pattern. A sweep filtered by `ancestor=postgres:16-alpine` would destroy a
  developer's unrelated database. **Never `docker prune`, in any form.**
- **One database per test _binary_.** Sharing one let a real `sms-worker --roles
dispatch` subprocess claim _other suites'_ leftover messages — the claim loop
  selects any eligible row, as it must in production. Passed alone, timed out
  under the full sweep.
- **The migration check fingerprints migration _content_**, not whether a table
  exists. An existence check silently served a **stale schema** from a
  pre-existing container after a bootstrap-only change.
- **The container name is fixed and global.** Two concurrent `cargo test`
  invocations on one machine fight over it and corrupt each other's runs. Do not
  run overlapping live-test processes.

## Within one binary, take the mutex

Tests in one binary share that binary's database, and Postgres's own `pg_type`
catalog race on first use is what the per-binary `tokio::sync::Mutex`
serialises. **Any new live suite must take it.** Two suites that missed it both
flaked in CI within hours of the live suites first running there.

## Test isolation against a never-reset database

Fixtures must not assume an empty table. The established patterns:

- `clear_claimable_backlog` before seeding claimable rows.
- `deactivate_every_active_provider` / `disable_every_route` before seeding one
  a test's assertions depend on — otherwise a stale route from an earlier run can
  win the weighted draw and point at a provider this test never registered.
- Derive expectations from the engine's own reported output, not from an
  assumption about row identity. `Cuid` order is not creation order.

## A live suite can fail for reasons that are not Postgres

`hooks_node_receiver_live.rs` spawns a real `node` subprocess out of
`examples/node/webhook-receiver`. That directory is **outside** the pnpm
workspace on purpose, so a root `pnpm install` never installs it — and running
`pnpm install` inside it _without_ `--ignore-workspace` resolves against the root
workspace and writes **no lockfile at all** (it succeeds, which is what makes it
misleading). Install with `--ignore-workspace --frozen-lockfile`.

On a filesystem that cannot create symlinks — an sshfs mount, for instance —
`pnpm install` cannot succeed there at all, for any dependency tree. That is an
environment limit, not a regression; say so rather than chasing it.

## Flakes that are infrastructure, not code

`error communicating with database: expected to read 5 bytes, got 0 bytes at
EOF` inside the harness's own database-creation step is a dropped connection
under concurrent I/O load, not an assertion failure. **Re-run that suite in
isolation before concluding anything** — and report the isolated result, not
just the sweep's.
