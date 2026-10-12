# The Browser Arena

Open-source, reproducible benchmarks for cloud browser providers.

How long does it take to spin up a browser in the cloud, use it, and tear it down? This project measures that across every major provider, same test, same machine, same conditions, and ranks them on reliability, latency, and cost.

Live results at [browserarena.ai](https://browserarena.ai).

## Background

Steel built the first version of this benchmark ([steel-dev/browserbench](https://github.com/steel-dev/browserbench)) and tested five providers. We extended it: more providers, a scoring system, a public leaderboard, and a structure that can grow with new benchmarks over time.

## How it works

Each provider goes through the same test: create a browser session, connect via CDP, navigate to a page, and release. All tests run from the same EC2 instances so network conditions are comparable. Results show median values across all successful runs.

```
Create session → Connect via CDP → Navigate page → Release session
     (API)          (Playwright)       (goto)           (API)
```

### Test environment

| Region | Instance | OS | Node |
|---|---|---|---|
| AWS us-east-1 | t3.micro | linux x64 | v20.20.0 |
| AWS us-west-1 | t3.micro | linux x64 | v18.20.8 |

### Providers

| Provider | Region | Website |
|---|---|---|
| Notte | us-west-2 | [notte.cc](https://www.notte.cc) |
| Tilion (beta) | us-east-1 | [tilion.dev](https://tilion.dev) |
| Browserbase | us-west-2 | [browserbase.com](https://www.browserbase.com) |
| Steel | us-east-1 | [steel.dev](https://www.steel.dev) |
| Kernel | us-east-1 | [kernel.sh](https://www.kernel.sh) |
| Hyperbrowser | us-east-1 | [hyperbrowser.ai](https://www.hyperbrowser.ai) |
| Anchor Browser | us-east-1 | [anchorbrowser.io](https://www.anchorbrowser.io) |
| Browser Use | us-east-1 | [browser-use.com](https://www.browser-use.com) |
| Lightpanda | us-west-1 | [lightpanda.io](https://lightpanda.io) |

Missing a provider? [Open a PR](https://github.com/nottelabs/browserarena/pulls).

## Session Performance benchmark

The core benchmark measures the minimal end-to-end lifecycle for a remote Chrome session:

1. Create a session via the provider's API
2. Connect Playwright over CDP
3. Navigate to a URL (wait for `domcontentloaded`)
4. Release the session via the provider's API

Two modes:

- Sequential: 100 measured sessions per provider, one at a time
- Concurrent: 100 measured sessions per provider, in batches of 10 parallel sessions

`--concurrency` takes any list of levels (`1,10,25,50`). Check the provider plan's concurrent session cap before turning on c25 or c50, or a plan limit shows up as a reliability drop.

### Browser throughput

`hello-browser` measures how fast you get a browser. The browser throughput benchmark measures what a long-running agent pays once it has one: every session connects, sets a 1920x1080 viewport, and runs loops of ten actions on Wikipedia, each timed on its own.

```
navigate → waitForSelector → screenshot → textContent → click
        → waitForSelector → screenshot → textContent → goBack → waitForSelector
```

Per provider it reports actions per second, task time, per-action median / p95 / p99 for the six action types, within-session drift (last loop over first loop, with `--loops` above 1), and cost per 1,000 actions on the provider's billing. A session is a success only when every action succeeded; the partial completion rate is shown alongside. Start pages come from a fixed pool rotated by date, so every provider walks the same pages on a given day. Live at [browserarena.ai/browser-throughput](https://browserarena.ai/browser-throughput) and `GET /api/browser-throughput`. See [docs/browser-throughput.md](docs/browser-throughput.md).

```bash
npm run bench -- --benchmark=browser-throughput --provider=notte --runs=100
npm run bench -- --benchmark=browser-throughput --provider=notte --runs=25 --loops=5   # fifty actions, for drift
```

## Methodology

### Proxy Performance benchmark

The separate **Proxy Performance** page compares complete 1 MiB downloads through native
residential proxies in the US, France, Brazil, India, and Japan. It defaults to
50 fresh sessions per provider/country, with country verification, browser-side
timing, response validation, and estimated browser-plus-proxy costs.

```bash
npm run bench -- --benchmark=proxy-get --provider=steel,kernel,notte --runs=50
```

Deploy the included controlled target before a live run. See
[setup, pricing, and measurement details](docs/proxy-get.md). The benchmark's
latency excludes create/connect/release; estimated cost includes billable setup
and failed attempts. Unknown prices remain unknown.

### Fairness

- 10 warm-up runs before measurement to reduce cold-start effects. Warm-ups are recorded too, flagged `warmup: true` and excluded from every stat; the first session of a run is flagged `cold_start: true` and surfaced as the cold-start creation time
- Same URL across all providers (`example.com`)
- No provider-specific tuning, default SDK settings only
- Automatic 30s backoff on 429 rate limit errors
- Most provider SDKs auto-retry transient errors; success rates reflect post-retry outcomes

### Network

All providers tested from the same EC2 instances. TCP+TLS round-trip times measured with `curl time_appconnect` (median of 10):

| Provider | CDP endpoint | RTT | Runner |
|---|---|---|---|
| Notte | `[redacted host]` | 12 ms | us-west-1 |
| Hyperbrowser | `connect-us-east-1.hyperbrowser.ai` | 9 ms | us-east-1 |
| Steel | `connect.steel.dev` | 14 ms | us-east-1 |
| Kernel | `api.onkernel.com` | 14 ms | us-east-1 |
| Browser Use | `cdp.browser-use.com` | 29 ms | us-east-1 |
| Anchor Browser | `connect.anchorbrowser.io` | 38 ms | us-east-1 |
| Browserbase | `connect.usw2.browserbase.com` | 62 ms | us-west-1 |

### What the stages actually measure

`create` and `release` timings reflect provider API design (sync vs async session management) more than browser speed. The `connect` + `goto` timings are the best proxy for actual browser performance.

### Percentiles

Every phase is reported at the median, p90, p95 and p99 (`?percentile=p99`). At 100 runs p99 is one of the two slowest runs, so p95 is the steadier tail; p99 is there for the shape of the distribution, not for ranking. Tail totals (p90, p95, p99 of Latency) are percentiles of per-session totals, not sums of per-phase percentiles, so they describe sessions that actually happened.

### Value Score

Each provider gets a single 0-to-1 score combining reliability, latency, and cost. Default weighting is equal (33/33/33). You can shift it on the leaderboard with presets like "Speed first" or "Budget first."

The latency dimension is not the selected percentile alone: 70% is the selected percentile and 30% is the p95 total, both normalized with the same anchors. Two providers with the same median no longer tie when one of them has a long tail, because for anything that runs for hours the tail is what you pay.

Each dimension is normalized to a 0-1 scale using fixed anchors:

| Dimension | 0.0 (unacceptable) | 1.0 (perfect) | Rationale |
|---|---|---|---|
| Reliability | 90% | 100% | Below 90% is unusable in production |
| Latency | 10,000 ms | 0 ms | 10s is a practical timeout threshold |
| Cost | $0.20/hr | $0.00/hr | About 2x the most expensive current provider |

Final score: `w_latency * norm_latency + w_reliability * norm_reliability + w_cost * norm_cost`

Why fixed anchors? Two common alternatives break down:

- Ratio-to-best (`best / yours`) gives each dimension a different effective scale depending on data spread. If latency has a 6.8x range but cost only 2.4x, cost silently dominates even at "equal" weights.
- Min-max on observed data (`(yours - worst) / (best - worst)`) maps the single worst provider in each dimension to 0.00 regardless of the actual gap. 98.3% reliability becomes 0.00 if everyone else is 100%. That's a 1.7% difference, not a zero.

Fixed anchors keep the scales comparable, don't zero anyone out for small gaps, and don't shift when providers are added or removed.

## Reproduce

```bash
git clone https://github.com/nottelabs/browserarena
cd browserarena
npm install
cp .env.example .env   # add your provider API keys
npm run bench -- --provider=notte --runs=100
```

Requires Node.js >= 18. Run `npm run bench -- --help` for all options. Query results locally with [DuckDB](https://duckdb.org/docs/installation/): `duckdb -c ".read queries/hello-browser/simple.sql"`

Or deploy directly on Railway:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/UNedGj?referralCode=YUwE3Q&utm_medium=integration&utm_source=template&utm_campaign=generic)

### Automated runs

Daily results are produced by `scripts/run-and-publish.sh`, which runs one benchmark for one region's providers (c1 + c10 by default, 100 measured sessions per concurrency level), stages only that region's `results/` slice, and pushes to `main`. Two EC2 boxes share the script; the cron lines differ in `--region`, and the browser throughput benchmark is a second invocation offset from the first:

```cron
# us-east-1 box (Steel, Kernel, Hyperbrowser, Anchor Browser, Browser Use)
0 3 * * * /home/ubuntu/browserarena/scripts/run-and-publish.sh --region us-east
0 5 * * * /home/ubuntu/browserarena/scripts/run-and-publish.sh --region us-east --benchmark browser-throughput

# us-west-1 box (Notte, Browserbase) — staggered 1h to avoid push races
0 4 * * * /home/ubuntu/browserarena/scripts/run-and-publish.sh --region us-west
0 6 * * * /home/ubuntu/browserarena/scripts/run-and-publish.sh --region us-west --benchmark browser-throughput
```

`--concurrency 1,10,25,50` and `--loops 5` are accepted on either line; see the plan-cap note above before raising concurrency. The script holds a lock on the checkout, so if the first job overruns its slot the second waits instead of racing it.

Per-EC2 setup: clone the repo, populate `.env` with that region's provider keys, and add an SSH key as a [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) with write access (one key per box). Cron logs go to `logs/` (gitignored).

Proxy Performance has a separate publisher, `scripts/run-proxy-and-publish.sh`, for a
dedicated checkout on the east runner. Five daily batches accumulate to **50
attempts per provider/country** under one daily suite ID; the frontend reads all
batches together. Run `--check` before enabling it. See the
[proxy scheduling and deployment instructions](docs/proxy-get.md#results-and-website)
for the UTC cron lines, prerequisites, and estimated $20.50/day usage budget.

### Regression alerts

`GET https://www.browserarena.ai/api/health` reports whether a provider has regressed against its own 28-day baseline. It answers **200** when healthy and **503** when degraded or when results have gone stale, so an uptime monitor can alert on it with no custom code — point Better Stack, Checkly or Cronitor at the URL.

```console
$ curl -s https://www.browserarena.ai/api/health | jq -r .summary
Notte session release 26ms -> 1.07s (41.2x) since 2026-09-05
```

Use the `www.` host: the apex 307-redirects, and monitors that don't follow redirects misread the 307.

A metric only counts as regressed when **2 of the last 3 run-days** exceed the baseline by **both** 1.5x and 50ms. That combination is what separates a sustained step change from a one-day spike; a day-over-day check fires on the noise and still misses the real thing. `.github/workflows/regression-alert.yml` posts open/close events to Slack, deduped so one incident is one message.

See [docs/regression-detection.md](docs/regression-detection.md) for the thresholds, the calibration against real history, and why there is deliberately no fast path below 24 hours.

## License

MIT
