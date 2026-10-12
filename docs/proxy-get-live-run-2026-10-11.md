# Additional-provider proxy GET pilot — October 11, 2026

Ran Tilion's documented residential session configuration on the existing EC2
runner, with **10 attempts in each of US, FR, BR, IN, and JP**. Imported all 50
attempts, including failures. Lightpanda has five unsupported markers, one per
country; these are support records, not timed attempts or paid sessions.

| Country | Valid GETs / attempts | Median complete GET | Failure breakdown |
| --- | ---: | ---: | --- |
| US | 4 / 10 | 1,879.45 ms | 6 session-launch failures |
| France | 0 / 10 | — | 5 session-launch failures; 5 US exit mismatches |
| Brazil | 0 / 10 | — | 5 session-launch failures; 5 US exit mismatches |
| India | 0 / 10 | — | 3 session-launch failures; 7 US exit mismatches |
| Japan | 0 / 10 | — | 10 session-launch failures |

The four valid US GETs ranged from 1,654.70 to 2,001.20 ms. All received the
expected 1 MiB body and passed the checksum. The 29 launch failures were HTTP
502 with `session_launch_failed`. The remaining 17 failed attempts exited
through US instead of their requested country and never performed a measured
GET. There were no cleanup errors. A final `GET /v1/sessions` audit returned
HTTP 200 and an empty list.

## Configuration and scope

- Runner: AWS `us-east-1`, `t3.medium`, Linux x64, Node 22.23.2.
- Run: `2026-10-11T16:29:01.373Z` to `2026-10-11T16:33:55.637Z`.
- Suite ID: `a308a19e-7a01-4c79-8f74-95e0b4f93072`.
- Sequential fresh sessions, shuffled countries, starts paced at 10/minute.
- Warm-origin fetch, 30-second workload timeout, no measured-GET retries.
- Target: `https://burning-hop-purchased-trying.trycloudflare.com/api/proxy-get/payload`.
- Bootstrap: the same origin's `/api/proxy-get/bootstrap`.
- Country check: `https://api.country.is/`.
- Expected body: 1,048,576 bytes.
- SHA-256: `7317cbc61ea73cc173a87aacd2f86645ba3932a5f7fb3f04b1c7169a633b7776`.

The controlled payload and bootstrap were served by the local app through a
temporary HTTPS tunnel. EC2 preflight validated the body and hash before paid
session creation. The tunnel was stopped after the suite. This is the same
payload and measurement method as October 8, but a different hostname and day;
the dashboard keeps the workloads separate. Selecting October 8 retains the
original seven-provider comparison. History compares matching workloads within each provider, so the October 8
providers remain visible beside the additional October 11 providers. Different
workloads for the same provider remain separate. The overview table shows
all nine providers with their latest runs through the selected day and an
explicit date on each row; its export and raw details match those rows. The
distribution now plots those same provider suites, omitting Lightpanda because
it has no recorded attempts and showing run dates beside the provider names. Measurements are never backdated or
pooled across provider suites or workloads.

## Tilion

The funded account reported `premium_egress: true` and sufficient remaining
allowances. The pilot requested:

```json
{
  "residential": true,
  "region": "fr",
  "proxy_rotation": "per_session",
  "idle_timeout": 90
}
```

`region` changed to each lower-case country code. All five codes were listed by
`GET /v1/regions`. The adapter verified the returned session region and then
the benchmark independently checked the browser's exit country. Tilion's docs
describe `region` as browser placement, not a separate proxy-country selector;
this pilot tested whether combining it with residential egress would provide
the requested exit. Completed non-US checks did not.

After the pilot, `proxyCountries` was restricted to US. Other countries produce
unsupported markers without creating sessions. The live failed attempts remain
unchanged. Two earlier exploratory smoke attempts (FR and US) also returned
HTTP 502; they are excluded from this 50-attempt suite. No fallback to datacenter
or unproxied traffic was used.

References, checked October 11:

- [Residential egress and rotation](https://docs.tilion.dev/browsers/proxies)
- [Session configuration](https://docs.tilion.dev/browsers/configuration)
- [Create-session API](https://docs.tilion.dev/api-reference/sessions/create-session)

## Lightpanda

The official [proxy guide](https://lightpanda.io/docs/guides/configure-a-proxy)
documents `fast_dc` and country-selectable `datacenter` as built-in datacenter
proxies. Residential requires a separately configured account proxy, then its
identifier in the CDP URL. The west-coast lifecycle runner has a Lightpanda API
key, but no custom CDP endpoint, proxy identifier, or residential country
configuration in its environment. The east runner has no Lightpanda key.

Lightpanda therefore remains unsupported for this native residential comparison.
Its recorded markers explain the reason instead of silently omitting it. No
Lightpanda sessions were created.

## Pricing and validation

Tilion publishes $0.03/browser-hour. At recording time, its usage API exposed
egress credit rates without a verified USD conversion, so total cost was saved
as unknown. A subsequent [pricing reconciliation](proxy-get-pricing-2026-10-11.md)
uses an inferred $0.0002/credit to estimate $0.20/GB and $0.0004/session,
including one session fee per failed launch for budgeting. It adds dated
reconciliations while preserving the original fields. The US estimate is
**$0.00573333/run and $0.00143333/success**; the full pilot estimate is
**$0.02559167**. The summed browser
component for sessions that started and were released is approximately $0.000592;
this is a partial estimate, not a suite total or invoice. Browser-observed traffic
was 4,223,058 bytes and remains a lower bound on provider billing.

Results and environment metadata are in
`results/proxy-get/tilion/2026-10-11/` and
`results/proxy-get/lightpanda/2026-10-11/`.

Root TypeScript build and all 31 benchmark/provider tests passed, including
Tilion request settings, unsupported-country guards, placement rejection,
cleanup error propagation, and the existing browser measurement integration.
The CLI was also checked without Lightpanda credentials: it emitted exactly
five unsupported markers without contacting the payload or creating sessions.
The existing daily lifecycle schedule was not changed.
All 56 web tests passed. A new country-specific region regression check ensures
the API reports the selected country's region, rather than whichever country
was shuffled last in the suite. API checks confirmed the new outcomes and the
original seven-provider October 8 view remain independently selectable. No
page geometry or styling was changed.
