---
name: vsms-auth
description: "Identity in vsms — machine callers over private_key_jwt against an embedded OIDC provider with no shared secret anywhere, human login by authorization_code plus PKCE with Argon2id passwords or, since 2026-10-19, brokered Keycloak single sign-on, the two RBAC layers and their two vocabularies, and the synthetic system principal that must never be reachable from HTTP. Load when touching sms-auth (including sms_auth::sso and sms-fake-oidc), GatewayAuth, /login/sso, an @@allow clause's role logic, provisioning, or anything that decides who may do what."
---

# vsms-auth

> **Verified against vsms `7dfad661` (2026-10-20).** Version-sensitive claims
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
surface, not a footnote. ~~Local Argon2id rather than federation, because
federation needs a second security-sensitive OIDC _client_ implementation and an
external IdP nobody has chosen, with nothing to prove it against end to end.~~
**Corrected 2026-10-19:** that was the reasoning at #194's time and all three
conditions have since changed. Federation was built afterwards **as a second
path beside** the password (next section), and local Argon2id stays as the
break-glass path.

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

## Federated sign-in (Keycloak SSO): a broker, since 2026-10-19

`sms-gateway` **stays the console's OpenID Provider** and becomes a relying
party of the staff Keycloak realm for the one step the OP could not do itself:
_who is this human?_ `GET /login/sso/start` and `GET /login/sso/callback`
(raw axum routes in `backends/apps/sms-gateway/src/sso.rs`, beside `login.rs`,
for the same reason: they run before any bearer token exists) answer it by
sending the browser to Keycloak, verifying what comes back, and handing the
**same** `Identity` to the **same, unmodified** `handle_authorize`. The console
and `GatewayAuth` never see an upstream token, so `authenticate_human`, the
per-request `User`/`Role` lookup and every `@@allow` are exactly what they
were. The broker is `backends/crates/sms-auth/src/sso/`; the test double is
`backends/crates/sms-fake-oidc`.

The decisions, each of which a plausible change would undo:

- **Identity is `(iss, sub)` in `FederatedLink`, never email**, and not
  `User.subject` (that column is vsms's own OP subject). A Keycloak user whose
  email a local account holds is refused (`email_in_use`), never merged.
- **Provisioning is just-in-time, gated by an exact group name.** The first
  sign-in of a user in `--sso-required-group` creates the `User` and its link
  in one serializable transaction. A JIT user has **no password**.
- **Roles stay local.** No claim — `role`, `roles`, `realm_access`, a group
  name — ever sets a role. A JIT user gets `--sso-jit-role` (default
  `support`; `system` and `app` refused at startup).
- **A second factor is required, by claim, and fails closed.** `acr` in
  `--sso-accepted-acr` **or** `amr` sharing a member with `--sso-accepted-amr`;
  both lists empty is a startup failure. Keycloak's `acr` cannot express it —
  the production rule is `amr = ["otp"]`, and `amr` is empty unless Keycloak is
  configured for it. Read `vsms-troubleshooting` before touching this.
- **One automatic retry.** When the group is fine and _only_ the MFA claim is
  missing, the callback starts one fresh upstream sign-in with `prompt=login`;
  a second miss is refused. Any other failure is refused at once.
- **Refusals are generic to the browser** (`access_denied`) and precise in the
  log (a fixed `reason` label, never a token or claim value).
- **No feature flag.** SSO is active exactly when its settings are present; a
  partial or invalid block refuses to start. A dead Keycloak never blocks boot
  or password sign-in (discovery is lazy and cached).
- **The console learns SSO exists from discovery:** the OP's discovery document
  carries `vsms_sso_login_endpoint` exactly when SSO is configured.

`references/sso.md` has the sequence and lifecycle diagrams, the order of the
token checks, the file that owns each step, and what is not built (no
back-channel logout, no `auth_time` check, no unlink/relink, one issuer).
Operator setup is `docs/runbooks/sso.adoc`.

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

### Only an owner hands out `owner` (2026-10-21)

`User`'s `create`/`update` `@@allow` admits `admin`, and on 2026-10-20 an admin
updated its **own** record to `roleKey = owner` in production (vaam-apps/vsms#434).
Closed in two halves, because the policy engine can see only one of them:

- **Schema half.** The admin disjunct is `hasRole('admin') && roleKey != 'owner'`.
  A `create` policy is evaluated against the _input_, so an admin cannot create an
  owner. An `update` policy compiles to `UPDATE … WHERE <policy>` on the _stored_
  row, so an admin cannot edit, demote or deactivate an existing owner. It
  **cannot see the new value**, so it cannot stop `admin -> owner` on its own.
- **Request half.** `sms_api::owner_grant::enforce_owner_grant_guard`, a middleware
  on `POST /users` and `PATCH /users/{id}`. For any caller whose role is not
  `owner` it decodes the body with the router's own codec into the generated
  `CreateUserInput`/`UpdateUserInput` and answers 403 when `roleKey` is `owner`.
  It fails closed: an undecodable body is 400, an unsupported `Content-Type` 415,
  an oversized one refused, never forwarded. An owner's request is not inspected.

`provisionUser` writes through the delegate under the caller's context, so the
schema half already refuses an admin provisioning an owner. **A new user-write
route must be added to `GUARDED_ROUTES`**; `every_generated_user_write_route_is_guarded`
fails the build until it is classified. Live suite:
`backends/crates/sms-api/tests/role_escalation_live_postgres.rs`.

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
