# Which skill a change touches

The routing table for the parity rule. A change to the left-hand area needs the
right-hand skill re-read, and usually edited.

| You changed                                                             | Skill                         |
| ----------------------------------------------------------------------- | ----------------------------- |
| `schemas/vsms.cstack`, `backends/migrations/**`                         | `vsms-data-layer`             |
| `sms-encoding`, `sms-msisdn`, the send path, `dlr.rs`                   | `vsms-messaging`              |
| `sms-provider`, `sms-provider-http`                                     | `vsms-providers`              |
| `sms-provider-orange-cm`, `sms-fake-orange`                             | `vsms-orange-cm`              |
| `sms-provider-mtn`                                                      | `vsms-mtn`                    |
| `sms-routing`, `worker/routing.rs`, `breaker.rs`, `grey_route_watch.rs` | `vsms-routing`                |
| `sms-worker` anywhere else                                              | `vsms-worker`                 |
| `sms-webhook`, `webhooks.rs`, `hooks.rs`, `drain.rs`, `reap_outbox.rs`  | `vsms-webhooks`               |
| `router.rs`, `rbac.rs`, procedures, the wire contract                   | `vsms-api`                    |
| `sms-auth`, `auth.rs`, `op.rs`, `login.rs`                              | `vsms-auth`                   |
| `frontends/**`                                                          | `vsms-console`                |
| `consent.rs`, `pepper.rs`, `audit_log.rs`, purge/anchor jobs            | `vsms-compliance`             |
| `deploy/**`, Dockerfiles, `sms-metrics`, compose                        | `vsms-ops`                    |
| `sms-test-support`, any `tests/` directory                              | `vsms-testing`                |
| `sdks/**`, `examples/**`, the generated client                          | `vsms-sdks`                   |
| Anything touching numbers, money, operators, quiet hours                | **also** `vsms-multi-country` |
| `justfile`, `.xtask/**`, `.github/workflows/**`                         | `vsms-tooling`                |
| A trap you only found by running it                                     | `vsms-troubleshooting`        |
| The rules, error modelling, style                                       | `vsms-conventions`            |
| Repository-wide orientation, or a new rule                              | `vsms`                        |

## What earns a claim in `coverage.json`

The gate checks the claim **exists**. A reviewer checks it is **true** — that
the skill's prose actually covers that path. Adding a path to `covers` without
writing the prose passes the gate and defeats the point.

## Adding a new feature

1. Write the code.
2. Write `docs/flows/<feature>.md` in the same PR.
3. Open a `vsms-skills` PR: fold the feature into the owning skill's prose, add
   the flow page and the source paths to that skill's `covers`, and stamp the
   skill with the vsms commit you verified against.
4. Link the two PRs.

If you skip step 3, the gate turns red on the next push or the next daily run —
which is the point. A red build is a better outcome than a confidently wrong
agent three weeks later.
