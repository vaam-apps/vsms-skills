---
name: vsms-aws-sms
description: "AWS End User Messaging SMS in vsms (provider key aws_sms), the go-live provider while the Orange and MTN contracts are pending — why it is not SNS Publish, the worker-sends and gateway-receives split, hand-written SigV4, the error and event mappings, how an Amazon SNS callback is authenticated and why the subscription is confirmed by hand, configuration, AWS-only provisioning, routing alongside other rails, and the limits nobody has run live. Load before touching sms-provider-aws-sms, configuring or seeding aws_sms, or debugging receipts that never arrive."
---

# vsms-aws-sms

> **Verified against vsms `69afaf0b` (2026-10-22).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

`backends/crates/sms-provider-aws-sms`, key **`aws_sms`**, landed 2026-10-21. It
is the third `SmsProvider` (beside `orange_cm` and `mtn_cm`) and the one meant
to carry real traffic first, because the Orange and MTN contracts are slow to
unlock. The operator's half is `docs/runbooks/aws-sms.adoc`; the crate's own
pages are `lib.md`, `sns.md`, `events.md` and `sigv4.md`.

> **Nothing here has run against a live AWS account.** Request, error and event
> shapes come from botocore's `pinpoint-sms-voice-v2` service model and AWS's
> documentation, and the signer is checked against two independent references.
> The first real send is the first real verification.
>
> **Cross-border transfer blocks go-live.** `SendTextMessage` hands every
> recipient number and body to AWS in whichever Region is configured — AWS has no
> Cameroon Region. Law No. 2024/017 requires prior authorisation for that, and
> `OPEN_QUESTIONS.md` §1.5 (opened 2026-10-21) records it as blocking `aws_sms`
> (not Orange or MTN). `purge_retention` clears vsms's copy only; AWS keeps its
> own, and its own opt-out list, which vsms's `OptOut` does not know.

## Why End User Messaging and not SNS `Publish`

SNS can send an SMS directly, but it reports what happened only to CloudWatch
Logs. vsms would never learn a message arrived: every one would sit in
`submitted` until `expire_stale` marked it `expired`, firing `message.expired`
for an OTP that was delivered. End User Messaging is the same SMS backend (same
sandbox, spend limits, sender IDs) with an API that can publish per-message
events to an SNS topic, which SNS then posts, signed, to `POST /dlr/aws_sms`.
SNS is still in the picture; it carries the receipts.

## One provider, two halves

- **The worker sends** (`AwsSmsProvider::sender`): region, an IAM access key
  allowed `sms-voice:SendTextMessage`, the configuration set whose event
  destination is the SNS topic, and the account's commercial terms.
- **The gateway receives** (`AwsSmsProvider::receiver`): only the topic ARN. It
  holds **no AWS credentials**, so a compromised gateway cannot send an SMS.

Each half refuses the other's job: a receiver's `submit` is `Unavailable`; a
sender refuses every callback.

## Submit

One signed JSON 1.0 `POST /` (`X-Amz-Target: PinpointSMSVoiceV2.SendTextMessage`).
The body is serialised once and those exact bytes are both signed and sent.

- **SigV4 is hand-written** (`sigv4.rs`, ~40 lines over the `hmac`/`sha2` the tree
  already has) because the AWS SDK's HTTP stack is how `aws-lc-rs` would come
  back. It is checked against AWS's published `get-vanilla` vector and against
  botocore signing the exact request `submit` builds; the harness reproduced
  `get-vanilla` first, which is what makes its second answer worth trusting.
  `cargo tree -i aws-lc-rs` must keep matching nothing.
- `Context` carries `vsmsMessageId` = our `Message.id`, echoed in every event so a
  human can tie a raw receipt to a message. **Correlation does not use it**: it
  uses the `MessageId` AWS returns, stored as `providerMessageRef` and matched
  against each event's `messageId`.
- The origination identity is `AWS_SMS_ORIGINATION_IDENTITY` when set, else the
  message's own approved sender ID. A body over 1600 characters is `Rejected`
  (`BODY_TOO_LONG`).

### Errors

