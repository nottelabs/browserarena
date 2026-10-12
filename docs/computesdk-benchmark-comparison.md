# ComputeSDK browser benchmarks vs. Browser Arena

A comparison of what [ComputeSDK Benchmarks](https://www.computesdk.com/benchmarks/browsers)
([source](https://github.com/computesdk/benchmarks)) measures for cloud browser
providers against what this repo measures, and a shortlist of ideas worth
adopting here. Written against their repo state of 2026-10-09 (their latest
published run) and ours of 2026-10-12.

## What they run

ComputeSDK publishes two browser leaderboards. Both rank seven providers
(Tilion, Kernel, Browser Use, Browserbase, Hyperbrowser, Steel, Notte) on a
0-100 composite score, higher is better.

### Browser Lifecycle

Same shape as our `hello-browser`: create a session, connect over CDP, load
`https://www.example.com`, release.

| | ComputeSDK | Browser Arena |
|---|---|---|
| Cadence | Weekly, Friday 10:00 UTC (daily reruns are a paid tier) | Daily, 03:00 / 04:00 UTC |
| Runner | GitHub Actions on Namespace runners, region not published | Two AWS `t3.micro` boxes, us-east-1 and us-west-1, RTT table published |
| Sessions per provider | 100 | 100 at c1 and 100 at c10 |
| Warm-up | None found in the runner | 10 discarded warm-up sessions |
| Navigation wait | `load` | `domcontentloaded` |
| Provider access | Their own `@computesdk/<provider>` wrapper packages | Each provider's SDK or REST API directly |
| Stats published | median, p95, p99 per phase and total | median, p90, p95 per phase and total |
| Success rate | Fraction of iterations without error | Same, plus failures grouped by stage and error message, with error screenshots |
| Cost | Not modelled | Hourly rate, billing granularity, minimum, per-session fee, median cost per session |
| Score | `0.40 total p50 + 0.20 total p95 + 0.10 total p99 + 0.30 create p50`, each linear 0 ms = 100 to 10 s = 0, multiplied by success rate | Value Score 0-1 over latency, reliability and cost with fixed anchors and user-adjustable weights |
| Concurrency | c1 only. A concurrent workflow (Monday 04:00 UTC, up to c50) exists but the benchmark file and results are not published yet | c1 and c10 |
| Regression detection | None | 28-day baseline, 2-of-3 day rule, `/api/health`, Slack alerts |
| PR runs | Every PR runs 2 iterations per provider and posts a comparison table | None |

### Browser Throughput

This is the one we do not have. It measures per-action latency inside one
running session, which is what matters for a long-running agent: once the
browser is up, provisioning time is noise and per-step cost is everything.

Each session runs a fixed 10-action loop against Wikipedia (their `THROUGHPUT.md`
says 50 actions and `stealth: true`; the code as of 2026-10-09 runs 10 actions
with `stealth: false`):

```
goto(<random article>) -> waitForSelector('#firstHeading') -> screenshot()
-> textContent('#firstHeading') -> click(first article link)
-> waitForSelector -> screenshot -> textContent -> goBack -> waitForSelector
```

Design points worth copying:

- **Six action types, each timed individually** with `performance.now()` around
  the Playwright call: `navigate`, `waitForSelector`, `screenshot`,
  `textContent`, `click`, `goBack`. Per-type median, p95 and p99 are published.
- **`textContent` is the cheapest action** and isolates raw CDP round-trip cost.
  `screenshot` at a fixed 1920x1080 viewport isolates the cost vision agents
  pay on every turn.
- **Actions per second** (`actionsCompleted / taskMs`) is the headline number.
- **A failing action does not abort the session.** The loop records the failure
  and continues, so partial completion is measurable. But a session only
  counts as successful if every action succeeded.
- **The action index is recorded**, so late-session slowdown (resource
  exhaustion, leaks) can be detected once sessions get longer.
- **The random article URLs are resolved up front** and shared across
  providers in the same run, so every provider sees the same page mix.
- Score: `0.40 actions/sec p50 (10/s = 100) + 0.25 task p50 + 0.20 task p95 + 0.15 screenshot p50`,
  latency terms linear 0 ms = 100 to 30 s = 0, multiplied by full-completion
  success rate.

Their 2026-10-09 run, median per action type in ms, c1:

| Provider | navigate | waitForSelector | screenshot | textContent | click | goBack | actions/s |
|---|---|---|---|---|---|---|---|
| Tilion | 316 | 133 | 175 | 9 | 341 | 53 | 5.79 |
| Kernel | 620 | 140 | 280 | 6 | 344 | 36 | 4.65 |
| Browser Use | 417 | 255 | 251 | 23 | 735 | 63 | 3.76 |
| Browserbase | 839 | 117 | 273 | 6 | 351 | 69 | 3.64 |
| Hyperbrowser | 882 | 233 | 430 | 14 | 496 | 154 | 2.74 |
| Steel | 603 | 388 | 506 | 40 | 1323 | 100 | 2.17 |
| Notte | 591 | 716 | 812 | 81 | 2480 | 209 | 1.33 |

The `textContent` column is effectively a CDP round-trip table. Compare it with
the `curl time_appconnect` RTT table in our README: a provider whose
`textContent` is 10x another's is mostly paying network distance from the
runner, and a single-region runner with an unpublished location makes that
hard to separate from provider overhead. Our two-region setup with a published
RTT table is the right answer to that; it would be worth keeping for any
throughput benchmark we add.

## What we have that they do not

Worth keeping and, where the site does not already say so, worth saying:

- Daily runs instead of weekly, with history charts.
- Cost as a scored dimension, with a real billing model (per-minute vs
  per-second, minimums, per-session fees).
- Adjustable score weights instead of one fixed formula.
- c10 concurrency, published today.
- Two runner regions with measured RTT to each provider's CDP endpoint.
- Warm-up runs, so cold-start outliers do not dominate.
- Failure diagnostics: stage, message patterns, screenshots.
- Regression detection and a health endpoint.
- Nine providers (they do not run Anchor Browser or Lightpanda).
- No SDK wrapper in the middle: each adapter calls the provider directly, so a
  slow number is the provider's, not the wrapper's.

## Suggestions, in priority order

1. **Add an agent-loop throughput benchmark.** The gap that matters most. The
   `v0` benchmark in `src/benchmarks/v0` already does a Wikipedia
   extract / crawl / form workload but only reports three coarse phase totals
   and has not run since March. Replace or extend it with a fixed action loop,
   timed per action, with per-type median / p95 / p99 and actions per second.
   Keep our warm-ups, both regions, c1 and c10, and resolve the article URLs
   once per run so every provider sees the same pages. Surface it as a second
   leaderboard tab.
2. **Make screenshot latency a first-class metric** at a fixed 1920x1080
   viewport. Vision agents pay it on every turn, and the spread between
   providers is large (175 ms to 812 ms in their last run).
3. **Publish p99 and score the tail.** We stop at p95 and the Value Score only
   uses the median. Their lifecycle score puts 30% of the weight on p95 + p99.
   Cheapest change on this list: add p99 to the aggregation and either a
   "Consistency" dimension (p95 / median) to the Value Score or a p95 term in
   the latency dimension.
4. **Cost per action, not just cost per session.** We are the only one of the
   two with a pricing model, so once per-action timings exist we can publish
   "cost per 1,000 agent actions" per provider. Nobody else has that number.
5. **Strict session success plus a partial-completion rate** for the agent-loop
   benchmark: a session counts only if every action succeeded, and the share of
   actions completed is reported separately. One flaky action in 50 is a
   failed task for an agent.
6. **Within-session drift.** Record the action index and compare the last loop
   against the first in longer sessions (50+ actions). This is the only cheap
   signal for resource exhaustion in multi-hour agent sessions.
7. **Report cold starts separately.** We already run 10 warm-ups and discard
   them. Keep them as a "cold" series instead: cold vs warm session creation is
   on their roadmap and we have the data already.
8. **Higher concurrency levels** (c25, c50) for the lifecycle benchmark. Their
   concurrent workflow targets c50; our runner already loops over
   `--concurrency` levels.
9. **PR smoke runs.** A 3-session run per provider on pull requests that touch
   `src/`, posting a comparison table as a comment, catches adapter
   regressions before they reach the daily cron.
