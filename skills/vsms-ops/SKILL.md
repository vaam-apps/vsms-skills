---
name: vsms-ops
description: "Running vsms in production — distroless musl images with no shell and exec-form health checks, the migrate binary, bootstrap and the console-optional seeding chain, compose and the Helm umbrella chart, backup and restore, and the five Prometheus metrics with their absent-versus-zero design. Load when deploying, changing a Dockerfile or compose file, adding a metric or alert, or diagnosing a container that will not come up."
---

# vsms-ops

> **Verified against vsms `32a6be37` (2026-10-21).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The images

`rust:1.98-alpine3.22` (musl-native — Alpine's libc _is_ musl, so a plain
`cargo build --release` produces a static binary: no cross-compilation, no
`rustup target add`, no cross-linker) into
`gcr.io/distroless/static-debian12:nonroot`.

Verified by inspecting the distroless layers directly, not assumed from
documentation: it ships current CA certificates, `/etc/passwd` and friends (so
`:nonroot`'s uid 65532 needs no `useradd` — there is no `useradd` binary to run
one with), and a `1777` `/tmp`, which the worker's heartbeat file depends on.

> **Neither runtime image has a shell, `curl`, or coreutils.** Every health check
> is an exec-form subcommand of the binary — `sms-gateway healthcheck`,
> `sms-worker healthcheck` — in the Dockerfile `HEALTHCHECK`, the compose
> override, and the Helm exec probes. Kubernetes `httpGet` probes needed no
> change: kubelet does that GET itself.

**`ring` is the only TLS provider**; `install_default()` is the literal first
line of each `main`. A test binary's entry point is the libtest harness, not
that `main` — see `vsms-troubleshooting`.

## Migrations at deploy time: applied, never generated

`backends/apps/sms-migrate` embeds the committed SQL via `include_str!` and
applies it under an advisory lock with a `schema_migrations` table. It is **not**
sqlx's `migrate!` framework — that needs a flat file layout this repository's
directory-per-migration shape does not match, and two bookkeeping tables would be
worse than one.

`build.rs` discovers migrations from disk, so a new one needs a directory and no
code change (five exist as of 2026-10-19; see `vsms-data-layer` for why the
fifth is a forward migration and not a regenerated `0001_init`). `up.pre.sql`, when present, runs **in the same transaction**
immediately before `up.sql` — a guarantee two separate `raw_sql` calls against a
bare connection would not give.

It uses a **dedicated, unpooled** connection, the same reasoning `lease.rs`
documents for advisory locks.

## Bootstrap

`sms-gateway bootstrap` chains `rotate-signing-key` → `seed-dispatch` →
`seed-console-client` → `provision-user`. It is a thin wrapper: each step's logic
is extracted and shared, so nothing exists twice.

- **Console-optional by construction (R4).** Without `--console-redirect-uri`,
  steps 3 and 4 print "skipped — backend-only deployment".
- **Key rotation skips if an active key exists**, so a re-bootstrap does not start
  the previous key's overlap clock early.
- **`seed-dispatch` seeds a `Provider` _and_ a catch-all `Route`.** Without the
  route, the deployment comes up healthy and rejects every message.
- **`bootstrap --skip-seed-dispatch` (since 2026-10-21) skips step 2.** Step 2 is
  hardcoded to `orange_cm`; in a deployment that will not send through Orange, a
  later `seed-dispatch` for another provider leaves **two identical catch-all
  routes** that the engine draws 50/50 between, and half of all traffic goes to a
  provider the worker has no adapter for. See the AWS section below and `vsms-aws-sms`.
- `create-app` writes the first production `App`, which no HTTP token can.

## Three things that were broken by construction

Expect this shape again:

- `provision-client --key-out secrets/…` wrote into a container `run --rm`
  discards — the service had no `volumes:` at all.
- **A bind mount whose host path does not exist is silently created as an empty
  _directory_** by the daemon, so a config-file mount produced a directory the
  tool could not read. Both are `configs:` now, which fail `up` outright naming
  the missing path.