| Response                                                                                                                                                                 | `ProviderError`  | Consequence                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------- |
| `200` + `MessageId`                                                                                                                                                      | — (`SubmitAck`)  |                                                     |
| `200` without one, or unreadable                                                                                                                                         | `Indeterminate`  | `uncertain`, never resubmitted                      |
| connect failure                                                                                                                                                          | `Unavailable`    | fail over; nothing was sent                         |
| timeout or body error after connecting                                                                                                                                   | `Indeterminate`  | AWS may have accepted it                            |
| `ThrottlingException`                                                                                                                                                    | `Transient` (1s) | retry on this provider                              |
| `ServiceQuotaExceededException` (spend limit), credential or signature errors, account-level access/not-found                                                            | `Unavailable`    | opens the breaker, fail over                        |
| `AccessDeniedException` with no `Reason`, or `ResourceNotFoundException` for anything but the configuration set, **when the identity came from the message's sender ID** | `Permanent`      | fail over; **no** provider-wide breaker trip        |
| `ValidationException` about country, sender identity or price                                                                                                            | `Permanent`      | fail over                                           |
| any other `ValidationException`                                                                                                                                          | `Rejected`       | fail the message                                    |
| `ConflictException` opted out / protect-blocked                                                                                                                          | `Rejected`       | fail the message                                    |
| `ConflictException` `RESOURCE_NOT_ACTIVE`, `MESSAGE_TYPE_MISMATCH`                                                                                                       | `Unavailable`    | opens the breaker                                   |
| any other `ConflictException`, including `DESTINATION_PHONE_NUMBER_NOT_VERIFIED` (the **sandbox**), or a new reason                                                      | `Permanent`      | fail over; with no other route the message `failed` |
| `5xx`                                                                                                                                                                    | `Unavailable`    |                                                     |

The sender-ID row exists because counting one app's unregistered sender ID toward
the breaker would take every other app's traffic off AWS. A deployment still in
the sandbox shows `failed` messages ("no alternate route available"), **not** an
outage and not an open circuit.

## Receipts: events and the `isFinal` rule

`events.rs` maps End User Messaging event records onto `DeliveryOutcome`.

> **Only a final event is a verdict.** Anything other than `TEXT_DELIVERED` with
> `isFinal` not `true` (including a record that omits it) is `InFlight`. A
> non-final failure can still be followed by a delivery, and acting on it would
> let the retry path resubmit a message that then arrives — a duplicate SMS.

