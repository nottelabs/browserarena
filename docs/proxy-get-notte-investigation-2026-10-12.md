# Notte proxy reliability investigation — October 12, 2026

The October 8 pilot had 41/50 valid Notte attempts overall, including 6/10 in
US. Seven failures occurred in the third-party country check before any measured
GET; two were HTTP 200 downloads that timed out after receiving partial bodies.
The old records only say `Failed to fetch` for country-check failures and do not
prove their underlying cause.

## Reproduction and fix

The current default configuration reproduced a browser-side problem: all 50
country checks failed with `net::ERR_BLOCKED_BY_CLIENT`, `blocked_reason: other`,
and no country-check HTTP response. Each bootstrap loaded with HTTP 200. These
attempts never issued a measured payload GET and all sessions were released.

Notte's live [OpenAPI](https://api.notte.cc/openapi.json) documents `block_ads`
as enabled by default. The bundled uBlock Origin Lite EasyPrivacy rules list
`api.country.is` in a rule that blocks third-party requests (`id: 2`, action
`block`, condition `domainType: thirdParty`). This matches the diagnostic evidence.

The adapter now requests `block_ads: false` when creating country-targeted proxy
benchmark sessions. Ordinary lifecycle sessions keep their existing settings.
The country-check URL, body/checksum, 30-second timeout, and no-retry measurement
protocol stay the same. A second complete suite tests the changed configuration;
each result records the requested setting in `diagnostics.session_config`.

## Method and artifacts

Both suites run on the existing us-east-1 EC2 runner with Node 22.23.2. Each uses
50 sequential fresh sessions, ten in US, FR, BR, IN, and JP, with shuffled country
order and starts paced at ten per minute. There are no measured-GET retries.

Target: `https://tba-eternal-holdem-answer.trycloudflare.com/api/proxy-get/payload`.
The bootstrap uses the same origin. A dedicated Node server on the EC2 runner
serves the same deterministic 1 MiB body and SHA-256 as the October 8 pilot,
through a temporary Cloudflare HTTPS tunnel. Every target request records its
nonce, time, HTTP status, and server completion. An independent non-proxy probe
checks complete bytes and hash about every ten seconds. The monitor starts before
paid attempts. This removes the local laptop from the origin path, but retains
temporary-tunnel/CDN limitations and changes the target host and origin placement;
latencies are not a controlled before/after comparison with October 8.

The public endpoint `https://www.browserarena.ai/api/proxy-get/payload` returned
HTTP 404 before this run. A permanent deployed target is still needed before
publishing comparative claims from this benchmark.

Default-settings suite: `4758e325-044e-448d-bbf6-6c7c07129560`.
Changed-settings suite: `2031e9ca-fe52-4ac3-a2a7-eaba03aadcc5`.

Original failed attempts are retained in
`results/proxy-get/notte/2026-10-12/diagnostics/default-settings-results.jsonl`.
The corrected suite is kept separately in `results.jsonl`, which the dashboard
reads. The diagnostic control is not pooled into its reliability measurement.

Per-attempt logging now includes phase durations, selected response headers,
Chromium network/CORS errors, partial byte counts, and browser errors. Structured
failure logs link the run, requested country, and session ID. Requests and messages
are sanitized; request bodies, cookies, authorization headers, and CDP URLs are
not captured. No failed attempt is removed, retried, or relabeled as a success.

## Completed results

| Country | October 8 | Corrected October 12 | Median valid GET |
| --- | ---: | ---: | ---: |
| US | 6/10 (60%) | 10/10 (100%) | 2,339.95 ms |
| France | 9/10 (90%) | 9/10 (90%) | 1,637.00 ms |
| Brazil | 9/10 (90%) | 10/10 (100%) | 2,844.10 ms |
| India | 9/10 (90%) | 9/10 (90%) | 3,675.00 ms |
| Japan | 8/10 (80%) | 10/10 (100%) | 2,526.55 ms |
| Overall | 41/50 (82%) | 48/50 (96%) | — |

The corrected run has **zero country-check failures or country mismatches**.
Its two failures are valid HTTP 200 downloads aborted by the unchanged 30-second
benchmark deadline. They are retained as failed attempts, with their observed
bytes, first-byte time, CDP error, response headers, and session IDs.

| Country | Failed session | Received / expected bytes | First byte | Origin completion |
| --- | --- | ---: | ---: | ---: |
| France | `50168960-32a6-4c69-b8ec-cb4e6e1c949f` | 548,864 / 1,048,576 | 1,618.60 ms | 1 ms |
| India | `96440d41-1693-4d97-8ba7-978845d0dac3` | 712,704 / 1,048,576 | 1,616.10 ms | 1 ms |

Both requests reached the origin, whose Node response finished in 1 ms. This
means the server handed the body to the tunnel connection, not that the remote
browser received it. Both browser connections used HTTP/2 and reported
`net::ERR_ABORTED` when the benchmark canceled them. Their Cloudflare request
identifiers and nonce-to-origin correlations are retained in `diagnostics/analysis.json`.
The direct monitor completed **90/90 probes** with HTTP 200, the expected byte
count, and matching SHA-256. The tunnel logged no errors or reconnects during the
suites. These facts argue against an origin-wide outage; they do not distinguish
an individual residential exit problem from a CDN or downstream transport stall.

Read-only checks of the provider API/browser logs for the two session IDs found
normal lifecycle closure and no error-level entries (114 and 123 matching API
lines; six browser lifecycle lines each). The blank bootstrap produced screencast
watchdog warnings, which do not identify a network failure. The proxy gateway
logs had no entries matching these session IDs, so they add no request-level
explanation. Only safe evidence counts and the session correlations are stored;
unrelated provider logs are not included in the benchmark artifacts.

A final authenticated audit of all **100 unique session IDs** returned HTTP 200
and `status: closed` for every session. There were no cleanup errors. The target,
tunnel, and monitor processes were stopped after the suites and audit.

The corrected suite's marginal list-price estimate is **$0.51632**, including
failed GETs; browser-observed traffic remains a lower bound on billing. The
control run's estimate is recorded separately in its original attempt rows.

## What this establishes before release

Disabling content filtering fixes the reproduced country-check failure without
weakening country validation or retrying measured requests. It does not establish
96% as a long-term proxy availability rate: there are only ten samples per
country, the reliability measure includes the complete setup/verification/GET
protocol, and the October 8 and October 12 targets differ.

Before publishing provider-comparison claims, deploy a permanent controlled target
(the public route currently returns 404), run every provider against that same
host with recorded content-filter settings, and gather repeated daily samples.
Keep the two download timeouts visible and use the retained session IDs and
Cloudflare request identifiers for any deeper provider/exit investigation.
Changing the timeout or retrying a failed transfer would be a separate workload,
not a fix to hide these failures.

Validation: root TypeScript build and 35 benchmark/provider tests pass, including
Notte's `block_ads: false` request, unchanged lifecycle defaults, country-check HTTP
failure evidence, stalled-body partial bytes, CORS/network error evidence, and
credential/header filtering. Every recorded attempt, country count, payload
validation, and final session status was audited locally.
