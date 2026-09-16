# Database and migrations

## Check the CLI against the pin. Every time, not from memory.

The two numbers move independently — the CLI is a global install on whatever
machine runs this, the pin is a file in the repository — and nothing automated
compares them. A newer CLI's emitter produces DDL the pinned library never
emits.

**How to tell it is skew and not your change:** run `migrate diff` against the
**unmodified** schema. If that already disagrees with the committed
`0001_init`, the CLI is wrong, not your edit.

`cargo xtask cratestack-pin` prints the pin. Install that exact version into an
isolated prefix and put it on `PATH` for the regeneration.

## There is no snapshot, so every diff is the whole schema

`cratestack migrate diff` has nothing to diff _against_, so it emits the
complete current schema. **Regenerate `0001_init` wholesale**; never hand-write
an incremental migration. Then regenerate `0002_bootstrap` from §2.10 of the
design doc with `cargo xtask bootstrap-sql`.

The tool also writes a `schema.snapshot.json` as a side effect. **Delete it** —
this repository does not use snapshot-based diffing and a stale one committed by
accident is misleading.

## A policy-only change must not be regenerated at all

An `@@allow` edit has no DDL consequence. Confirm it with a byte-identical diff
and leave the migrations untouched.

## "Parses" is not "compiles" is not "applies"

`cratestack check` and `cargo build` both stayed green through a silent change
from native enum types to `TEXT` + `CHECK`, which broke at `psql` time. Verify
against a **real** Postgres before trusting a regeneration: apply all migrations
in order, then run `ci/test-state-machine.sql`.

## `SM001`

The transition trigger's SQLSTATE. If it reaches a caller as a `500
DATABASE_ERROR`, the mapping is not running — see `vsms-conventions`'
`references/errors.md`. If it fires unexpectedly, the edge is genuinely not in
`message_state_transitions`; `cargo xtask parity` will tell you whether the
table and the design doc's diagram agree.

## Bootstrap SQL has hand-written rows that the emitter knows nothing about

§2.10 carries seed `INSERT`s. When a model gains `@version`, those raw inserts
do **not** get the framework's server-side `version = 0` seed — a regeneration
failed with `null value in column "version"` for exactly that reason. Add the
column to the doc's seed table, then regenerate.
