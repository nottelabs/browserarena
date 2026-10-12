# Proxy Performance benchmark

Compare the time to download a complete, identical response through providers'
native residential proxies in the US, France, Brazil, India, and Japan. The
default is **50 attempts per provider per country**, sequentially, each in a
fresh browser session. Country/provider jobs are shuffled to reduce time-of-day
and run-order bias. There are no automatic measured-GET retries or discarded
warm-up samples. Creation retries are disabled for SDK adapters where supported.

## Run

```bash
npm ci
cp .env.example .env # fill only the provider keys you use
npm run bench -- --benchmark=proxy-get --provider=steel,kernel,notte --runs=50
```

The default target is `https://www.browserarena.ai/api/proxy-get/payload`.
**Deploy this change before using that URL.** The CLI validates the target's
status, byte length, and hash before creating any paid sessions. No provider keys
or paid sessions are needed to run the tests.

To use your own deployment of the same endpoint:

```bash
npm run bench -- --benchmark=proxy-get --provider=steel \
  --url=https://your-benchmark-host.example/api/proxy-get/payload \
  --countries=US,FR,BR,IN,JP --runs=50
```

The host must be publicly reachable from the remote browser. Payload and bootstrap
origins must use HTTPS so browser SHA-256 validation is available. HTTP is allowed
only on localhost, 127.0.0.1, or ::1 for local browser tests; development tunnels
must expose HTTPS. Unsupported origins are rejected before paid sessions. A custom target
path requires `--expected-bytes` and `--expected-sha256`. `--bootstrap-url` must
share the target's origin and serve a minimal document without subresources,
with a CSP that permits the country check. Both endpoints are included in the
web app. `--country-url` can override `https://api.country.is/`; it must return
`{"country":"FR"}` (an ISO country code), permit cross-origin browser requests,
and locate the requesting browser, not the benchmark runner.

Other flags:

* `--timeout-ms=30000`: bounds CDP connection, bootstrap, country check, and the
  complete measured GET separately (maximum 120 seconds).
* `--rate=10`: minimum interval between session starts for each provider, in
  sessions per minute. Kernel defaults to 10; other providers use no extra pacing.
* `--pricing=path/to/config.json`: overrides marginal list-price assumptions.
* `--out=path/to/results.jsonl`: custom output with exactly one provider.
* `--preflight`: verify configured provider credentials and payload/bootstrap
  availability without creating sessions or writing results.
* `--run-id=ID`: resume that suite to the cumulative `--runs` target. Saved
  failures count toward the target; changing its workload or proxy support is
  rejected before sessions. Default output discovery searches all dated provider
  folders, so overnight resumes append to the original file. If an existing ID
  is already split across multiple files, recovery stops before sessions and
  requires reconciliation. Omit the ID for a new independent suite.

Damaged historical JSONL rows produce a warning with the file and line number;
unrelated new suites can still start on a new date. A suite identified in valid
rows, a truncated row's surviving ID, or its metadata cannot resume from a
damaged file. The destination file is also checked before replacing metadata or
opening any sessions, including with `--out`. Files are never silently repaired
or truncated. Restore the original data or reconcile incomplete attempts against
provider session/usage logs before resuming; simply discarding a partial row can
repeat a paid attempt. If no suite ID survives, use the warning to investigate
the file before reusing any of its old IDs. Preflight checks credentials and
endpoints independently of saved history and does not modify it.

`--record` and concurrent runs are unsupported. `RUNS`, `PROVIDER`, and `URL`
remain available as environment defaults; proxy-specific environment defaults
are documented in `.env.example`.

## Measurement

1. Create a country-targeted native residential proxy session.
2. Connect over CDP; open a new page; disable cache and bypass service workers.
3. Load the controlled, empty bootstrap document and check the exit country.
4. Start a timer **inside the remote browser**, issue one GET with a unique query
   nonce, and consume its response stream until the final byte.
5. Validate HTTP 200, byte length, and SHA-256 after the timer stops.
6. Release the session and collect provider-metered traffic when available.

The connection mode is **warm origin, fresh session**. Loading the bootstrap
warms the browser-to-target connection before measurement. This avoids relying
on opaque cross-origin responses or disabling browser security. It measures
ready-browser download performance, rather than cold DNS/TCP/TLS establishment.
Session creation, CDP connection, page setup, country verification, checksum
work, and release are excluded from `get_ms`. `first_byte_ms` is the time until
the first body chunk is available to JavaScript; `headers_ms` is separate. This
is not a packet-level measurement. Effective Mbps uses total body bytes divided
by the whole GET duration, including latency; it is not sustained link capacity.

