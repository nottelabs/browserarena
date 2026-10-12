# Proxy GET live pilot — October 8, 2026

This exploratory suite completed **350 attempts: 325 successful downloads and 25
failures**, with exactly ten attempts for each of seven providers in each of the
US, France, Brazil, India, and Japan. Failures were retained and not retried.
The colored violin plots at `/proxy-get` show successful samples on a shared
0–30 second axis. The [methodology](proxy-get.md) describes measurement and pricing.

## Environment and workload

- Run ID: `233d7eeb-5304-46e7-aa4e-d302570018cb`.
- Started: `2026-10-08T16:17:30.735Z`; finished: `2026-10-08T17:32:55.917Z`.
- Runner: AWS us-east-1, Ubuntu Linux x64, t3.medium, Node v22.23.2.
- Each trial creates a fresh browser with a native residential country-targeted
  proxy. Country verification uses `https://api.country.is/`.
- Target: `https://refers-pottery-plasma-board.trycloudflare.com/api/proxy-get/payload`.
  This temporary Cloudflare tunnel forwarded to the local production Next server.
  CDN edges and the local origin were not pinned to a benchmark region.
- Body: identical deterministic 1 MiB; SHA-256
  `7317cbc61ea73cc173a87aacd2f86645ba3932a5f7fb3f04b1c7169a633b7776`.
- Browser-side timing consumes the complete response stream, excluding creation,
  connection, setup, country verification, checksum, and release. The bootstrap
  warms the origin connection; this measures a ready browser in a fresh session.
- Browserbase and Steel used us-east-1; Hyperbrowser used us-east. The other
  adapters used provider-default browser placement. Countries refer to proxies.
- Kernel explicitly created `type: "residential"`, `config: { country }`, and
  attached the resulting proxy ID. A post-run check of both source and compiled
  code on EC2 confirmed this configuration; the adapter test checks the request.
  Kernel's default stealth ISP proxy was not the configuration requested here.
  Exit IP network types were not independently classified.

## Results

Each cell gives the median successful complete GET and the success fraction.
Ten attempts are too few for stable tail-latency or provider-ranking claims.

| Provider | US | France | Brazil | India | Japan | Known estimate | Unknown cost attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Anchor Browser | 4.20s (9/10) | 3.68s (10/10) | 2.67s (10/10) | 4.87s (9/10) | 3.36s (10/10) | $0.9592 | 0 |
| Browserbase | 4.40s (8/10) | 6.39s (10/10) | 7.04s (10/10) | 5.37s (10/10) | 4.21s (9/10) | Unknown | 50 |
| Browser Use | 3.78s (9/10) | 3.48s (10/10) | 3.98s (8/10) | 5.21s (9/10) | 4.95s (9/10) | $0.2443 | 0 |
| Hyperbrowser | 2.44s (9/10) | 3.24s (10/10) | 3.50s (10/10) | 4.56s (10/10) | 4.12s (10/10) | $0.5355 | 0 |
| Kernel | 2.94s (10/10) | 3.23s (10/10) | 2.79s (10/10) | 3.41s (10/10) | 2.99s (9/10) | $0.0091 | 1 |
| Notte | 3.56s (6/10) | 2.70s (9/10) | 6.24s (9/10) | 3.86s (9/10) | 3.21s (8/10) | $0.4383 | 0 |
| Steel | 3.09s (9/10) | 2.87s (10/10) | 3.46s (8/10) | 6.01s (10/10) | 5.48s (9/10) | $0.5665 | 1 |

The **known marginal cost estimates total $2.7528** across 298 attempts. Another
52 attempts have unknown total cost: all 50 Browserbase attempts because the
account proxy rate was unavailable, plus one Kernel and one Steel creation
failure. This is not the total invoice. Estimates exclude subscriptions, credits,
taxes, target hosting, and potentially unobserved proxy traffic. Costs include
lifecycle duration even though GET timing excludes it. Kernel proxy use is
unmetered under the configured paid-plan assumptions; the subscription is excluded.

## Infrastructure limitations and failures

Pricing follow-up, October 11: the table above records the original estimates.
Browserbase's finalized session counters and published Developer rates now
support a **$1.264 suite estimate**, preserved in dated `cost_reconciliation`
fields and used by the UI. See the [pricing investigation](proxy-get-pricing-2026-10-11.md)
for per-country values, plan assumptions, and the distinction from an invoice.

The temporary tunnel disconnected at **17:03:47–17:03:48 UTC** during a Steel
Brazil HTTP 502. It disconnected again at **17:31:35 UTC**, failed a reconnect
at **17:32:00 UTC**, and reconnected at **17:32:26 UTC**. The latter outage
overlapped an Anchor India partial-download network failure and five HTTP 530
responses (Browser Use US and twice Brazil, Browserbase US, and Steel Japan).
These seven records carry `infrastructure_note` annotations based on tunnel logs.
Their original timing, status, and success counts are unchanged. Those failures
cannot fairly be attributed to the providers.

Other failures include measured GET timeouts, country-check errors, and two
session-creation errors. Success fractions therefore describe this complete
pilot protocol, including the separate country service and temporary target.
They are not isolated measures of proxy availability. The target outage may also
have affected nearby successful timings; annotated failures alone do not remove
that limitation. Use stable deployed hosting for subsequent comparative suites.

There were pauses between attempts while the local UI was rebuilt. An SSH loss
ended the initial process after 240 recorded attempts. At
`2026-10-08T17:08:39.756Z`, the remaining 110 trials resumed under nohup with the
same run ID, workload, and pricing snapshots. No recorded attempt was removed or
rerun. This interruption and time-varying conditions further limit interpretation.

## Verification and artifacts

- All 35 provider-country pairs have exactly ten attempts.
- All 325 successful records have HTTP 200, 1,048,576 bytes, matching observed
  country, and complete GET timing below the configured 30-second timeout. The
  benchmark validates the expected checksum before recording success.
- The 348 created session IDs are unique; two creation failures have no session ID.
- No recorded cleanup errors. A post-run audit found one unused Kernel proxy
  configuration left by the Japan creation timeout. It was deleted after checking
  ownership and confirming no active browser used it. The final audit at
  `2026-10-08T17:42:52.461Z` found no benchmark Kernel proxies, no active Kernel
  browsers, and no active Steel sessions.
- Raw records and runner metadata: `results/proxy-get/{provider}/2026-10-08/`.
  The same date also contains 11 earlier smoke-test records with separate run IDs;
  the UI selects the completed suite and does not pool these smoke tests.
- Validation: 30 root tests and 43 web tests passed, TypeScript and the production
  web build passed, and the desktop/mobile chart and controls were checked.