- An env var reached the console but never the gateway, so overriding it broke
  every human login at `aud` validation.

Note also: **`configs.mode`/`uid`/`gid` are silently ignored outside swarm**
(confirmed live), so file ownership is a host-side fact. The compose stack has
explicit `chown`/`chmod` one-shots for that, gated behind a profile, with the
consumer depending on their completion so a plain `up -d` cannot race them.

## Compose and Helm

Three full-stack files, deliberately not merged: `compose.dev.yaml` (builds from
source), `compose.demo.yaml` (pulls published images), and the deployment stack.
Every image reference is owner-parameterised — **the GitHub owner has moved
twice, and old images keep their old owner**, so flip owner and tag _together_,
never a subset.

R5: **one umbrella chart** on `bjw-s` common ≥ v4, pinned, via a classic HTTP
repo dependency (no OCI reference for that library chart exists — verified
against the registry API, not assumed). Not a chart per service: everything
shares a database, a migration ordering and a secret set.

## Single sign-on settings (optional, since 2026-10-19)

Keycloak SSO for the console is **off unless `SMS_SSO_ISSUER` (compose) /
`sso.issuer` (Helm) is set**; there is no other switch. Operator setup is
`docs/runbooks/sso.adoc`, the gateway-side behaviour is `vsms-auth`. What is
specific to the deploy artefacts:

- **Helm:** a `sso:` values block (`issuer`, `clientId`, `scopes`,
  `requiredGroup`, `groupsClaim`, `acceptedAmr`, `acceptedAcr`, `jitRole`) plus
  `existingSecrets.sso` (secret name; key `SMS_SSO_CLIENT_SECRET`) for the
  client secret. **The callback is derived, not set:** `<oidcIssuer>/login/sso/callback`,
  so it cannot disagree with the public origin — and that is the one URI to
  register at Keycloak. Only the **gateway** controller gets any of it.
- **`templates/common.yaml` strips every SSO env var from the gateway when
  `sso.issuer` is empty** (including the `secretKeyRef`). A present-but-empty env
  var is a value to clap, not an absence — the MTN hazard again. With `issuer`
  set, a missing `clientId`, `requiredGroup` or secret name is a `required`
  error at render time.
