---
name: vsms-docs-skills
description: "Finishing a change in vsms — which document a change belongs to, when docs/roadmap.md actually needs editing and when saying so is a complete answer, the dated-claim and struck-through-correction conventions, and the docs-to-skills parity rule that binds this repository to vaam-apps/vsms-skills. Load when wrapping up any vsms change, writing a PR description, or adding a feature that needs a briefing."
---

# vsms-docs-skills

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The rule

> **Every feature lands in three places or it has not landed: the code, the
> docs, and the skills.**

A status page that lags is worse than none, because people trust it. A **skill**
that lags is worse still, because an agent does not merely trust it — it acts on
it, at machine speed, across every session that loads it.

## Where a change belongs

| You changed                                              | Update                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Behaviour a caller can observe                           | `docs/architecture.md`'s relevant numbered section, **in the same commit** |
| Why something is shaped the way it is                    | The module's `.md` sidecar, updated in the same commit                     |
| Something you found by running it, especially a surprise | `AGENTS.md`, in the section for that area                                  |
| A decision that was open                                 | `OPEN_QUESTIONS.md`, and the decision's own issue                          |
| The sequencing picture                                   | `docs/roadmap.md` — see below                                              |
| A feature, of any kind                                   | **A skill in `vaam-apps/vsms-skills`**                                     |

## `docs/roadmap.md`: check it always, edit it rarely

**The check is mandatory; the edit usually is not.** Most changes need nothing
there, and saying so in the PR is a complete answer.

Edit it when the change:

- **completes a milestone or passes its §12 gate** — the status column, and the
  snapshot date above it;
- **resolves, adds or reframes a blocker or decision**;
- **changes a dependency** — something blocked no longer is, or a new constraint
  appears. The mermaid graph's arrows are claims about what genuinely blocks
  what, not decoration;
- **lands infrastructure ahead of its milestone** — add it to "Already built,
  ahead of its milestone", which exists so the next person does not rebuild it.

**Do not update it merely because a story closed.** GitHub owns live status and
is always more current; turning the roadmap into a changelog recreates the drift
problem it was written to avoid. When you do touch the status column, move its
date to the day you **verified** it — against `gh`, not memory.

## The two prose conventions

**A version-sensitive claim carries the date it became true.** Not "the worker
has six roles" but "six roles as of 2026-09-15". A bare count silently expires.

**A corrected claim is struck through and dated, not overwritten:**

```markdown
~~The gateway fails on the first `/token` request.~~ **Corrected:** it fails at
process start — `serve` calls `load_signing_keys(...)?` before binding.
```

This is not sentimentality. It tells a reader which sentences have been looked
at recently, and what the plausible-but-wrong belief was — usually the one they
were about to form.

## The parity gate

`vaam-apps/vsms-skills` ships `node tools/verify-coverage.mjs <path-to-vsms>`,
run by that repository's CI against vsms's `main` daily and on every push. It
fails in **both** directions:

- **docs → skills**: a module `.md` sidecar, `docs/runbooks/*.adoc`,
  `docs/design/*.md` or `docs/legal/*.md` page no skill claims. Catches a
  feature shipping with no briefing.
- **skills → docs**: a path claimed in `coverage.json` that no longer exists in
  vsms. Catches a skill still describing something that moved or was deleted.

**Read what it actually proves.** Green means "every documentation page is
claimed by some skill and no skill cites a dead path". **It cannot read prose**,
so it does _not_ mean the claiming skill says anything true about that page.
Only a dated claim and a reader can do that.

**Open the `vsms-skills` PR alongside the vsms one and link them** rather than
leaving it to the daily cron. `references/skills-parity.md` has the routing
table: which skill a given change touches.

## Finishing

Say explicitly, in the PR and in your summary, **what you did not do**. State
unmet acceptance criteria plainly and strip auto-closing keywords so the tracker
stays honest. A closed issue that is not fixed is worse than an open one.
