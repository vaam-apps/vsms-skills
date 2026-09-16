# Contributing

A skill is judged on **whether an agent that read it does the right thing**, not
on whether it is complete.

## What a good skill looks like here

**Prefer the caveat over the tour.** An agent can read the code. What it cannot
recover from the code is the trap: that a policy denial is an empty array rather
than a `403`, that `if_match` is a runtime requirement the compiler cannot see,
that a `PoolConnection` leaks an advisory lock forever. Those sentences are the
product.

**Say what is not built, and name it.** vsms's own cardinal habit is refusing to
look more finished than it is. A skill that describes a mechanism without saying
the job that drives it does not exist is worse than no skill.

**Date anything that could go stale.** See [VERSIONING.md](VERSIONING.md).

**Correct, do not overwrite.** Strike the old claim through and date the
correction. The wrong belief is usually the one the reader was about to form.

**Quote the description.** The YAML frontmatter is parsed by a real YAML parser
in `npx skills add`, and an unquoted value containing `": "` is a nested mapping
— the installer **skips the skill outright**. The gate refuses that, but wrap it
anyway.

## The shape

```
skills/<name>/
  SKILL.md              # frontmatter, the version stamp, then the prose
  references/*.md       # detail pages, each LINKED from SKILL.md
```

- `name:` in the frontmatter **must equal the directory name** — that is what
  `--skill` resolves.
- `description:` is the **only** thing an agent reads when deciding whether to
  load the skill. Say what it covers **and** when to reach for it. Under 80
  characters fails the gate.
- Every `references/*.md` must be linked from `SKILL.md`, and every link must
  resolve. An unreferenced reference page is a page no agent will ever open.
- Keep `SKILL.md` readable in one sitting. Push detail into `references/`.

## The gate

```bash
node tools/verify-coverage.mjs /path/to/vsms
```

It fails in both directions, and it also checks frontmatter validity, the
description length, the version stamp, and reference linkage.

**Run it before opening a PR**, and run it against the vsms checkout you
actually verified against.

## Adding coverage for a new vsms feature

1. Read the feature — the code, its `.md` sidecar, and its `docs/flows/` page.
2. Fold it into the **owning** skill's prose. Resist adding a skill: twenty-one
   is already a lot to choose between, and a routing table that is too fine is a
   routing table nobody follows.
3. Add the flow page **and** the source paths to that skill's `covers` in
   `coverage.json`.
4. Re-stamp that skill with the vsms commit you verified against.
5. Run the gate.

**Adding a path to `covers` without writing the prose passes the gate and
defeats the point.** The gate checks the claim exists; you are the part that
checks it is true.

## Changing a claim

If vsms changed under a skill, the change here is not "edit the sentence". It is:

- correct the sentence, struck through and dated;
- re-stamp the skill;
- add a `CHANGELOG.md` entry **naming the claim that stopped being true**, which
  is the entry someone upgrading actually needs.

## Formatting

Prettier, 80 columns, `proseWrap: preserve`:

```bash
npx --yes prettier@3 --check "**/*.{md,json,yml}"
```

## Where the source of truth lives

**vsms, always.** When this repository and vsms disagree, vsms is right and this
repository has a bug. Fix it here, and check whether vsms's own `docs/flows/`
page carried the same wrong claim — twice now, a skill's error was a faithful
copy of a document that was already wrong.
