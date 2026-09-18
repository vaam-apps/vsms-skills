---
name: vsms
description: "Orientation for working in the vsms repository — a Rust + TypeScript A2P SMS gateway for Cameroon, extensible to any country. Load this before any task in vsms: it carries the six machine-enforced engineering rules, what is actually built versus stubbed, the repository map, the traps that cost this project whole milestones, and which of the other vsms-* skills to load for the work at hand. Use when reading, planning, reviewing or changing anything in vsms."
---

# vsms

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

An A2P SMS gateway: OTP and notification delivery, provider abstraction over
HTTP APIs and (eventually) SMPP, a Next.js admin console. **Cameroon-first and
extensible to any country** — Cameroon is the default region and the
best-supported market; other countries are reached through data and
configuration.

## Read these three, in this order, before you believe anything

1. **`AGENTS.md`** (`CLAUDE.md` is a symlink to it). It is ~578 KB and it is
   the engineering record: every framework surprise, every corrected claim,
   every bug found live rather than by review. It is not optional background.
2. **`docs/architecture.md`** — the spec. Every claim in it was verified
   against the real toolchain rather than assumed.
3. **`docs/design/multi-country.md`** — **before touching numbers, money,
   operators or quiet hours.** Both of the files above were written for
   Cameroon alone and most of them still read that way.

vsms has no single feature index. "What does this system promise about X"
is `docs/architecture.md`'s relevant numbered section first, then the `.md`
sidecar next to the module that implements it (`#![doc = include_str!(...)]`
— `dispatch.md`, `claim.md`, `op.md`, and 72 others under `backends/**/src/`).

## The one thing to get right

> **A green `cargo test` proves nothing about what it never ran.**

This repository is organised around that sentence, and it has earned it:

- `cratestack-sqlx` 0.5.x **discarded SQLSTATE on every generated write**, so
  the error mapping silently did nothing against a real database. Every test of
  it constructed the typed error _by hand_ — correct unit coverage, and
  structurally incapable of seeing the conversion feeding it.
- Fourteen live-Postgres suites were **skipped in CI for a whole milestone**
  because the command had no `--ignored`. One of them was hiding a policy bug
  that made its own query return zero rows.
- A model missing `hasRole('system')` from its `@@allow` **does not error** —
  the list route filters to an empty array. That has now been found **fifteen
  times**.

So: **prove the guard can fail.** Break the mechanism, watch the test fail with
the expected message, restore it, and say so — with the captured output — in
the PR. A guard that has never been seen to fail is not known to guard
anything.

## The second thing: never make the system look more finished than it is

Unimplemented procedures return an error **naming the milestone that will build
them**, never a plausible empty success. The `smpp` worker role logs once and
genuinely idles rather than busy-looping. When you cannot implement something
properly, leave the gap visible and say so in your summary.

`docs/roadmap.md` is the dated snapshot of what is real. GitHub owns live
status and is always more current.

## The six engineering rules

`CONTRIBUTING.md` carries the full reasoning. In short:

- **R1 — all data access goes through CrateStack delegates. Never raw `sqlx`.**
  Raw SQL bypasses row-level policy, audit rows, `@@emit` outbox rows and
  `@version` bumping — all four, silently. Twelve named exceptions, enforced by
  `cargo xtask no-raw-sqlx`.
- **R2 — state transitions are proposed by Rust and decided by Postgres.**
  Legal edges are rows in `message_state_transitions`/`job_state_transitions`;
  triggers reject the rest with SQLSTATE `SM001`. Map it to `Conflict` → 409.
  `cargo xtask parity` checks the table against the design doc's diagram, both
  ways.
- **R3 — nothing that must be written can be `@server_only`.** It excludes a
  field from create _and_ update, so such a field can never be populated.
- **R4 — the admin console is optional; the backend must run without it.**
  Review test: _if `frontends/apps/admin/` were deleted, would this still
  work?_ Every operator action needs a `sms-gateway` subcommand, not only a
  screen.
- **R5 — Helm is one umbrella chart on `bjw-s` common ≥ v4.** Not a chart per
  service.
- **R6 — pages compose, smart components decide, dumb components style.** A
  view file contains **no CSS classes** — not a `className`, not a `cn(...)`,
  not a hoisted class constant. `cargo xtask r6`.

## Before you start, and when you finish

```bash
cat AGENTS.md | head -200      # status, and the current milestone
just all-checks                # the FAST subset — not the whole gate
just ci                        # the whole gate, 23 steps, in a container
```

`just all-checks` runs neither `cargo deny`, nor the live-Postgres suites, nor
anything on the TypeScript side. Do not report it as CI passing.

