---
name: vsms-data-layer
description: "The vsms data layer — CrateStack schema-first modelling, the .cstack grammar and emitter constraints that are in no documentation, row-level policy and the hasRole('system') gap this repository has hit fifteen times, migration regeneration and the CLI-versus-pin skew, and R1's twelve raw-sqlx exceptions. Load before touching schemas/vsms.cstack, any migration, an @@allow clause, or anything that reads or writes the database."
---

# vsms-data-layer

> **Verified against vsms `bba85b9c` (2026-10-20).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

**CrateStack is schema-first.** `schemas/vsms.cstack` generates models,
row-level policies, audit, events and REST routes, and **it compiles into
`sms-api`** — a syntax error is a build failure, not a runtime one. 25 models
as of 2026-10-19 (23 as of 2026-09-15; the two added are the SSO broker's
`FederatedLink` and `SsoTransaction`, below) and 18 procedures as of
2026-09-15.

## R1 — delegates, never raw `sqlx`

Raw SQL bypasses **four** guarantees at once, silently: row-level policy, audit
rows, `@@emit` outbox rows, and `@version` bumping.

Twelve named exceptions, enforced by path in `cargo xtask no-raw-sqlx` and
documented with reasoning in `CONTRIBUTING.md`. Four categories: migrations,
advisory locks, `LISTEN`/`NOTIFY`, and **tables that are not schema models** —
the framework's own outbox and audit tables, `pg_locks`, and the readiness
probe's bare `SELECT 1`.

**Two things people reach for that are _not_ exceptions:** transactions (every
builder has `.run_in_tx(&mut tx, &ctx)`, and delegates inside a caller-managed
transaction still write their audit and outbox rows into it) and row locking
(`.for_update()` works). The one genuine gap is `SKIP LOCKED`, which the
framework cannot express — hence the CAS claim loop, which is better here anyway
because no lock is held across a provider HTTP call.

## The gap this repository has hit fifteen times

> A model whose `@@allow` omits `hasRole('system')` **does not error.** The list
> route's policy denial is row-level filtering to an **empty array**.

Fifteen instances, every one found live. The fix never touches DDL. The guard
that ended it is
`backends/crates/sms-api/tests/system_context_golden_list_live_postgres.rs`, in
two layers:

- **No database, runs under plain `just test`**: parses `schema.cstack` for
  every `model Foo {` and asserts each appears in exactly one of two justified
  lists — `SYSTEM_READABLE_MODELS` or `NOT_REQUIRED_TO_BE_SYSTEM_READABLE`. A new
  model in neither fails immediately, by name.
- **Live**: seeds a row per system-readable model and reads it back under a real
  system context.

A purely schema-derived list could not catch this: the omission would make the
schema and the expectation agree by construction. Since it exists, every new
instance has been **flagged in advance** rather than found broken.

## Grammar and emitter constraints

The full table with exact error text is `docs/architecture.md` §2.0. The ones
that will cost you an afternoon:

### Will not compile or parse

- **Scalar list fields panic the server macro.** `String[]` parses and emits DDL
  happily; only `include_server_schema!` fails. Multi-values are space-delimited
  strings with **sentinel separators** (`" a b "`) so `.contains(" a ")` cannot
  false-match `ab`. `sms_core::pack`/`unpack` own that.
- **Exactly one whitespace character** between field name and type — no column
  alignment.
- **The parser is line-based.** An `@@allow` cannot wrap onto a second line.
- **Relation scalars require type-name equality**, including through
  `auth().x` comparisons.

### Will compile, and be silently wrong

- `@@use` instead of `@use` parses and does **not** expand the mixin.
- **A misspelled `@@allow` action is dropped**, and deny-by-default makes that
  operation unreachable.
- Unknown attributes are ignored. Enum `@default` values are not checked against
  variants — a typo reaches the DDL and fails at `psql` time.
- **`@db_enforce` is a silent no-op on `@regex`.** It backs `@length`/`@range`
  with a real `CHECK` and does nothing at all for a pattern; anything
  pattern-shaped needs a hand-written `CHECK` in `0002_bootstrap`.

### Shape the schema

- **Any `@default(...)` excludes the field from `CreateXInput`** — literals
  included. That is the _control_ behind `Message.state @default('accepted')`,
  not a check. It does **not** exclude the field from the _update_ input.
- `@pii`/`@sensitive` redact audit snapshots only. No serde attribute; the field
  is still returned by the API. **They are not confidentiality controls.**