The target serves deterministic pseudo-random **1 MiB** data, has no subresources
or redirects, and sends `no-store`, `no-transform`, and identity encoding. Every
provider uses the same URL and expected hash. The page rejects different bodies,
short downloads, redirects, errors, and timeouts. Failed requests do not enter
the successful-latency distribution. A valid GET remains successful if cleanup
fails; cleanup errors are displayed separately and the session's cost is unknown.

Country targeting is best effort on some providers. A mismatch is a failed
attempt; it is never silently relabeled. Country checking is a separate
destination: residential providers can choose different exits for different
destinations, so this verifies session country routing without guaranteeing the
precise exit of the payload request. A deployment that independently geolocates
requests to the target can strengthen that check later.

This benchmarks **browser → residential proxy → destination**, not proxy hardware
in isolation. Browser region, provider routing, load, target location, and CDN
edge selection affect it. The default web deployment may use distributed origin
infrastructure; it is not a fixed-region networking laboratory. Record hosting
and browser-region changes when interpreting results. `provider-default` means
the adapter does not pin or obtain a region. Fifty samples improve daily median and reliability estimates, but remain limited for tail latency; show
the individual samples, median, range, and success fraction, not p95/p99 claims.

## Provider support

| Integration | Native country targeting | Configuration reference |
| --- | --- | --- |
| Browserbase | US, FR, BR, IN, JP | [Proxies](https://docs.browserbase.com/platform/identity/proxies) |
| Steel | US, FR, BR, IN, JP | [Proxies](https://docs.steel.dev/overview/stealth/proxies) |
| Kernel / Kernel headful | US, FR, BR, IN, JP | [Residential](https://kernel.sh/docs/proxies/residential) |
| Notte | US, FR, BR, IN, JP | [Proxies](https://docs.notte.cc/features/sessions/proxies) |
| Hyperbrowser | US, FR, BR, IN, JP | [Proxies](https://hyperbrowser.ai/docs/sessions/proxy) |
| Anchor Browser | US, FR, BR, IN, JP | [Proxies](https://docs.anchorbrowser.io/advanced/proxy) |
| Browser Use | US, FR, BR, IN, JP | [Proxies](https://docs.browser-use.com/cloud/browser/proxies) |
| Tilion | US verified in the October 11 pilot; other exits unverified | [Residential egress](https://docs.tilion.dev/browsers/proxies), [Session regions](https://docs.tilion.dev/browsers/configuration) |
| Lightpanda | Unsupported with built-in proxies (datacenter only) | [Proxy guide](https://lightpanda.io/docs/guides/configure-a-proxy); requires a separately configured residential proxy |

Tilion requests `residential: true`, the lower-case country as `region`, and
`proxy_rotation: "per_session"`. Its region field describes browser placement,
not a documented independent proxy-country setting. The October 11 pilot tried
all five regions: only US exits produced valid measurements. Future suites allow
US only until another country passes verification; the pilot preserves every
failed attempt. Creation and release requests have bounded timeouts, placement
is checked, and proxy sessions use a 90-second idle timeout.
Lightpanda has no residential country configuration on the runner. Its built-in
`fast_dc` and `datacenter` proxies are excluded. Unsupported markers need no
credentials and create no sessions.

Support here means the documented API accepts targeting, not guaranteed capacity
in every country or availability on every account. Provider plan restrictions
and account funding still apply. Kernel proxy configurations are separate
resources, created per trial and deleted after the browser is released.
Kernel's [stealth default](https://kernel.sh/docs/browsers/bot-detection/stealth)
uses ISP proxies hosted in datacenters with ISP-assigned IP addresses. This
benchmark overrides that default: it creates `type: "residential"` with the
requested country and attaches the resulting proxy ID to the browser. The
adapter test checks both the proxy type and its attachment. Residential here
describes the requested provider configuration; the country check does not
independently classify each exit IP's network type.
Anchor’s default ad blocker blocks the cross-origin country-check request, so
proxy GET sessions disable ad blocking and its dependent popup blocker. Notte
proxy GET sessions request `block_ads: false`: its default tracker rules include
`api.country.is` and can reject the country check with `net::ERR_BLOCKED_BY_CLIENT`.
Lifecycle sessions retain their existing defaults.

## Reading the chart

The provider table uses the lifecycle benchmark's terminology and number
formatting: **Runs**, **Reliability (%)** (one decimal), and **Latency (ms)**
(rounded whole milliseconds). For proxy GET, latency is the median successful
complete GET time and excludes lifecycle/setup time. First-byte time is also
rounded to milliseconds; **Throughput (Mbps)** uses two decimals. **Cost/success
($)** and **Run cost ($)** use five decimals to keep small usage estimates
visible. Cost per success includes failed attempts. Metrics requiring successful
GETs show **N/A** when none succeeded; unsupported countries have no invented
reliability or run count. Header tooltips explain these definitions.

The colored horizontal violins share a linear time axis fixed to the configured
timeout across countries. The median is the dark marker; colored points are
actual successful samples, with exact values on hover or keyboard focus. Switch
between the complete GET and first-byte time, or hide the raw points.

Shapes use a Gaussian kernel density estimate, one shared bandwidth across
providers in the selected view, and reflection at zero to avoid suggesting
negative durations. Each shape is normalized to the same maximum width. With
fewer than three successful samples, only points and the median are shown.
These shapes are exploratory summaries of the recorded successful attempts, not population or tail
latency estimates. Failures remain in the success counts and raw results.

## Cost estimates

List rates and provenance are in `src/benchmarks/proxy-get/pricing.ts`, checked
October 8, 2026 (Browserbase and Tilion checked October 11). This benchmark deliberately keeps its pricing separate from the
existing lifecycle leaderboard. Monthly subscriptions, account credits,
discounts, taxes, and fixed target hosting fees are excluded.

| Provider | Browser $/hour | Proxy $/GB | Assumption |
| --- | ---: | ---: | --- |
| Notte | 0 | 10 | Listed usage |
| Steel | 0.10 | 10 | Launch; browser minutes round up |
| Browserbase | 0.12 | 12 | Developer list rates; account plan unconfirmed; Startup overrides are $0.10/hour and $10/GB |
| Kernel | 0.06 | 0 | Headless; managed proxies unmetered; paid plan required |
| Kernel headful | 0.48 | 0 | Headful; managed proxies unmetered |
| Hyperbrowser | 0.10 | 10 | Listed credits |
| Anchor Browser | 0.05 | 8 | Infrastructure; $0.01 creation fee |
| Browser Use | 0.02 | 5 | Listed usage; browser minutes round up |
| Tilion | 0.03 | 0.20 | Inferred $0.0002/credit; $0.0004/session, including failed launches as a budgeting assumption; decimal MB rounded up |

Browser usage is estimated over creation-start through successful release, with
configured billing increments, minimums, and creation fees. This is a conservative
wall-time approximation, not a provider invoice; actual billable start/stop and
idle semantics can differ. Kernel, for example, excludes standby time. Browserbase
proxy sessions have a 1 MB minimum; the estimate conservatively rounds traffic
up in MB increments. Provider-specific bandwidth units are configurable.

The [October 11 pricing investigation](proxy-get-pricing-2026-10-11.md) reconciles
Browserbase's recorded sessions with finalized provider traffic and current
Developer rates. Each original JSONL record is preserved, with a dated
`cost_reconciliation` added. The table, history, and raw detail view use that
recalculation; exports contain both the original fields and the reconciliation.
Historical costs are therefore explicitly current-rate estimates, not original
invoices. Cost-cell hover text and raw details explain incomplete estimates.
Tilion's configured Scale allowance covers current usage, but included-account
usage is not substituted for the comparative list-price metric. Its pricing
estimate uses the published $0.03/hour divided by the configured account's 150
credits/hour, giving $0.0002/credit: $0.20/GB and $0.0004/session. Traffic rounds
up in decimal MB. Failed launches with no returned session or traffic are
budgeted as one $0.0004 session fee and no additional unobserved usage. These
are explicit inferred assumptions, not verified invoice rules. The October 11
Tilion records also retain originals alongside dated `cost_reconciliation` fields.

Steel and Browserbase traffic counters replace browser observations when they
are available and finalized. Otherwise, CDP network events account for the
bootstrap, country lookup, payload, and partial failed downloads on the test page.
These are a **lower bound** on billable bandwidth: proxy authentication, TLS,
other browser traffic, and provider overhead can be omitted. Counter retrieval
errors are saved separately. GET-only body size is never presented as an invoice.

Unknown proxy rates or unconfirmed cleanup make total cost unknown. All attempt
costs, including failures, are summed. Cost per successful GET divides that total
by successful attempts; zero successes have no cost-per-success value.

Example account override (uppercase provider IDs):

```json
{
  "BROWSERBASE": {
    "proxyPerGbUsd": 12,
    "plan": "My account's contracted rates",
    "checkedAt": "2026-10-08",
    "sourceUrls": ["https://www.browserbase.com/pricing"]
  },
  "STEEL": {
    "plan": "Scale",
    "browserPerHourUsd": 0.08,
    "proxyPerGbUsd": 6
  }
}
```

The Browserbase value above is illustrative, not a verified published rate.

## Results and website

Results append to `results/proxy-get/{provider}/{YYYY-MM-DD}/results.jsonl` with a
suite `run_id`, workload definition, per-phase timings, outcome, traffic, pricing
snapshot, and errors. `_meta.json` records runner environment and suite options.

Each attempt also records bounded network diagnostics for the bootstrap, country
check, and payload: per-phase durations, HTTP status, Chromium network/CORS error,
received bytes, selected response headers, and browser error messages. Request
URLs omit query strings; headers use an allowlist; messages redact secrets.
Failures are emitted as structured `PROXY_GET_FAILURE` log entries with run and
session IDs, including cleanup failures. These diagnostics do not retry requests
or alter the measured GET interval. A failed country check is an end-to-end
protocol failure, not evidence that a measured payload GET failed.

`scripts/run-proxy-and-publish.sh` publishes the proxy results to `main`,
separately from the lifecycle script. Use a dedicated checkout on the east EC2
runner, with the nine configured integrations (seven five-country providers,
Tilion US only, and unpaid Lightpanda unsupported markers). Kernel headful remains
available through the CLI but is not part of this default daily budget.

The publisher uses a lock, checks every supported provider's required keys and
the target before sessions, preserves partial results, stages proxy samples and
metadata across all saved dates with their index, and rebases/retries pushes
against concurrent lifecycle publication. Unrelated artifacts are not staged;
older interrupted results are published rather than referenced without files.
Each CLI suite writes `results/proxy-get/index.json`; the publisher commits it
with the samples. Deployed Vercel pages fetch the index and JSONL from raw GitHub
with a 60-second cache. Production follows `main`; Vercel previews use their
deployed Git commit (or branch if the commit SHA is unavailable) so unmerged
pilot results appear in the preview. `RESULTS_GITHUB_BRANCH` overrides either
default. This avoids relying on immutable build-time results or
the unauthenticated Contents API quota. Local development still reads files.
It never resets the checkout. It requires `main` for publication; `--check` can
verify a feature branch without sessions or publication. Logs and every failure's
diagnostics remain on EC2; per-attempt diagnostics are also in the published JSONL.

After merging/deploying this PR, prepare the dedicated checkout on EC2:

```bash
git clone git@github.com:nottelabs/browserarena.git /home/ubuntu/browserarena-proxy-daily
chmod 700 /home/ubuntu/browserarena-proxy-daily
cp /home/ubuntu/browserarena/.env /home/ubuntu/browserarena-proxy-daily/.env
chmod 600 /home/ubuntu/browserarena-proxy-daily/.env
cd /home/ubuntu/browserarena-proxy-daily
npm ci
scripts/run-proxy-and-publish.sh --check
```

On a UTC-configured host, add these lines alongside the existing lifecycle cron:

```cron
0 1 * * * /home/ubuntu/browserarena-proxy-daily/scripts/run-proxy-and-publish.sh --batch 1
0 5 * * * /home/ubuntu/browserarena-proxy-daily/scripts/run-proxy-and-publish.sh --batch 2
0 9 * * * /home/ubuntu/browserarena-proxy-daily/scripts/run-proxy-and-publish.sh --batch 3
0 13 * * * /home/ubuntu/browserarena-proxy-daily/scripts/run-proxy-and-publish.sh --batch 4
0 17 * * * /home/ubuntu/browserarena-proxy-daily/scripts/run-proxy-and-publish.sh --batch 5
```

Each batch increases the same UTC day's attempt target to 10, 20, 30, 40, then
50 per supported provider/country. An interrupted batch resumes saved progress;
a missed earlier batch is caught up by the next cumulative target. Repeating a
completed batch does not create more sessions. A killed in-flight session may
still incur usage without a saved attempt; audit retained session IDs/logs when
recovering a process interruption. Keep one publishing runner for this proxy
slice; using a second machine with the same daily ID is not supported.

The frontend aggregates this daily ID, so its table, daily distribution, cost,
and history contain all five batches rather than just the latest ten attempts.
Results during the day are partial, with the actual attempt count shown. The
seven-day chart still averages daily medians equally. Based on the pilots, budget
roughly $20.50/day ($615/30 days) for the daily usage, excluding subscriptions and
EC2/hosting; unknown charges and browser-observed traffic prevent an exact invoice.

Operational activation requires the deployed HTTPS endpoints to pass preflight,
the existing write-enabled Git deploy key, and successful EC2 `--check`. This
commit prepares the scripts and schedule; it does not merge the PR or install cron.

On October 12 the east runner was checked directly: Node 22.23.2, active cron,
UTC timezone, all eight required paid-integration credential sets present, 8.1 GB
disk available, and successful lifecycle Git publication earlier that day. A
dedicated `/home/ubuntu/browserarena-proxy-daily` checkout was prepared on the PR
branch with private environment permissions. Its build passes; production
preflight stops on the undeployed payload's HTTP 404 before any sessions. After
merge, switch that checkout to `main`, pull, pass `--check`, then install cron.

`/proxy-get` reads local results in development and falls back to the configured
GitHub results repository in a web-only deployment. `RESULTS_DIR` optionally
points to the directory containing the benchmark folders. The overview table keeps each provider
visible using its latest suite up to the selected UTC day, with the run date
under its name. Dates and target hosts may differ across rows; each row retains
its own samples and pricing. It does not combine reruns or workloads into a
provider measurement. Countries absent from a newer suite are not resurrected
from older runs. The export button uses `GET /api/proxy-get?country=FR&view=overview`
(with the selected `date`) and exports the same table rows and raw samples.
Without `view=overview`, the API continues returning the selected-day or latest
compatible-workload summary for that day.

The public `/proxy-get` dashboard includes daily history for each
country, with complete GET, first-byte, and estimated cost-per-success series.
Click a point or choose a run day to inspect provider runs available up to
that day. The overview table and distribution use the same latest provider
suites, with a recorded date on each row; raw attempts and the table export
cover those same suites. Distributions omit providers with no recorded attempts
(such as unsupported Lightpanda), while retaining attempted runs with no
successful samples. Unsupported providers are also omitted from history legends.
`date=YYYY-MM-DD` selects the latest provider suite assigned to that UTC day;
suites crossing midnight are assigned whole to their final day. Missing runs,
failed latency measurements, and unknown costs remain gaps. History compares workloads within each provider, using that provider’s latest
workload as of the selected day. A different target used by another provider does
not hide its recorded history. A provider’s incompatible days remain gaps without
hiding other providers on those days; rolling averages never mix its workloads.
Providers first recorded after the selected day are excluded until that day is
selected. Other workloads remain selectable for inspection. `/api/proxy-get?country=FR&date=YYYY-MM-DD` exports that day's results
and returns 404 if no run is recorded for that date. Without `date`, the latest
compatible recorded run is selected. The public page and API always use recorded
results, including when a `demo` query parameter is supplied.

The `/test` proxy view defaults to a clearly labeled 14-day simulation seeded
from the latest recorded samples. Its day picker, violin plot, and tables use
generated values; no result files are changed. Choose **Show recorded data** or
append `demo=0` to inspect only published runs. Demo exports use `/test/export`
and explicitly include `simulated: true`; the real API never serves demo data.

Recorded history is populated by published result files. The UI does not enable
cron; install the separate proxy schedule described above to collect daily data.

The accepted `/test-compressed` layout now powers `/proxy-get`: the daily provider table spans
the main container, followed by two charts side by side: the trailing 7-day rolling
average on the left and the latest provider runs' violin plot on the right. Benchmark,
History, and Results headings follow the lifecycle page's hierarchy, with the
range and day controls above the chart panels. The charts stack on narrower
screens. Panels, section gaps, page padding, and controls use the lifecycle
page's spacing scale. The table-to-history gap matches lifecycle, and chart
controls sit below the section descriptions on both views.
Country and day changes retain the current results while a shared,
delayed progress indicator runs; chart choices persist across country changes.
Motion respects the reduced-motion preference. The trend averages available daily medians (or
daily cost-per-success estimates) with equal weight per day; early windows are
partial, and missing current measurements remain gaps. Clicking a rolling point
selects the latest unsmoothed provider suites available through that day. Raw attempts, pricing
sources, failure notes, and methodology remain available below the charts.
The `/test-compressed` preview still defaults to the labeled simulation and
supports `demo=0` for recorded results.

Both public benchmarks share the floating Benchmark and Config sidebar, without
reducing the main container's width. Country choices include flags. On narrower
screens a visible menu button opens a slide-out sidebar. `/benchmark` provides
two cards linking to browser lifecycle (`/`) and proxy GET (`/proxy-get`).

The first [live pilot report](proxy-get-live-run-2026-10-08.md) records the complete
350-attempt suite and its temporary-target limitations.

The [additional-provider pilot report](proxy-get-live-run-2026-10-11.md) records
Tilion attempts and Lightpanda support status. Its date and temporary target differ
from October 8; use the day picker to inspect each workload separately.

The [Notte reliability investigation](proxy-get-notte-investigation-2026-10-12.md)
records the October 12 default-setting control, the ad-blocking correction, and
the 48/50 corrected result with both remaining partial-download timeouts.