When you finish: update the module's `.md` sidecar (and `docs/architecture.md`
if it changes the spec) **in the same commit**, check `docs/roadmap.md`
(usually no edit — see `vsms-docs-skills`), and state explicitly in your
summary what you did _not_ do.

## Repository map

| Path                            | What is in it                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backends/crates/`              | The libraries: `sms-api`, `sms-auth`, `sms-worker`, `sms-routing`, `sms-provider*`, `sms-encoding`, `sms-msisdn`, `sms-webhook`, `sms-metrics`, `sms-core`, `sms-test-support` |
| `backends/apps/`                | The binaries: `sms-gateway`, `sms-worker`, `sms-migrate`, `sms-fake-orange`, `vsms-demo-seed`                                                                                  |
| `backends/migrations/postgres/` | Three migrations. `0001_init` is generated wholesale; `0002_bootstrap` is generated from §2.10 of the design doc. **Never hand-edit either**                                   |
| `schemas/vsms.cstack`           | The CrateStack schema. **It compiles into `sms-api`** — a syntax error is a build failure                                                                                      |
| `frontends/`                    | The pnpm workspace: `apps/admin` plus `packages/{gateway,api,env,hooks,sms-client}`                                                                                            |
| `sdks/`, `examples/`            | Published SDKs and runnable examples. **`examples/*` is outside the pnpm workspace on purpose**                                                                                |
| `.xtask/`                       | Every CI guard. No bash or Python survives in this repo                                                                                                                        |
| `backends/**/src/*.md`          | The real feature index — one sidecar per module, pulled in via `#![doc = include_str!(...)]`. 75 of them as of `0dbde02a`                                                      |
| `docs/runbooks/`                | AsciiDoc. How to operate it, including the two manual milestone gates                                                                                                          |

## Traps that have each cost this project real time

- **The installed `cratestack` CLI must match the `Cargo.toml` pin**, every
  time, checked rather than remembered. A newer CLI emits DDL the pinned
  library never produces.
- **A policy-only `@@allow` change has no DDL consequence and must not be
  regenerated.**
- **`if_match` on a `@version` model is a _runtime_ requirement, not a
  compile-time one.** `cargo check` stays green across every call site that
  needs one. Grep for `Update<Model>Input`.
- **A nullable column serialises as an explicit JSON `null`, not an omitted
  key** — on the TypeScript side, where `tsc` cannot see it.
- **`Forbidden` is ambiguous**: policy denied, _or_ the row is gone. Never fold
  it into a "lost the race" branch.
- **Never `docker prune`, in any form**, and never scope container cleanup by
  image name — the test harness scopes by Compose project for exactly this
  reason.

`references/reading-the-repo.md` covers the documentation conventions that will
mislead you if you do not know them — in particular why a page tells you what
it used to say and was wrong about.

## Which skill to load

| The work                                                  | Load                   |
| --------------------------------------------------------- | ---------------------- |
| Writing Rust or TS here — errors, style, doc sidecars     | `vsms-conventions`     |
| Running anything — `just`, xtask, CI, toolchain pins      | `vsms-tooling`         |
| Something broke and the message is not the cause          | `vsms-troubleshooting` |
| Finishing a change — flows, roadmap, the parity rule      | `vsms-docs-skills`     |
| The schema, migrations, policies, CrateStack itself       | `vsms-data-layer`      |
| Message states, the send path, encoding, numbers, DLRs    | `vsms-messaging`       |
| The `SmsProvider` port, the error taxonomy, adding a rail | `vsms-providers`       |
| Orange Cameroon specifics, or the fake                    | `vsms-orange-cm`       |
| MTN via an aggregator                                     | `vsms-mtn`             |
| Route selection, failover, circuit breakers, grey routes  | `vsms-routing`         |
| The worker — roles, leases, claim loops, dispatch, jobs   | `vsms-worker`          |
| Events, the outbox, webhook delivery and signing          | `vsms-webhooks`        |
| The wire contract, idempotency, rate limiting             | `vsms-api`             |
| OAuth, `private_key_jwt`, human login, RBAC               | `vsms-auth`            |
| The admin console, R6, the gateway seam                   | `vsms-console`         |
| Consent, quiet hours, opt-outs, retention, audit          | `vsms-compliance`      |
| Images, compose, Helm, metrics, alerts, backup            | `vsms-ops`             |
| Live-Postgres suites, the harness, guard-failure proofs   | `vsms-testing`         |
| The Rust/Node SDKs and the generated TS client            | `vsms-sdks`            |
| Numbers, money, operators or quiet hours in any country   | `vsms-multi-country`   |
