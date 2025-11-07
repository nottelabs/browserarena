# Browser Arena

### How fast is "Hello, browser?"

This benchmark measures the minimal end-to-end lifecycle for a remote, provider-hosted Chrome session. Originally based on [Steel's open-source browser benchmark](https://github.com/steel-dev/browserbench), we've extended it to cover more providers and refined the methodology.

Every provider is tested with the same four steps:

1. **Create** a session (control plane)
2. **Connect** Playwright over CDP (data plane)
3. **Navigate** to a URL (wait for `domcontentloaded`)
4. **Release** the session (control plane)

Providers: **Browserbase**, **Steel**, **Kernel**, **Notte**, **Hyperbrowser**, **Anchor Browser**, **Browser Use**.

## Methodology

### 1,000 runs per provider

We reduced the sample size from 5,000 to 1,000 runs per provider.
### Region: AWS us-east-1

All benchmarks run from a single **AWS EC2 t3.micro in us-east-1**. We verified latency to each provider's actual CDP WebSocket endpoint (not their CDN-fronted API) by creating real sessions and measuring TCP+TLS connect time from the VM:

| Provider | CDP Host | Median RTT | Location |
|---|---|---|---|
| Browserbase | `connect.use1.browserbase.com` | 14ms | us-east-1 |
| Steel | `connect.steel.dev` | 14ms | us-east-1 |
| Notte | `us-prod.notte.cc` | 14ms | us-east-1 |
| Kernel | `proxy.*.onkernel.com` | 34ms | Montreal (YUL) |
| Anchor Browser | `connect.anchorbrowser.io` | 39ms | us-east-2 (Ohio) |
| Hyperbrowser | `connect-us-east-1.hyperbrowser.ai` | 16ms | us-east-1 (configured) |
| Browser Use | `*.cdp*.browser-use.com` | 28ms | us-east-2 (Ohio) |

For providers that support region selection, we explicitly set **us-east**:
- **Browserbase**: `region: "us-east-1"` (hardcoded in provider)
- **Hyperbrowser**: `region: "us-east"` (session parameter)

The remaining providers (Kernel, Anchor Browser, Browser Use, Notte, Steel) don't expose a region selector.

The remaining providers don't expose a region selector — their browser instances run in fixed locations.

### Fairness

- **10 warm-up runs** per provider before measurement to reduce cold-start effects
- **Same URL** (`google.com`) across all providers
- **No provider-specific tuning** — default settings only
- **Rate limit handling**: automatic 30s backoff on 429 errors

Note that `create` and `release` timings reflect API design choices (sync vs async cleanup) more than browser performance. The `connect` + `goto` timings best represent actual browser speed.

## Quickstart

### Requirements

- Node.js >= 18

### Install

```bash
git clone https://github.com/nottelabs/browserarena
cd browserarena
npm install
```

### Configure

Copy the example file and add API keys for whichever providers you will run:

```bash
cp .env.example .env
```

Set the variables for those providers (leave the rest unset or empty):

| Variable | Provider |
| --- | --- |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Browserbase |
| `STEEL_API_KEY` | Steel |
| `KERNEL_API_KEY` | Kernel |
| `NOTTE_API_KEY` | Notte |
| `HYPERBROWSER_API_KEY` | Hyperbrowser |
| `ANCHORBROWSER_API_KEY` | Anchor Browser |
| `BROWSER_USE_API_KEY` | Browser Use |

You can also set CLI defaults via the environment — same names as in [CLI options](#cli-options) (`BENCHMARK`, `PROVIDER`, `RUNS`, `URL`, `OUTPUT`, `RATE`, `CONCURRENCY`) — instead of passing flags every time.

### Run

```bash
npm run build
npm run bench -- --provider=steel --runs=1000 --url=https://google.com/
```

Or run directly during development:

```bash
npm run dev -- --provider=steel --runs=20
```

Run all providers (sequentially, 1000 runs each):

```bash
npm run build
npm run bench -- --provider=browserbase,steel,kernel,notte,hyperbrowser,anchorbrowser,browser-use
```

### View results

Requires [DuckDB](https://duckdb.org/docs/installation/) installed.

```bash
# Quick summary (median per provider, sorted by total latency)
duckdb -c ".read queries/hello-browser/simple.sql"

# Full breakdown (median, p90, p95, min, max per stage)
duckdb -c ".read queries/hello-browser/full.sql"
```

## CLI options

| Flag | Default | Description |
|---|---|---|
| `--provider` | `browserbase` | Provider name or comma-separated list. Available: `browserbase` (`bb`), `steel`, `kernel`, `kernel-headed`, `notte`, `hyperbrowser` (`hyper`), `anchorbrowser` (`anchor`), `browser-use` (`bu`) |
| `--benchmark` | `hello-browser` | Benchmark to run: `hello-browser` or `v0` |
| `--runs` | `1000` | Number of measured iterations per provider |
| `--url` | `https://google.com/` | Page to navigate to |
| `--out` | auto | Output path (default: `results/{benchmark}/{provider}/{date}.jsonl`) |
| `--rate` | unlimited | Max sessions per minute |
| `--concurrency` | `1` | Concurrency level (v0 benchmark only) |

Behavioral details:

- 10 warm-up iterations per provider (not written to results)
- Kernel: built-in 10 sessions/min rate limit in hello-browser
- Browserbase: 3s minimum floor per cycle to avoid rate-limit bursts
- All providers: 30s backoff on 429 rate limit errors

## What gets measured

Each iteration records (in milliseconds):

| Field | Description |
|---|---|
| `session_creation_ms` | Control plane latency to create a session |
| `session_connect_ms` | Playwright `connectOverCDP` handshake |
| `page_goto_ms` | `page.goto(url, { waitUntil: "domcontentloaded" })` |
| `session_release_ms` | Control plane latency to release the session |

Output is JSON Lines (one object per line), appended to `results/hello-browser/{provider}/{date}.jsonl`.

## Web app

The `web-app/web` directory contains a Next.js app that shows the benchmark leaderboard: choose **Hello Browser** or **v0**, sort by **price**, **latency**, or **reliability**, and when sorting by latency pick **median**, **P90**, or **P95**. It includes a total-latency stacked bar chart. Results are read from a local `results/` tree when present (e.g. after running the benchmark); otherwise they are fetched from GitHub (see env vars below).

```bash
cd web-app/web
npm install
npm run dev
```

**Env vars** (optional):

- `RESULTS_GITHUB_REPO` – GitHub repo for results (default: `nottelabs/browserarena`)
- `RESULTS_GITHUB_BRANCH` – Branch to fetch from (default: `main`)

## License

MIT
