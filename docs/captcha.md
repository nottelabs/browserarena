# CAPTCHA handling

Run a fixed campaign of fresh sessions against Cloudflare Turnstile, reCAPTCHA v2
and hCaptcha. The supported presets are Kernel, Browserbase, Browser Use, Steel
and Notte. This benchmark is opt-in: it has no cron entry and does not use the
lifecycle publisher. The website at `/captcha` reads reviewed campaign exports;
`GET /api/captcha` exposes the same data.

## Run a campaign

Install dependencies with `npm ci`. Set the existing provider variables in `.env`:
`KERNEL_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`,
`BROWSER_USE_API_KEY`, `STEEL_API_KEY`, and `NOTTE_API_KEY`. Only keys for selected
providers are required. Keep credentials out of results and logs.

```bash
# Check fixture contracts and required credential presence; no paid sessions.
npm run bench -- --benchmark=captcha --preflight

# One attempt per type/provider: 15 fresh sessions.
npm run bench -- --benchmark=captcha --runs=1 --out=.captcha-runs/first-campaign

# Default: 5 attempts per type/provider, 75 fresh sessions in total.
npm run bench -- --benchmark=captcha --out=.captcha-runs/repeated-campaign

# Select providers explicitly. Missing credentials fail before creating sessions.
npm run bench -- --benchmark=captcha --provider=kernel,notte --runs=5 --concurrency=2
```

`--runs` is attempts **per provider per CAPTCHA type**, from 1 to 20.
`--concurrency` is the global session cap, from 1 to 3; each provider remains
limited to one active session including its five-second cleanup cooldown.
Provider and fixture order rotate between rounds. Use the same runner for the
whole campaign and avoid overlapping other benchmarks or account workloads.
The preflight checks public fixtures and credential presence, not account access
or available capacity. Verify account access before running a paid campaign.

Every invocation uses a new directory under `.captcha-runs/` unless `--out` is
specified. Existing output directories are refused. The runner saves the plan,
configuration, source hashes and copies, revision, SDK versions, preflight,
append-only attempt and event journals, screenshots, summary and an interactive
`report.html`. These are private evidence, ignored by git. The copied JavaScript
protocol uses the repository's installed SDKs and is emitted by `npm run build`.

On a shared runner, acquire its existing benchmark locks. For example:

```bash
flock -n .run-and-publish.lock flock -n "$HOME/.browserarena-comparison.lock" \
  npm run bench -- --benchmark=captcha --out=.captcha-runs/repeated-campaign
```

Run in a persistent terminal if SSH might disconnect. SIGINT, SIGTERM and SIGHUP
stop new starts and let active attempts finish cleanup. Do not force-kill the
process. Unknown session ownership or failed release/disconnect halts new work;
inspect and reconcile the owned sessions before a new campaign. Nothing resumes
or retries automatically. A completed campaign may contain rejected tokens,
timeouts and setup errors; a zero exit code does not mean every challenge passed.

## Protocol v3

Each session uses a 1920 × 1080 viewport, a 30-second navigation limit and a
180-second solve window after navigation. Timing starts at navigation and ends
at independent acceptance, or token delivery for hCaptcha. Setup, screenshots
and cleanup are excluded. The harness never clicks a CAPTCHA or answers a
challenge: each provider's own solver goes through every step. Provider solvers
may make their own internal attempts within the fixed window. SDK retries and
benchmark retries are disabled.

| Provider | Native preset |
| --- | --- |
| Kernel | Headless stealth, default stealth ISP proxy |
| Browserbase | Native solving, managed proxy, US East browser |
| Browser Use | Default solving, US proxy, v4 browser API |
| Steel | Native solving, managed proxy |
| Notte | Headless Chrome, automatic solving only, US proxy, ad filter disabled, public API |

These presets compare the provider products, including their proxy pools. They
are not identical networks and do not isolate solver quality from browser or
proxy behavior. Lifecycle benchmark presets and retry policy do not apply here.

- **Turnstile:** ZeroCaptcha's real managed-widget demo. The same-origin verifier
  must report HTTP 200, `success=true`, `testSecret=false`, the expected hostname
  and widget. No ZeroCaptcha solver is used.
- **reCAPTCHA v2:** Google's official submission demo. A POST response at the
  exact demo URL and the accepted page must both be observed. The form uses
  `requestSubmit()` so pointer overlays cannot block verification.
- **hCaptcha:** NopeCHA's enterprise demo. Delivery means the demo page reports
  success, the same signal the page shows a visitor. This is **token delivery**,
  not server acceptance: the demo's callback does not call a server verifier.

Fixture sitekeys and the hCaptcha script are pinned. Preflight also checks that
Turnstile rejects an invalid token using a real secret. Fixture drift fails the
run; test widgets cannot count as accepted tokens. Challenge difficulty varies
per visit and automatic clearance can count as success. This is neither a
visual-puzzle accuracy benchmark nor a test of Cloudflare's full interstitial.

## Export results for review

```bash
npm run captcha:export -- .captcha-runs/repeated-campaign 2026-10-29-west-v3
```

This writes one new `results/captcha/<id>.json` locally. It never pushes or
updates a live site. Review that file in a PR. The site bundles the files from
its own revision, so a preview can display proposed results without fetching
results from another branch. `/captcha?campaign=<id>` selects an exact campaign;
unknown IDs return not found. No campaigns produces an explicit empty state.

The export includes only the fixed protocol identity, source revision, dates,
provider list, workload settings and per-attempt outcome/timing/cleanup flag.
It excludes session IDs, credentials, screenshots, runner hostnames, provider
payloads and error strings. It validates the declared workload and preserves
incomplete campaigns. It refuses existing filenames, mixed protocols, duplicate
or unplanned attempts and inconsistent completion. Failed and unrun work cannot
silently become successes. Preserve private evidence to investigate errors.

The page reports accepted/attempted counts for Turnstile and reCAPTCHA and
delivered/attempted counts for hCaptcha, with per-round details, conditional
medians and 95% Wilson intervals. Errors remain in the denominator and unrun
attempts appear separately. Five successes out of five still has a lower bound
near 57%; small campaigns are exploratory, not reliable speed rankings. Campaigns
are never pooled across protocols or dates. Synthetic layout fixtures are not
published as provider results.

## Validation

`npm test` includes the protocol, scheduler, cleanup, redaction, provider request,
CLI and export tests without live provider credentials. `npm --prefix web test`
checks loading and validation. `npm --prefix web run test:layout` checks the
CAPTCHA route, partial campaigns and its API as part of the website suite.
