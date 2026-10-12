# Proxy Performance value score

The proxy leaderboard uses the same preset controls as Session Performance, with
a score from 0 to 1; higher scores rank first. Fastest is the default. Scores
use the selected country's latest available provider suites, not rolling averages.

| Preset | Latency | Reliability | Cost |
| --- | ---: | ---: | ---: |
| Fastest | 100% | 0% | 0% |
| Cheapest | 0% | 0% | 100% |
| Most reliable | 5% | 90% | 5% |
| Balanced | ⅓ | ⅓ | ⅓ |

Weights are normalized before use. Each component is clamped to [0, 1]:

- Latency: `1 - medianGetMs / 30,000`, using successful full-response GETs.
- Reliability: `successes / attempts`, including country-check and download failures.
- Cost: `1 - costPerSuccessUsd / 0.05`, including failed attempts in the total cost.

The score is the weighted sum of these components. The fixed anchors represent
30 seconds per GET (the default timeout) and $0.05 per successful GET. They are
UI normalization choices, not measured baselines or service guarantees. Unlike
min/max normalization against competitors, they do not change when another
provider enters or leaves the table. Lifecycle uses its existing hourly-cost
and latency scales; scores from the two benchmarks are not interchangeable.

Providers without any successful attempts remain unranked. If an actively
weighted metric is missing or non-finite, the score is N/A and the provider
appears after scored providers. Unknown cost therefore allows a Fastest score,
but does not become a free or zero-cost score in other presets. Equal scores
share ranks, with names determining a stable display order. Ranking uses full
precision; the UI displays three decimals.

First byte, throughput, and total suite cost remain available through the
expandable GET details control, without increasing the main table's width.
Provider samples, exported measurements, history, and daily distributions are
unchanged by selecting weights. Exports contain measurements rather than the
current browser's scoring preference; the formula above reproduces the score.

Current pilot suites used different dates and target hosts. Their scores are
exploratory UI comparisons, not controlled cross-provider rankings. A controlled
ranking requires fresh suites against the same deployed payload host and workload.
