---
name: vsms-testing
description: "Testing in vsms — the per-binary live-Postgres harness and its five hard-won rules, the fault-injecting Orange fake and the chaos suite's invariant assertions, the house standard of proving a guard can fail before trusting it, the containerised 23-step just ci gate, and the two milestone gates that need a real handset and cannot be automated. Load before writing or changing any test here, or when a suite passes and you are not sure what it proved."
---

# vsms-testing

> **Verified against vsms `bba85b9c` (2026-10-20).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The sentence this repository is organised around

> **A green `cargo test` proves nothing about what it never ran.**

Earned, three times over: an error mapping that silently did nothing against a
real database while every unit test of it passed; fourteen live suites skipped in
CI for a whole milestone; and a policy gap that makes a query return zero rows
without erroring, found **fifteen** times.

## Prove the guard can fail

**Break the mechanism, run the test, capture the failure, restore, re-run.** Put
the captured output in the PR. This is not optional rigour here; it is the house
standard, and it has caught real regressions in the _tests_:

- **A test can pass with its mechanism broken** because its fixture is too thin
  to distinguish the outcomes — a single-route fixture cannot prove "never fails
  over", because a broken implementation finds nothing eligible and lands in the
  same state by accident. Say so, and add the fixture that can.
- **A sabotage can fail earlier and louder than intended.** That is a _stronger_
  result. Record what actually happened rather than claiming the intended path
  fired.
- **Assert the effect, not the absence of a panic.** "The attempt reached a
  terminal state" passed both before and after a real fix; "`consecutiveFailures`
  stayed `0` and zero HTTP requests were made" did not.

## The live-Postgres harness

`sms-test-support` manages **one** container via `docker compose -p
vsms-test-harness` and gives **each test binary its own database** from a
once-migrated template. Suites are `#[ignore]`d; `just test-live` runs them.

`references/live-suites.md` has the five rules in full. The ones that bite:
**never cache a container handle in a `static`** (Rust never runs `Drop` for a
`static` on any exit path — 56 orphaned instances filled a 32 GB laptop);
**never `docker prune`, in any form**, and scope cleanup by Compose project;
**one database per binary**; **fingerprint migration _content_**; and **any new
live suite must take the per-binary mutex**.

## The chaos suite

`sms-fake-orange` is a **participant, not a stub** — it answers the provider
calls per a `FaultPolicy` and independently POSTs DLRs back into a real running
route, including one that **races the submit response**.

Ten scripted tests (one fault mode each) and five seeded sweeps that assert
**invariants rather than exact outcomes**: no message lost, nothing left
claimable, `attempts <= maxAttempts`, and — checked against **the fake's own
request ledger, not this system's database** — a message that went `uncertain` is
never submitted again.

That last distinction is the point: the database records what this system
_believes_ it did; the ledger records what the provider actually received.

## The SSO suites, and a fake that is not Keycloak (since 2026-10-19)

`backends/crates/sms-fake-oidc` is the second fake in this repository
(`sms-fake-orange` is the first), and it is built on a small stateful `axum`
app rather than `wiremock` for a reason worth keeping: the `nonce` and `state`
the test sends must come back inside a token **signed at exchange time**, an
authorization code is single use, and the PKCE challenge seen at `/authorize`
must be checked at `/token`. Its `/authorize` is **browserless** — it answers
`302 redirect_uri?code=...&state=...` at once, and a test plays the browser by
following redirects by hand. Its point is that a scripted `LoginSpec` can be
wrong on purpose (wrong `nonce`/`aud`/`iss`/`azp`, expired, no or unknown `kid`,
an unknown signing key, `alg: none`, `HS256`, any `acr`/`amr`/`groups`), so every
refusal in the broker is exercised by a token that is _actually_ malformed.
Its signing keys are throwaway literals.

| Suite                                         | Needs                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `sms-auth/tests/sso_provider.rs`              | no database                                                              |
| `sms-auth/tests/sso_live_postgres.rs`         | live Postgres                                                            |
| `sms-gateway/tests/sso_flow_live_postgres.rs` | live Postgres; spawns the **real** `sms-gateway` binary against the fake |

**What the fake cannot prove:** Keycloak's own behaviour. The measured facts —
`acr` is `"1"`/`"0"` and `amr` empty on the stock browser flow, OTP enrolment via
a required action — came from a **by-hand** run against a real
`quay.io/keycloak/keycloak:26.6.1` container on 2026-10-19 (no container test
pattern exists here except for Postgres), and a fake scripted to say what the
authors believe Keycloak says can only confirm the belief. Treat the runbook's
"Verification performed" table as the evidence and the suites as its regression
net. Guard-failure proofs were run for the nonce check, the algorithm
allow-list, the group gate and MFA rule, the one-retry rule, single-use
consumption, the `handle_authorize` dry run, and the link lookup ignoring
`issuer` — each named test failed with the mechanism broken.

Two test-shaped traps from that work: the golden-list guard
(`system_context_golden_list_live_postgres.rs`) now names `FederatedLink` and
`SsoTransaction` (`vsms-data-layer`); and `help_never_prints_secret_env_values.rs`
gained a sentinel for `SMS_SSO_CLIENT_SECRET`, in step with the `secret-env-args`
guard (`vsms-tooling`).

## `just ci`

23 steps in a pinned container against its own disposable Postgres. **`just
all-checks` is the fast host-toolchain subset, not the gate** — it runs neither
`cargo deny`, nor the live suites, nor the TypeScript side.

**It cannot run from a linked git worktree** (`.git` is a file naming a host path
the container cannot see). **The runner pins the MSRV while CI uses `stable`**,
so a lint added after the MSRV passes locally and fails CI.

A per-run scratch database is created and trap-dropped, because a persistent
volume made the migrations step a **no-op from the second run on** — asserting
against a stale schema.

## The two gates that cannot be automated

- `docs/runbooks/36-handset-gate.adoc` — a real handset receiving `delivered`
  within 15s, and a human-timed `kill -9` against a real account.
- `docs/runbooks/65-kill-orange-gate.adoc` — the rest of "kill Orange in
  staging".

**Neither has been run.** Their automatable halves _are_ suites — the second
drops a real listening socket so the next submit gets a genuine `ECONNREFUSED`
through the real adapter, which needed `SO_REUSEADDR` to revive on the same port
(`TIME_WAIT` blocks a fresh _listening_ bind even with nothing listening —
verified with a throwaway program before writing any test code).

## When local and CI disagree, CI is the evidence

Run the project's own command, not your reconstruction of it. `just test-live`
once carried a `--tests` narrowing CI's command did not have, and the difference
was a real failure nobody saw locally.

And **a skipped test is not a passing test.** A suite that skips on a missing
dependency still prints `ok`.
