---
name: vsms-api
description: "The vsms wire contract — generated REST routes and procedures versus the hand-rolled axum ones, the Authorized witness that makes a direct procedure call skip every policy check, what @authorize's preflight does to NotFound, idempotency keyed on a verified principal, three rate limiters with three keys, and response shapes. Load when adding or changing a route or procedure, integrating against the gateway, or reasoning about what a caller actually receives."
---

# vsms-api

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

Most of the surface is **generated**: `include_server_schema!` expands
`schemas/vsms.cstack` into models, policies, audit, events and REST routes —
**133 routes as of 2026-09-15**. `just routes` prints them and needs no database.

## Three kinds of route

| Kind                | Example                                                                                                    | Notes                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Generated CRUD      | `GET /messages`, `PATCH /providers/{id}`                                                                   | `GatewayAuth` + row-level policy  |
| Generated procedure | `POST /$procs/sendMessage`                                                                                 | plus the procedure's own `@allow` |
| Hand-rolled axum    | `POST /dlr/{providerKey}`, `POST /login`, `/token`, `/jwks.json`, discovery, `GET /healthz`, `GET /readyz` | each for a stated reason          |

A route is hand-rolled only when the generated shape cannot express it — a
provider webhook carries no bearer token; the library's JWKS handler can publish
only one signing key; the discovery document had no hook to advertise
`private_key_jwt`.

## Calling a procedure from non-HTTP code

**Must go through `invoke_with_db`.** Every generated trait method takes an
unconstructible `Authorized` witness; before that existed, calling the trait
method directly compiled and **silently skipped every `@allow`/`@deny`/
`@authorize` check**.

```rust
proc_mod::invoke_with_db(&db, &args, &ctx,
    |authorized| registry.the_proc(&db, &ctx, args.clone(), authorized))
```

That witness landing exposed real fixture bugs that had been invisible: a test
helper hardcoding an empty `app_id` had never had its `appId == auth().appId`
clause evaluated at all.

## `@authorize` changes what a caller sees

`@authorize(Model, action, args.path)` runs
`SELECT 1 FROM <table> WHERE id = $1 AND <detail policy>` **before the body**.
That query cannot distinguish "no row" from "policy denies", so:

> **A nonexistent id can no longer produce `NotFound` for
> `replayWebhookAttempt` or `requeueJob`, ever, for any caller.** It is
> `Forbidden`. Permanent, verified behaviour.

It also means a **Layer 2 denial test pointed at a nonexistent id stops proving
anything** — Layer 1 denies first, and the message no longer names the missing
permission. Seed a real row the caller passes Layer 1 for.

## Two framework facts that bite

- **JSON `null` cannot clear a nullable field over a generated `PATCH`** — a
  verified no-op, indistinguishable from omitting the key. Fixed upstream; three
  columns still carry the empty-string sentinel workaround, safe **only** because
  nothing queries their NULL-ness.
- **A list route's policy denial is row-level filtering to an empty array, not a
  `403`.** `GET /oauth_signing_keys` under role `app` returns `[]`. This is the
  mechanism behind this repository's most-repeated bug.

## Response shapes differ by model

`@@paged` models return `{ items, totalCount, pageInfo }`. Everything else —
`Provider`, `Route` — returns a **bare JSON array**. Confirmed by reading the
generator, not inferred from the two examples already wired.

**Nullable columns serialise as explicit `null`, not an omitted key.** On the
TypeScript side that is a crash `tsc` cannot see; see `vsms-console`.

## Idempotency, and the fix that does not transfer

The `IdempotencyLayer` key must be a **verified** `sub`. Keyed on an unverified
one, a caller can forge someone else's `sub` and be handed **their** stored
response — because the layer both writes a stored response and reads one back.

**That fix does not transfer to rate limiting**, and the difference is worth
holding: a rate limiter only ever _consumes_ from a bucket, never writes a value
another request reads back, so the cheaper unverified read stays correct there.
Same-looking bug, different consequence.

`Message.idempotencyKey` is a separate, weaker, application-level dedupe — a
verbatim copy of `clientRef`.

**Nothing gives a provider a dedup key.** That gap is real and accepted; a crash
in the submit window produces two real submissions.

## Three rate limiters, three keys

| Where                | Key                                                       | Closes                              |
| -------------------- | --------------------------------------------------------- | ----------------------------------- |
| Caddy edge           | source IP                                                 | Flood protection                    |
| Gateway, on `/token` | **`client_id` from the request body**                     | The composite the edge cannot reach |
| Router, all routes   | `client_id_fingerprint` **and** `ConnectInfo<SocketAddr>` | A flood of forged `sub`s            |

`client_id` arrives **only** in the form-urlencoded body, and every way the edge
could read one field out of it was checked and rejected. The `/token` layer
buffers and **reconstructs** the body rather than consuming it — proven with a
round-trip test, because a handler receiving a drained body breaks every real
exchange, not just an attacker's.

Deliberately **not** `X-Forwarded-For`: the compose stack has **two** internal
callers of this router, and Compose assigns container IPs dynamically with no
static allowlist to pin a trusted hop against.

Both limiters set `StoreErrorPolicy::Deny` explicitly — the framework default
`Allow` is right for a _capacity_ control and wrong for a _security_ one. There
is **no keyspace bound** at the pinned version; adopting the upstream one needs
an explicit budget matched to these keys, not a bare bump.

## RBAC

See `vsms-auth`. The one thing to carry here: for `Job`, `Provider` read and
`Route` read, the `@@allow` deliberately admits `auth().kind == "app"` **unscoped**
— so Layer 2 is the **real perimeter**, not defence in depth. Treat a
`kind == "app"` clause on a model with no `appId` as that declaration.
