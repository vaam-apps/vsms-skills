# Errors, in detail

## The database mapping that must exist

`sms_api::errors::map_database_error`:

| SQLSTATE                         | Becomes                     | HTTP |
| -------------------------------- | --------------------------- | ---- |
| `SM001` (the transition trigger) | `CratestackError::Conflict` | 409  |
| `23505` (unique violation)       | a named conflict            | 409  |
| anything else                    | untouched                   | 500  |

Untranslated, an illegal transition is a `500 DATABASE_ERROR` — which callers
retry and operators read as a gateway fault. Genuine database faults stay 500
on purpose.

It also increments `sms_sm001_total{entity,from_state,to_state}`, with labels
parsed out of the trigger's own `RAISE EXCEPTION` text.

## Check `is_illegal_transition` on the _raw_ error, before mapping

Three call sites had a `Conflict` match arm whose comment claimed it meant "the
row moved on before this write landed". Nothing on those paths produced
`Conflict` without going through the mapper first, so the arm was dead code —
and naively mapping _before_ the match would have made a **genuine `SM001` fall
into that arm and be silently swallowed as a harmless race**, which is exactly
the failure mode the metric exists to make loud.

The order is: check `is_illegal_transition` (it reads `db_sqlstate()` directly,
no mapping needed), _then_ map the confirmed-illegal case and propagate it.

## The two ambiguous variants

- **`Forbidden`** — the update or delete policy denied, **or** the row is gone.
  Both produce zero rows. Log it; never fold it into a race branch. Swallowing
  it hides a policy regression as unexplained throughput loss.
- **`PreconditionFailed`** — the `if_match` version did not match, **or**
  `if_match` was never supplied at all on a `@version` model. The second is a
  _runtime_ error from a builder field that defaults to `None`, so the compiler
  cannot see it.

## `NotFound` may be unreachable

Since `@authorize`'s `SELECT 1 … AND <detail policy>` preflight, a nonexistent
id yields `Forbidden`, not `NotFound`, for `replayWebhookAttempt` and
`requeueJob` — the preflight cannot distinguish "no row" from "policy denies".
A test asserting `NotFound` for a bogus id is asserting the old behaviour.

## Why this is the reference example for distrusting green tests

`cratestack-sqlx` 0.5.0–0.5.2 discarded SQLSTATE and constraint on **every**
generated write. Every test of the mapping constructed the typed error by hand
— correct unit coverage of the mapping function, structurally incapable of
seeing the conversion feeding it. `cargo build` could not see it either; the
signature is `Result<T, CratestackError>` either way.

The fix was a live test through a real delegate call, **confirmed to fail
against the broken version and pass against the fixed one before being
trusted.** Never pin the cratestack family below 0.6.0.
