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
| Browserbase | us-west-2 | [browserbase.com](https://www.browserbase.com) |
| Steel | us-east-1 | [steel.dev](https://www.steel.dev) |
| Kernel | us-east-1 | [kernel.sh](https://www.kernel.sh) |
| Hyperbrowser | us-east-1 | [hyperbrowser.ai](https://www.hyperbrowser.ai) |
| Anchor Browser | us-east-1 | [anchorbrowser.io](https://www.anchorbrowser.io) |
| Browser Use | us-east-1 | [browser-use.com](https://www.browser-use.com) |

Missing a provider? [Open a PR](https://github.com/nottelabs/browserarena/pulls).

## Benchmark

The core benchmark measures the minimal end-to-end lifecycle for a remote Chrome session:

1. Create a session via the provider's API
2. Connect Playwright over CDP
3. Navigate to a URL (wait for `domcontentloaded`)
4. Release the session via the provider's API

Two modes:

- Sequential: 1,000 runs per provider, one at a time
- Concurrent: 100 batches of 16 parallel sessions

## Methodology

### Fairness

- 10 warm-up runs before measurement to reduce cold-start effects
- Same URL across all providers (`google.com`)
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
| Browser Use | `cdp1.browser-use.com` | 29 ms | us-east-1 |
| Anchor Browser | `connect.anchorbrowser.io` | 38 ms | us-east-1 |
| Browserbase | `connect.usw2.browserbase.com` | 62 ms | us-west-1 |

### What the stages actually measure

`create` and `release` timings reflect provider API design (sync vs async session management) more than browser speed. The `connect` + `goto` timings are the best proxy for actual browser performance.

### Value Score

Each provider gets a single 0-to-1 score combining reliability, latency, and cost. Default weighting is equal (33/33/33). You can shift it on the leaderboard with presets like "Speed first" or "Budget first."

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

## License

MIT
