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
loops of ten actions against the Python 3.12 documentation
(`docs.python.org/3.12`):

```
 1. navigate         goto(<page>, domcontentloaded)
 2. waitForSelector  h1
 3. screenshot       viewport PNG
 4. textContent      h1
 5. click            first visible cross-reference in the body text
 6. waitForSelector  h1
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

The click target is the first visible cross-reference inside a paragraph of
the main content (`[role="main"] p a.reference.internal`). Same-page anchors
are excluded, so the click always loads another documentation page, which has
an `h1` of its own.

Lightpanda has no layout engine: every element reports a placeholder box, so a
mouse click can never target it. For providers flagged `domClicksOnly` the
click step calls the link's `element.click()` and waits for the navigation to
commit instead. Each session records this as `click_mode: "dom"`; everyone else
is `"mouse"`.

### Start pages

A fixed pool of 100 pages (`src/benchmarks/browser-throughput/articles.ts`):
the largest pages of the library reference, language reference, tutorial and
HOWTOs that have one `h1` and at least five cross-references in their body
text. The pool rotates by date, and session N loop M on a given day lands on
the same page for every provider in both regions. Day-to-day differences are
then the provider's, which is what the regression detector needs.
`--articles=random` shuffles the pool for ad-hoc runs.

### Why the Python documentation

The pages are static HTML behind a CDN, and 3.12 only receives security
fixes, so the content barely changes.

The benchmark first ran on Wikipedia. Wikipedia rate limits addresses that
many clients share, which is what a hosted browser's egress is: a
navigation can come back as HTTP 429 with an error page instead of the
article. The loop then spends four action timeouts on a page that has no
heading, and the session counts as a provider failure. That measures the
site's rate limit, not the browser.

Results recorded before the switch stay in `results/browser-throughput`;
`article_urls` in each record names the site a session ran on. The Python
pages are lighter than Wikipedia articles, so timings from before and after
the switch are not comparable with each other. Rankings within one day are.

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

### Publishing daily comparisons

The east and west runners publish at different times. The website and API
default to the latest day for which every provider active on that date has
published measured attempts at the selected concurrency. Provider coverage is
derived from run history: a provider is expected from its first published day
onward, so adding a provider does not invalidate older complete days. Warm-ups
and the hidden Kernel headful variant do not count. A failed session counts as
a reported attempt; missing timings such as Browserless's exhausted quota do
not prevent the day from becoming complete.

Newer partial days remain accessible in the date picker, marked `(partial)`,
with the number of providers reporting shown above the table. The default
advances once the remaining results arrive. Historical charts retain partial
days with gaps for missing providers. The API follows the same default and
accepts `?date=YYYY-MM-DD` to inspect a specific day; its publication metadata
reports coverage and the latest complete date. If a provider is permanently
retired, this coverage policy will need an explicit end date for that provider.
When local files are unavailable, assembled GitHub history is cached per
concurrency for 60 seconds within each server process, shared across date
selections and concurrent requests. The cache holds at most eight concurrency
levels. Cold loads fetch providers in parallel, with one historical file per
provider in flight at a time.

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
show up at `/throughput` and `GET /api/browser-throughput?concurrency=1`.

## Limitations

- The documentation is served from a CDN. A provider near one of its edges
  gets a small edge on `navigate`. The relative comparison holds; absolute
  numbers do not transfer to arbitrary sites.
- The pages are mostly text. A screenshot of an image-heavy page costs more
  than the ones measured here.
- The target is a third-party site. If it starts refusing requests, that shows
  up as failed actions, as it did on Wikipedia.
- Ten actions is short. Drift needs `--loops=5` or more, and even fifty actions
  will not show a leak that takes an hour to matter.
- The same per-provider rate limits and plan caps as hello-browser apply, and
  more so at c25 and c50. Check the plan's concurrent session cap before
  turning those levels on, or a plan limit will show up as reliability.
