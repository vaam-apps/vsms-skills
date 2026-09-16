# Build and toolchain

## "No rustls crypto provider is configured"

`aws-lc-rs` is absent from this graph entirely; `ring` is the only provider, and
`install_default()` is the **literal first line** of each binary's `main`.

**A test binary's entry point is the libtest harness, not that `main`**, so it
never runs there. Two live suites panicked with exactly this. The fix lives in
two places so it reaches every suite present and future:
`sms_test_support::database_url()` (every live suite calls it) and
`GatewayAuth::new` itself.

If a _new_ kind of binary hits this, install the provider in **its** entry
point; do not add a fourth ad-hoc call site.

## `cargo tree -i aws-lc-rs` is not the question you think

That command lists everything depending on the shared `rustls`, **not**
everything _asking for_ `aws-lc-rs` — Cargo unifies features, so one `rustls`
carries both providers' flags regardless of who requested which. Read
`cargo tree -e features -i rustls` instead, which shows the actual feature edges.

A misread of the first command produced a confidently wrong claim in this
repository's own notes.

## The three manifests `cargo check --workspace` cannot see

`sdks/rust/vsms-sdk-rust`, `examples/rust` and `ci/e2e-integration` are
workspace-`exclude`d so they can pin independently. **No workspace command
touches them.** A bump that left one behind shows green everywhere. Check each
by hand.

Two of them declare no `license` field, so `cargo deny check licenses` fails on
them with `error[unlicensed]`. Pre-existing.

## `cargo deny`

Four categories — advisories, bans, licenses, sources. **Running only
`advisories` and reporting "deny is clean" is a real mistake that has been made
here.** Ignores are scoped to a single advisory id, carry the reachability
analysis inline, and are **time-boxed**. A time box that fires and is never
re-checked is the same rot the gate exists to prevent.

## MSRV

`Cargo.toml` declares the floor; the Dockerfiles pin it exactly; CI's `rust` job
uses `stable`. Nothing enforces the floor in CI, so a lint added after the MSRV
passes in `just ci` and fails in CI — and vice versa.

A toolchain bump must sweep **every** Rust-building Dockerfile. The last one
missed two: a CI runner image on a sibling branch, and a `ARG` version default
two lines below the toolchain line in the same file.
