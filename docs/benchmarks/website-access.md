# Website access

The `/website-access` report contains the reviewed October 28, 2026 exploratory campaign: 20 difficult URLs, five managed browser providers, three fresh visits per pair, 300 planned visits. It includes the results report, a validated interchange format and an opt-in five-provider collector. It does not schedule benchmark traffic.

## Read the result correctly

Visit access is accessible visits divided by all 60 planned visits for a provider. Site coverage is sites with at least one accessible visit divided by 20. Both are displayed, and all failed or uncertain visits remain in the denominator.

The subset was deliberately selected for difficult access from Stealth Bench v2 and Web Data benchmark URLs. It is not representative of the general web, a complete rerun of those suites, or a reproduction of the 725-URL claim. Three samples do not establish a permanent block or isolate the cause of a provider difference.

One initial navigation was made in each fresh session. Evidence was captured at nominal 20 and 60 seconds; 60-second usable content is the scored endpoint. Navigation could time out after 19 seconds while the observation continued. Provider-native challenge handling was enabled; the harness did not click challenges, reload, or replace failed attempts. Providers progressed independently at concurrency one each, at most five overall, with a five-second cooldown after release. Target order rotated between rounds.

A reviewer used original screenshots and page text, without blinding to provider identity. A menu, HTTP 200 or reported CAPTCHA solve alone does not establish access. Login walls and uncertain content have their own outcomes. Expected-text matches used by extraction benchmarks are a separate diagnostic, not this access score.

The US West runner used provider-managed proxies and native browser configurations. Browserbase used US East, explicit US proxy and standard mode; Kernel used headful stealth and its default ISP proxy; Browser Use used v4, US proxy and default solver; Steel used its managed proxy and solver; Notte used its production headless Chrome, US proxy, native solving and no ad blocking. IP pools, provider location and autonomous browser behavior differ. A 1365 × 900 viewport was requested, but Browser Use's observed geometry differed. This is a comparison of those managed offerings, not a controlled fingerprint experiment.

## Public evidence

`results/website-access/2026-10-28/run.json` is the public, reviewed record. Every row has its original outcome and reason, original screenshot filename and SHA-256, and a separately described replay. The 300 unaltered final screenshots ship under `web/public/website-access/2026-10-28/`. Raw session IDs, authenticated CDP endpoints, organization identifiers, headers and cookies are not part of this format.

Replay provenance is mandatory:

- `original`: recording of the scored visit. There are 180.
- `followup`: a separately recorded later visit for that site/provider/round slot. There are 120. It does not reconstruct the scored visit and contributes no score.

Original screenshots remain visible even when a follow-up replay is shown. Additional diagnostic runs and extra recordings are not imported into this scored campaign.

The export endpoint `/website-access/export` returns the same validated JSON. `parseAccessReport` rejects missing slots, duplicates, unreviewed outcomes, unsafe asset filenames and unknown visit fields. `providerScores` uses only original visit outcomes. Tests assert the published totals and hash every original screenshot.

## Replay hosting

Videos are archived outside git. The JSON records the 300 selected filenames, SHA-256 hashes and durations. Before publishing them, verify the files against this manifest and upload only the selected MP4s to an approved public evidence store at `<root>/2026-10-28/<filename>`.

Set `WEBSITE_ACCESS_MEDIA_ORIGIN` to that public HTTPS root, for example `https://evidence.example.com/website-access`. It must not contain credentials, a query string or a fragment. Next.js rewrites the same-origin `/website-access/evidence/:date/:file` route to this store; the existing Content Security Policy remains unchanged. The origin must support video content types and byte-range requests. Configure it before the deployment build, and verify seeking and playback in the resulting preview.

Without this setting the report explicitly says the replays are archived but unpublished. It never presents a broken or fabricated video as available. Screenshots and scores work without external media services.

## Extending the benchmark

The format is versioned at `schemaVersion: 1`. A complete report names providers, exact target URLs, planned rounds, observation time and all reviewed slots. Keep collection, review and presentation separate. The collector emits an immutable attempt journal, records failed creates and cleanup failures, starts recording before navigation, and preserves provider configuration and observed geometry. Do not convert HTTP responses or solver acknowledgements into access scores. Do not reuse diagnostic or recording follow-ups as scored retries.

Before another campaign is accepted, declare its sites, attempt count and access criteria; preserve all attempts; review its original evidence; and validate its full denominator. New dates should produce new immutable report directories rather than overwrite this run.

## Run a campaign

