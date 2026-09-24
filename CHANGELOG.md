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
