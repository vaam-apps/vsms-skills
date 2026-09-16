# CI specifics

## The four non-obvious path couplings

Each looks like an over-inclusion someone could tidy up. Each is commented at
the filter for that reason.

| A change to              | Also runs                          | Because                                                                                   |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `schemas/**`             | Rust **and** the TypeScript client | `include_server_schema!` generates the Rust; the client is generated from the same schema |
| `backends/migrations/**` | Rust                               | `sms-migrate`'s `build.rs` embeds every `up.sql` via `include_str!`                       |
| `docs/architecture.md`   | the migrations job                 | §2.10 is what `cargo xtask bootstrap-sql` generates `0002_bootstrap` from                 |
| `**/Cargo.toml`          | the JS job                         | `just client-check` regenerates the client with the CLI version read out of that file     |

`**/Cargo.toml` is also the safety net a positive list needs: a new crate in an
unlisted directory cannot exist without a manifest.

The `rules` job (the xtask guards) is **deliberately ungated** — it spans
backends, schemas, docs, frontends, sdks and the workflows themselves, and
finishes in about fifteen seconds.

## Concurrency

Both workflows carry a concurrency group keyed on `github.ref`, with opposite
cancellation behaviour.

**`ci.yml` cancels superseded runs — as an expression, not a bare `true`:**
`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. On `main` the
group key is identical for every merge, so cancelling there would let one merge
abort the run still verifying the merge before it, leaving a commit on `main`
whose only check reads "cancelled".

**`release.yml` never cancels**, because every job either publishes or gates
something that does, and a publish interrupted halfway is the one failure here
that cannot be re-run into a clean state.

**Keyed per ref, not globally**, and this is the load-bearing part: when a run
is pending on a busy group and a newer one joins, GitHub **cancels the older
pending run**. Under a global key a routine push to `main` can silently cancel
a queued tag release — and the symptom is a release that simply never happened,
with nothing failing to say so.

Two accepted residues, recorded at the group itself: three pushes to `main` in
quick succession drop the middle run while pending (so that commit gets no
`:sha-` image, correct enough for continuous delivery), and two _different_ tags
pushed close together still race for `:latest`. **Cut one release at a time.**

## Toolchain

`.github/workflows/ci.yml` uses `dtolnay/rust-toolchain@stable` — always latest,
not pinned — while `Cargo.toml` declares the MSRV floor and the Dockerfiles pin
it exactly. Nothing in CI enforces the floor; the declaration is correct, not
gated.

## Publishing

npm Trusted Publishing is configured on npmjs.com against an `owner/repo` plus a
workflow filename. **A GitHub owner rename breaks it**, and the symptom is a
masked `E404` from `publish-node-sdk`. The owner has moved twice; re-point that
entry _before_ pushing a tag.

`release.yml` refuses a tag whose version differs from the workspace, the Rust
SDK and the Node SDK manifests — nothing compared them before.
