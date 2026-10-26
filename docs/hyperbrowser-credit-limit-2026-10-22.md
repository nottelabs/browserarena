# Hyperbrowser credit-limit incident, October 22–25, 2026

The US East throughput campaign stalled because Hyperbrowser rejected session creation after the account exhausted its credits. The runner treated the billing rejection as a transient rate limit and retried it indefinitely. The network timeout in the published results was one failed request during that loop; it does not establish a Hyperbrowser service outage.

## Evidence

Read from the US East runner on October 26, 2026:

- `logs/cron-2026-10-22T21-00-01Z-us-east-browser-throughput.log` contains **7,811** copies of this retry:

  ```text
  [RATE_LIMIT] provider=HYPERBROWSER message="[Hyperbrowser]: You have reached your credit limit. Please upgrade your plan or purchase more credits." → retry in 30s
  ```

- Those backoffs alone account for 234,330 seconds, or about 65.1 hours. The [published Hyperbrowser metadata](https://github.com/nottelabs/browserarena/blob/92eb32c011cf9302c7a84c11d4c44b336e538eb8/results/browser-throughput/hyperbrowser/2026-10-22/_meta.json) spans October 22 at 21:37:29 UTC to October 25 at 15:10:22 UTC, about 65.5 hours.
- The creation loop matched `/rate|limit|429|too many/i` against error messages. The words `credit limit` therefore triggered the same infinite retry as an actual HTTP 429. Its timing restarted on every attempt, so a later success reported only its final API call, hiding the preceding rejected requests and backoffs.
- The proxy checkout also logged credit-limit rejections: 66 on October 22, 500 on October 23, 500 on October 24, and 400 on October 25. These counts come from log files whose names start on those dates.
- Both checkouts currently use the same Hyperbrowser API key. A read-only request to `/api/team/credit-info` returned `usage: 2704`, `limit: 30000`, `remaining: 27296` for each checkout on October 26, before the verification sessions. The account had credits again by the time of this investigation. The available evidence does not identify whether they were replenished by renewal, a purchase, a plan change, or another account action.

The shared checkout lock caused the stalled throughput campaign to block the lifecycle schedule. The published lifecycle data consequently has no US East run dates for October 23–25. Per-provider process deadlines are addressed separately in [PR #124](https://github.com/nottelabs/browserarena/pull/124).

## Fix and verification

The lifecycle, throughput, and v0 runners now share a bounded creation policy. Credit, quota, and billing errors fail the session immediately. Transient HTTP 429 errors get at most three total attempts, separated by 30-second backoffs. Adapters without a status must explicitly report a rate limit; generic messages containing `rate` or `limit` no longer qualify. Network errors and other ambiguous create failures are not automatically retried, since a lost create response could already have allocated a session. Proxy GET keeps its existing no-retry measurement policy.

Each session records `session_creation_diagnostics`: attempts, backoff time, total elapsed time, and sanitized status/code/request ID/message for rejected requests. The existing `session_creation_ms` metric continues to describe the successful API call. Failed sessions retain the diagnostics as well.

Regression tests replay the exact credit-limit message, verify bounded genuine 429 retries and successful recovery, check sanitization, and exercise quota failures through all three runners. A live check from the US East runner used the new creation helper with the deployed Hyperbrowser adapter: **3/3** sessions created, connected over CDP, loaded `example.com`, and released successfully. Creation took 284, 213, and 224 ms; complete checks took 1,032, 940, and 943 ms, with no retries. These were diagnostic sessions; daily result files and deployed code were not changed.

Temporary SSH rules were restricted to the investigator's IP and removed after each connection. No API keys were retained in the report or diagnostic output.