- **Compose:** `deploy/docker-compose.yml` passes the ten `SMS_SSO_*` variables
  through, blank by default; the gateway normalises blank SSO values to unset
  itself, so that is safe (unlike MTN's). `deploy/.env.example` carries the block
  commented out.
- **`sms_auth` is in the gateway's default log filter** in the image, compose
  (`SMS_GATEWAY_LOG`) and Helm (`RUST_LOG`) — discovery failures, an issuer
  mismatch and a rejected client secret are logged by it. It was missing before
  2026-10-19 and those errors were silently dropped.
- **`deploy/Caddyfile` has a `sso_per_ip` zone** on `/login/sso/*` (30 events per
  minute by default; `RATE_LIMIT_SSO_PER_IP_EVENTS` / `_WINDOW`). **It has not
  been exercised:** the `rate_limit` module is not in the stock Caddy image and
  `deploy/caddy.Dockerfile` is still not wired into compose. Keycloak is in
  neither `compose.dev.yaml` nor `compose.demo.yaml`.

## AWS End User Messaging settings (since 2026-10-21)

Optional, and the deploy-artefact half of `vsms-aws-sms` (the runbook is
`docs/runbooks/aws-sms.adoc`). Two halves, two binaries, two different switches:

- **Worker (sends).** `AWS_SMS_REGION` is the switch. Region, access key id,
  secret access key, configuration set, TPS ceiling and cost per segment are
  **all-or-none** (a partial set stops the worker); origination identity, message
  type, alphanumeric flag, endpoint override and
  **`AWS_SMS_TIME_TO_LIVE_SECONDS`** (new, 5–259200, `900` for OTP) are optional.
- **Gateway (receives).** `AWS_SMS_EVENTS_TOPIC_ARN` is the switch and the **only**
  AWS variable the gateway reads — it needs no credentials.
- **Compose:** `deploy/docker-compose.yml` passes each variable through by bare
  `NAME:` (forwarded when set, absent when not — `${NAME:-}` would hand clap an
  empty string). `deploy/.env.example` carries the block **commented out, and says
  in capitals to leave it that way rather than blank**. The stack has **no
  `seed-dispatch` one-shot**; the compose file's comment gives the AWS command to
  run by hand.
- **Helm:** an `awsSms:` values block (`region`, `accessKeyId`, `configurationSet`,
  `tpsCeiling`, `costPerSegmentXaf` — quoted strings — plus the optional
  `originationIdentity`, `messageType`, `supportsAlphanumericSender`, `endpointUrl`,
  `timeToLiveSeconds`, and `eventsTopicArn`) and `existingSecrets.awsSms` (key
  `AWS_SMS_SECRET_ACCESS_KEY`). `templates/common.yaml` **strips every worker-side
  `AWS_SMS_*` variable (the `secretKeyRef` included) when `awsSms.region` is empty**,
  strips each optional one when its value is empty, and strips the gateway's when
  `eventsTopicArn` is empty — never rendering them empty. `timeToLiveSeconds` joined
  that list on 2026-10-21. With region set, a missing `accessKeyId`,
  `configurationSet`, `tpsCeiling`, `costPerSegmentXaf` or secret name is a
  `required` error at render time.
- **Provider seeding in Helm is two hooks, not `bootstrap`:** `seedDispatch`
  (Orange) is **switched off when `orange.clientId` is empty**, and
  `seedDispatchAws` is switched on when `awsSms.region` or `awsSms.eventsTopicArn`
  is set, its arguments assembled in `common.yaml`. An AWS-only values file leaves
  `orange.clientId` and `mtn.clientId` empty. The chart refuses to render with no
  provider at all (`orange.clientId`, `mtn.clientId`, `awsSms.region` or
  `awsSms.eventsTopicArn`). If AWS runs beside another provider, both hooks add a
  catch-all route at the same priority and weight, so traffic splits evenly until
  the routes are edited.
- **Keep `sms_provider_aws_sms` in any overridden gateway log filter.** It is in
  the default `SMS_GATEWAY_LOG` / Helm `RUST_LOG`; without it the
  subscription-confirmation command and two `error` lines never appear
  (`vsms-aws-sms`, Traps).
- **`AWS_SMS_SECRET_ACCESS_KEY` is a secret** in `cargo xtask secret-env-args`
  (`vsms-tooling`); the worker's `--help` hides its value.

## Backup

`deploy/backup-tool` — `backup`/`restore`/`restore-drill`/`schedule`.
`pg_dump`/`pg_restore`/`rclone` stay external processes; everything else is typed
Rust, including an in-process cron scheduler.

> A process that is PID 1 **in its own PID namespace** is kernel-exempted from a
> signal's default disposition unless it installs a handler — so an unhandled
> `SIGTERM` is silently ignored and `docker stop` hangs for the full grace
> period, every time.

The restore drill is a **real** drill: a network-isolated Postgres, a real
migration, table-by-table row counts, a marker row, and pepper-fingerprint
warn-not-block behaviour. It was proven by sabotage — making the restore step a
no-op failed the drill _earlier and louder_ than the row-count check was written
to catch it.

## Observability

`references/metrics-and-alerts.md`. The design fact worth carrying: **absent
versus zero is solved structurally.** A standby worker never reaches the code
that writes the dispatch or drain gauges, so they are genuinely _absent_ from its
`/metrics` — not present-and-zero. Only the lease gauge is written on every
outcome. The alert rules check both `sum(...) == 0` **and** `absent(...)`.

**`/metrics` is a second listener, never on the public router** — the edge proxy
has no path allowlist, so anything on that router is public the moment it exists.

**Alerting stops at the rules evaluating.** There is no Alertmanager and no
receiver: nothing in this tree can page anyone.
