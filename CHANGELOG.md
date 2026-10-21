# Changelog

Per release: the vsms range covered, which skills changed, and — most
importantly — **any claim that stopped being true**, which is the entry someone
upgrading actually needs.

## v2026-09-16-0dbde02a — initial release

Verified against vsms
[`0dbde02a`](https://github.com/vaam-apps/vsms/commit/0dbde02aa10c02e13da0978a5cd5d2338a4df0f9)
(2026-09-15).

Twenty-one skills, covering the whole system as of that commit: orientation and
the six engineering rules, conventions, tooling, troubleshooting, the docs↔skills
parity rule itself, the data layer, messaging, providers and the two adapters,
routing, the worker, webhooks, the API surface, identity, the console,
compliance, operations, testing, the SDKs, and multi-country.

~~Landed alongside vsms's own `docs/flows/` — 36 feature pages, created in the
same change, which is what this repository's gate enumerates.~~ **Corrected
2026-09-18:** that never happened. `docs/flows/` does not exist in vsms and
never has — zero commits touch it across every ref in vsms's history, verified
with `git log --all -- docs/flows` returning nothing. The 36 "feature pages"
named above, and the `"37th"` overview page (`docs/flows/README.md`), were
fabricated: 37 `coverage.json` entries pointing at a directory this initial
release's own author invented rather than found. `tools/verify-coverage.mjs`'s
docs → skills direction called `note(...)` unconditionally the moment
`docs/flows` was absent, so `verify.yml` had failed on every run since this
release's own first push — it was never green, not once, despite this entry's
own "Proven to fail four ways before being trusted" claim in the initiating
commit. See the `v2026-09-18` entry below for the fix.

**No claims retired**, there being no previous release. The claims most likely
to go stale first, and therefore the ones to re-verify soonest:

- **Counts.** 133 routes, 23 models, 18 procedures, 36 feature pages, 21 skills,
  six worker roles, five built job kinds, eleven xtask guards, twelve R1
  exceptions, fifteen instances of the `hasRole('system')` gap. Every one is
  dated; none is stable.
- **"Not built" claims.** Five job kinds (`poll_balance`, `probe_providers`,
  `reconcile_clients`, `cleanup_secrets`, `verify_backup`), the MTN adapter's
  registry wiring, `cancelMessage`, the `smpp` role, rate limiting on `/login`,
  and inbound STOP handling. Each becomes wrong the moment it is built.
- **The two unrun milestone gates** (`#36`, `#65`).
- **Pinned versions** — cratestack, the authkestra family, the MSRV.
- **Multi-country stage 1's four explicit gaps** (#356–#359).

## Unreleased — AWS End User Messaging SMS (`aws_sms`)

Verified against vsms
[`f2662c7d`](https://github.com/vaam-apps/vsms/commit/f2662c7d) (2026-10-21), the
squash-merge commit of vaam-apps/vsms#435.

**Also folded in, because the gate checks the whole tree:** vaam-apps/vsms#434
(only an owner may grant, remove or deactivate `owner`) merged to vsms `main`
first and added `sms-api/src/owner_grant.md` with no skill covering it.
`vsms-auth` gains a section on its two halves (the `User` policy, and the
request-body guard on `POST /users` / `PATCH /users/{id}`) and claims
`owner_grant.rs`, `owner_grant.md` and `role_escalation_live_postgres.rs`.

**New skill:** `vsms-aws-sms` — twenty-two skills now. It covers why this is End
User Messaging and not SNS `Publish`, the worker-sends / gateway-receives split,
hand-written SigV4, the error and event mappings (including the final
`TEXT_SUCCESSFUL` → `Delivered` overstatement and the `isFinal` rule), how an
Amazon SNS callback is authenticated, configuration, AWS-only provisioning,
routing beside other rails, and what has never run live. The four new
`sms-provider-aws-sms/src/*.md` sidecars and `docs/runbooks/aws-sms.adoc` are
claimed by it, **each by its own path** — a directory claim on a crate that
arrived after the baseline covers none of its sidecars.

**Skills changed:** `vsms-providers` (the `authenticate_callback` hook),
`vsms-messaging` (DLR section), `vsms-api`, `vsms-worker`, `vsms-tooling`,
`vsms-ops`, `vsms-routing`, `vsms-multi-country`, `vsms-troubleshooting`, `vsms`
and `vsms-docs-skills` (the routing table). Only the AWS-related parts of those
were re-verified; the rest of each page was not re-read against `f2662c7d`.

**Claims that stopped being true** (each struck through and dated in the skill):

- ~~The worker's provider registry has exactly **one** entry (`orange_cm`).~~ Up
  to three — `orange_cm`, `mtn_cm`, `aws_sms` — each built from its own
  all-or-none flag group (`vsms-providers`, `vsms-worker`).
- ~~**No signature verification exists** for any provider.~~ `aws_sms`
  authenticates every callback through the new `SmsProvider::authenticate_callback`
  hook; `orange_cm` and `mtn_cm` still do not (`vsms-messaging`, `vsms-providers`).
- ~~`secret-env-args` covers five secret variables.~~ Six: `AWS_SMS_SECRET_ACCESS_KEY`
  is the sixth (`vsms-tooling`).
- ~~A new secret-bearing flag needs a sentinel in
  `help_never_prints_secret_env_values.rs`.~~ That test spawns only `sms-gateway`
  and sets four sentinels, so the worker's `MTN_CLIENT_SECRET` and
  `AWS_SMS_SECRET_ACCESS_KEY` — and the gateway's own `MTN_CLIENT_SECRET` — are
  guarded by the **static** check alone. This was never true of them; the page
  implied otherwise (`vsms-tooling`).
- ~~78 documentation sidecars~~ 82 (`vsms`).
- A late provider receipt no longer trips `SM001` for any provider: ingestion
  proposes a transition only when it is a legal edge from the message's current
  state, so a `delivered` arriving after `expired` is recorded and changes nothing
  (`vsms-messaging`).
- ~~An SNS `SubscriptionConfirmation` is confirmed automatically by the gateway.~~
  It is never visited: the gateway logs the `aws sns confirm-subscription` command
  and a human runs it with `--authenticate-on-unsubscribe true`. vsms's own
  `AGENTS.md` section on this provider still said otherwise when this was written
  (`vsms-aws-sms`).

**Added, for the first time:** `sms-gateway bootstrap --skip-seed-dispatch` and the
AWS-only provisioning recipe (`vsms-ops`, `vsms-aws-sms`); `AWS_SMS_TIME_TO_LIVE_SECONDS`
(`vsms-aws-sms`, `vsms-ops`); the `403` / `503` / `200` response semantics of
`POST /dlr/{providerKey}` (`vsms-api`, `vsms-messaging`).

**Found while writing it, and fixed in vsms before merge:** the gateway's default
log filter did not name `sms_provider_aws_sms`, so the subscription-confirmation
command and the adapter's two `error` lines would have been silently dropped —
the same trap `sms_auth` fell into on 2026-10-19. Probed against
`tracing-subscriber` with the exact filter string; the target is now in all four
default strings (binary, compose, `.env.example`, Helm).

**Left alone, still stale from earlier work:** `vsms-mtn` still says MTN is "not
wired up", that the registry has one entry, and describes the invented
aggregator placeholder that the MADAPI rewrite replaced; `vsms-orange-cm` still
describes `receiptRequest.callbackData` as load-bearing for DLR correlation,
which the Orange DLR rewrite removed. Neither is touched by this change.

**Not covered:** nothing has run against a live AWS account, and neither have
these pages.

## Unreleased — Keycloak single sign-on for the admin console

Verified against vsms
[`7dfad661`](https://github.com/vaam-apps/vsms/commit/7dfad661a828b63485b7e46bb056576c97e38d50)
(2026-10-20), the squash merge of vaam-apps/vsms#429 into `main`. The pages were
first written against that PR's branch head `bba85b9c` and re-stamped to the
merge commit once it landed; the five commits in between (lint fixes, a random
test password, the refusal labels gathered into `Refusal::reason()`) change no
claim made here.

**Skills changed:** `vsms-auth` (the new `references/sso.md`), `vsms-data-layer`,
`vsms-troubleshooting` (the new `references/sso-and-keycloak.md`), `vsms-console`,
`vsms-ops`, `vsms-api`, `vsms-testing`, `vsms-tooling`, `vsms-sdks` and `vsms`.
The new runbook `docs/runbooks/sso.adoc`, the two `sso.md` sidecars and
`sms-fake-oidc`'s `lib.md` are now claimed. Only the SSO-affected parts of those
skills were re-verified; the other skills keep the `0dbde02a` stamp.

**Claims that stopped being true** (each struck through and dated in the skill):

- ~~Human login is local Argon2id **rather than** federation, because federation
  needs an IdP nobody has chosen and nothing to prove it against.~~ Federation
  was built as a **second path**; passwords stay as the break-glass path
  (`vsms-auth`).
- ~~Regenerate `0001_init` wholesale on every schema change.~~ True only until a
  deployment applied it; `sms-migrate` records migrations by name. New models are
  forward migrations, and `cargo xtask migrations-current` no longer compares
  `0001_init` with the whole generator output (`vsms-data-layer`,
  `vsms-troubleshooting`, `vsms-tooling`, `vsms`).
- ~~Three migrations.~~ Five — this was already wrong after `0004`, which the
  page did not mention.
- ~~23 models~~ 25 as of 2026-10-19 (`FederatedLink`, `SsoTransaction`); ~~75
  documentation sidecars~~ 78.
- The gateway's default log filter now includes `sms_auth`; before, the broker's
  discovery and client-secret errors would have been dropped (`vsms-ops`,
  `vsms-troubleshooting`).

**Added, for the first time:** the Keycloak traps measured against 26.6.1 — `acr`
proves nothing, `amr` is empty until the browser flow's executions carry a
`default.reference.value`, the one `prompt=login` retry — in
`vsms-troubleshooting`; the Helm/compose/Caddy settings in `vsms-ops`; the fake
IdP and its limits in `vsms-testing`.

**Not covered:** the by-hand real-Keycloak run is a one-time measurement
(2026-10-19), not something CI repeats; `deploy/Caddyfile`'s `sso_per_ip` zone
was never exercised.

## v2026-09-18 — the docs → skills direction pointed at a structure that never existed

`docs/flows/` was never real (see the correction above, in the initial-release
entry it corrects). Every run of `verify.yml` since this repository's first
push had failed for that reason alone — not a flake, not a drift issue, a gate
that could not pass by construction.

**The docs → skills direction of `tools/verify-coverage.mjs` now walks vsms's
real documentation surfaces instead**: the `.md` sidecars vsms keeps next to
Rust source under `backends/**/src/` (75 of them, pulled in with
`#![doc = include_str!(...)]` — the same convention vsms's own
`.xtask/src/docs_drift.rs` already names), plus `docs/runbooks/*.adoc`,
`docs/design/*.md`, and `docs/legal/*.md`. `coverage.json` was rewritten to
match: the 37 fabricated `docs/flows/*` entries are gone, replaced by real
paths — `backends/apps/vsms-demo-seed` (which had no covering skill at all),
`backends/crates/sms-provider-mtn/src/token.md` (a real page that arrived
after this release's own baseline commit, inside an already-claimed crate —
exactly the "directory claim does not retroactively cover a later addition"
case `VERSIONING.md` describes), and the five `docs/design/*.md` pages that
had relied on a blanket `"docs/design"` directory claim doing nothing more
than making the gate pass regardless of content — three (`console-redesign.md`,
`better-auth-evaluation.md`, `frontend-package-audit.md`) moved to
`vsms-console`, and two (`gdpr-engineering-readiness-adr.md`,
`gdpr-engineering-readiness-rfc.md`) to `vsms-compliance`, matching
`references/skills-parity.md`'s own routing table. The equivalent blanket
`"docs/runbooks"` claim under the `vsms` skill was dropped for the same
reason — every runbook was, and still is, claimed individually by name.

**No skill's factual content was re-verified against a newer vsms as part of
this fix.** This release stays stamped `0dbde02a` (2026-09-15); only the
coverage mechanism, `coverage.json`'s map, `skills/vsms/SKILL.md` and
`skills/vsms-docs-skills/SKILL.md`'s instructions (both told agents to write
`docs/flows/<feature>.md`, which no agent could ever have done successfully),
and this file changed.

The gate was proven to actually fail, three separate ways, against a real
vsms checkout, before being trusted — see the PR that shipped this entry.

## v2026-09-24 — the `vaam-ui` copy was never pinned to a tag

**A claim that stopped being true — in fact, never was.**
`vsms-troubleshooting/references/console-and-node.md` said the `vaam-ui` agent
skill is a copy "at a named tag, tracked in `skills-lock.json`". The lockfile
records only the source, the skill's path and a content hash; no tag appears in
it. Which release the copy matches is recorded by hand in vsms's `AGENTS.md`
("Currently synced from …"), and that line read `v0.2.0` while the installed
package was `0.2.4` — the copy lagged the package for a release without the
lockfile being able to show it. Found while bumping vsms to `@vaam-apps/ui`
`0.3.0` ([vaam-apps/vsms#420](https://github.com/vaam-apps/vsms/pull/420)).

**Only that claim was re-verified**, against vsms
[`c8568575`](https://github.com/vaam-apps/vsms/commit/c8568575006cd6d195bcb6eab769b2d772d80fb7) (2026-09-23).
The skill stays stamped `0dbde02a` (2026-09-15): re-stamping it would claim the
whole skill had been checked against the newer tree, and it has not.
