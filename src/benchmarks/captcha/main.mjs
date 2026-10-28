#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { preflight, schedule, summarize } from "./protocol.mjs";
import { createProviders, REQUIRED_ENV } from "./providers.mjs";
import { attempt, installCancellation, runSuite } from "./run.mjs";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";

export function sanitizer(base, env = process.env) {
  const secrets = Object.entries(env).filter(([key, value]) => /KEY|TOKEN|SECRET/.test(key) && value?.length > 8).map(([, value]) => value);
  return error => {
    let value = error instanceof Error ? error.message : String(error);
    for (const secret of secrets) value = value.split(secret).join("[redacted]");
    return base(value).slice(0, 2_000);
  };
}

export function report(config, rows, complete) {
  const cells = summarize(config, rows);
  const data = JSON.stringify({ cells, rows }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CAPTCHA repeated trials</title><style>
*{box-sizing:border-box}body{margin:0;color:var(--foreground,#18222d);font:14px/1.5 var(--font-sans,system-ui,sans-serif)}p{margin:0 0 14px}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{padding:10px 5px;border-bottom:1px solid var(--border,#d4dce6);text-align:left;vertical-align:top}th{font-weight:600;font-size:12px}td button{font:inherit;border:0;padding:0;background:none;color:var(--foreground,#18222d);text-decoration:underline;text-underline-offset:3px;cursor:pointer}small{display:block;color:var(--muted-foreground,#64748b);font-size:11px}.pass{color:var(--success,#16834a)}.mixed{color:var(--warning,#976100)}.none{color:var(--destructive,#c93636)}.rounds{display:flex;gap:4px;margin-top:5px}.round{width:8px;height:8px;border-radius:50%;background:var(--muted-foreground,#64748b)}.round.verified,.round.token_delivered{background:var(--success,#16834a)}.round.timeout{background:var(--warning,#976100)}.round.error,.round.rejected{background:var(--destructive,#c93636)}details{margin-top:18px}summary{cursor:pointer;font-weight:600}li{margin:6px 0}.panel{padding:16px;margin-top:14px;background:var(--secondary,#edf2f7);border-radius:var(--radius,8px)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--font-mono,monospace)}@media(max-width:420px){body{font-size:13px}th,td{padding:9px 3px}th{font-size:11px}}
</style></head><body><p><strong>CAPTCHA acceptance: repeated trials</strong></p><p>${config.rounds} fresh sessions per provider/type. Turnstile and reCAPTCHA require server acceptance. hCaptcha measures token delivery on NopeCHA; server acceptance is unverified. ${complete ? "All planned attempts are recorded." : "Campaign incomplete; unrun attempts are shown separately."}</p>
<table><thead><tr><th>Provider</th><th>Cloudflare<br>Turnstile</th><th>reCAPTCHA v2</th><th>hCaptcha<br><small>Token delivery only</small></th></tr></thead><tbody id="matrix"></tbody></table>
<p><small>Counts include every attempted session, including errors. Dots show rounds: green accepted/token delivered, amber timeout, red rejected/error. Intervals are 95% Wilson intervals; five attempts leave substantial uncertainty. Median times include navigation, conditional on acceptance or token delivery as labeled.</small></p>
<section id="detail" class="panel" hidden><strong id="detail-title"></strong><pre id="detail-body"></pre></section>
<details><summary>Protocol and limits</summary><ul><li>Fixed ${config.solveTimeoutMs / 1000}s solve window, no attempt retries, up to ${config.concurrency} sessions globally and one session per provider. Provider and CAPTCHA order rotate between rounds. The provider remains occupied during a five-second cooldown after cleanup.</li><li>Kernel uses headless stealth mode and its default ISP proxy. Browserbase and Steel use their native solver and managed proxy. Browser Use uses its default solver and US proxy. Notte uses Chrome, native solving and US proxy on its public API. The viewport is 1920 × 1080 for every session.</li><li>A single checkbox initiation is eligible after ten seconds for every provider when there is no token or visible image challenge. Image challenges and Turnstile are handled by the provider. Official forms use requestSubmit(), independently of pointer overlays.</li><li>Turnstile uses ZeroCaptcha’s real managed-widget demo and its same-origin verifier. A pass requires HTTP 200, success=true, testSecret=false, and the expected hostname. No ZeroCaptcha solver is used. reCAPTCHA uses Google’s official submission demo and requires an observed official POST response and the accepted page. hCaptcha uses NopeCHA’s enterprise demo: matching response-field/widget tokens and its success callback establish token delivery only. Its callback performs no server verification; hCaptcha results are never labeled accepted.</li><li>Fixtures select challenge difficulty dynamically. Acceptance can reflect automatic clearance or solving, and is not a visual-puzzle accuracy score. Native proxy pools and provider implementations differ. This does not test Cloudflare’s full interstitial challenge.</li><li>These rounds are a separate campaign from the exploratory pilot. Setup errors, verification errors, rejection, timeouts, cleanup failures and unrun work remain distinct. Unknown session ownership or failed cleanup stops new attempts.</li></ul></details>
<script>const data=${data};const names={kernel:'Kernel',browserbase:'Browserbase','browser-use':'Browser Use',steel:'Steel',notte:'Notte'};const types=['turnstile','recaptcha','hcaptcha'];const matrix=document.getElementById('matrix');for(const provider of ${JSON.stringify(config.providers)}){const tr=document.createElement('tr');const th=document.createElement('th');th.scope='row';th.textContent=names[provider];tr.append(th);for(const type of types){const cell=data.cells.find(c=>c.provider===provider&&c.type===type);const td=document.createElement('td');const button=document.createElement('button');const delivery=type==='hcaptcha';const count=delivery?cell.token_delivered:cell.verified;const bounds=delivery?cell.delivery_interval_95:cell.acceptance_interval_95;const median=delivery?cell.delivered_median_ms:cell.accepted_median_ms;button.className=count===cell.attempted&&cell.attempted?'pass':count?'mixed':'none';button.textContent=count+'/'+cell.attempted+(delivery?' delivered':' accepted');button.onclick=()=>{document.getElementById('detail').hidden=false;document.getElementById('detail-title').textContent=names[provider]+' · '+type;document.getElementById('detail-body').textContent=JSON.stringify({summary:cell,attempts:data.rows.filter(r=>r.provider===provider&&r.type===type)},null,2);};td.append(button);const meta=document.createElement('small');meta.textContent=bounds?Math.round(bounds[0]*100)+'–'+Math.round(bounds[1]*100)+'% interval':'No attempts';td.append(meta);if(median!==null){const time=document.createElement('small');time.textContent=(median/1000).toFixed(1)+(delivery?'s delivery median':'s accepted median');td.append(time);}if(cell.not_run){const missing=document.createElement('small');missing.textContent=cell.not_run+' not run';td.append(missing);}const dots=document.createElement('div');dots.className='rounds';for(const round of cell.rounds.sort((a,b)=>a.round-b.round)){const dot=document.createElement('span');dot.className='round '+round.status;dot.title='Round '+round.round+': '+round.status;dots.append(dot);}td.append(dots);tr.append(td);}matrix.append(tr);}console.log('attempts',data.rows.length,'cells',data.cells.length);</script></body></html>`;
}

export async function runCampaign(config, outputArg, repository, { preflightOnly = false } = {}) {
  const output = resolve(outputArg);
  const load = createRequire(join(repository, "package.json"));
  const clean = sanitizer(sanitizeErrorMessage);
  const missing = config.providers.flatMap(provider => REQUIRED_ENV[provider].filter(key => !process.env[key]));
  if (missing.length) throw new Error(`Missing credential variables: ${[...new Set(missing)].join(", ")}`);
  const { chromium } = load("playwright-core");
  const packages = ["playwright-core", "@browserbasehq/sdk", "@onkernel/sdk", "steel-sdk"];
  const versions = Object.fromEntries(await Promise.all(packages.map(async name =>
    [name, JSON.parse(await readFile(join(repository, "node_modules", name, "package.json"), "utf8")).version])));
  const directory = dirname(fileURLToPath(import.meta.url));
  const sources = Object.fromEntries(await Promise.all(["main.mjs", "protocol.mjs", "providers.mjs", "run.mjs"].map(async file => {
    const data = await readFile(join(directory, file));
    return [file, { hash: createHash("sha256").update(data).digest("hex"), data }];
  })));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Never overwrite or silently resume an earlier campaign.
  const metadata = { benchmark: "captcha", ...config, started_at: new Date().toISOString(), node: process.version, hostname: hostname(),
    browserarena_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    sdk_versions: versions, sources: Object.fromEntries(Object.entries(sources).map(([file, value]) => [file, value.hash])) };
  await writeFile(join(output, "configuration.json"), JSON.stringify(metadata, null, 2));
  await writeFile(join(output, "plan.json"), JSON.stringify(schedule(config).flat().map(({ fixture, ...task }) => ({ ...task, type: fixture.type })), null, 2));
  await mkdir(join(output, "source"));
  for (const [file, value] of Object.entries(sources)) await writeFile(join(output, "source", file), value.data);
  try { await writeFile(join(output, "preflight.json"), JSON.stringify(await preflight(), null, 2)); }
  catch (error) { await writeFile(join(output, "preflight-error.json"), JSON.stringify({ error: clean(error) })); throw new Error(clean(error)); }
  if (preflightOnly) { console.log("Preflight passed; no browser sessions created"); return; }
  const controller = new AbortController(), removeSignals = installCancellation(controller);
  const journal = event => appendFile(join(output, "events.jsonl"), JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n");
  const persisted = [];
  let result;
  try {
    result = await runSuite(config, { signal: controller.signal,
      runAttempt: task => attempt(task, config, { create: createProviders(load), chromium, clean, journal, signal: controller.signal,
        screenshot: async (page, task, row) => {
          const mask = task.fixture.type === "hcaptcha" ? [page.locator(".response")]
            : task.fixture.type === "turnstile" ? [page.locator("[data-demo-field]")] : [];
          await page.screenshot({ path: join(output, `${task.id}.png`), mask, timeout: 10_000 });
          row.screenshot = `${task.id}.png`;
        } }),
      save: async row => {
        await appendFile(join(output, "attempts.jsonl"), JSON.stringify(row) + "\n");
        persisted.push(row);
        console.log(JSON.stringify({ id: row.id, status: row.status, stage: row.stage,
          accepted_ms: row.accepted_ms, released: row.cleanup.released, halt: row.halt_campaign }));
      },
    });
  } finally {
    removeSignals();
    const complete = persisted.length === config.providers.length * config.rounds * config.fixtures.length;
    const summary = { configuration: metadata, finished_at: new Date().toISOString(), complete,
      halted: result?.halted ?? true, interrupted: controller.signal.aborted,
      cells: summarize(config, persisted), not_run: schedule(config).flat().filter(t => !persisted.some(r => r.id === t.id)).map(t => t.id) };
    await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(output, "report.html"), report(config, persisted, complete));
  }
  if (result.halted || controller.signal.aborted) throw new Error("Campaign incomplete or cleanup failed; inspect the saved evidence before another run");
  console.log("CAMPAIGN_COMPLETE", persisted.length);
}
