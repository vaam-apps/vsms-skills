# vsms-skills

Agent skills for [vsms](https://github.com/vaam-apps/vsms) — an A2P SMS gateway
for Cameroon, extensible to any country.

vsms is large and unusually opinionated. It has six engineering rules enforced
by eleven machine guards, a documentation tree with its own discipline, a
provider port that rails must be reached through, and one cardinal rule:
**a green test suite proves nothing about what it never ran.** An agent dropped
into that repository without context does not fail slowly — it fails by writing
something plausible, going green, and shipping a control that does not exist.

These skills are the context. Install the one that matches the work:

```bash
npx skills add https://github.com/vaam-apps/vsms-skills --skill vsms
```

Start with `vsms`. It is the orientation skill and it routes to the rest. Adding
more later is the same command with a different `--skill`; `--skill '*'` takes
all twenty-one.

## Upgrading

```bash
npx skills update                 # every installed skill, from every source
npx skills update vsms vsms-api   # just these
npx skills ls                     # what is installed, and from where
```

`update` (alias `upgrade`) re-fetches from the default branch and rewrites the
`computedHash` in `skills-lock.json`. **Commit that lockfile** — it, not the
install command, is what pins you: a project keeps the exact content it
installed until someone runs `update`. `npx skills experimental_install`
restores a checkout from the lockfile, which is what a fresh clone or a CI job
wants.

**Before you upgrade, read [CHANGELOG.md](CHANGELOG.md)** — specifically the
entries naming a claim that **stopped being true**, which is the thing that will
break an integration written against the old page.

**Do not upgrade blindly if you are pinned to an older vsms.** These skills
track vsms's `main`. Pulling the latest ones onto a six-week-old checkout is
exactly the case where a skill will confidently describe a route your tree does
not serve. [VERSIONING.md](VERSIONING.md) has the full policy; the short answer
is to check the tag whose vsms commit is nearest your own.

**Do not hand-edit an installed skill.** The lockfile hashes it, so a local edit
reads as drift rather than as an intended change — and the next `update`
silently overwrites it. Send a PR here instead.

## The skills

| Skill                                                  | Load it when                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`vsms`](skills/vsms/)                                 | Anything in the repo. Orientation, the six rules, the map to these others |
| [`vsms-conventions`](skills/vsms-conventions/)         | Writing Rust or TypeScript here — errors, doc sidecars, serde, lints      |
| [`vsms-tooling`](skills/vsms-tooling/)                 | Running anything — `just`, the xtask guards, `just ci`, pins, CI          |
| [`vsms-troubleshooting`](skills/vsms-troubleshooting/) | Something broke and the message is not the cause                          |
| [`vsms-docs-skills`](skills/vsms-docs-skills/)         | Finishing a change — flows, the roadmap, the parity rule                  |
| [`vsms-data-layer`](skills/vsms-data-layer/)           | The schema, migrations, row-level policy, CrateStack itself               |
| [`vsms-messaging`](skills/vsms-messaging/)             | Message states, the send path, encoding, numbers, DLRs                    |
| [`vsms-providers`](skills/vsms-providers/)             | The `SmsProvider` port, the error taxonomy, adding a rail                 |
| [`vsms-orange-cm`](skills/vsms-orange-cm/)             | Orange Cameroon specifics, and the fault-injecting fake                   |
| [`vsms-mtn`](skills/vsms-mtn/)                         | MTN via a licensed aggregator — and what is placeholder                   |
| [`vsms-routing`](skills/vsms-routing/)                 | Route selection, failover, circuit breakers, grey routes                  |
| [`vsms-worker`](skills/vsms-worker/)                   | Roles, leases, claim loops, dispatch, the job queue                       |
| [`vsms-webhooks`](skills/vsms-webhooks/)               | Events, the outbox, delivery, the signature scheme                        |
| [`vsms-api`](skills/vsms-api/)                         | The wire contract, procedures, idempotency, rate limiting                 |
| [`vsms-auth`](skills/vsms-auth/)                       | `private_key_jwt`, human login, the two RBAC layers                       |
| [`vsms-console`](skills/vsms-console/)                 | The admin console, R6, the gateway seam                                   |
| [`vsms-compliance`](skills/vsms-compliance/)           | Consent, quiet hours, opt-outs, retention, audit anchoring                |
| [`vsms-ops`](skills/vsms-ops/)                         | Images, compose, Helm, bootstrap, backup, metrics, alerts                 |
| [`vsms-testing`](skills/vsms-testing/)                 | Live-Postgres suites, the chaos suite, guard-failure proofs               |
| [`vsms-sdks`](skills/vsms-sdks/)                       | The Rust and Node SDKs and the generated TypeScript client                |
| [`vsms-multi-country`](skills/vsms-multi-country/)     | Numbers, money, operators or quiet hours in any country                   |

## Why a separate repository

Two reasons, and the second is the load-bearing one.

A skill is **installed, not cloned**. `npx skills add` fetches one directory
into `.agents/skills/` and pins its hash in `skills-lock.json`. That works for
any project that talks to vsms — an integrator using the Node SDK gets
`vsms-api` and `vsms-webhooks` without vendoring vsms's whole tree.

And skills must be able to **move at a different speed from the code**. A skill
is not documentation-of-record; it is a briefing, and a briefing that has to
clear vsms's whole CI gate to be corrected is a briefing nobody corrects.

The cost of that separation is drift, and drift is what the gate below exists to
refuse.

## The parity rule

> **Every feature lands in three places or it has not landed: the code, the
> docs, and the skills.**

vsms's own rule is that a document which lags is worse than none, because people
trust it. A skill that lags is worse still, because an agent does not merely
trust it — it **acts** on it, at machine speed, across every session that loads
it.

So this repository ships a gate, and it fails in **both** directions:

```bash
node tools/verify-coverage.mjs /path/to/vsms
```

- **docs → skills.** A page in `docs/flows/` that no skill claims fails the
  gate. That is the half that catches a feature shipping with no briefing.
- **skills → docs.** A path claimed in `coverage.json` that no longer exists in
  vsms fails the gate. That is the half that catches a skill still describing
  something that moved or was deleted.

A one-directional gate rots in the direction nobody looks.

`coverage.json` is the map. An entry earns its place by prose that actually
covers the path — **the gate checks the claim exists; a reviewer checks it is
true.** Green means "every feature page is claimed by some skill and no skill
cites a dead path". It cannot read prose, so it does **not** mean the claiming
skill says anything true about that page.

CI runs the gate against vsms's `main` daily and on every push, so a vsms merge
that outruns this repository shows up here as a red build rather than as a
confidently wrong agent three weeks later.

## Versioning — read this before you trust a skill

> **A skill is true of _a_ vsms, not of vsms.** A feature on `main` may be
> absent from the tree you are editing.

Every `SKILL.md` is stamped, under its title, with the vsms commit it was
verified against:

> **Verified against vsms `0dbde02a` (2026-09-15).**

That stamp is machine-enforced — the gate refuses a skill that carries none, or
one whose stamp is not the baseline or a descendant of it. And
`verify-coverage` reports how far the checkout you point it at has drifted.

Inside the prose, the mechanism is **dated claims**: "six roles as of
2026-09-15", never a bare count.

Full policy and how to write a version-sensitive claim:
[VERSIONING.md](VERSIONING.md). What changed between releases, including any
claim that **stopped** being true: [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: a skill is judged on
whether an agent that read it does the right thing, not on whether it is
complete. **Prefer the caveat over the tour**, and date anything that could go
stale.

## Licence

MIT, matching vsms.
