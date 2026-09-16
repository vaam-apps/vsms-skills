# Encoding and numbering details

## GSM-7 facts

- `Ä Ö Ñ Ü` and their lowercase forms are encodable either case. `à è ù ì ò` are
  single septets; **`À È Ù Ì Ò` are not** — only `É` made the default alphabet.
- The escape table (`€ [ ] { } \ | ~`) costs **two** septets each, and the pair
  cannot straddle a segment boundary.
- `$` sits at 0x02, not its ASCII slot.

## Two Cameroon facts worth keeping

- **Camtel mobile is `242`/`243`** — inside the fixed-line leading digit `2`. A
  classifier assuming "6 = mobile, 2 = fixed" misclassifies it.
- **The `88x` toll-free range is 8 digits**, the one legitimate 8-digit number
  in the plan. It must be special-cased **before** the generic "8 digits =
  pre-2014 legacy number" rejection, or every toll-free number is misdiagnosed.

libphonenumber reproduces both, plus the unallocated `63x`/`643`–`649` blocks,
unprompted. That agreement is what made adopting it a widening rather than a
correction.

## `Region` is a newtype

It wraps `phonenumber::country::Id` rather than re-exporting it. Leaking a
dependency's type through a pure crate's public API would make a `phonenumber`
major a breaking change for every caller.

## Masking

`Msisdn::masked` is **computed** from the parsed country code and national
length, not sliced at a fixed offset — the old version hardcoded Cameroon's.
CM output is byte-identical after the generalisation.

For webhooks, masking is applied **at subscriber time** and baked into the
stored payload. The delivery path never reconstructs it, and a test asserts the
unmasked E.164 form is absent from the actual POST body.

## `OperatorPrefixTable` ships empty

The type does longest-prefix-match lookup; the data lives in
`OperatorPrefixRule`, seeded and corrected from observed DLRs. 14 seeded rows
as of 2026-09-15, with `68x` recorded as contested and `62x` as unverified —
which is itself the argument for "advisory only".

## One test-authoring trap

`send_message_live_postgres.rs` once hand-rolled a **second copy** of the hash
algorithm to precompute a matching `OptOut.msisdnHash`. It drifted the moment
the real algorithm changed. The fix was to expose the production function and
call it — removing the drift risk rather than patching the one copy that
happened to be caught.

**Never reimplement a production algorithm in a test fixture.**
