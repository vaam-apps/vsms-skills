---
name: vsms-tooling
description: "Running anything in the vsms repository — the justfile, the eleven cargo xtask guards, the containerised 23-step just ci gate, toolchain and dependency pins, CI workflow path filters, and the rule that no bash or Python script survives in this repo. Load before running a command here, adding a CI check, bumping a pinned dependency, or debugging why a local pass disagrees with CI."
---

# vsms-tooling

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## `just ci` is the gate. `just all-checks` is not.

```bash
just ci          # ALL 23 steps, in a pinned container, against its own Postgres
just ci-quick    # everything except the live suites and the JS build/test
just ci-shell    # an interactive shell in the runner image
just ci-clean    # remove the CI stack's containers, network and volumes
```

`just all-checks` is the **fast host-toolchain subset**. It runs neither `cargo
deny`, nor the live-Postgres suites, nor anything on the TypeScript side. Do
not report it as CI passing.

**Two limits of `just ci`, both real:**

- **It cannot run from a linked git worktree.** `.git` is a _file_ naming an
  absolute host path the container cannot see, so `docs-drift`'s `git ls-files`
  and Turborepo's root detection both fail. The recipe refuses with that
  explanation and exit 2 before touching Docker.
- **The runner pins the MSRV while CI's `rust` job uses `stable`**, so a lint
  added after the MSRV can pass locally and fail CI. Deliberate — it enforces
  the floor.

## Everything else

```bash
just check          # cargo check --workspace --all-targets
just test           # unit + in-process only; live suites stay #[ignore]d
just lint           # fmt --check, then clippy -D warnings
just routes         # print the generated route table; needs no database
just test-live      # the live-Postgres suites
just test-live-clean
just demo / demo-up / demo-status / demo-down / demo-login
just jobs=8 check   # raise the concurrency cap
```

The recipes cap `CARGO_BUILD_JOBS`; bare `cargo` does not.

> `CARGO_BUILD_JOBS` in the environment once **never reached cargo**, because
> the justfile's prefix used a literal assignment, which beats the environment.
> If a tuning variable seems ignored, check `just --evaluate` before assuming
> the tool ignores it.

## The xtask guards

**No bash or Python script survives in this repository** — `git ls-files | grep
-E '\.(sh|py)$'` returns nothing. Every check is a `cargo xtask` subcommand,
one module per check.

| Guard                                     | What it refuses                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `no-raw-sqlx`                             | R1 — raw `sqlx` outside the twelve allowlisted paths                        |
| `parity`                                  | R2 — the state diagram and the transition table disagreeing, **either way** |
| `r6`                                      | A `className`, `cn(...)`, class constant or raw markup in a view file       |
| `docs-drift`                              | A documentation path that does not resolve                                  |
| `workflow-paths`                          | A `dockerfile:`/`working-directory:` in a workflow that does not exist      |
| `migrations-current`                      | A committed migration that disagrees with the schema                        |
| `bootstrap-sql-check`                     | `0002_bootstrap` disagreeing with §2.10 of the design doc                   |
| `sdk-schema-check`                        | The Rust SDK's vendored schema drifting from the real one                   |
| `node-sdk-types-check`                    | The Node SDK's hand-curated enum unions drifting                            |
| `cratestack-pin` / `cratestack-pin-check` | Every copy of the pin disagreeing                                           |
| `secret-env-args`                         | A secret passed as a process argument                                       |

`workflow-paths` exists because of a finding worth generalising:

> **A workflow that triggers only on push-to-`main` or on a tag cannot be
> validated by any pull request.** Its first execution of changed code is
> necessarily _after_ merge — and reviewing the diff does not help either,
> because the stale lines are _unchanged_ lines.

A path rename left `release.yml` building **zero container images for five
consecutive merges**. Path references are the part that _can_ be checked
statically from any branch, so now they are.

## Pins, and the copies that drift

`cratestack` and the `authkestra` family are pinned **exactly** (`=`), and the
whole authkestra family must move in lockstep. **The installed `cratestack` CLI
must match the `Cargo.toml` pin, checked every time rather than remembered** —
a newer CLI emits DDL the pinned library never produces, and the symptom is a
migration diff that looks like a schema change nobody made.

`cargo xtask cratestack-pin` prints the pin; `cratestack-pin-check` asserts
every _other_ copy equals it — the CI installer input, a Dockerfile build `ARG`,
and the workspace-excluded manifests. That guard exists because a Dockerfile
`ARG CRATESTACK_VERSION` was left behind by a bump and the failure only surfaced
one image build later.

> **An exact `=` pin is right for a binary and wrong for a published library.**
> Cargo resolves one version per semver line for the _entire_ graph, so `=` in a
> published crate vetoes every other crate in the consumer's graph. The Rust SDK
> uses `~`. Check `publish = true` before copying a dependency line.

## CI runs only what a change can affect

Each job is gated by a `dorny/paths-filter` `changes` job. Three things about
that are easy to get wrong:

- **Write the filters as positive lists.** `'**'` followed by `'!'` exclusions
  does _not_ subtract — paths-filter ORs its rules, so every job runs always and
  the configuration merely looks like it filters.
- **`**/*.md` is compiled input here**, not prose: the `.md` doc sidecars are
  pulled in by `include_str!` and have broken `clippy -D warnings`. Only
  root-level `*.md` and `docs/**` are safe to treat as prose.
- **Gate with a per-job `if:`, never `on.pull_request.paths`.** A skipped job
  still _reports_; a workflow that never triggers reports nothing and leaves a
  required check pending forever.

`references/ci.md` has the non-obvious couplings (why `schemas/**` reaches the
JS job, and three more) and the concurrency rules.

## When local and CI disagree, CI is the evidence

Run **the project's own command**, not your reconstruction of it. A passing CI
job that contradicts a local failure means you are running the wrong command —
`just test-live` once carried a `--tests` narrowing that CI's own command did
not, and the difference was a real failure nobody saw locally.
