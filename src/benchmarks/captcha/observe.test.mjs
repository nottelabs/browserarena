import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { FIXTURES } from "./protocol.mjs";
import { observe, submit } from "./run.mjs";

const by = type => FIXTURES.find(f => f.type === type);

async function launch() {
  for (const options of [{}, { channel: "chrome" }]) {
    try { return await chromium.launch(options); }
    catch (error) { if (!/Executable doesn't exist|is not found|ENOENT/i.test(String(error))) throw error; }
  }
  return null;
}

// Markup shaped like each live page on 2026-11-06, served at the fixture's own URL.
const IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const pages = {
  // democaptcha.com replaces its form with a var_dump of siteverify, after an echo of the token.
  hcaptcha: dump => `<div class="section article">${dump ? `string(51) "Hcaptcha code: P1_echoed-token"\n${dump}`
    : `<form action="" name="hcaptcha_demo_form" method="POST"><div class="h-captcha" data-sitekey="${by("hcaptcha").sitekey}">
    <textarea name="h-captcha-response">${"P1_" + "x".repeat(40)}</textarea></div></form>`}</div>`,
  "recaptcha-v3": sitekey => `<form><button data-action="demo_action" type="submit">Check</button></form>
    <script src="https://www.google.com/recaptcha/api.js?render=${sitekey}"></script>
    <script>window.grecaptcha = { execute: () => Promise.resolve("token") };</script>`,
  geetest: filled => `<form id="geetest-demo-form"><input type="hidden" name="geetest_challenge" value="${filled ? "c".repeat(34) : ""}">
    <input type="hidden" name="geetest_validate" value="${filled ? "v".repeat(32) : ""}">
    <input type="hidden" name="geetest_seccode" value="${filled ? "v".repeat(32) + "|jordan" : ""}"></form>`,
  text: `<form id="f"><img alt="normal captcha example" src="${IMAGE}"><input id="simple-captcha-field" value="">
    <button type="submit">Check</button></form>
    <script>document.getElementById("f").addEventListener("submit", event => { event.preventDefault();
      const ok = document.getElementById("simple-captcha-field").value === "w9h5k";
      document.body.insertAdjacentHTML("beforeend", ok ? "<p>Captcha is passed successfully!</p>"
        : "<div class='alertBody'>Incorrect captcha answer, please try again.</div>");
      if (ok) document.getElementById("f").insertAdjacentHTML("beforeend", "<p>Captcha is passed successfully!</p>"); });</script>`,
  perimeterx: ({ challenge, results }) => `<script>window._pxAppId = "${by("perimeterx").appId}";</script>
    ${results ? `<h2>Results for "desk lamp"</h2><a href="/ip/desk-lamp/123">Lamp</a>` : ""}
    ${challenge ? `<div id="px-captcha" style="width:300px;height:100px">Press & Hold</div>` : ""}`,
};

test("page probes read each v5 fixture's real signals in a browser", async t => {
  const browser = await launch();
  if (!browser) { t.skip("No Chromium installed"); return; }
  try {
    const page = await browser.newPage();
    let body = "";
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith("https://www.google.com/recaptcha/")) return route.fulfill({ body: "", contentType: "text/javascript" });
      return route.fulfill({ body: `<!doctype html><html><body>${body}</body></html>`, contentType: "text/html" });
    });
    const show = async (fixture, html, url = fixture.url) => { body = html; await page.goto(url); return observe(page, fixture); };

    const hcaptcha = by("hcaptcha");
    let state = await show(hcaptcha, pages.hcaptcha(""));
    assert.equal(state.formPresent, true); assert.equal(state.tokenPresent, true); assert.equal(state.rejected, false);
    const dump = (success, hostname) => `array(3) {\n  ["success"]=>\n  bool(${success})\n  ["credit"]=>\n  bool(false)\n` +
      `  ["hostname"]=>\n  string(${hostname.length}) "${hostname}"\n}\n<h2>Your message was posted</h2>`;
    state = await show(hcaptcha, pages.hcaptcha(dump(true, "democaptcha.com")));
    assert.deepEqual(state.siteverify, { success: true, hostname: "democaptcha.com", errorCodes: undefined });
    assert.equal(state.formPresent, false); assert.equal(state.rejected, false);
    // The echoed token stays out of the recorded state.
    assert.doesNotMatch(JSON.stringify(state), /echoed-token/);
    state = await show(hcaptcha, pages.hcaptcha(dump(true, "dummy-key-pass")));
    assert.equal(state.rejected, true);
    state = await show(hcaptcha, pages.hcaptcha(dump(false, "democaptcha.com")));
    assert.equal(state.rejected, true);
    state = await show(hcaptcha, pages.hcaptcha("").replace(hcaptcha.sitekey, "10000000-ffff-ffff-ffff-000000000001"));
    assert.equal(state.drift, "hCaptcha sitekey changed");

    const v3 = by("recaptcha-v3");
    state = await show(v3, pages["recaptcha-v3"](v3.sitekey));
    assert.equal(state.ready, true); assert.equal(state.drift, null);
    state = await show(v3, pages["recaptcha-v3"]("6Lother"));
    assert.equal(state.ready, false); assert.equal(state.drift, "reCAPTCHA v3 sitekey changed");

    const geetest = by("geetest");
    assert.equal((await show(geetest, pages.geetest(false))).tokenPresent, false);
    assert.equal((await show(geetest, pages.geetest(true))).tokenPresent, true);

    const text = by("text");
    state = await show(text, pages.text);
    assert.equal(state.formPresent, true); assert.equal(state.imageReady, true); assert.equal(state.tokenPresent, false);
    // Stand in for the provider's solver typing the answer, then submit as the harness does.
    await page.fill("#simple-captcha-field", "w9h5k");
    assert.equal(await submit(page, text), null);
    state = await observe(page, text);
    assert.equal(state.passed, true); assert.equal(state.failed, false);
    await show(text, pages.text);
    await page.fill("#simple-captcha-field", "wrong");
    await submit(page, text);
    state = await observe(page, text);
    assert.equal(state.passed, false); assert.equal(state.rejected, true);

    const px = by("perimeterx");
    state = await show(px, pages.perimeterx({ results: true }));
    assert.deepEqual([state.appId, state.challenge, state.searchReady, state.products], [px.appId, false, true, 1]);
    state = await show(px, pages.perimeterx({ challenge: true }), "https://www.walmart.com/blocked?url=x");
    assert.equal(state.challenge, true); assert.equal(state.searchReady, false);
    state = await show(px, pages.perimeterx({ challenge: true, results: true }));
    assert.equal(state.challenge, true, "a visible press-and-hold widget is a challenge even over results");
  } finally { await browser.close(); }
});
