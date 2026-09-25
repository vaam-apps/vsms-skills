# The console and the Node side

## Two traps TypeScript's own compiler cannot see

**1. A nullable column serialises as an explicit JSON `null`, not an omitted
key.** Every type in `@vsms/gateway` used `field?: T | undefined`, which is
internally consistent and simply wrong about the wire. The consequences were
real, not theoretical: a `"matches anything"` route rendering as
`operator=null, class=null`, and a screen crashing outright with `Cannot read
properties of null (reading 'priority')` because a `!== undefined` guard let a
`null` through.

Normalised **once**, in `frontends/packages/gateway/src/json.ts`. The earlier
state was **fourteen near-identical per-module `normalize*` functions**, and two
modules had never been caught at all.

The recursion is safe because every field carrying pre-serialised JSON
(`WebhookAttempt.payload`, the audit snapshots, `Provider.config`) is declared a
plain `String` in the schema, so it arrives as an opaque string leaf the walk
never descends into. Check that before adding a structured column.

**2. JSON `null` cannot clear a nullable field over a generated `PATCH`.** A
verified no-op, indistinguishable from omitting the key — the generated
deserializer wraps each field in a plain `Option<T>` with no disambiguation.
Fixed upstream; three text columns in `senders.ts` still carry the
empty-string-means-clear workaround, which is safe **only** because nothing
queries or branches on their NULL-ness.

## R6 and what `cargo xtask r6` cannot see

It scans `frontends/apps/admin/app` only. It **cannot** see a `className` in
`frontends/apps/admin/components/**`, and it **cannot** see a dumb component
that fetches its own data. Both are review-only. It also never fails on
`useState`, because R6 permits ephemeral presentational state.

## `@vaam-apps/ui` is an external package

Changed in its own repository, consumed by version. Three things learned bumping
it, each of which passed every shape check:

- **An identical export surface is not identical behaviour.** A component's own
  _default prop value_ changed and shipped under a patch number; the console
  inherited it and lost a control at some viewport widths for a full release
  cycle, because nothing in the test suite renders at a real viewport width.
- **pnpm's 24-hour `minimumReleaseAge` quarantine blocks a fresh version as a
  hard failure**, and the exclusion entry cannot be swapped in one step: pnpm
  re-verifies the lockfile's existing entries _before_ resolving the new
  manifest, so both versions must be excused for the one install that moves the
  lockfile. Scope an exclusion to `pkg@version`, never to a bare package name.
- **A version bump can legitimately break a test that pins class strings.** Read
  that diff rather than silencing it; what it must never show is the _structure_
  changing.

~~The `vaam-ui` agent skill is a **copy** of the upstream repository's, at a
named tag, tracked in `skills-lock.json`.~~ **Corrected 2026-09-24** (checked
against vsms `c8568575`): it is a **copy** of upstream's `skills/vaam-ui/`,
tracked in `skills-lock.json` by source and content hash only. The lockfile
records no tag, so it cannot say which release the copy matches. vsms's own
`AGENTS.md` records that by hand ("Currently synced from `v0.2.0`" on that
commit, while the package itself was already `0.2.4`), and a bump re-copies the
skill and updates that line together. Do not hand-edit the copy — the lockfile
hashes it, so a local edit reads as drift.

## `examples/*` is outside the pnpm workspace on purpose

So an integrator can copy a directory out and run it standalone. Consequences:
a root `pnpm install` never installs it, `pnpm turbo run test` never reaches it,
and `pnpm install` inside it without `--ignore-workspace` writes **no lockfile**
while appearing to succeed.

That last one silently un-gated a cross-language signature proof: the Rust half
genuinely ran in CI, the TypeScript half had been hand-run once. **A
cross-language agreement proof that only one side checks is precisely the half
that drifts.**