| Event (final)                                                                                                       | Outcome     | Note                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `TEXT_DELIVERED`                                                                                                    | `Delivered` | needs no finality                                          |
| `TEXT_SUCCESSFUL`                                                                                                   | `Delivered` | **a deliberate overstatement**, see below                  |
| `TEXT_QUEUED`, `TEXT_PENDING`, `TEXT_SENT`, non-final `TEXT_SUCCESSFUL`                                             | `InFlight`  | progress; never `Uncertain`                                |
| `TEXT_UNREACHABLE`, `TEXT_CARRIER_UNREACHABLE`                                                                      | `Failed`    | retryable (`undelivered`)                                  |
| `TEXT_TTL_EXPIRED`                                                                                                  | `Expired`   | the `TimeToLive` (or AWS's 72 hours) ran out               |
| `TEXT_INVALID`, `TEXT_INVALID_MESSAGE`, `TEXT_BLOCKED`, `TEXT_CARRIER_BLOCKED`, `TEXT_SPAM`, `TEXT_PROTECT_BLOCKED` | `Rejected`  | the same message to the same number fails the same way     |
| `TEXT_UNKNOWN`                                                                                                      | `Uncertain` | AWS's own "we do not know", after 72 hours with no verdict |
| any other `TEXT_*`                                                                                                  | `Unknown`   | never guessed                                              |

Non-`TEXT_*` events (voice, MMS) are acknowledged and produce no update.

**A final `TEXT_SUCCESSFUL` ("accepted by the carrier", `isFinal: true`) is
recorded as `Delivered`.** Many carriers never return a handset receipt to AWS
and nothing follows; treating it as in-flight would expire every such message.
It means "the network took it", not "the handset confirmed it".
`DeliveryReceipt.rawStatus` keeps `TEXT_SUCCESSFUL`, so the two stay
distinguishable.

## Authenticating the callback

`/dlr/{providerKey}` is public, so without this anyone could mark any message
`delivered`. The gateway calls `SmsProvider::authenticate_callback` before
`parse_dlr`; the checks run **cheapest first, network last**:

1. **`TopicArn` equals the configured topic.** The check most implementations
   forget: a valid SNS signature proves the message came _from SNS_, not from
   _your_ topic. Anyone can create a topic in their own account, subscribe this
   URL and publish perfectly signed notifications.
2. **`SignatureVersion` is `2`** (SHA256withRSA). Version 1 is refused rather than
   verified — `rustls-webpki` has no SHA1 signature algorithm. The topic default is
   1, so the operator sets the attribute once. A refusal on _our own_ topic is
   logged at `error`, because it silently drops every receipt.
3. **`SigningCertURL` is exactly
   `https://sns.<topic-region>.amazonaws.com/SimpleNotificationService-<32 hex>.pem`**
   — no port, credentials, query or fragment. Only then does anything leave the
   process, so a forged message cannot make the gateway fetch an arbitrary URL.
   Redirects are off, bodies are cut off past 64 KiB, the cache is keyed on the
   path, and uncached fetches are rate limited globally (about one per 5 seconds).
4. **The RSA-SHA256 signature verifies** over the exact `name\nvalue\n` string.

The gateway turns the result into a status: refused → `403`, an authentic
handshake → `200` with nothing parsed, the check could not _run_ (fetch failed or
rate limited) → `503`. The split matters because **SNS retries only `5xx` and
`429`** (three retries, 20s apart, by default) and treats everything else as
final: a wrongly answered `403` throws a genuine receipt away for good, while a
`503` is redelivered for about a minute.

`Timestamp` is not checked; replaying a genuine receipt is harmless (ingestion is
idempotent). The certificate's own chain is not walked — it is trusted because it
came over HTTPS from the topic Region's SNS host, the AWS SDK validators' model.

### The subscription is confirmed by a human

An authentic `SubscriptionConfirmation` is **not** visited. The gateway
acknowledges it and logs at `warn` the topic ARN, the token and the command:

```sh
aws sns confirm-subscription --topic-arn <arn> --token <token> \
    --authenticate-on-unsubscribe true
```

Confirming by a plain GET of `SubscribeURL` leaves `AuthenticateOnUnsubscribe`
`false`, and every notification carries an `UnsubscribeURL` that vsms stores
verbatim in `DeliveryReceipt.rawPayload`, readable by any signed-in console role.
An `UnsubscribeConfirmation` is acknowledged and logged at `error` — the
subscription is gone and receipts have stopped.

> ~~`SubscriptionConfirmation` is confirmed automatically, which is safe only
> because of the `TopicArn` check.~~ **Corrected 2026-10-21:** the gateway never
> confirms. vsms's `AGENTS.md` section on this provider was written before that
> change and may still say otherwise (it also lists four checks and "certificates
> are cached by URL", where the code now pins the exact certificate URL shape and
> caches by path). `sns.md` is the source of truth.

## Configuration

**`sms-worker`** (sends). The first six are **all-or-none** — a partial set is a
startup error:

| Variable                                              | Meaning                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `AWS_SMS_REGION`                                      | the Region                                                                                   |
| `AWS_SMS_ACCESS_KEY_ID`, `AWS_SMS_SECRET_ACCESS_KEY`  | long-lived IAM user key; the secret is hidden from `--help`                                  |
| `AWS_SMS_CONFIGURATION_SET`                           | required — without an event destination AWS emits no events and every message ends `expired` |
| `AWS_SMS_TPS_CEILING`, `AWS_SMS_COST_PER_SEGMENT_XAF` | commercial terms, **never defaulted**; cost is AWS's USD price converted to XAF by you       |
| `AWS_SMS_ORIGINATION_IDENTITY`                        | optional, strongly recommended — otherwise AWS may send from the word `NOTICE`               |
| `AWS_SMS_MESSAGE_TYPE`                                | optional, default `transactional`                                                            |
| `AWS_SMS_SUPPORTS_ALPHANUMERIC_SENDER`                | optional, informational (feeds advertised capabilities)                                      |
| `AWS_SMS_ENDPOINT_URL`                                | optional, tests against a fake only                                                          |
| `AWS_SMS_TIME_TO_LIVE_SECONDS`                        | optional, 5–259200 — see below                                                               |

**`sms-gateway`** (receives): only `AWS_SMS_EVENTS_TOPIC_ARN` (`--aws-sms-events-topic-arn`).
Setting it mounts `POST /dlr/aws_sms`. **The gateway exits at startup if it is set
and no `Provider` row keyed `aws_sms` exists** — seed first.

**`AWS_SMS_TIME_TO_LIVE_SECONDS` (new 2026-10-21).** Unset means AWS's 72-hour
default, so an OTP vsms expired after 15 minutes can still reach a handset days
later. Set `900` for OTP traffic. It is **per provider, not per message**: other
classes default to a 24-hour validity, so `900` cuts them short — choose it for
the traffic the provider actually carries.

The adapter treats a blank `AWS_SMS_ORIGINATION_IDENTITY` or
`AWS_SMS_ENDPOINT_URL` (which clap delivers as `Some("")`) as unset, and refuses a
blank access key, secret or configuration set outright. **That does not rescue a
present-but-empty numeric or enum variable**: `AWS_SMS_TPS_CEILING=` is a clap
parse failure before any of vsms's own validation runs. Comment the block out (the
MTN hazard again; `vsms-ops`).

