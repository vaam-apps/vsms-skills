# Versioning

> **A skill is true of a vsms, not of vsms.**

This is the failure mode this page exists to prevent:

> An agent loads `vsms-messaging`, reads that `parse_mobile` accepts
> `FixedLineOrMobile`, and writes an integration that sends to a North American
> number. The claim is true of vsms's `main`. The integrator is pinned to a
> commit from before the multi-country change, where that number is rejected.
> Nothing in the skill said when it became true, so nothing warned anyone.

The inverse is just as bad and harder to spot: a skill that still describes
something the current vsms has removed, which an agent then faithfully
reproduces.

## What a vsms "version" actually is

vsms **does** tag releases — for its container images and its two published
SDKs. But a skill describes the **tree**, not a release, and the tree moves
between tags. A skill correct at `v0.3.1` can be wrong three merges later
without any version number changing.

So the identity a skill carries is **a commit and a date**. That is not a
workaround; it is why vsms's own documents are written the way they are, in
dated sentences like "six roles as of 2026-09-15" and "this said X until Y and
was wrong".

**Follow that convention here.** It is the whole mechanism.

## The three rules

### 1. Every `SKILL.md` names the vsms it was verified against

Directly under the title:

```markdown
> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true. On an older or newer vsms, trust the
> repository over this page.
```

`coverage.json`'s `baseline` block carries the same ref in machine-readable
form, and `tools/verify-coverage.mjs` prints how far the checkout you gave it
has drifted.

**A stamp may be newer than the baseline; it may never be older or unrelated.**
Re-verifying one skill against a later vsms and stamping just that one is
correct and expected — the gate checks only that the stamped commit _contains_
the baseline. Requiring all twenty-one stamps to move together would make a
one-skill correction cost a full re-verification pass, which is how you get
twenty-one rubber-stamps.

The baseline also governs coverage. A claim on a **directory** covers the pages
that existed when the claim was made; a page added under a claimed directory
_since_ the baseline fails the gate by name, because inheriting the parent's
claim would hide exactly the case the gate exists to catch.

### 2. A version-sensitive claim carries the date it became true

Not "the worker has six roles" but "**six roles as of 2026-09-15**".

A claim is version-sensitive if a reader on a six-week-old checkout would be
misled by it. In practice that is most claims about:

| Kind of claim       | Write it as                                               |
| ------------------- | --------------------------------------------------------- |
| A route exists      | "routed since `<date>` (`#<PR>`)"                         |
| A guard exists      | "the eleventh guard, from `<date>`" — counts change often |
| A stub was replaced | "returned a milestone error until `<date>`, real since"   |
| A thing was deleted | "deleted `<date>`; nothing may import it"                 |
| A pin was bumped    | "`1.98.0` — it was `1.95.0` until `<date>`"               |
| A count of anything | "N as of `<date>`", never a bare N                        |

The cost of the date is six characters. The cost of omitting it is an agent
confidently generating code against a surface that does not exist on the tree it
is editing.

### 3. Say what it was before

When you correct a skill because vsms changed, **strike the old claim through
and date the correction** rather than overwriting it:

```markdown
~~The gateway fails on the first `/token` request if no signing key exists.~~
**Corrected 2026-08-08:** it fails at process start — `serve` calls
`load_signing_keys(...)?` before binding the listener, so anything that waits
for health before rotating a key deadlocks permanently.
```

This is vsms's own house style and it is not sentimentality. It tells a reader
two things they cannot get any other way: which sentences on the page have been
looked at recently, and what the plausible-but-wrong belief was — usually the
one they were about to form.

## Releases

This repository tags a release whenever a batch of skills is re-verified against
a newer vsms. A tag names the **date of verification and the vsms commit it was
verified against**:

```text
v2026-09-16-0dbde02a
```

`CHANGELOG.md` records, per release: the vsms range covered, which skills
changed, and — most importantly — **any claim that stopped being true**, so
someone upgrading can find the thing that will break them.

## Installing, upgrading, and what actually pins you

```bash
npx skills add https://github.com/vaam-apps/vsms-skills --skill vsms
npx skills update                 # re-fetch every installed skill
npx skills update vsms vsms-api   # just these
npx skills ls                     # what is installed, and from where
npx skills experimental_install   # restore a checkout from skills-lock.json
```

**`add` and `update` both fetch the default branch.** There is no `--ref` or
`--tag` on either, so a tag in this repository is a _human_ reference point —
something to read `CHANGELOG.md` against — not something the installer can
resolve.

**What pins you is the lockfile, not the command.** `skills-lock.json` records a
`computedHash` of the exact content installed, and a project keeps that content
until someone runs `update`. So:

- **Commit `skills-lock.json`.** It is the only record of which briefing your
  agents are actually running.
- **`experimental_install` is the reproducible path** — a fresh clone or a CI job
  restores exactly what the lockfile names.
- **Do not hand-edit an installed skill.** The hash makes a local edit read as
  drift, and the next `update` silently overwrites it.

### Upgrading deliberately

`update` is a re-fetch, not a merge: it takes whatever `main` says now. Three
things to do before running it, in descending order of how much they matter:

1. **Read `CHANGELOG.md` between your lockfile's release and now**, specifically
   the entries naming a claim that **stopped being true**. A new claim is
   additive; a retired one is what breaks an integration written against the old
   page.
2. **Check how far your vsms has drifted.** Run the gate against your own
   checkout — it reports the distance from the baseline in commits and dates:

   ```text
   baseline: these skills were verified against vsms 0dbde02a (2026-09-15);
   this checkout is 9a3d5732 (2026-08-02) — 0 commit(s) newer,
   61 commit(s) it does not have.
   ```

   Run against an **older** vsms the gate will legitimately fail on paths that do
   not exist there yet. That is not a bug; it is the tool telling you these skills
   are newer than your tree.

3. **If you are pinned to an old vsms, do not silently take the latest skills.**
   That is precisely the case where a skill will confidently describe a route
   your tree does not serve. Check the tag whose vsms commit is nearest your own
   and read forward from there.

### Downgrading

There is no `--ref`, so the honest answer is: check out the tag of this
repository whose vsms commit is nearest yours, and `npx skills add` from that
local path. Rare enough that it has not been made a first-class flow — if you
find yourself doing it often, the real fix is re-verifying a batch of skills
against your vsms and tagging that.

## What the gate can and cannot tell you

`tools/verify-coverage.mjs` checks that every vsms documentation page — a
module's `.md` sidecar, a `docs/runbooks/*.adoc`, a `docs/design/*.md`, or a
`docs/legal/*.md` — is claimed and
that every claimed path exists in the checkout you point it at. Run against an
**older** vsms it will legitimately fail on paths that do not exist yet — that is
not a bug, it is the tool telling you these skills are newer than that tree.

**It cannot read prose.** It cannot tell you that a sentence about a route is
true. Only a dated claim and a reader can do that.
