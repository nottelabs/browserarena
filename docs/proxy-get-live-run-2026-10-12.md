# Proxy Performance validation, October 12, 2026

The completed suite `premerge-50-2026-10-12` contains **1,800 attempts**, with
**1,712 successes and 88 failures**, plus nine unpaid unsupported markers.
Every supported provider/country pair has exactly 50 attempts. Every saved attempt
is retained, including setup failures, country mismatches, and partial downloads.
There are no repeated attempt identities or session IDs, no discarded failures,
and no extra benchmark attempts or measured-GET retries.

## Workload and target

The sequential run started at **12:18:54 UTC** and finished at **17:24:27 UTC**,
lasting 5 hours, 5 minutes, 33 seconds. Cumulative batches targeted 10, 20, 30, 40,
and 50 attempts per supported pair, finishing at 13:15:25, 14:10:01, 15:21:39,
16:27:58, and 17:24:27 UTC. Failed attempts counted toward every target.
Countries were shuffled, concurrency was one, starts were paced at ten per
provider per minute, session creation had a 90-second deadline, and each CDP,
bootstrap, country check, and measured GET phase had a 30-second deadline.
The process exited with status zero.

The runner was the existing AWS us-east-1 t3.medium EC2 instance, using Node
22.23.2 and benchmark commit `26a69b3384abb0a8cf04aa5395cf2103b8520873`.

- Payload: `https://southampton-band-computational-beef.trycloudflare.com/api/proxy-get/payload`
- Bootstrap: the same origin, `/api/proxy-get/bootstrap`
- Country verification: `https://api.country.is/`
- Body: 1,048,576 deterministic bytes, SHA-256
  `7317cbc61ea73cc173a87aacd2f86645ba3932a5f7fb3f04b1c7169a633b7776`
- Mode: warm origin, fresh browser session, native residential country targeting

A dedicated Node origin on EC2 served the payload through a temporary Cloudflare
HTTPS tunnel. This is **not the permanent production target**. PR #96 merged
while the suite was running; the running checkout, target and measurement protocol
were kept unchanged. The permanent production bootstrap and payload subsequently
passed HTTP 200, full-byte and hash checks. A final EC2 CLI preflight checked all
nine integrations against `https://www.browserarena.ai` without creating sessions.

## Recorded outcomes

| Provider | Successes / attempts | Reliability | Failure stages |
| --- | ---: | ---: | --- |
| Browser Use | 248 / 250 | 99.2% | 2 GET |
| Hyperbrowser | 243 / 250 | 97.2% | 4 GET, 3 country checks |
| Kernel | 243 / 250 | 97.2% | 3 GET, 3 country checks, 1 bootstrap |
| Notte | 242 / 250 | 96.8% | 6 GET, 1 creation, 1 bootstrap |
| Browserbase | 241 / 250 | 96.4% | 8 GET, 1 country check |
| Steel | 239 / 250 | 95.6% | 8 CDP, 1 GET, 1 bootstrap, 1 country check |
| Anchor Browser | 231 / 250 | 92.4% | 18 creation, 1 GET |
| Tilion | 25 / 50 | 50.0% | 25 creation |
| Lightpanda | Unsupported | N/A | 5 unpaid markers |

The seven five-country providers each have 250 attempts. Tilion has 50 US
attempts and four unsupported-country markers; its region setting is not a
verified independent residential exit-country selector outside US. Lightpanda
has no configured native residential proxy. Unsupported markers are neither
failed paid attempts nor invented latency samples.

All 1,712 successful records have HTTP 200, the complete byte count, the requested
observed country, and a measured GET duration. The runner validates SHA-256 before
emitting success. Latency distributions contain successful GETs only; failures
remain in reliability and raw exports. Fifty attempts per country are not enough
for robust population tail-latency or long-term availability claims.

Anchor's creation failures were four 90-second deadlines, six HTTP 500 errors,
and eight HTTP 400 connection failures. Tilion's 25 failed launches returned
HTTP 502. Steel's eight CDP failures returned HTTP 503 `session_unavailable`.
Hyperbrowser country mismatches included US instead of JP and HU instead of FR;
these remain failures. Other network and country-check failures are retained in
the per-attempt diagnostics and the linked analysis.

## Notte failures

| Country | Successes / attempts | Failures |
| --- | ---: | --- |
| US | 50 / 50 | None |
| France | 49 / 50 | 1 partial GET deadline |
| Brazil | 48 / 50 | 1 partial GET deadline, 1 bootstrap deadline |
| India | 48 / 50 | 2 partial GET deadlines |
| Japan | 47 / 50 | 1 creation deadline, 2 mid-body connection closures |

All eight failures are preserved. The six payload failures received HTTP 200 but
only part of the body: BR 991,214 bytes, FR 168,831 bytes, IN 133,376 and 23,233
bytes, and JP 630,676 and 392,554 bytes. Both JP closures reported
`net::ERR_CONNECTION_CLOSED` before the deadline; the four download deadlines
reported `net::ERR_ABORTED` when the benchmark canceled the request.
Every payload nonce matched an origin completion in 1 ms. The second IN failure's
first body chunk arrived at about 28.956 seconds, leaving little deadline time
for the body. These are observations, not a proven internal proxy root cause.

The JP creation deadline returned no session ID. The earlier authenticated
listing found no persisted session in its timestamp window, but cannot exclude
transient or unrecorded allocation. The BR bootstrap deadline occurred after
creation and CDP connection, before country verification or a measured GET.
One untagged bootstrap request in that window completed HTTP 200 at the origin;
without an attempt nonce it is only a temporal correlation. All four independent
probes during that window passed.

