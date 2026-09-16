---
name: vsms-conventions
description: "How to write Rust and TypeScript in the vsms repository — error modelling with thiserror and typed boundaries, the .md doc-sidecar convention, serde casing, lint policy, the six engineering rules R1 through R6, and the house standard of proving a guard can fail before trusting it. Load when writing or reviewing any code in vsms, or when a reviewer asks why a pattern here differs from the obvious one."
---

# vsms-conventions

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The six rules, in one screen

`CONTRIBUTING.md` has the reasoning; this is the operational form.

|     | Rule                                                           | Enforced by                                |
| --- | -------------------------------------------------------------- | ------------------------------------------ |
| R1  | All data access through CrateStack delegates. Never raw `sqlx` | `cargo xtask no-raw-sqlx`                  |
| R2  | Transitions proposed by Rust, decided by Postgres              | `cargo xtask parity` + the trigger         |
| R3  | Nothing that must be written can be `@server_only`             | `tests/create_inputs.rs` (a compile error) |
| R4  | The console is optional; the backend runs without it           | Review                                     |
| R5  | Helm is one umbrella chart on `bjw-s` common ≥ v4              | Review                                     |
| R6  | Pages compose, smart components decide, dumb components style  | `cargo xtask r6`                           |

R1's twelve exceptions are a **path allowlist**, and adding a thirteenth should
feel like a design decision, because it is one. Put the reasoning in the PR,
add the row to `CONTRIBUTING.md`'s table **and** the allowlist — a previous gap
between those two went unnoticed for a whole harness's lifetime.

## Errors: a typed hierarchy at every boundary, never a `String`

`thiserror` for libraries. A boundary error carries **structured context plus a
real `#[source]`**, not a pre-formatted sentence:

```rust
#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("{context}: {source}")]
    Database { context: &'static str, source: CratestackError },
    ...
}
```

Three things that decision buys, each learned by not having it:

- **`#[error(transparent)]` with a bare `#[from]` drops the context.** Every
  call site already carried a prefix ("expiring stale submitted messages: …")
  and `Job.lastError` has no separate field for "which step", so that prefix is
  load-bearing. Carry `context` as a real field.
- **The context strings live in `pub(crate) const CTX_*` next to the call
  site**, and a table-driven test pins each against its expected wording. A test
  that types the literal _inside the test_ proves the format string and nothing
  about the call site — a one-character edit changed production output while
  every test passed.
- **Name the test-only escape hatch after what it is.** `Injected(String)`, not
  `Other(String)`: an untyped catch-all that reads like a general-purpose
  variant is one a future author will reach for.

`CratestackError` is the framework's own type at the data boundary. Two of its
variants are ambiguous and must not be flattened — see `vsms-api`.

## Documentation lives in a sibling `.md`

```rust
#![doc = include_str!("claim.md")]
```

Narrative in `claim.md`; short `///` lines in `claim.rs`, enough to satisfy
`missing_docs`. The sidecar is where "we tried the obvious thing and here is
why it is wrong" goes — and that paragraph is the most valuable thing in most
of these modules.

**Read the sidecar before changing the module.**

## Serde casing

**Shapes this repository owns are `snake_case` on the wire**, declared with an
explicit `#[serde(rename_all = "snake_case")]` even when every field already
happens to be snake_case — so a future field cannot silently drift into
camelCase without the attribute visibly contradicting it.

**Shapes that mimic an external API keep that API's casing** and are usually
raw `serde_json::json!` rather than a derived struct. `sms-fake-orange` has
zero derived wire structs for exactly this reason: every shape must match
Orange's real camelCase, and converting them would be wrong.

Watch for a **persisted** format: a `rename_all` that would change a key in an
existing backup file is a breaking change, not a tidy-up.

## Doctests, where a doc makes a concrete claim

The five pure crates (`sms-core`, `sms-encoding`, `sms-msisdn`, `sms-webhook`,
`sms-routing`) carry doctests so a documented input→output claim is falsifiable
rather than prose. Assert a real value; never write a "does not panic"
placeholder.

**Never author a doctest in `sms-api`.** Its public surface is macro-generated
from the schema, so its doc comments are upstream's illustrative text — testing
them tests the framework's comments, not this repository's code.

## Lints and formatting

`cargo fmt --all --check`, then `cargo clippy --workspace --all-targets -- -D
warnings`. `biome` on the TypeScript side. Both are steps in `just ci`.

**A pure rename is not a zero-diff change**: a six-character-longer type name
pushed 31 files past the wrap width. Run `cargo fmt` after any wide rename and
expect it.

Two clippy lints bite in sidecars specifically: `doc-lazy-continuation` (a line
starting `+` reads as a nested list marker) and `doc-markdown` (backtick
anything that looks like an identifier, `DPoP` included).

## Prove the guard can fail

> A guard that has never been seen to fail is not known to guard anything.

Break the mechanism, run the test, capture the failure, restore, re-run. Put
the captured output in the PR. Two outcomes are worth naming rather than
smoothing over:

- The sabotage fails **earlier and louder** than intended — a _stronger_ result.
  Record what actually happened.
- The test **passes** with the mechanism broken, because the fixture was too
  thin to distinguish the outcomes. Say so, and add the fixture that can.

See `references/errors.md` for the error-mapping specifics and
`vsms-testing` for the full discipline.