Install root dependencies with `npm ci`, then `npm run access -- plan config/website-access/difficult-20.json`. Planning validates the configuration and prints all 300 slots and missing credential variable names without creating sessions.

The collector uses `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `KERNEL_API_KEY`, `BROWSER_USE_API_KEY`, `STEEL_API_KEY` and `NOTTE_API_KEY` through the existing environment or ignored `.env`. `NOTTE_API_URL` optionally selects an HTTPS API origin; its default is production. Verify account, environment, available credit and intended target list before running. Never commit keys or raw run directories.

```sh
npm run access -- run config/website-access/difficult-20.json website-access-runs/my-run --live
```

The output directory must not exist. The command allocates fresh sessions, one at a time per provider, and rotates site order between rounds. It makes one navigation per slot, captures the declared checkpoints, and never clicks a challenge or repeats a failed visit. A provider's native solver may act independently. The runner preserves the original campaign's scenario-specific proxy and solver settings in separate adapters; the existing lifecycle benchmark defaults are unchanged. Current SDK parameter names map the Browserbase 300-second and Steel 300,000-millisecond session limits to their wire fields.

`viewport_mode: "requested"` reproduces the original post-connect viewport operation. `"native"` omits it for a separately labelled experiment. Actual inner, outer, screen, available-screen and DPR values are recorded. Neither option establishes equivalent fingerprints or proxy exits across providers.

The private output contains an immutable plan, requested configuration, source hashes and revision, an append-only attempt/event journal, original screenshots and observations, raw CDP frames with timestamps, and completion/cleanup metadata. An ambiguous create or failed release halts further allocations; already active visits still clean up. Interrupts preserve completed and interrupted attempts. Unattempted slots are explicitly listed and an incomplete campaign cannot be exported as a complete report. The runner does not silently resume or replace attempts. Inspect retained session ownership after a failed create or release.

CDP recording starts before navigation on every connected browser and acknowledges every received frame after writing it. Frame receipt times and first/last frame times remain in the archive; CDP does not promise a fixed frame rate. Recording failures do not change access outcomes and are surfaced separately. The live command returns nonzero for incomplete collection, cleanup failures, any requested capture failure or recording errors. A successful final capture does not erase an earlier failed checkpoint.

## Encode, review and export

FFmpeg and FFprobe are needed only for encoding. These commands preserve raw frames and use their timing, holding the last received frame between updates. They never interpolate missing activity or create a substitute visit.

```sh
npm run access -- encode website-access-runs/my-run
# Review original screenshots and observations, then fill each row of review.json.
npm run access -- export website-access-runs/my-run website-access-runs/my-export 2026-10-28
```

`review.json` starts with null outcomes and `reviewed: false` for every planned slot. A reviewer must set a supported outcome and evidence-based reason for each row. Scores are never assigned from HTTP status, expected text, CAPTCHA acknowledgement or successful capture alone. Publication requires one attempt and one completed review per planned slot. A visit with no screenshot or recording retains a null asset; an accessible outcome requires an original screenshot. The renderer displays absent evidence explicitly. The exporter copies only referenced assets and allowlisted public fields, and checks screenshot and encoded-video hashes. It excludes session IDs, response headers and credentials.

Encoding requires a recording without capture errors and decodes the resulting MP4 before accepting it. A failed encoding stops the command and retains raw evidence; resolve that failure rather than treating it as a passing replay. Rerunning encoding verifies the hashes of completed videos and leaves them untouched, then processes unfinished recordings. New videos are encoded and decoded in temporary files before their video and completion metadata are published; a partial encoding cannot stand in for a completed replay. The exporter also supports a deliberate screenshot-only review when no encoded video exists. Inspect screenshots, page text and videos for sensitive content before making the exported bundle public; sanitizing diagnostic text cannot redact pixels.

To publish a reviewed run, add its run.json under results/website-access/DATE, its screenshots under web/public/website-access/DATE, and explicitly select it in web/lib/website-access.ts. Upload its videos through the evidence-store procedure above. The current page is deliberately pinned to the reviewed October 28 campaign; collection does not automatically publish or overwrite it.

## Validation boundary

Local tests exercise all five adapters with intercepted requests, no-retry errors, ambiguous creates, release failures, real Chromium screenshots and CDP frames, reviewed export, and immutable output directories. An additional local fixture validated FFmpeg encoding, decoding and video hashes. The imported 300-visit campaign was collected by the earlier frozen harness; the new packaged runner has not yet been validated against all five live provider APIs. Preview playback also awaits public media configuration.