No completed Notte country verification mismatched. All 249 returned Notte
session IDs were checked after the run: every response was HTTP 200 with
`status: closed`. There were no Notte cleanup errors.

## Target evidence and attribution limits

The independent direct monitor recorded **1,792/1,792 healthy probes**, including
1,768 through suite completion. Every probe returned HTTP 200, 1,048,576 bytes,
and the expected hash. Monitoring began at 12:23:41.499 UTC after an empty script
transfer was repaired: **the first approximately 4 minutes, 47 seconds of the
paid run have no independent probe coverage**. Origin request logs exist from
the start. The tunnel logged no error or reconnect lines before shutdown.

Of 25 measured-GET failures, 23 returned a request nonce that matched a completed
HTTP 200 origin response in 0–2 ms. The other two, Browserbase IN and Kernel BR,
recorded no response headers and cannot be correlated by response nonce.
Origin completion means Node handed the body to its tunnel connection; it does
not prove receipt by the remote browser. Independent direct probes also do not
exercise each residential exit's path. Failures across multiple providers could
involve exits, Cloudflare/CDN routing or downstream transport. These records
cannot distinguish those causes, and no failure was excluded on an attribution
assumption. Comparing these latencies with earlier pilot hosts or the permanent
production target is not a controlled before/after comparison.

## Cleanup and cost audit

Three successful Anchor GETs recorded cleanup errors: two HTTP 504 and one
HTTP 500. A final read-only retrieval reports all three affected sessions as
`completed`; a corrected active-list parser reports zero active sessions. The
original cleanup errors and unknown costs remain unchanged. An earlier audit
parser failed on the listing response shape; that failure and its corrected
read are retained as evidence. All eight Steel sessions with CDP failures report
`released`. Kernel's current proxy listing contains no `browserarena-` named
resources. Other providers have no recorded cleanup errors; that does not amount
to an independent status retrieval for every session. No manual cleanup retry
or additional session creation was performed.

The sum of **known marginal usage estimates is $20.28906**, including known
failed-attempt costs. This is not the suite's complete cost or an invoice:
**22 attempts have unknown total cost** (21 Anchor and the Notte creation timeout).
Provider API behavior can include existing SDK cleanup retries; no benchmark
attempt or measured GET was retried.

| Provider | Sum of known estimates | Unknown-cost attempts |
| --- | ---: | ---: |
| Anchor Browser | $4.39937 | 21 |
| Browserbase | $6.39200 | 0 |
| Browser Use | $1.30334 | 0 |
| Hyperbrowser | $2.62809 | 0 |
| Kernel | $0.03970 | 0 |
| Notte | $2.56298 | 1 |
| Steel | $2.93300 | 0 |
| Tilion | $0.03058 | 0 |

Steel's usage counter was unavailable for 239 records and Browserbase's for all
250 records. Their configured estimates use browser-observed traffic where
provider counters are absent, a lower bound on billable traffic. The original
pricing snapshots remain in every record. Subscriptions, credits, discounts,
taxes, EC2 and target hosting are excluded. Provider totals with any unknown
attempt remain unknown in the dashboard, even though the known subtotal is
reported here for budgeting.

## Publication and artifacts

The new records append to each provider's `2026-10-12/results.jsonl`.
Earlier dates, the 50-attempt corrected Notte suite and its separate 50-attempt
blocked control are retained byte-for-byte. The dashboard selects the latest
provider suite rather than pooling the old Notte attempts into this 250-attempt
measurement. The old Notte metadata is archived alongside the new audit before
writing metadata for the new suite. Each new metadata file uses `started_at`
and `finished_at` for the full suite, retaining the runner's original final-batch
window in `final_batch_started_at` and `final_batch_finished_at`. The results
index includes all saved dates. A suite-specific snapshot archives all nine
corrected metadata files so historical validation survives a later run replacing
a dated `_meta.json`.

- [Analysis and failure correlations](../results/proxy-get/diagnostics/2026-10-12-premerge50/analysis.json)
- [Selected session status audit](../results/proxy-get/diagnostics/2026-10-12-premerge50/session-audit.jsonl)
- [Archived suite metadata](../results/proxy-get/diagnostics/2026-10-12-premerge50/suite-metadata.json)
- [Independent target probes](../results/proxy-get/diagnostics/2026-10-12-premerge50/target-monitor.jsonl)
- [Prior corrected Notte metadata](../results/proxy-get/diagnostics/2026-10-12-premerge50/notte-previous-meta.json)

No credentials, authorization/cookie headers, CDP URLs, response bodies or raw
backend logs are published. A scan against the eight configured credential
values found no matches in the new results. Full runner/target logs remain
private on EC2 and in the local collection for investigation.

The temporary origin, Cloudflare tunnel, Node monitor and monitor wrapper were
stopped after the run and audit. The production lifecycle checkout was untouched.
The daily proxy cron remains inactive; passing permanent-target preflight does
not activate it. Production reads published results from GitHub main with a
60-second cache, so finishing this EC2 process alone does not update the dashboard.

Validation before publication: the root TypeScript build and 57 benchmark/provider
tests pass; the web production build and 96 web-library tests pass. Loading the
actual result files through the dashboard summarizer selects nine provider rows
for every country, exactly 50 attempts for each supported pair, the expected
Notte country counts, and the new suite ID. All existing tracked JSONL files were
checked byte-for-byte for preservation, including the earlier Notte control.
The publication integration tests in `web/lib/proxy-publication.test.ts` load
the actual saved artifacts, verify every provider/country count and retained
failure, check archived metadata coverage, and exercise dashboard history and API exports
for all five countries. Unsupported markers contribute no attempts or latency.
