# Regenerating migrations

Three migrations: `0001_init` (generated wholesale), `0002_bootstrap` (generated
from §2.10 of `docs/architecture.md`), `0003_idempotency_table`.

## Step 0, every time: match the CLI to the pin

```bash
cargo xtask cratestack-pin     # prints the pinned version
cratestack --version           # must equal it
```

The two numbers move independently and nothing automated compares them. A newer
CLI's emitter produces DDL the pinned library never emits.

**How to tell skew from your own change:** run the diff against the
**unmodified** schema. If that already disagrees with the committed `0001_init`,
the CLI is wrong.

Install the pinned CLI into an isolated prefix and put it on `PATH` for the
regeneration. Do not regenerate with a mismatched CLI "just to see".

## The workflow

```bash
cratestack migrate diff --schema schemas/vsms.cstack \
  --out-dir backends/migrations --backend postgres --name init
# copy the output over backends/migrations/postgres/0001_init/{up,up.pre,down}.sql
cargo xtask bootstrap-sql backends/migrations/postgres/0002_bootstrap/up.sql
```

The CLI nests output under `<out-dir>/<backend>/<timestamp>_<name>/`. It also
writes `schema.snapshot.json` — **delete it**; this repository does not use
snapshot diffing and a stale one committed by accident is misleading.

`up.pre.sql` exists only when the generator scaffolds one for a blocking
migration. It is committed, and it is **applied in the same transaction**,
immediately before `up.sql`. Delete the committed copy if a regeneration stops
emitting one.

## Verify against a real Postgres, not `cratestack check`

```bash
createdb vsms_check
DATABASE_URL=postgres://localhost/vsms_check cargo run -p sms-migrate
psql postgres://localhost/vsms_check -v ON_ERROR_STOP=1 -f ci/test-state-machine.sql
dropdb vsms_check
```

`cratestack check` and `cargo build` both stayed green through a silent change
from native enum types to `TEXT` + `CHECK` that broke at `psql` time.

## Hand-written SQL lives in the design doc, not in the file

§2.10 owns every default, index, trigger and transition-table row. **Edit the
doc, then regenerate.** `cargo xtask bootstrap-sql-check` diffs them.

A trap: when a model gains `@version`, §2.10's raw seed `INSERT`s do **not** get
the framework's server-side `version = 0` — a regeneration failed with `null
value in column "version"` for exactly that reason. Add the column to the seed
table in the doc.

## Foreign keys changed at `=0.7.8`

The emitter now writes a plain `ON DELETE NO ACTION` foreign key for every
`@relation`, so hand-written duplicates left `0002_bootstrap`.

**The trap, found live: two foreign keys on the same column enforce
independently.** Leaving the emitted `NO ACTION` beside a hand-written `CASCADE`
does not resolve to the more permissive one — Postgres raises on `NO ACTION`
before `CASCADE` runs, silently reinstating the block. The three relations that
need cascade **drop the emitted constraint by name** and replace it.

## When _not_ to regenerate

A policy-only `@@allow` change. Confirm with a byte-identical diff and leave the
migrations untouched. Every prior instance of the `hasRole('system')` fix did
exactly this.
