---
name: vsms-compliance
description: "Compliance mechanisms in vsms — class-gated consent and opt-out enforcement, the marketing quiet-hours window and why it refuses rather than defers, the 90-day retention purge and the peppered HMAC hashes that survive it, and the tamper-evident audit hash chain. Load when touching consent, suppression, hashing, retention, the audit trail, or anything where the honest limit of a control matters more than the control."
---

# vsms-compliance

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

## The asymmetry is the point

`otp` and `transactional` are **exempt** from consent, opt-out and quiet hours.
`marketing` and `notification` are not (quiet hours: `marketing` only). That is
what makes a mislabelled class consequential.

Both predicates are **exhaustive `match`, not `matches!` with a wildcard**, so a
fifth `MessageClass` fails to compile rather than silently defaulting either way.

## What the classification audit trail actually proves

`Message.class` carries `@@audit`, so every send writes an audit row in the same
transaction, capturing the declared class and the authenticated caller.

> It records **who declared what, when.** It does **not** prove the declaration
> was true.

Content classification from free text is not machine-verifiable the way a state
transition is. A caller willing to label marketing traffic `transactional`
bypasses every control here, and the trail records that **accurately, not
honestly**. Closing the real gap needs a manual compliance review reading that
trail — this system's actual answer today — or an independent classifier.

Read that before assuming a heading like "keep the audit trail proving the
classification" describes a solved problem.

## Consent is evidence; opt-out is enforcement

|            | `OptOut`                         | `ConsentRecord`                               |
| ---------- | -------------------------------- | --------------------------------------------- |
| Role       | Its presence **refuses a send**  | Append-only evidence with provenance          |
| Scope      | **Global** across the deployment | `appId`-scoped                                |
| Revocation | n/a                              | **A new `OptOut` row.** No `revokedAt` exists |

So "does this recipient currently receive X" never has two disagreeing sources
of truth. `ConsentRecord.scope` reuses `MessageClass` rather than a free-form
string, so a typo cannot drift from the class it meant.

Both match on **`msisdnHash`**, not plaintext — which is what keeps them working
after a purge, subject to the rotation caveat below.

Neither has an app-level self-service write path, and **there is no inbound STOP
handling**. An app's own signup backend recording consent the instant a user
opts in is the obvious future caller and does not exist.

> Opt-out enforcement once ran for **every** class — more restrictive than
> specified (an opted-out recipient could not receive an OTP either).
> Accidentally safe rather than a hole, but not what was asked for.

## Quiet hours

A `pub const` with a doc comment saying it is **self-imposed best practice**,
because no Cameroon-specific statutory rule was found. The next reader should see
a value to reconsider, not a rule to trust. **Deliberately not runtime
configurable**: this repository prefers a visible hard-coded decision to a
half-built configurability seam.

Enforced at **accept** time. A message held until morning would sit in `queued`
for up to twelve hours with no caller-visible signal; an accept-time refusal is
synchronous and actionable. The real cost: **there is no built-in "schedule this
campaign for the next window"** — `scheduledAt` exists for a caller to do it
themselves.

Still a fixed UTC+1 offset — see `vsms-multi-country`.

## Retention and hashing

`references/retention-and-hashing.md`. The three facts to carry:

- **`hmac-sha256-v1:` under a server pepper.** They were plain unkeyed SHA-256
  while the doc claimed otherwise — reversible in seconds over Cameroon's ~10^7
  numbering space, so a purge that kept `msisdnHash` **de-identified nothing**.
- **Rotating the pepper rehashes nothing**, and **opt-out matching against old
  rows silently stops working** the moment it rotates. Nothing detects it.
- **A purge must not re-fire a webhook.** Un-guarded it did — a live webhook
  about a message reported on three months earlier, carrying the placeholder
  MSISDN.

## Audit anchoring, and its honest limit

A plain, unkeyed SHA-256 **chain**: each daily anchor folds its period's audit
rows into a `rangeHash` and chains that onto the previous anchor's `chainHash`.

A bare periodic digest was rejected because without the link, deleting an entire
period's rows _and its own anchor_ leaves every remaining anchor internally
self-consistent. A keyed HMAC chain was rejected because a pepper is designed to
**rotate**, and a keyed chain would need every historical pepper kept forever or
every rotation would look like tampering.

| Attack                                                               | Caught?                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Editing a covered audit row                                          | Yes                                                         |
| Editing or deleting a past anchor                                    | Yes, **if a later anchor still references its `chainHash`** |
| Deleting the single most-recent anchor before anything references it | **No.** Nothing in this database catches it                 |

Closing that needs real external anchoring or an offsite copy. Named as
follow-up; **not** implied by the feature's title.

## Decision #5, resolved

**90-day minimisation, no split ledger** (2026-08-11). The parallel ten-year
traffic-metadata table was a real, considered option and is now a documented
alternative that was **not** taken. Long-horizon retention is an infrastructure
concern for whoever operates the deployment.
