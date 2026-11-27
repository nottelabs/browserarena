# reCAPTCHA v3 — what we learned

**Date:** Nov 12–13, 2026 · **Context:** BrowserArena's reCAPTCHA v3 benchmark
(2Captcha v3 demo, site key `6Lcyqq8o…`, action `demo_action`, pass = score ≥ 0.5)
· Full detail: `recaptcha-v3-investigation.md` · Raw data: this directory.

## TL;DR

Every provider scores ~50% on v3 not because of anything a provider or we do
wrong inside the session, but because a **fresh session + a 0.5 cutoff +
per-session residential IPs is a coin flip**. We proved the levers people
assume help (dwell, bought tokens, proxies) do nothing on day one. We then took
the client apart completely: it is Closure-obfuscated JS plus a **small
register-machine VM** shipped per-session in the anchor's `bgdata`, and we
disassembled the VM, decrypted its output, decompiled the host code to readable
JavaScript, and mapped every field of the `/reload` request. The client's
browser-side behaviour is no longer a black box — but the score is ultimately
decided server-side, on inputs (IP reputation, TLS fingerprint, cookie
history) that no browser-side change can move within a single fresh session.

## 1. The score is a coin flip — measured, not assumed

| Experiment | Result | Verdict |
|---|---|---|
| Benchmark runs (all providers) | 73/147 pass | ~50% |
| Our Notte runs, 2×2 (cold/dwell × proxy/no-proxy, 20/cell) | 41/80 pass | ~51% |
| Dwell (15 s interaction before check) | 19/40 vs 22/40 cold, p=0.65 | **no effect** |
| Notte proxy vs direct | 21/40 vs 20/40, p=1.0 | **no effect** |
| Bought tokens (Anti-Captcha, 60 tokens, tiers 0.3/0.7/0.9) | 25/50 ≥ 0.5, p=0.33 vs our own browser | **no better than doing it ourselves** |
| Fresh exit IP | 79/80 sessions had a distinct residential IP; the one reuse scored 0.7 *and* 0.3 | fresh IP ≠ good score |
| Page-ready timing vs score | corr = −0.02 | no timing signal |

The earlier local hint that dwell helps (6/10 vs 3/10) did not survive 80 real
Notte sessions — it was noise.

## 2. What the client actually is

Three layers, all reverse-engineered:

1. **Closure-compiled host code** — control-flow-flattened: 13 lazy function
   tables (`N, Z, n, p, z, P, J, l, E, m, W, H, Q6`), ~470 functions dispatched
   by ~214 numeric guards (`(f & M) == f`). Two XOR-encrypted string tables
   (the 31 KB inline one: 1,177 strings, decoder verified 1,177/1,177).
2. **A per-session register-machine VM** — the anchor's `bgdata` ships a
   constants *prelude* plus a program the client compiles and runs: **5,904
   instructions** in the main program, **38 opcodes seen / 42 mapped**, 244
   decoded string constants. It runs ~255 native-function/event-integrity
   probes with per-check timing and emits **exactly 25 signals** (25 static
   emit sites = 25 runtime emissions = 25 decrypted — fully accounted).
   Signals are LCG-encrypted, keyed from the session's own prelude.
3. **A scrypt proof-of-work in the worker**, handed around via a
   `window.scrypt` global.

`window.botguard` never appears — the BotGuard loader from public write-ups is
not part of the v3 flow; the "VM" here is its own smaller thing.

## 3. What it collects (the signal inventory)

- **Traced at runtime:** 75 browser-API read families across host, anchor and
  worker — behaviour events with timing, device (UA, UA-CH brands, cores,
  memory, battery, storage estimate), page context (cookies, referrer,
  resources, title), reputation storage (`rc::*` keys, storage-access), ~210
  `Function.prototype.toString` integrity tests, and content scans (error
  text, buy/pay words, **currency/price regexes** — it classifies the page as
  checkout vs content).
- **The VM adds what DOM proxies can't see:** `navigator.webdriver`, WebGL
  vendor/renderer via `UNMASKED_*` (flags software rendering), event-spoofing
  and native-function probes. Headless tells it demonstrably collects:
  `HeadlessChrome` UA, `webdriver === true`, SwiftShader renderer string —
  all three visible **in the decrypted signals themselves**.
- **/reload field map (all fields identified):** f1 release id, f2 token,
  f5 Qt, f6 `"q"`, f8 action, f14 site key, **f16** = client-data envelope
  (jspb `b5`: ~35 collector fields — page URL/title, first element + hash,
  viewport, timezone, third-party script hosts, DOM-quantity timings… all
  plaintexts captured), f20/f25 timing JSON, **f22** = the VM emission buffer
  (custom bit-packed stream; packer logic identified), f28/f29 timeouts.

## 4. The decompilation (done, verified)

Pipeline (`recaptcha-js/deobfuscate.mjs`): runtime-verified string-table
substitution (1,175 calls → `() => "literal"` thunks) → per-constant function
specialization + guard folding (3,590 clones, 7,661 call sites rewritten,
scope-aware via babel bindings) → webcrack **last** (it renames tables; order
matters). Verified behavior-preserving: original vs decompiled client in
identical traced sessions — both score, API-touch sets differ only by session
noise. Result: `recaptcha-js/final-deobfuscated.js` (~130k lines) where every
string is a named constant and the collection code reads as ordinary JS.

## 5. What this means for BrowserArena

**Don't**
- Rebuild bought-token v3 solving — no measurable benefit, plus cost, ~14 s
  latency, and the full-URL-to-provider privacy issue.
- Chase in-session tricks (dwell, timing, proxy toggling) — all measured null.

**Do**
- Use a real-Chrome UA (not `HeadlessChrome`), `webdriver = false`, and a
  GPU-backed WebGL renderer — the three tells the client demonstrably ships.
  (Plain headless Playwright fails all three.)
- Warm **persistent profiles and IP reputation across many sessions** — the
  only lever with a plausible mechanism, since the coin flip is decided by
  server-side history, not in-session behaviour.
- Publish score distributions in the benchmark — pass/fail at a 0.5 cutoff
  hides everything; the "ranking" between providers is sampling noise.

## 6. Honest limits

- **#22's final bit-packed layout** is the one un-reversed wire detail (packer
  logic known; bit arrangement not).
- **Server-side evaluation** — IP reputation, TLS/HTTP2 fingerprint, header
  order, Google cookies, and the per-site scoring weights are outside the
  browser and unknowable. This is why ~50% on day one is structural.
- **Release drift** — everything here is a snapshot of release
  `0lEGiwO4Qwx5R9ArxUy0mBpf` (desktop, `en`); the VM prelude is even
  per-session. The pipeline re-runs, but captures must be repeated per release.
- **Untested conditions** — error paths, other locales, mobile, Enterprise
  keys; canvas checks sit in the code's orbit but never triggered in our flows.

## Artifacts

The full write-up is [recaptcha-v3-investigation-2026-11-12.md](recaptcha-v3-investigation-2026-11-12.md).
Raw data and tooling (session logs, traces, the captured client, the
disassembler and every script named above) live in the local, untracked
`scratchpad/v3/` workspace of the security-audits checkout: experiment JSONL
files, `recaptcha-js/` for the decompilation, and `recaptcha-js/vm2/` for the
VM programs, disassemblies and the labeled signal table.