## Provisioning

There is **no `aws_sms` `ProviderKind`**: the row uses `aggregator_http`, because
a new enum value is a forward migration for a column nothing reads — adapters are
resolved by `Provider.key`. Seed the row (and its catch-all `Route`) **before the
gateway starts with the topic ARN set**:

```bash
docker compose --env-file .env run --rm sms-gateway seed-dispatch \
  --key aws_sms --kind aggregator_http \
  --display-name "AWS End User Messaging SMS" \
  --credential-ref env:AWS_SMS_SECRET_ACCESS_KEY \
  --max-tps 5 --cost-per-segment-xaf 30
```

> **AWS-only go-live: do not seed Orange by accident.** `sms-gateway bootstrap`
> and a bare `seed-dispatch` both create an `orange_cm` provider and a catch-all
> `Route` at the same priority and weight as the AWS one. With no Orange
> credentials in the worker, about half of all messages route to a provider with
> no adapter — retried with backoff **forever**, not failed. Use
> `sms-gateway bootstrap --skip-seed-dispatch` (new 2026-10-21), then the AWS
> `seed-dispatch` above. The Helm chart avoids it with a separate `seedDispatchAws`
> hook (`vsms-ops`).

Order: seed the row → restart the gateway with the topic ARN → `aws sns subscribe`
→ run `confirm-subscription` from the gateway's `warn` line.

## Routing now and later

**No routing code changed.** Priority bands, weights and failover over the whole
route set already existed (`vsms-routing`). Today: one wildcard route to AWS.
When operators unlock, give each operator a priority band holding that operator's
direct route and an AWS route, split by weight (the runbook's example is 70/30),
plus a lower-priority wildcard AWS route for everything else and as the fallback.
`Permanent` and `Unavailable` re-run the engine with the failed route excluded, so
the AWS member of the band is the failover target. There is no "failover only"
flag — a weight-`0` member is never drawn while a heavier one is eligible but is
still a candidate once that one is excluded; simulate it first.

**Never create a `Route` to a provider whose credentials the worker lacks.** The
message is retried with backoff indefinitely, not failed. Configure the adapter,
restart the worker, _then_ add the route.

## Known limits

- **Long-lived IAM user keys only.** No instance profile, IRSA or STS session
  credentials — refreshing them is the SDK's credential chain, the dependency this
  crate avoids. There is no hot reload; rotate by restarting the worker.
- **An `Indeterminate` submit is not rescued by a later receipt.** Its `MessageId`
  was never learned, so the event matches nothing and `expire_stale` resolves it —
  the same trade-off as Orange (#119). (The runbook's routing table says a later
  receipt can still resolve it; `lib.md` and its own known-limits list say it
  cannot. The code stores no other reference, so trust the latter.)
- **No `delivering_network`.** Events carry `mcc`/`mnc`; mapping them onto this
  schema's operator codes is not done, so grey-route divergence analysis gets
  nothing per-operator from AWS.
- **A receipt SNS gives up on is lost** and its message ends `expired`. A delivery
  policy and an SQS dead-letter queue shrink the window; nothing in vsms reads the
  queue.
- **One carrier partner per country** behind AWS: keep another provider
  configured for traffic that matters.

## Traps

- **The adapter's log lines need `sms_provider_aws_sms` in the log filter.** The
  confirmation command, the `SignatureVersion`-1 `error` and the
  `UnsubscribeConfirmation` `error` are emitted by target `sms_provider_aws_sms`,
  and an `EnvFilter` with only target directives disables every other target.
  The default (binary, compose's `SMS_GATEWAY_LOG`, `.env.example`, Helm's gateway
  `RUST_LOG`) includes it as of 2026-10-21 — the first draft did not, the same
  trap `sms_auth` fell into on 2026-10-19. **An operator who overrides
  `SMS_GATEWAY_LOG`/`RUST_LOG` must keep it**, or the token needed to confirm the
  subscription is never printed.
- **The repo's `*.pem` gitignore would have silently dropped the public test
  certificate** (it exists to keep `provision-client` private keys out) and broken
  `include_bytes!` in CI. There is now a **single-file negation** for
  `backends/crates/sms-provider-aws-sms/tests/fixtures/test-sns-signing-cert.pem`;
  do not weaken the rule.
- **Empty env vars** — above. The compose stack passes `FOO=` through as a value.
- **A refused receipt is not retried by SNS.** A topic still on
  `SignatureVersion` 1, `RawMessageDelivery` on, or a different Region all produce
  `403`s that lose receipts for good. The gateway log's `reason` names the check.

## Without an account: `sms-fake-aws` (2026-10-21)

`backends/crates/sms-fake-aws` (library) and `backends/apps/sms-fake-aws`
(binary, package `sms-fake-aws-bin`) stand in for AWS the way `sms-fake-orange`
stands in for Orange. They play both of AWS's parts: `SendTextMessage` (its own
SigV4 verifier, a second implementation held to AWS's `get-vanilla` vector and
rebuilt from the bytes and `Host` that arrived; a `FaultPolicy`; a `Ledger`) and
the SNS topic (signed `Notification`s POSTed to `/dlr/aws_sms`, retried until a
2xx). An exhausted `FaultPolicy::Scripted` answers `500`, not a silent accept.
The RSA key and self-signed certificate are generated at start-up with `rsa` +
`rcgen` (`ring` backend only); no key is committed.

