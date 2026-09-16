---
name: vsms-multi-country
description: "Cameroon-first and extensible in vsms — what stage 1 of the multi-country work actually changed in sms-msisdn, the addressability correction that would otherwise have rejected every North American number, and the four things that are explicitly not done. Load before touching numbers, money, operators or quiet hours anywhere in vsms, or before assuming any market other than Cameroon works today."
---

# vsms-multi-country

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

vsms is **Cameroon-first and extensible to any country**. Cameroon is the
default region and the best-supported market; other countries are reached
through data and configuration, not a fork.

[`docs/design/multi-country.md`](https://github.com/vaam-apps/vsms/blob/main/docs/design/multi-country.md)
is the decision record and the authority. `AGENTS.md` and `docs/architecture.md`
were both written for Cameroon alone and **most of them still read that way** —
treat a bare Cameroonian fact in either as the default case, not the only one.

## Stage 1: `sms-msisdn` parses every country

The hand-rolled Cameroon numbering plan is gone, replaced by Google
libphonenumber metadata via the `phonenumber` crate. **`parse` and `parse_mobile`
still default to `CM`**, so every existing call site compiled unchanged;
`parse_in`/`parse_mobile_in` take an explicit `Region`.

libphonenumber reproduced the hand-rolled plan **exactly** — including the
unallocated `63x`/`643`–`649` blocks and the 8-digit `88x` toll-free range. That
unprompted agreement is what made the swap a widening rather than a correction.

## The two defects it caught, both of which would have shipped looking right

- **`parse_mobile` accepted only `LineType::Mobile`.** North American numbers
  classify as `FixedLineOrMobile`, because **the NANP does not encode the
  distinction at all** — so carried over unchanged, that rejects **every US and
  Canadian number**, and a long tail of other countries behaves the same way.
  Addressability replaced mobility: `Mobile | FixedLineOrMobile`. Cameroon is
  unaffected — CM metadata still returns `FixedLine` for `2xx`.
- **`Message.msisdn` carried `@length(min: 12)`** — a floor derived from `+237`
  plus nine digits, which **refuses Denmark, Norway and Iceland outright**
  (11-character E.164 numbers). Lowered to 8. No `@db_enforce`, so no DDL
  consequence.

Also generalised: `national()` was a fixed 4-character slice, and `masked()`
hardcoded "country code plus last two digits" at Cameroon's length. Both are
computed now; CM output is byte-identical.

## What is explicitly not done

| Not done                                                               | Tracked |
| ---------------------------------------------------------------------- | ------- |
| No country column anywhere — no `App.defaultCountry` to thread through | #356    |
| No currency abstraction — cost fields are still XAF                    | #357    |
| `OperatorCode` is still a five-variant DDL enum                        | #358    |
| Quiet hours are still a fixed UTC+1 offset                             | #359    |

And two things no code closes: the design doc names **sender-ID regimes,
aggregator coverage, and data-residency conflicts** as unsolved. **Nobody should
read "extensible" as "any market works today."**

## The honest limitation

`phonenumber` ships **no carrier mapper** — number portability destroys the
premise — so `operator` is honestly `unknown` for foreign traffic.

That is what makes the existing "prefix routing must never be load-bearing"
caution **mandatory rather than merely prudent**: a route keyed on
`matchOperator` matches nothing outside the markets whose prefixes are seeded,
and `OperatorPrefixTable` ships with zero built-in rows for exactly that reason.

## A correction worth reading before you write a similar comment

`PURGED_MSISDN_PLACEHOLDER`'s doc once claimed it could not collide with a real
MSISDN because no digit-run that long exists in the Cameroon prefix tables.
**True then, false the moment any country is parseable.** The durable reason —
it carries letters, which `sms_msisdn` refuses before consulting any numbering
plan — replaced it.

Check your invariants against "any country", not "this country", whenever you
write one down.
