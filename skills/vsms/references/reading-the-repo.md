# Reading this repository's documentation

vsms's documents have conventions that will mislead you if you do not know
them.

## `AGENTS.md` is a ledger, not a manual

It is ~578 KB and roughly chronological within sections. It records **what was
found**, including what was found to be wrong, because the wrong belief is
usually the one the next reader was about to form. So:

- A paragraph beginning "an earlier revision of this file claimed…" is a
  **correction**. The claim it describes is false. The correction is the fact.
- A section headed with a PR or issue number is the state **as of that change**.
  Later sections can supersede it. Read to the end of the topic, not to the end
  of the first section that mentions it.
- Version citations inside historical narrative are **historical**. A sentence
  citing `cratestack-core-0.7.10/src/error.rs` is evidence gathered at that
  version, not a claim about the current pin.

## Corrections are struck through, not overwritten

```markdown
~~`X` fails lazily on the first request.~~ **Corrected:** it fails at process
start — `serve` calls `load_signing_keys(...)?` before binding the listener.
```

This tells a reader two things nothing else can: which sentences have been
looked at recently, and what the plausible-but-wrong belief was. Follow it.

## A dated claim is the version mechanism

vsms tags releases for images and SDKs, but a skill or a doc describes the
_tree_, and the tree moves between tags. So a version-sensitive claim carries
the date it became true: not "the worker has six roles" but "six roles as of
2026-09-15". A bare count is a claim that silently expires.

## The `.md` sidecar convention

Most Rust modules keep their narrative in a sibling `.md` pulled in with
`#![doc = include_str!("lib.md")]`, with only short doc lines in the `.rs`. So
`backends/crates/sms-worker/src/claim.rs` is the code and `claim.md` is the
reasoning. **Read the sidecar before changing the module** — it usually
contains the "we tried the obvious thing and here is why it is wrong"
paragraph.

`cargo xtask docs-drift` checks that every path a document names resolves.
Sidecars under `src/` are exempt from its link check by design.

## Where each kind of answer lives

| Question                              | Look in                                   |
| ------------------------------------- | ----------------------------------------- |
| What does the system promise about X? | `docs/architecture.md`'s relevant section |
| Why is it shaped this way?            | The module's own `.md` sidecar            |
| What broke, and what did we learn?    | `AGENTS.md`                               |
| How do I operate it?                  | `docs/runbooks/*.adoc`                    |
| What is actually built?               | `docs/roadmap.md`, then GitHub            |
| What is still undecided?              | `OPEN_QUESTIONS.md`                       |

## The rule that binds them

> **Every feature lands in three places or it has not landed: the code, the
> docs, and the skills.**

See `vsms-docs-skills`.