- Ids must be lowercase alphanumeric, no separator — REST filters are
  format-guarded `[a-z0-9]{2,32}`, so a `msg_` prefix breaks `GET /messages?id=`.
- No `@@index`, no triggers, no column defaults come from the emitter.
- `upsert` does not exist when the `@id` has a default; dedupe is `create` +
  catching `23505` via `db_sqlstate()`.
- `@length` on a **nullable** `String?` breaks the generated update input at
  compile time. Use a non-null sentinel, or drop the bound.

## `@version`, and the check the compiler cannot do

`if_match` is a **runtime** requirement, not a compile-time one: the builder
field is a plain `Option<i64>` defaulting to `None`, so omitting it compiles and
fails at execution with `PreconditionFailed`. `cargo check --workspace
--all-targets` stayed green across ten models gaining `@version` and seventeen
call sites that needed a real fix.

**Grep for `Update<Model>Input` and read each site.** Since cratestack 0.7.13
this applies to `DELETE` too.

## Migrations

See `references/migrations.md`. The short version: **check the CLI against the
pin every time**, regenerate `0002_bootstrap` from §2.10 of the design doc with
`cargo xtask bootstrap-sql`, **never hand-edit it or `0001_init`**, delete the
`schema.snapshot.json` side effect, and verify against a real Postgres —
"parses" is not "compiles" is not "applies".

~~Regenerate `0001_init` wholesale on every schema change (there is no snapshot,
so every diff is the whole schema).~~ **Corrected 2026-10-19:** that held only
while no database had applied `0001_init`. `sms-migrate` records migrations by
**name**, so a regenerated `0001_init` never reaches a database that applied the
old one — and `0004_import_to_imported` already said so. **A new model ships as
a forward migration** (`0005_sso_federation` is the worked example), and
`0001_init` stays byte-for-byte as deployed. Five migrations exist as of
2026-10-19.

**A policy-only `@@allow` change has no DDL consequence and must not be
regenerated at all.**

## `FederatedLink` and `SsoTransaction` (since 2026-10-19)

The two models of the SSO broker (the SSO page of `vsms-auth`), both
`hasRole('system')` on every action they have and both read under `sys()` by
`sms_auth::sso::store`. They were **named in
`system_context_golden_list_live_postgres.rs` from day one** — in the same
change, rather than found live as the fifteen earlier instances were of the
`hasRole('system')` gap.

- **`FederatedLink(issuer, subject, userId)`** — `read` and `create` only, plus
  `@@audit`; there is deliberately no `update` or `delete`, because unlinking is
  not an operation yet. `UNIQUE (issuer, subject)` is **hand-written** in
  `0005` (the emitter writes neither composite uniques nor non-unique indexes),
  and it is what makes two concurrent first sign-ins for one identity unable to
  both create a link — the loser gets SQLSTATE `23505` on
  `federated_links_issuer_subject_key` and re-reads.
- **`SsoTransaction(stateHash, nonce, codeVerifier, consoleRequest, isRetry,
expiresAt)`** — `read`, `create` and `delete`. `stateHash` is the SHA-256 of
  the upstream `state` (`@unique`); the row is consumed by `delete`; five-minute
  TTL; reaped by a task in `sms-gateway serve`.

**`0005_sso_federation` mixes two kinds of statement.** Its first four are the
generator's own output for the two models, copied byte for byte; the rest
(`cs_cuid()` and `now()` defaults, the composite unique, the user and expiry
indexes) are hand-written. `cargo xtask migrations-current` enforces the split:
see `references/migrations.md`.

## The verified delegate API

```rust
db.message().find_many()
    .where_expr(FilterExpr::from(message::state().in_([MessageState::accepted]))
                  .and(message::expiresAt().gt(now)))
    .order_by(message::priority().desc())   // appends, doesn't replace
    .limit(n).run(&ctx).await?

db.message().update(id).set(UpdateMessageInput { ..Default::default() })
    .if_match(version).run(&ctx).await?
```

Filter helpers are `cratestack_schema::<model_snake>::<fieldNameVerbatimCamelCase>()`.
Ops: `.eq .ne .lt .lte .gt .gte .in_ .is_null .is_not_null .eq_or_null .contains
.starts_with .is_true .is_false` — **no `not_in`, `between` or `ilike`**.
`.and()`/`.or()` are on `FilterExpr`, not `Filter`. Enum variants are
lowercase-verbatim. `Int` is `i64`. Nullable setters are `Option<Option<T>>`
(on the Rust builder — **not** over REST).
