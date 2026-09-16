---
name: vsms-sdks
description: "The vsms client surfaces — the Rust and Node SDKs, the generated TypeScript client, the parity gates that keep their hand-curated parts honest, why an exact = pin is wrong in a published library, and the three workspace-excluded manifests no cargo workspace command can see. Load when changing an SDK, an example, the generated client, or a dependency pin that any of them shares."
---

# vsms-sdks

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

|                     | Where                                       | Published as                                          |
| ------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Rust SDK            | `sdks/rust/vsms-sdk-rust`                   | `vsms-sdk-rust` on crates.io                          |
| Node SDK            | `sdks/node/vsms-sdk-node`                   | `@vymalo/vsms-node` on npm                            |
| Generated TS client | `frontends/packages/sms-client`             | not published; generated, gitignored except two files |
| Examples            | `examples/rust/sms-send`, `examples/node/*` | not published                                         |

**The npm scope and the crate name do not track the GitHub owner.** The owner has
moved twice; neither package name moved with it.

## An exact `=` pin is right for a binary and wrong for a published library

Cargo resolves **one version per semver-compatible line for the entire graph**,
so an `=` requirement inside a published library is not a statement about that
library — it is a **veto over every other crate in the consumer's graph**, for
code the SDK will never see.

Reproduced against the real registry: a consumer wanting `cratestack-client
=0.11.1` alongside this SDK got `all possible versions conflict`, and **downgraded
its whole pin to adopt the SDK**. An application binds only itself, because
`Cargo.lock` is where it records an exact version; a published library has no
lockfile once published.

The SDK uses `~0.11.0`. `cargo xtask cratestack-pin-check` enforces the required
**operator** per manifest, not just the version.

> **Before copying a dependency line from the root `Cargo.toml` into a crate,
> check whether that crate has `publish = true`.**

## The three manifests no workspace command touches

`sdks/rust/vsms-sdk-rust`, `examples/rust` and `ci/e2e-integration` are
workspace-`exclude`d so they can pin independently — which also means **`cargo
check --workspace` never reaches them**. A bump that left one behind, or broke it
outright, shows green everywhere in CI. Check each by hand:

```bash
cargo check --manifest-path <m> --all-targets
cargo clippy --manifest-path <m> --all-targets -- -D warnings
cargo test --manifest-path <m>
cargo deny --manifest-path <m> check
```

Two declare **no `license` field**, so `cargo deny check licenses` fails on them
with `error[unlicensed]`. Pre-existing — a `license` decision has to come before
any CI gate over those manifests.

## Parity gates

- **`cargo xtask sdk-schema-check`** — the Rust SDK's vendored `schema.cstack`
  must match `schemas/vsms.cstack` byte-for-byte. Forgetting to re-vendor has
  turned CI red before.
- **`cargo xtask node-sdk-types-check`** — the Node SDK hand-curates four enum
  unions out of the schema, and nothing else checked that copy. The package is
  **published**, so a drift ships to integrators. Proven in **both** directions
  before being trusted.
- **`just client-check`** — every call the generated TS client makes must match a
  route the pinned gateway actually serves (133 as of 2026-09-15).

## A doc claim in the SDK that is wrong

`VsmsClient::private_key_jwt(base_url, config)`'s doc says `base_url` backs both
the `/token` endpoint and the REST API. **It does not** — the token endpoint is
derived exclusively from `config.issuer`. Confirmed with a real `401
invalid_client`.

The practical consequence: `ci/e2e-integration` cannot run as a bare host process
against a compose stack, because the gateway's configured issuer must be the
internal DNS name for the console's server-side calls to work at all. It runs as
a container joined to the same network instead, where the address it connects to
and the gateway's own identity are the same string.

## The generated TS client is not imported at runtime

`@vsms/gateway` is a deliberate, temporary hand-rolled seam. That is also why
`Decimal` money fields are still plain strings there, and why the upstream change
making them real `decimal.js` objects had **no live consumer to break** — a
regenerated `package.json` gained the dependency and nothing else did.

Regenerate with `just client-gen`. It must leave the two tracked files
byte-identical; a flag exists specifically to keep a generator option from
rewriting them.

## `examples/*` is outside the pnpm workspace on purpose

So an integrator can copy a directory out and run it standalone. Consequences: a
root `pnpm install` never installs it, `pnpm turbo run test` never reaches it,
and `pnpm install` inside it without `--ignore-workspace` writes **no lockfile**
while appearing to succeed. Each carries its own committed lockfile and CI
installs `--ignore-workspace --frozen-lockfile`.

That gap silently un-gated a cross-language signature proof for a long time.
