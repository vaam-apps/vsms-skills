# Claims that were documented and false

This repository has recorded the same failure shape repeatedly: **documentation
asserting something the code does not do.** These are the known instances, kept
because the wrong belief is usually the one a reader is about to form.

| The claim                                                                    | The truth                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gateway fails on the **first `/token` request** if no signing key exists | It fails at **process start** — `serve` calls `load_signing_keys(...)?` before binding the listener. It matters: anything that waits for health before rotating a key deadlocks permanently |
| `msisdnHash` is HMAC-SHA256 under a pepper                                   | It was plain, unkeyed SHA-256 — reversible in seconds over Cameroon's ~10^7 numbering space, so a "purge" de-identified nothing. Now genuinely `hmac-sha256-v1:`                            |
| `rust-version` is `1.85`                                                     | The committed lockfile needed `1.88`. No CI job checked the claim, so it drifted silently                                                                                                   |
| `/token` rate limiting is keyed on `client_id` **and** source IP             | Only the IP half existed. The edge structurally cannot read one field out of a form-urlencoded body                                                                                         |
| `aws-lc-rs` enters via four independent paths                                | One path. A misread of `cargo tree -i`, which shows `rustls` dependents, not provider requesters                                                                                            |
| The MTN `429` delay is parsed from `Retry-After`                             | It has always been a fixed constant. The doc was fixed, not the code                                                                                                                        |
| `seed-provider` prepares a deployment for traffic                            | It only ever created a `Provider` row. After routing became real, a runbook-following deployment came up healthy and silently rejected **every** message forever. Renamed `seed-dispatch`   |
| `webhooks.rs`'s subscriber can never see a purged message                    | It can. That reasoning was true of `dispatch.rs` and false here — un-guarded, every purge re-fired a live webhook about a message reported on three months earlier                          |
| `crypto-aws-lc-rs` enables FIPS                                              | An empty feature whose `install_fips_crypto_provider()` returned `Ok(())` without installing anything — a false assurance in a compliance-facing API. Now a hard `compile_error!`           |
| The SDK's `base_url` backs both `/token` and the REST API                    | It does not. The token endpoint comes from `config.issuer`. Confirmed with a real `401 invalid_client`                                                                                      |

## What to take from the list

Four of these were found by **running the system**, not by reading it. Two were
found by a reviewer checking the deploy path a change _implied_ rather than the
diff it contained.

So: when a document and the code disagree, **the code is the evidence** — and
when you correct one, correct it where the claim was made, struck through and
dated, rather than quietly overwriting it.
