# CAPTCHA handling

Run a fixed campaign of fresh sessions against seven CAPTCHA types: Cloudflare
Turnstile, reCAPTCHA v2, hCaptcha, reCAPTCHA v3, GeeTest v3, a text (image to
text) CAPTCHA and PerimeterX. The supported presets are Kernel, Browserbase, Browser Use, Steel,
Notte, Hyperbrowser, Anchor Browser, Browserless and Tilion. Providers without
native CAPTCHA solving are listed on the page with the reason and never run (see
[Providers without a solver](#providers-without-a-solver)). Campaigns can be run by hand, and the US West runner publishes one
every day (see [Daily run](#daily-run)). It does not use the lifecycle publisher.
The website at `/captcha` reads campaign exports; `GET /api/captcha` exposes the
same data.

## Run a campaign

Install dependencies with `npm ci`. Set the existing provider variables in `.env`:
`KERNEL_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`,
`BROWSER_USE_API_KEY`, `STEEL_API_KEY`, `NOTTE_API_KEY`, `HYPERBROWSER_API_KEY`,
`ANCHORBROWSER_API_KEY`, `BROWSERLESS_API_KEY`, and `TILION_API_KEY` (plus
`TILION_BASE_URL` when the lifecycle benchmark uses one). Only keys for selected
providers are required. Keep credentials out of results and logs.

```bash
# Check fixture contracts and required credential presence; no paid sessions.
npm run bench -- --benchmark=captcha --preflight

# One attempt per type/provider: 63 fresh sessions.
npm run bench -- --benchmark=captcha --runs=1 --out=.captcha-runs/first-campaign

# Default: 5 attempts per type/provider, 315 fresh sessions in total.
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
process. When a release fails, the runner asks the provider whether the session
ended (Anchor; `GET /v1/sessions/{id}`), retries the release once after 5 s and
asks again; the session counts as released only on a successful release or a
provider answer that it ended, recorded as `cleanup.recovered` in the private
evidence. Unknown session ownership or a release that stays failed, or a failed
disconnect, halts new work;
inspect and reconcile the owned sessions before a new campaign. A session create
the provider refuses with an HTTP 4xx (other than 408), such as a quota, credit
or auth error, created nothing: it counts as an error for that attempt and the
campaign continues. Nothing resumes
or retries automatically. A completed campaign may contain rejected tokens,
timeouts and setup errors; a zero exit code does not mean every challenge passed.

## Protocol v5

Each session uses a 1920 × 1080 viewport, a 30-second navigation limit and a
180-second solve window after navigation. Timing starts at navigation and ends
at the type's success signal (see the table below). Setup, screenshots
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
| Hyperbrowser | [Native solving](https://www.hyperbrowser.ai/docs/sessions/captcha-solving), US proxy, US East browser, ad blocking off |
| Anchor Browser | [Native solving](https://docs.anchorbrowser.io/advanced/captcha-solving), Anchor US proxy (the solver requires one), ad and popup blocking off |
| Browserless | [Native solving](https://docs.browserless.io/baas/bot-detection/captchas) on the stealth route, residential US proxy, SFO fleet |
| Tilion | [Automatic challenge recovery](https://docs.tilion.dev/sessions/sessions) for CDP clients (`cdp_observe`, its default), residential US exit |

Browserless has no session API: connecting starts the browser and disconnecting
ends it, so its session ID is local to the run. Tilion is never asked to solve
through `POST /v1/solve`; only its automatic recovery runs, as for Notte.

### Providers without a solver

These providers are benchmarked elsewhere on the site but have no native CAPTCHA
solving, so they are shown with the reason and never run:

| Provider | Reason |
| --- | --- |
| TinyFish | Its docs say it [cannot solve CAPTCHAs](https://docs.tinyfish.ai/anti-bot-guide) |
| AWS AgentCore | No solver; [Web Bot Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html) only reduces CAPTCHAs on sites that accept verified bots |
| Cloudflare Browser Run | No solver; CAPTCHAs go to a person through [Human in the Loop](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/) |
| Lightpanda | No CAPTCHA solving in its [docs](https://lightpanda.io/docs) |

The reasons shown on the page live in `CAPTCHA_UNSUPPORTED_PROVIDERS` in
`web/lib/captcha-data.ts`.

These presets compare the provider products, including their proxy pools. They
are not identical networks and do not isolate solver quality from browser or
proxy behavior. Lifecycle benchmark presets and retry policy do not apply here.

Every type has exactly one success signal, shown under its column on the page
and exported as `types[].signal_label`. A success under one signal can never be
recorded as another:

- **Server acceptance** (`verified`): a server holding the CAPTCHA's secret
  accepted the solver's output.
- **Token delivery only** (`token_delivered`): the widget produced a token, but no
  server checked it. Only protocol v3's hCaptcha used this.
- **Page check** (`page_passed`): the page itself judged the answer in the
  browser. No server is involved.
- **Page reached** (`page_passed`): there is no token. The protected page loaded
  and stayed usable with no visible challenge.

| Type | Test page | Signal | What counts as success |
| --- | --- | --- | --- |
| Cloudflare Turnstile | [ZeroCaptcha managed widget](https://zerocaptcha.io/captcha-test/cloudflare-turnstile-managed) | Server acceptance | Same-origin verifier returns HTTP 200, `success=true`, `testSecret=false`, hostname `zerocaptcha.io` and widget `managed`. No ZeroCaptcha solver is used. |
| reCAPTCHA v2 | [Google's demo](https://www.google.com/recaptcha/api2/demo) | Server acceptance | A POST response at the exact demo URL and Google's "Verification Success" page. |
| hCaptcha | [democaptcha.com demo form](https://democaptcha.com/demo-form-eng/hcaptcha.html) | Server acceptance | The form is posted to the exact demo URL and the siteverify response it prints (a PHP `var_dump`) reports `success` `bool(true)` and hostname `democaptcha.com`. |
| reCAPTCHA v3 | [2Captcha demo](https://2captcha.com/demo/recaptcha-v3) | Server acceptance | The page's own Check runs `grecaptcha.execute` and its verifier returns Google's siteverify result: HTTP 200, `success=true`, hostname `2captcha.com`, action `demo_action` and **score ≥ 0.5**. |
| GeeTest v3 | [2Captcha demo](https://2captcha.com/demo/geetest) | Server acceptance | The solver fills the three hidden `geetest_*` inputs; the same-origin verifier returns HTTP 200 and `success=true`, and the page's init call reported online mode (`success: 1`) with the pinned `gt`. |
| Text CAPTCHA | [2Captcha normal CAPTCHA](https://2captcha.com/demo/normal) | Page check | The solver types the answer; once it has stopped changing for one probe the form is submitted and the page shows "Captcha is passed successfully!". |
| PerimeterX | [Walmart search](https://www.walmart.com/search?q=desk+lamp) | Page reached | Search results for the query stay usable for five seconds with PerimeterX loaded (`_pxAppId` `PXu6b0qd2S`), no visible `#px-captcha` and not on `/blocked`. |

Type-specific notes:

- **Forms** are submitted with `requestSubmit()`, so pointer overlays cannot block
  verification. The harness only submits; it never fills an answer.
- **hCaptcha:** the page is run by Anti-Captcha, which advertises its solver
  plugin there; the widget, its sitekey and siteverify are hCaptcha's own. Both
  the exact URL and the hostname are required, and preflight checks that the
  published test token is rejected with `not-using-dummy-secret`, so the page
  uses a real secret. The page echoes the submitted token above the verdict:
  the probe parses the verdict outside the page and keeps the text out of the
  evidence, and screenshots mask it.
- **reCAPTCHA v3** has no challenge: the score reflects how Google rates the
  browser, and a solver can only change it by its own means. The demo accepts any
  score; 0.5 is Google's documented default threshold. The score of each attempt
  stays in the private evidence. The form is submitted as soon as the pinned
  sitekey's script has loaded.
- **GeeTest:** in offline mode GeeTest's library validates locally, so a pass
  there would not be a GeeTest verdict. An attempt whose init response was not
  observed is an error.
- **Text CAPTCHA:** the image is static and the page compares the answer with a
  fixed string in the browser. This shows whether a provider's solver reads and
  types an image CAPTCHA; it is not server acceptance and not an OCR accuracy
  score. The page checks its React state, so an answer written into the field
  without input events is rejected, and the page then clears the field. The
  private evidence keeps the submitted answer (`submitted_answer`) to tell the
  two apart.
- **PerimeterX:** Walmart challenges some visits and not others. A visit that is
  never challenged also passes, as with Turnstile's automatic clearance, and
  the private evidence records `challenge_seen` when a challenge appeared. The
  harness makes one navigation and never clicks; a challenge or `/blocked` page
  resets the five-second clock. Walmart's block page may answer HTTP 403; that is
  the challenge, not a navigation error.

Sitekeys, GeeTest's `gt` and Walmart's PerimeterX app ID are pinned. Preflight
fetches every page, checks that Turnstile, hCaptcha, reCAPTCHA v3 and GeeTest
reject invalid input with a real secret, that GeeTest is online, and that
Walmart either serves the PerimeterX app or redirects to its block page. A
changed sitekey or GeeTest `gt` seen in the browser is fixture drift: that
attempt records an error and the campaign halts, so it is never published.
Fixture drift fails the run; test widgets cannot count as accepted tokens. Challenge
difficulty varies per visit and automatic clearance can count as success. This
is neither a visual-puzzle accuracy benchmark nor a test of Cloudflare's full
interstitial.

### Protocol v4

The 2026-11-06 campaign ran under protocol v4: the same seven types, with hCaptcha
on [hCaptcha's own demo](https://accounts.hcaptcha.com/demo). Success was the
form posted to the exact URL and the printed siteverify response reporting
`success: true` and hostname `hcaptcha.com`. The validator still accepts v4.
Anti-Captcha refuses every task on that domain (`ERROR_INCORRECT_SESSION_DATA
... Not valid domain hcaptcha.com`, seen from Notte on 2026-11-06), so any
solver built on it could never pass there, whatever its quality. v5 moves only
hCaptcha; every other fixture is unchanged.

That campaign was amended the same day into `2026-11-06-west-v5`. Its six
unchanged types are this morning's v4 attempts, run at `20e6f120`. Its hCaptcha
column is a separate v5 run with the same providers, rounds, concurrency and
task IDs, using the revision the file records. `started_at` is the v4 start and
`finished_at` is the hCaptcha run's end. The v4 file is in git history.

### Protocol v3

Campaigns up to 2026-11-05 used protocol v3: Turnstile and reCAPTCHA v2 as
above, and hCaptcha on [NopeCHA's enterprise demo](https://nopecha.com/captcha/hcaptcha#enterprise),
counted as **token delivery only** because its callback calls no server verifier.
They still validate and display with their three columns. Since 2026-11-05
nopecha.com answers every visitor with a Cloudflare "Sorry, you have been
blocked" page (HTTP 403), from residential, EC2 and provider proxy IPs alike,
so v3 can no longer run and later protocols use no NopeCHA page.

## Daily run

`scripts/run-captcha-and-publish.sh` runs one campaign from the US West runner,
exports it as `results/captcha/<date>-west-v5.json` and pushes that file to
`main` as `browserarena-bot (us-west)`. It resets the checkout to `origin/main`,
reuses the runner's `.env`, and takes the checkout lock and the comparison lock
first, so it queues behind the other jobs on the box instead of overlapping them.

```cron
0 8 * * * /home/ubuntu/browserarena/scripts/run-captcha-and-publish.sh
```

This line is installed in the `ubuntu` crontab on the US West runner, the EC2
instance tagged `browser-arena-west` in AWS `us-west-1`, after the 04:00 and
06:00 UTC jobs (the 06:00 one usually ends by 07:35). The script writes its own
log to `logs/cron-<time>-us-west-captcha.log`. Port 22 is not open to the
internet; connect through the VPC's EC2 Instance Connect endpoint:

```bash
ID=$(aws ec2 describe-instances --region us-west-1 \
  --filters Name=tag:Name,Values=browser-arena-west Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2-instance-connect ssh --region us-west-1 --instance-id "$ID" --os-user ubuntu --connection-type eice
```

The default is 5 attempts per provider per CAPTCHA type: 210 paid sessions for
the six daily providers. `DAILY_EXCLUDED` in `protocol.mjs` leaves out Tilion
(no `TILION_API_KEY` on the runner), Hyperbrowser (out of credits) and
Browserless (free-plan usage cap) until their accounts can serve a daily
campaign; a missing key fails preflight and holds every later run for review. A
35-session protocol v4 campaign (five providers, one round) took 22 minutes on
2026-11-06, so expect roughly 3 to 4 hours on a normal day. `--runs N` changes it, `--dry-run` stops before the commit (and, if an earlier
push failed, reports the waiting result without pushing it), and
`--date YYYY-MM-DD` names the campaign. `--no-reset` keeps the checkout as it is
and refuses tracked changes. Guards:

- A date whose campaign is already on `origin/main` is never run again. A
  complete result that was not pushed is pushed first on the next run, so a
  failed push does not cost a second paid campaign. A copy waits in
  `.captcha-runs/pending/` until the push succeeds, because the other jobs on the
  box reset the shared checkout and would drop the unpushed commit. An export
  the publisher started (it leaves `.captcha-runs/pending/<id>.exporting`) but
  stopped before committing is published the same way if it is complete, and held
  for review if it is not. Any other export in `results/captcha/` is left alone
  for PR review.
- The daily providers are always passed explicitly, so `PROVIDER`, `RUNS` or
  `CONCURRENCY` in the runner's environment cannot shrink the campaign. `.env`
  is loaded only into the campaign's environment, so it cannot change the
  publisher's settings either.
- Only a complete campaign is published, and only its result file is committed.
- `.captcha-runs/needs-review` is written before the campaign starts and removed
  only once it exits cleanly. A campaign that fails, halts or is incomplete, or a
  publisher that is killed mid-run, leaves it behind. Later runs refuse to start
  until someone has reconciled the provider sessions it names and removed it. The
  evidence stays in `.captcha-runs/daily-*`.
- The campaign's time limit defaults to its worst case: every attempt using its
  full create, connect, navigation, solve and cleanup limits, including a failed
  release's recovery (425 seconds), three at a time, plus 15 minutes. That is
  8 h 31 min for the default 210
  attempts, so a slow day is published instead of cut off. `--timeout SECONDS`
  overrides it. At the limit the campaign gets SIGTERM so active attempts can
  finish cleanup, and SIGKILL only ten minutes later.
- Private evidence older than two weeks is deleted after a successful push.

## Export results for review

```bash
npm run captcha:export -- .captcha-runs/repeated-campaign 2026-11-07-west-v5
```

This writes one new `results/captcha/<id>.json` locally. It never pushes or
updates a live site. For a manual campaign, review that file in a PR; the daily
run above publishes its own. The site bundles the files from
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

The page shows one column per type of the campaign's protocol, labelled with its
success signal, and successes/attempted on that signal, with one dot per round
and the median time of successful attempts. Hovering, focusing or tapping a dot names its
round and outcome. Errors remain in the denominator and unrun attempts appear
separately. Five successes out of five still has a 95% lower bound near 57%;
small campaigns are exploratory, not reliable speed rankings. Campaigns
are never pooled across protocols or dates. Synthetic layout fixtures are not
published as provider results.

## Validation

`npm test` includes the protocol, scheduler, cleanup, redaction, provider request,
CLI and export tests without live provider credentials, plus a browser test of
each page probe against markup shaped like the live pages (skipped without
Chromium). The daily-script tests need GNU `timeout` and fail on macOS; run them
on Linux (CI or the runner). `npm --prefix web test`
checks loading and validation. `npm --prefix web run test:layout` checks the
CAPTCHA route, partial campaigns and its API as part of the website suite.
