# Keycloak single sign-on: what it actually issues, and the refusals that look like bugs

Everything here was **measured**, against `quay.io/keycloak/keycloak:26.6.1` on
2026-10-19 (`start-dev`, a realm imported from JSON, the real gateway, a real
Postgres), not read from Keycloak's documentation. The mechanism is in
`vsms-auth` (`references/sso.md`); the operator's procedure and the full
refusal-label table are `docs/runbooks/sso.adoc`. A fake IdP
(`sms-fake-oidc`) is scripted to say what the authors believe Keycloak says, so
none of this was learned from CI.

## 1. `acr` proves nothing about a second factor

A password + OTP sign-in is issued `acr "1"`. A repeat sign-in completed from
Keycloak's SSO cookie is issued `acr "0"`. Neither says whether an OTP was used.
**Do not put `1` or `0` in `--sso-accepted-acr`**: that would accept a
password-only sign-in. A test pins `acr "1"` with `amr ["pwd"]` as refused.

## 2. `amr` is empty on the stock browser flow, even when the user used OTP

Even with the _Authentication Method Reference_ (`oidc-amr-mapper`) mapper on
the client. `amr` is populated only once the browser flow's **executions** carry
an authenticator configuration with a reference value:

```bash
kcadm.sh get authentication/flows/browser/executions -r <realm>
# note the ids of  auth-username-password-form  and  auth-otp-form
kcadm.sh create authentication/executions/<password-form-id>/config -r <realm> \
  -s alias=amr-pwd -s 'config."default.reference.value"=pwd'
kcadm.sh create authentication/executions/<otp-form-id>/config -r <realm> \
  -s alias=amr-otp -s 'config."default.reference.value"=otp'
```

Then `SMS_SSO_ACCEPTED_AMR=otp` and `SMS_SSO_ACCEPTED_ACR` empty. **Symptom of
skipping this:** every user is refused after exactly one retry, `reason =
mfa_not_satisfied`, however many OTPs they enter.

## 3. A repeat sign-in keeps `amr ["pwd"]`, and OTP enrolment is not a login

Keycloak enrols a new user's OTP through the `CONFIGURE_TOTP` **required
action**, not the OTP login form, so that first token has `amr ["pwd"]` — and so
does every later sign-in completed from the same SSO session. The gateway
absorbs this with **one** retry using `prompt=login` (new `state`, `nonce`, PKCE;
the same console request), after which Keycloak re-runs the forms and the token
carries `otp`.

- A user with no second factor at all is refused after **exactly two**
  authorization requests at Keycloak, never three. If a log shows three, the
  "at most one retry" rule is broken.
- Anything other than the MFA claim being the sole problem is refused **with no
  retry**: a user outside the group costs one authorization request.
- The retry is a **new** `SsoTransaction` marked `isRetry`; a retry that fails
  for any reason is final.

## 4. The groups mapper must have "Full group path" off

The group-membership mapper must be on the client's dedicated scope, claim name
`groups`, **Add to ID token on**. With the full path on, the claim holds
`/vsms-staff` and the exact-match gate (`--sso-required-group vsms-staff`) never
matches. **Symptom:** `not_in_required_group` for someone who is plainly in the
group — and the same label when the claim is missing altogether.

## 5. The issuer is compared byte for byte

`--sso-issuer` must equal the discovery document's `issuer` and every token's
`iss` exactly: no trailing-slash tolerance, no case folding. Keycloak builds the
issuer from its _frontend_ URL, so a differing hostname or a trailing slash
shows up as `issuer_mismatch` when it is a token's `iss`, and as an operational
`ERROR` (discovery's own `issuer` did not match, so nothing is fetched from it)
when it is the discovery document's.

## 6. Reading a refusal

The browser is told only `access_denied` (or `temporarily_unavailable`), so a
user cannot learn why. The log can — **if `sms_auth` is in the filter** (it was
not before 2026-10-19: the default was `sms_gateway=info,sms_api=info,cratestack=info`,
so discovery failures, issuer mismatches and a rejected client secret were
silently dropped; set `RUST_LOG`/`SMS_GATEWAY_LOG` on an older image).

A refusal is one `WARN` from `sms_gateway::sso` with a fixed `reason` and never a
token, code, secret or claim value. The ones that look like bugs:

| `reason`                | Usually                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `not_in_required_group` | The groups mapper (point 4), not the user's membership                                          |
| `mfa_not_satisfied`     | The retry's token still lacks the claim: the `amr` execution configs (point 2)                  |
| `issuer_mismatch`       | `--sso-issuer` differs from Keycloak's frontend URL (point 5)                                   |
| `email_missing`         | First sign-in, but no usable email: add the `email` scope or mapper                             |
| `email_in_use`          | A local account already holds that email. **Resolve it by hand — vsms will not merge by email** |
| `user_inactive`         | The linked account is deactivated or deleted — `Deactivate` is the revocation                   |
| `no_such_transaction`   | An unknown, replayed or expired `state` (five-minute life): a stale tab or a double-click       |
| `algorithm_not_allowed` | `none`, `HS*` or `EdDSA`: only RSA and ECDSA are accepted                                       |

`ERROR` lines (`SSO sign-in could not be evaluated`) mean Keycloak or the
database could not be used: discovery failed, the discovery `issuer` did not
match, the client secret was rejected, or Postgres errored. A rotated client
secret that was not updated in `SMS_SSO_CLIENT_SECRET` shows as
`error=temporarily_unavailable` with the token endpoint answering a failure
status; fix the secret and **restart the gateway**.

## 7. Things that are not bugs

- **The SSO button appears while Keycloak is down.** Discovery is lazy and
  cached for an hour, with a stale copy kept if a refresh fails; clicking it
  returns the user to `/login` with "Single sign-on is unavailable right now".
  Password sign-in is unaffected — that is the design.
- **Signing a user out of Keycloak does not end their vsms console session.**
  Back-channel logout is not built. Deactivating the `User` does (within the
  60-second principal cache); a console session lasts at most eight hours.
- **Changing someone's Keycloak email or name changes nothing in vsms.** Email
  and name are written once, at creation; identity is `(iss, sub)`.
- **An SSO user cannot sign in with a password.** They have no `UserCredential`.
- **A blank `SMS_SSO_*` in compose is not an error.** The gateway treats blank as
  unset; a _half_-filled block is the startup failure.
