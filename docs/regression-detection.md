# Regression detection

## Why this exists

On 2026-09-05 Notte's `session_release_ms` median jumped **25ms → 1071ms** and
stayed there. Nobody noticed for five days. Nothing in this repo watched for
latency regressions, success-rate drops, or a benchmark cron that had silently
died.

## The endpoint

```
https://www.browserarena.ai/api/health
```

**Use the `www.` host.** The apex 307-redirects, and monitors that don't follow
redirects record the 307 as either up or down — both wrong.

| Param | Default | Values |
|---|---|---|
| `provider` | `notte` | any provider slug (`browser-use`) or key (`BROWSER_USE`), or `all` |
| `concurrency` | `1` | `1`, `10` |
| `benchmark` | `hello-browser` | `hello-browser` |

The HTTP status carries the signal, so Better Stack / Checkly / Cronitor /
UptimeRobot alert on it with no custom code:

| Status | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | within baseline |
| `unknown` | 200 | not enough history to judge — **never pages** |
| `degraded` | 503 | a sustained regression |
| `stale` | 503 | no results for >36h — the cron is probably dead |

Every response also carries `X-Health-Status` and `X-Health-Age-Hours` for
monitors that match on headers rather than JSON.

Responses are CDN-cached — 300s when healthy, 60s when degraded. A regression
stays open for days, and an uncached 503 would mean every uptime check
re-parses the full result history for the duration of the incident. Caching a
failure is safe here because results only change on redeploy and each Vercel
deployment gets its own cache, so a stale 503 cannot outlive the fix.

### Putting an uptime monitor on it

Point the monitor at `https://www.browserarena.ai/api/health` and let it alert
on any non-2xx. Nothing else needs configuring. Two things worth setting:

- **Check every 3-5 minutes, not every 30 seconds.** The underlying data changes
  once a day, so faster polling buys nothing.
- **Request timeout of 10s or more.** Steady-state responses are ~150ms, but a
  cold start has to read the full history.

Note that during a sustained regression the monitor stays red for as long as the
breach is open, then goes green on its own once the baseline washes out (see
*Known limitation*) — a green monitor means "no longer anomalous", not
necessarily "fixed".

```console
$ curl -s -o /dev/null -w '%{http_code}\n' https://www.browserarena.ai/api/health
503
$ curl -s https://www.browserarena.ai/api/health | jq -r .summary
Notte session release 26ms -> 1.07s (41.2x) since 2026-09-05
```

## How detection works

The hard requirement is telling a **sustained step change** apart from a
**one-day spike**. On 2026-08-29 Notte's creation time went 132ms → 960ms and
goto 85ms → 622ms, then returned to normal the next day. A day-over-day check
fires on that, trains everyone to ignore the channel, and *still* misses the
real 09-05 regression.

So a metric is only in breach when **all** of the following hold:

- **Baseline** — median of daily medians over the last **28 run-days**, ending
  **3 days before** the recent window. A persisting regression can never
  contribute to the baseline it is measured against. Median, not mean, so one
  1745ms spike day can't drag it.
- **Persistence** — at least **2 of the last 3 run-days** breach. This is the
  rule that kills spikes.
- **Dual threshold** — a day breaches only if `current / baseline ≥ 1.5` **and**
  `current - baseline ≥ 50ms`. The ratio alone fires on a 6ms → 10ms wobble; the
  absolute floor alone fires on anything slow but stable.
- **Enough history** — under 7 baseline days reports `unknown`, which never pages.

Windows are counted in *run-days*, not calendar days: providers have gaps, and
calendar arithmetic would silently produce short windows on either side of one.

`total` is suppressed when a phase already breached, so one root cause produces
one alert naming the culprit phase rather than two saying the same thing.

Success rate breaches on a drop of ≥5 points that also lands below 95%.
Staleness (>36h since the last recorded run) outranks `degraded`: if the cron
died, the latency numbers are stale too and the actionable fact is the cron.

### The 24-hour detection floor is deliberate

With one benchmark run per day, `2 of 3` cannot resolve faster than one day
after onset. **Do not add a "fire immediately on a huge jump" K=1 fast path.**
It would catch 09-05 a day earlier, but it would also fire on the 08-29 spike
(creation 6.6×, goto 7.1×) — precisely the case we are required to suppress.

### Calibration

Replayed over all 121 run-days of Notte history, these thresholds produce
**two** alerts: `2026-08-20/goto` and `2026-09-06/release`. The 09-05 regression
is caught one day after onset; 08-29 and 09-01 stay silent.

`web/lib/regression.test.ts` pins this. If you change a threshold, that test
tells you which historical incidents you started or stopped catching — treat a
diff there as a decision, not a chore.

### Known limitation

The baseline window slides, so a regression that persists past roughly half the
baseline window (~15 run-days) becomes the new normal and the endpoint returns
to `ok`. That's intentional. The open/close events in Slack are the durable
record of when an episode started.

## Slack alerts

`.github/workflows/regression-alert.yml` runs on every `results/**` commit and
on a daily schedule.

Dedup is **edge-triggered and stateless**: the detector is a pure function of
committed data, so diffing "what is breaching today" against "what was
breaching yesterday" yields exact open/close events. No state file, no
commit-back to `main` (which would race the runners' push-retry loop), nothing
to evict. The five-day Notte incident produces exactly one message.

| Trigger | Mode | Purpose |
|---|---|---|
| push to `main` touching `results/**` | `edge` | new regressions and recoveries |
| daily cron, 12:00 UTC | `staleness` | dead cron — no commit means no push event |
| Monday cron, 13:00 UTC | `digest` | backstop for an edge lost to a missed run |

Alerting is scoped to Notte by default; the detector evaluates every provider
regardless, and the scope is a config change (`ALERT_PROVIDERS=NOTTE,TILION` or
`--providers`). Staleness is checked per provider, not globally — the runners
are split across two EC2 boxes (`us-east` publishes 8 providers, `us-west`
publishes Notte alone), so a global "did anything land today" check would miss
one box dying entirely.

Both concurrency levels (c1 and c10) are checked. Staleness is reported once
rather than per level, since a dead cron is a property of the runner.

Set the `SLACK_WEBHOOK_URL` repo secret to enable posting. In a fork, or with
`--dry-run`, the script prints the payload instead. In the upstream repo the
workflow sets `ALERT_REQUIRE_WEBHOOK=true`, so a missing or rotated secret fails
the run loudly instead of degrading into a green workflow that reaches nobody —
which would be the same silent failure this system exists to catch.

## Running it by hand

```bash
cd web
npm test                                              # the backtest
npm run check-regressions -- --dry-run                # today, print don't post
npm run check-regressions -- --as-of 2026-09-06 --dry-run   # replay a past day
npm run check-regressions -- --providers all --dry-run
```

`--as-of` truncates history to that date and reproduces that day's decision
exactly, which is how the calibration above was derived.