**What it proves:** the code agrees with our reading of AWS, over real HTTP and
through the real signature code on both sides. **Not** that AWS behaves that way.

**How a receiver comes to trust it.** Notifications name a `SigningCertURL` on
AWS's real SNS host, so every check runs unchanged. The one seam is
`sms_fake_aws::RedirectSnsHttp`: an `SnsHttp` that fetches the same path from the
fake. Tests pass it to `AwsSmsProvider::receiver_with`. `sms-gateway` reaches it
only through its **off-by-default `fake-aws` cargo feature**, which adds
`serve --aws-sms-fake-sns-cert-base` / `AWS_SMS_FAKE_SNS_CERT_BASE`; a build
without the feature cannot parse that flag (`a_release_build_has_no_fake_certificate_flag`).
The gateway Dockerfile's `ARG CARGO_FEATURES=""` is how `compose.dev.yaml` turns
it on (on every service sharing the `vsms-dev/sms-gateway:local` tag); the release
workflow never sets it. Do not turn this into a runtime flag in every build: one
stray env var would make a production gateway accept receipts anyone can sign.
CI builds the feature (`ci.yml` `rust` job, `just ci` step 3), because a feature
nobody enables is a silent skip.

`just demo` runs `sms-fake-aws` beside `sms-fake-orange`, with `seed-dispatch-aws`
adding an `aws_sms` catch-all at Orange's priority and weight, so traffic splits
50/50. Fault modes (`--fault-mode happy|carrier-only|silent|sandbox|unreachable`)
are in `docs/runbooks/aws-sms.adoc` "Without an AWS account".

## Tests

The crate's tests need **no database and no `--ignored`** — plain `cargo test`.
`tests/fixtures/` holds a self-signed test certificate and two SNS envelopes whose
string-to-sign was built by a separate Python implementation and signed with
`openssl dgst -sha256 -sign`, then re-verified with `openssl dgst -verify`, so the
verifier is checked against a third tool rather than its own canonicalisation. The
signing key was **deleted**: nothing can sign new messages, and re-signing means a
fresh key and certificate (the fixtures' README says how). Guard-failure proofs
(topic pinning, ignoring the signature result, the certificate host check, the
gateway hook bypassed to a hard-coded `Ingest`) each failed the named test with the
mechanism broken.

`backends/crates/sms-fake-aws/tests/round_trip.rs` (12 tests, no database) drives
the real adapter against the fake: signing, each error class, a post-accept
timeout, tampering, redelivery, a subscription confirmation, and that without
`RedirectSnsHttp` the certificate is sought on AWS's host.
`backends/crates/sms-worker/tests/aws_sms_fake_live_postgres.rs` (4, `--ignored`)
goes through dispatch and `sms_api::dlr::ingest`: `delivered` via a signed
receipt, the sandbox refusal failing over to Orange, no `MessageId` held
`uncertain` and never resent (asserted on the fake's ledger), and a tampered
receipt refused on the route.
