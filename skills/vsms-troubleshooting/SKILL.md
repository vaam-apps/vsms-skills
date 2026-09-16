---
name: vsms-troubleshooting
description: "Diagnosing failures in the vsms repository where the error message is not the cause — silent empty results from a missing schema policy, migrations that disagree because the CLI does not match the pin, container and test-harness traps, demo and compose stacks that will not come up, TypeScript crashes tsc cannot see, and documented claims that turned out false. Load when something broke in vsms and the obvious reading of the symptom is not leading anywhere."
---

# vsms-troubleshooting

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## Start here: the symptom-to-cause table

| Symptom                                          | Very likely cause                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A query returns **zero rows** and nothing errors | The model's `@@allow` omits `hasRole('system')`. Found **fifteen times**                                 |
| `Forbidden` from a write that should be allowed  | Same, but on `update`/`delete`, where it fails _loudly_ — and may be absorbed by a best-effort call site |
| `Forbidden` where you expected `NotFound`        | `@authorize`'s preflight cannot distinguish "no row" from "policy denies". Correct and permanent         |
| `PreconditionFailed: If-Match header required`   | A `@version` model whose `.update()`/`.delete()` has no `.if_match(...)`. **`cargo check` stays green**  |
| `migrate diff` shows a change nobody made        | The installed CLI does not match the `Cargo.toml` pin                                                    |
| A test passes alone and fails in the suite       | Leftover rows from another test in the same binary's shared database, or a missing per-binary mutex      |
| "No rustls crypto provider is configured"        | A **test** binary — its entry point is libtest, not the binary's `main`                                  |
| A screen renders unstyled or crashes on a `null` | See `references/console-and-node.md` — two traps `tsc` cannot see                                        |
| `just demo` fails building images                | The shared cargo cache-mount race. See `references/demo-and-compose.md`                                  |
| `pnpm install` fails in `examples/*`             | That directory is **outside** the pnpm workspace on purpose                                              |
| A worker is healthy and nothing moves            | No `Route` seeded, or a route naming a provider this process has no adapter for                          |
| A webhook endpoint stops receiving               | Its circuit breaker is open (20 failures / 15 min), or a `410` deactivated it                            |

## The single most common one, in full

> **A model whose `@@allow` omits `hasRole('system')` does not error.** The
> generated list route's policy denial is **row-level filtering to an empty
> array** — so an internal read quietly returns nothing and the calling code
> behaves as though the table were empty.

`App`, `AppClient`, `SenderIdRegistration`, `OperatorPrefixRule`, `Provider`,
`Job`, `Message`, `DeliveryReceipt`, `WebhookEndpoint`, `WebhookAttempt`,
`Route`, `User`, `Role`, `ConsentRecord`, `RouteValidation` — fifteen
instances, every one found **live**, never by review.

**The fix is always the same and never touches DDL:** add the clause in
`schemas/vsms.cstack`, move the model into `SYSTEM_READABLE_MODELS` in
`backends/crates/sms-api/tests/system_context_golden_list_live_postgres.rs`, and
**do not regenerate migrations** — a policy-only change has no DDL consequence.
Confirm that with a byte-identical `migrate diff`, as every prior instance did.

Then prove the guard: pull the clause back out, watch that golden test fail
naming the model and its broken policy, restore it.

## Diagnosing by area

- `references/build-and-toolchain.md` — pins, MSRV, rustls providers, `cargo deny`
- `references/database-and-migrations.md` — the CLI/pin skew, regeneration, `SM001`
- `references/live-tests.md` — the harness, orphaned containers, cross-suite bleed
- `references/demo-and-compose.md` — `just demo`, the build race, stale compose files
- `references/console-and-node.md` — the two TypeScript traps, pnpm workspace scope
- `references/known-wrong-claims.md` — documented claims that were false

## The meta-rule

**Grep narrows; read confirms.** Never conclude something is absent from a grep
miss when the file is small enough to read — windowing the wrong block has
produced confidently wrong conclusions here more than once.

And **a skipped test is not a passing test.** Suites that skip on a missing
dependency still print `ok`. Force the failure mode before reporting anything as
verified.
