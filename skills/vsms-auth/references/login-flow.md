# The human login flow, end to end

1. **`GET /login`** — middleware mints and encrypts a PKCE/state/nonce
   transaction into a short-lived cookie. It **must** happen in middleware:
   Next.js allows `cookies().set()` only in a Server Action, Route Handler or
   Middleware, never a plain Server Component render.
2. **The login page** — a plain `<form method="post">`, no client JS.
3. **`POST /api/auth/login`** — reads the txn cookie server-side and **never
   trusts the form** for `state` or `codeChallenge`. Calls the gateway's `POST
/login`. On success it redirects the **browser** to the returned URL — a
   genuine HTTP redirect, not a JSON response, so `state` is verified on a real
   callback.
4. **`GET /api/auth/callback`** — verifies `state` against the cookie, exchanges
   the code with the real `code_verifier`, and **verifies the `id_token`**:
   signature via the gateway's own JWKS, `iss`, `aud`, `exp`, and **`nonce`**.
   Then an encrypted session cookie.

Both cookies are `jose` JWE, `HttpOnly`, `Secure` in production, `SameSite=Lax`.

`frontends/apps/admin/lib/oidc.ts` is deliberately **Edge-and-Node-portable**
because `middleware.ts` runs on Edge and cannot opt into Node — if the two had
separate implementations they would silently drift.

## What the library gives you, and what it does not

`authkestra-op` supports `authorization_code` + PKCE fully: S256-only (it
rejects `plain`, and rejects a method with no challenge), exact `redirect_uri`
matching, and the matching verifier check at `/token`. All of it was already
exercised by the library's own tests before this deployment ran it.

What it does **not** give you: a login form, or any way to establish the
`Identity` that `handle_authorize` requires. That is the piece `POST /login`
supplies.

The in-memory authorization-code and refresh-token stores are the **right**
choice here, not a shortcut: one `serve` process, a code lives at most 60s, and
a lost refresh token on restart just forces a re-login.

## Provisioning

- `sms-gateway seed-console-client` registers the console's `OauthClient` with
  `tokenEndpointAuthMethod: none` — a public BFF client; PKCE is the protection,
  and no column could hold a shared secret anyway.
- `sms-gateway provision-user` creates a `User` + `UserCredential` and generates
  a random password, printed once. **There is deliberately no `--password`
  flag** — it would land in shell history and the process list, the exact
  exposure `--key-out` exists to avoid.
- **No migration seeds the six roles.** The first `owner` is bootstrapped by
  hand, the same bootstrapping problem the signing key has.

## Not wired up

- **Rate limiting on `/login` itself** — the class of gap already closed for
  `/token`.
- **`Session.role` is stamped `""`** — the `id_token` carries no role claim by
  design. Cosmetic; never a security boundary.
- **Scope widening is now refused at `/authorize`.** A requested scope not in
  `client.scopes` is a hard `invalid_scope`; an older library version copied it
  verbatim into the token. The console's seeded scopes and requested scopes match
  exactly today — the next person seeding a narrower or differently-cased string
  will get a refusal that is the new code working, not a bug.
