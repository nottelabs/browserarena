# Browser throughput benchmark

`hello-browser` answers one question: how fast can I get a fresh browser? It
is the right number for short-lived sessions. It says nothing about the
question that matters for a long-running agent: once the session is up, how
fast does each step complete, and does that hold up over the session?

A vision agent runs for minutes to hours and issues hundreds of actions inside
one session. For that workload, provisioning is a rounding error and per-action
cost is everything. A provider that creates a session in 200 ms but takes
800 ms per screenshot loses to one that takes 2 s to create and 100 ms per
screenshot, every time.

## What runs

Each session connects once, sets a 1920x1080 viewport, then runs `--loops`
loops of ten actions against Wikipedia:

```
 1. navigate         goto(<article>, domcontentloaded)
 2. waitForSelector  #firstHeading
 3. screenshot       viewport PNG
 4. textContent      #firstHeading
 5. click            first visible article link in the body text
 6. waitForSelector  #firstHeading
 7. screenshot
 8. textContent
 9. goBack           waitUntil: commit (bfcache restores never fire load)
10. waitForSelector
```

Every action is timed on its own with `performance.now()` around the
Playwright call. Session-level numbers are sums of action durations, so the
per-action breakdown always adds up to the session number.

| Action | What it isolates |
|---|---|
| `navigate` | Full page transition: HTTP, parse, render |
| `waitForSelector` | DOM polling, CDP round trips |
| `screenshot` | Pixel capture at a fixed viewport, the vision-agent tax |
| `textContent` | The cheapest action there is: raw CDP round-trip cost |
| `click` | Synthetic input plus the navigation it triggers |
| `goBack` | History navigation, back-forward cache behaviour |

The click target is the first visible article link inside a paragraph of
`#mw-content-text`. Wikipedia serves article links as absolute URLs, so the
selector matches `/wiki/` anywhere in the href and excludes namespaced pages
(`File:`, `Category:`, `Help:` and friends) by name. Paragraph links only:
infobox and hatnote links are often collapsed, and a collapsed link makes
Playwright wait out the whole timeout.

### Start pages

A fixed pool of 100 broad, link-rich articles (`src/benchmarks/browser-throughput/articles.ts`),
not `Special:Random`. The pool rotates by date, and session N loop M on a given
day lands on the same article for every provider in both regions. Day-to-day
differences are then the provider's, which is what the regression detector
needs. `--articles=random` uses the Wikipedia random API for ad-hoc runs.

### Failure handling

A failing action is recorded with its error and the loop moves on, so partial
completion is visible. Three consecutive failures skip the rest of that loop
(recorded as `skipped`, duration 0) so a dead page cannot burn one timeout per
remaining action. The default per-action timeout is 15 s.

A session is a **success only if every action succeeded**. An agent that fails
one action in fifty fails one task in fifty. `actions_completed / actions_total`
is reported alongside as the partial completion rate.

### Warm-ups and cold starts

Both benchmarks run warm-up sessions before measuring. Those sessions are now
written to the results file too, flagged `warmup: true`, and the leaderboard
skips them. The first session of each run is additionally flagged
`cold_start: true`: it is the only one we can honestly call cold. By the second
session the provider has served this account seconds earlier, so the warm-up
loop does not make every warm-up session a cold start.

## Recorded fields

Per session (`results/browser-throughput/<provider>/<date>/c<N>/results.jsonl`):

| Field | Meaning |
|---|---|
| `session_creation_ms`, `session_connect_ms`, `session_release_ms` | Same as hello-browser |
| `viewport_width`, `viewport_height` | Always 1920x1080 |
| `loops`, `actions_total`, `actions_completed` | 10 actions per loop |
| `task_ms` | Sum of all action durations |
| `actions_per_second` | `actions_completed / (task_ms / 1000)` |
| `first_loop_ms`, `last_loop_ms` | Sum of durations in the first and last loop |
| `actions[]` | `index`, `loop`, `type`, `duration_ms`, `success`, `error_message`, `skipped` |
| `article_urls` | The page each loop started from |
| `warmup`, `cold_start` | See above |

## Leaderboard

Per provider: strict success rate, action completion rate, actions per second
(median, p95, p99), task time, per-action median / p95 / p99, within-session
drift and cost per 1,000 actions.

**Drift** is the median of `last_loop_ms / first_loop_ms` across sessions and
only exists for runs with `--loops` above 1. A ratio well above 1.0 means late
actions are slower than early ones: resource exhaustion or leaks in the
session. Fifty actions (`--loops=5`) is enough to see it on a bad day; it is
not a multi-hour soak test.

**Cost per 1,000 actions** bills one long session at the provider's median
throughput with the provider's billing granularity (per minute or per second,
minimums, per-session fee), from `web/lib/pricing.ts`. It is the number an
agent operator pays per thousand steps, and it is only possible because this
repo models pricing.

Ranking is by median actions per second.

## Running it

```bash
# one provider, 10 sessions, 1 loop each
npm run bench -- --benchmark=browser-throughput --provider=notte --runs=10

# fifty actions per session, for drift
npm run bench -- --benchmark=browser-throughput --provider=notte --runs=25 --loops=5

# the cron shape: both concurrency levels, 100 sessions each
scripts/run-and-publish.sh --region us-east --benchmark browser-throughput --concurrency 1,10
```

Results go to `results/browser-throughput/<provider>/<date>/c<N>/results.jsonl` and
show up at `/browser-throughput` and `GET /api/browser-throughput?concurrency=1`.

## Limitations

- Wikipedia's CDN is close to everyone. A provider near Wikipedia's edge gets
  a small edge on `navigate`. The relative comparison holds; absolute numbers
  do not transfer to arbitrary sites.
- Ten actions is short. Drift needs `--loops=5` or more, and even fifty actions
  will not show a leak that takes an hour to matter.
- The same per-provider rate limits and plan caps as hello-browser apply, and
  more so at c25 and c50. Check the plan's concurrent session cap before
  turning those levels on, or a plan limit will show up as reliability.
