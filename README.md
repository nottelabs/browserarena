# Browser Arena

Open benchmarks for cloud browser providers. Two benchmarks test different aspects of browser performance:

- **Hello Browser** — minimal session lifecycle (create, connect, navigate, release)
- **v0** — realistic workflow (extract data, crawl pages, fill forms)

Providers: **Browserbase**, **Steel**, **Kernel**, **Notte**, **Hyperbrowser**, **Anchor Browser**, **Browser Use**.

## Benchmarks

### Hello Browser

Measures the minimal end-to-end lifecycle for a remote Chrome session:

1. **Create** a session (control plane)
2. **Connect** Playwright over CDP (data plane)
3. **Navigate** to a URL (wait for `domcontentloaded`)
4. **Release** the session (control plane)

Supports concurrency testing (`--concurrency=16`) to measure provider performance under parallel load.

### v0

Simulates a realistic workflow across 16 Wikipedia pages and a form submission:

1. **Extract** — Navigate to a seed article, scroll to trigger lazy content, extract structured data (title, summary, infobox, headings, links, word count, image count)
2. **Crawl** — Two-level deep crawl: follow 5 links from the seed, then 2 links from each of those (15 additional pages), scrolling and extracting on every page
3. **Form** — Navigate to httpbin, fill a form with the collected research data, submit, and verify the response

Data flows between phases: links extracted in Phase 1 drive Phase 2 navigation, and all extracted data feeds into Phase 3's form fill.

## Methodology

### Sample size

- **Hello Browser**: 1,000 runs per provider (sequential), 100 batches of 16 (concurrent)
- **v0**: configurable, default 1,000

### Benchmark runner & RTT

Two AWS EC2 VMs (t3.micro) run the benchmarks. TCP+TLS RTT measured with `curl time_appconnect`, median of 10.

| Provider | CDP host | RTT | Runner region |
|---|---|---|---|
| Notte | `[redacted host]` | 12ms | us-west-1 |
| Steel | `connect.steel.dev` | 14ms | us-east-1 |
| Kernel (Headless) | `api.onkernel.com` | 14ms | us-east-1 |
| Kernel (Headful) | `api.onkernel.com` | 14ms | us-east-1 |
| Hyperbrowser | `connect-us-east-1.hyperbrowser.ai` | 9ms | us-east-1 |
| Browser Use | `cdp1.browser-use.com` | 29ms | us-east-1 |
| Anchor Browser | `connect.anchorbrowser.io` | 38ms | us-east-1 |
| Browserbase | `connect.usw2.browserbase.com` | 62ms | us-west-1 |

### Fairness

- **Warm-up runs** before measurement (10 for hello-browser, 3 for v0)
- **Same URL** across all providers (`google.com` for hello-browser, Wikipedia AI article for v0)
- **No provider-specific tuning** — default settings only
- **Rate limit handling**: automatic 30s backoff on 429 errors

Note: `create` and `release` timings reflect API design choices (sync vs async cleanup) more than browser performance. The `connect` + `goto` timings best represent actual browser speed.

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

```bash
cp .env.example .env
```

Add API keys for the providers you want to test:

| Variable | Provider |
|---|---|
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Browserbase |
| `STEEL_API_KEY` | Steel |
| `KERNEL_API_KEY` | Kernel |
| `NOTTE_API_KEY` | Notte |
| `HYPERBROWSER_API_KEY` | Hyperbrowser |
| `ANCHORBROWSER_API_KEY` | Anchor Browser |
| `BROWSER_USE_API_KEY` | Browser Use |

### Run

```bash
# Hello Browser — single provider, 100 runs
npm run bench -- --provider=notte --runs=100

# Hello Browser — concurrent (16 parallel sessions)
npm run bench -- --provider=notte --concurrency=16 --runs=100

# v0 — data extraction and filling worflow benchmark
npm run bench -- --benchmark=v0 --provider=notte --runs=10

# All providers, default settings
npm run bench
```

### View results

Requires [DuckDB](https://duckdb.org/docs/installation/).

```bash
# Quick summary (median per provider, sorted by total latency)
duckdb -c ".read queries/hello-browser/simple.sql"

# Full breakdown (median, p90, p95, min, max per stage)
duckdb -c ".read queries/hello-browser/full.sql"
```

## CLI options

| Flag | Default | Description |
|---|---|---|
| `--provider` | all providers | Comma-separated names |
| `--benchmark` | `hello-browser` | `hello-browser` or `v0` |
| `--runs` | `1000` | Measured iterations per provider |
| `--concurrency` | `1` | Parallel sessions per iteration |
| `--url` | auto | Target URL (hello-browser: `google.com`, v0: Wikipedia AI article) |
| `--rate` | unlimited | Max sessions per minute |
| `--out` | auto | Output path |

All flags can also be set via environment variables (`BENCHMARK`, `PROVIDER`, `RUNS`, `CONCURRENCY`, `URL`, `OUTPUT`, `RATE`).

## What gets measured

### Hello Browser

| Field | Description |
|---|---|
| `session_creation_ms` | Control plane latency to create a session |
| `session_connect_ms` | Playwright `connectOverCDP` handshake |
| `page_goto_ms` | `page.goto(url, { waitUntil: "domcontentloaded" })` |
| `session_release_ms` | Control plane latency to release the session |
| `concurrency` | Number of parallel sessions in this batch |

Output: `results/hello-browser/{provider}/{date}/c{N}/results.jsonl`

### v0

| Field | Description |
|---|---|
| `session_creation_ms` | Control plane latency to create a session |
| `session_connect_ms` | Playwright `connectOverCDP` handshake |
| `extract_ms` | Phase 1: navigate + scroll + extract structured data |
| `crawl_ms` | Phase 2: two-level crawl across 15 pages |
| `form_ms` | Phase 3: form fill + submit + verify |
| `total_agent_ms` | Total time for all three phases |
| `session_release_ms` | Control plane latency to release the session |
| `cost_usd` | Estimated cost for this session |

Output: `results/v0/{provider}/{date}/results.jsonl`

## Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/UNedGj?referralCode=YUwE3Q&utm_medium=integration&utm_source=template&utm_campaign=generic)

Set your provider API keys as environment variables in the Railway dashboard.

## License

MIT
