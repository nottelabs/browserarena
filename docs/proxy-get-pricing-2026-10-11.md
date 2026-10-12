# Browserbase and Tilion pricing investigation — October 11, 2026

Both providers were configured with `proxyPerGbUsd: null`. A missing bandwidth
price makes each total unknown. Separately, an unconfirmed launch or release
charge makes the whole suite total unknown; failures must not be silently free.
The table estimates list-price usage before subscriptions and included credits.
It does not calculate an account invoice.

## Browserbase: resolved as a labeled list-price estimate

The [official pricing page](https://www.browserbase.com/pricing) publishes:

| Plan | Monthly subscription | Included browser hours | Included proxy GB | Browser overage/hour | Proxy overage/GB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Developer | $20 | 100 | 1 | $0.12 | $12 |
| Startup | $99 | 500 | 5 | $0.10 | $10 |

These browser-session rates are distinct from Fetch API per-call prices.
[Proxy documentation](https://docs.browserbase.com/platform/identity/proxies)
confirms residential proxies, transfer overhead, a 1 MB minimum per session,
and subsequent rounding to the nearest MB. We retain the benchmark's
conservative *upward* MB rounding rather than claiming exact invoice rounding.
[Cost optimization](https://docs.browserbase.com/guides/cost-optimization)
confirms a one-minute browser-session minimum. Browser duration uses our existing
creation-start to successful-release measurement, not an audited billing clock.

Read-only authenticated requests against the EC2-configured account returned
project concurrency 25, 2,259 browser minutes, and 52,446,291 proxy bytes. The
project endpoint exposes no plan or invoice. Concurrency matches Developer's
public limit, but does not prove the plan; custom limits are possible. Therefore
the default is explicitly **Developer list rates; account plan unconfirmed**.

All 51 recorded session retrievals returned HTTP 200 and an end timestamp.
Finalized per-session `proxyBytes` sum to the project usage counter above and
exceed each original browser-observed lower bound. Fifty belong to the country
suite; one is an earlier US smoke check and is excluded from the suite totals.
The country suite totals 51,366,186 provider-measured bytes. Using upward MB
rounding bills an estimated 97 MB and 50 browser minutes:

| Country | Successes | Rounded proxy MB | Developer run estimate | Estimate/success |
| --- | ---: | ---: | ---: | ---: |
| US | 8/10 | 18 | $0.236 | $0.0295 |
| France | 10/10 | 20 | $0.260 | $0.0260 |
| Brazil | 10/10 | 20 | $0.260 | $0.0260 |
| India | 10/10 | 20 | $0.260 | $0.0260 |
| Japan | 9/10 | 19 | $0.248 | $0.02756 |

The full suite estimate is **$1.264** on Developer or **$1.05333** on Startup.
Failed GETs remain billable in these sums. Both plans include more than this
project's reported usage; project-level usage cannot rule out overages from
other projects in the same billed organization. We do not label either number
as the actual invoice or infer an actual charge of zero.

Original record fields, traffic counters, prices, timings, failures, and null
costs remain intact. A `cost_reconciliation` records the October 11 calculation,
provider meter, pricing sources, and assumptions. Summary/history/detail views
use it; exported samples retain both versions. Future runs use the verified
$12/GB Developer default, with explicit pricing-file overrides for other plans.

## Tilion: inferred comparative estimate

The [official launch post](https://tilion.com/blog/stealth-is-a-speed-problem)
publishes $0.03/browser-hour. The [usage documentation](https://docs.tilion.dev/reference/usage)
and [limits documentation](https://docs.tilion.dev/reference/limits) describe
monthly allowances followed by credit-based overages. The cloud dashboard's
public billing page lists Scale at $499/month, including 5,000 browser hours
and 35 GB egress. That published price does not establish what this account pays.
Tilion's separate Fortress licensing page is not cloud browser pricing.

Read-only `/v1/usage` on the configured account reported:

- Tier `scale`; October usage 13,163 browser seconds (3.656 hours), 33,261,894
  egress bytes, 2,467 sessions, zero actions/captcha solves.
- Included limits: 18,000,000 browser seconds and 37,580,963,840 egress bytes
  (35 GiB). Sessions have no monthly cap. Premium egress is enabled.
- Remaining: 17,986,837 browser seconds and 37,547,701,946 egress bytes.

`/v1/credits` returned a 250,000-credit balance with `enforced: false` and costs
of 150 credits/browser-hour, 2.5/browser-minute, 1/egress-MB, and 2/session.
No dollar-denominated conversion or credit purchase price appeared in these
responses, official usage docs, or the public dashboard billing bundle. The
public Fortress repository does not contain the cloud billing implementation.
No checkout, purchase, or billing mutation was performed.

**This run fits inside the account's allowance**, so the documented model
supports no additional usage-overage charge at this snapshot. That is not an
invoice audit, and the subscription or granted credits may have a cost. It is
also not a fair replacement for every provider's comparative list-price estimate.

For a practical estimate, we use the blog's $0.03/hour divided by 150 credits/hour
as **$0.0002/credit**. This implies **$0.20 per decimal GB** at 1 credit/MB,
plus **$0.0004/session** at 2 credits/session. Browser seconds and decimal MB
are rounded up per attempt. This is an inferred conversion; promotional rates
and purchase tiers may affect actual invoices. The config and UI label it as an
estimate and expose the assumptions instead of withholding a usable number.

The 50-attempt pilot created and released 21 sessions: 4 successful US GETs,
17 country mismatches, and 29 launch failures without a returned session ID.
Recorded wall time is 60,867 ms. The existing $0.03/hour browser-only estimate
is **$0.000591667 across the pilot**, including per-attempt upward second
rounding. US browser-only cost is **$0.000133333**, with at least 4,204,269
browser-observed traffic bytes. Neither is a complete proxy run cost.
There is no confirmed billing rule for the 29 failed launches. For budgeting,
each launch with no returned session ID or observed traffic is assigned one
$0.0004 session fee, with no additional unobserved runtime or traffic. This
avoids silently making failed requests free, but is not a bound on hidden usage.
Cleanup failures and missing duration for known sessions still remain unknown.
Only pricing configurations with an explicit `failedLaunchFeeUsd` opt into this
assumption; other providers' unknown launch costs remain unchanged.

| Country | Successes | Estimated run cost | Estimate/success |
| --- | ---: | ---: | ---: |
| US | 4/10 | $0.00573333 | $0.00143333 |
| France | 0/10 | $0.00508333 | — |
| Brazil | 0/10 | $0.00511667 | — |
| India | 0/10 | $0.00565833 | — |
| Japan | 0/10 | $0.00400000 | — |

The full pilot estimate is **$0.02559167**: $0.020 in assumed session fees,
$0.005 for 25 rounded MB, and $0.00059167 browser time. Original record fields
remain untouched; the dated reconciliations power the table, history, raw
details, and exports. Countries with no successes display a dash for cost per
success. Browser-observed bytes are a lower bound on traffic; these estimates
exclude subscriptions and included credits. No live paid benchmark was rerun.
