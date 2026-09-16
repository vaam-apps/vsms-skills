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

Landed alongside vsms's own `docs/flows/` — 36 feature pages, created in the
same change, which is what this repository's gate enumerates.

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
