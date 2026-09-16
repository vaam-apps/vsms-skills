---
name: vsms-auth
description: "Identity in vsms — machine callers over private_key_jwt against an embedded OIDC provider with no shared secret anywhere, human login by authorization_code plus PKCE with Argon2id passwords, the two RBAC layers and their two vocabularies, and the synthetic system principal that must never be reachable from HTTP. Load when touching sms-auth, GatewayAuth, an @@allow clause's role logic, provisioning, or anything that decides who may do what."
---

# vsms-auth

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## Machine callers: `private_key_jwt`, no shared secret anywhere

`OauthClient` has **no `secretHash` column**. It has `tokenEndpointAuthMethod`
and `jwks`. The OP is `authkestra-op`, embedded in the gateway and pinned
exactly — the whole family moves in lockstep.

**Three schema facts that are load-bearing and easy to undo:**

- **`tokenEndpointAuthMethod` has no `@default`, on purpose.** A `@default`
  drops a field from the create input entirely, and a _missing_ method is how
  authkestra spells "accepts a secret from either transport, refuses assertions"
  — the one state `private_key_jwt` must never reach. A test turns its
  disappearance into a compile error.
- **`@sensitive` on `OauthSigningKey.privateKeyPem` is not confidentiality.** It
  redacts audit snapshots only. The `hasRole('system')` read policy is the
  **entire** control — anything minting `system` for an HTTP caller hands out the
  key that signs every token, through generated CRUD.
- **`ClientAssertion` is insert-only, `create` + catching `23505`.** `record_jti`
  must be atomic; a read-then-write is the TOCTOU race the table prevents.

`provisionAppClient` **generates the keypair server-side**, stores only the
public JWK, and returns `privateKeyPem` **exactly once**. `sms-gateway
provision-client` is the CLI form, writing with `O_EXCL` and `0600` — because
that procedure needs `owner`/`admin` and **no HTTP token in this deployment can
carry either**.

Two operational facts:

- **`serve` fails at process start if no active signing key exists** — it calls
  `load_signing_keys(...)?` before binding the listener. Anything that waits for
  health before rotating a key deadlocks permanently; use `run --rm`, never
  `exec`.
- **`aud` is not validated for machine tokens** (`aud == sub == client_id`, so
  there is nothing fixed to check). Note that leaving `set_audience` uncalled
  does **not** skip validation the way it does inside authkestra's own strategy
  construction — the explicit `validate_aud = false` is deliberate, and the human
  path does its own audience check manually.

## Human login

**This system stores password hashes**, which it did not before — new security
surface, not a footnote. Local Argon2id rather than federation, because
federation needs a second security-sensitive OIDC _client_ implementation and an
external IdP nobody has chosen, with nothing to prove it against end to end.

**`UserCredential` is a separate model, and it had to be.** §2.0: _no
field-level read masking; model-level access only._ A hash on `User` would come
back verbatim from `GET /users/{id}` to every role `User.read` admits. It is
`hasRole('system')` on **every** action.

`authenticate_user` always runs a real Argon2 verify — against a lazily-computed
dummy hash when no active account matches — so "wrong password" and "no such
account" cost the same and return the identical error.

`authorization_code` + PKCE, **S256 only**. `POST /login` on the gateway
collapses "authenticate the human" and "run the real `handle_authorize`" into one
call; `GET /authorize` is never mounted, because the console is the only OIDC
client this deployment will ever have.

**Role and permissions are resolved per request, not baked into the token** —
the library's user-token path cannot stamp extra claims, and forking it would
mean re-implementing PKCE and redirect-URI validation alongside. A 60-second-TTL
cached `User`/`Role` lookup instead. That is **more** responsive than baking
them in, not a consolation: a deactivation takes effect within one TTL.

`references/login-flow.md` has the full browser flow and what is **not** wired
up.

## RBAC: two layers, two vocabularies

**Layer 1** is `@@allow` on the model, deny by default. **Its failure mode is
silence** — a denied list is filtering to an empty array.

**Layer 2** is `require_permission(ctx, "sms:send")`, checking `perms` (human) or
`scope` (service account) — the same literal satisfies either — and failing
closed on anything missing.

Layer 2 is **the real perimeter, not defence in depth**, wherever the `@@allow`
admits `auth().kind == "app"` _unscoped_: `Job`, `Provider` read, `Route` read.
For `Provider.update` or `sendMessage` it is redundant _today_, because Layer 1
already excludes every issuable token.

Roles: `owner`, `admin`, `operator`, `developer`, `auditor`, `support`, and
`system`. Scopes: `sms:send`, `sms:read`, `webhook:manage`, `optout:read`,
`job:read`, `job:enqueue`, `worker:read`, `dashboard:read` — reused verbatim from
`operator`'s permissions rather than invented separately.

> The seeded role permissions used `message:read`/`message:send` while the check
> reads `sms:read`/`sms:send`, and **no role carried `dashboard:read` at all**.
> Both were silent until a human token first reached the API. **A permission
> literal that nothing checks is worse than none**, because it implies a control
> that does not exist.

## The `system` principal

Synthetic, constructed **only** inside a process, by exactly one function:
`sms_api::auth::system_context(sub)` — `kind: App`, `role: "system"`,
`app_id: ""`. Nine hand-rolled copies were consolidated into it; `sub` is
preserved per call site because it lands verbatim in `cratestack_audit.actor.sub`
and names which subsystem acted.

`hasRole` looks at `role`, **never** at `kind`.

**A `Role` keyed literally `"system"` would escalate any human assigned to it.**
`Role.key`'s regex cannot exclude specific literals and `@db_enforce` is a silent
no-op on `@regex`. Closed **two independent ways**, deliberately — a point-of-use
refusal in `load_human_principal`, and a database `CHECK (key NOT IN ('system',
'app'))`. Both proven to fail before being trusted. This is the one invariant in
this system worth defence in depth.

**Note the test gap:** thirty-six test files hand-roll their own
`role: "system"` fixtures, and none of them would notice a corrupted
`system_context`. A green live suite is not proof of that function.
