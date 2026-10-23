import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { GologinProvider } from "./gologin.js";

test("GoLogin creates a fresh profile, builds the CDP URL, then stops and deletes it", async () => {
  const requests: { method: string; path: string; auth?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method!, path: req.url!, auth: req.headers.authorization,
      body: raw ? JSON.parse(raw) : {} });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") { res.writeHead(204); res.end(); }
    else res.end(JSON.stringify({ id: "profile123" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const previous = { token: process.env.GOLOGIN_API_TOKEN, api: process.env.GOLOGIN_API_URL };
  process.env.GOLOGIN_API_TOKEN = "tok";
  process.env.GOLOGIN_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const provider = new GologinProvider();
    const session = await provider.create();
    assert.equal(session.id, "profile123");
    const cdp = new URL(session.cdpUrl);
    assert.equal(cdp.host, "cloudbrowser.gologin.com");
    assert.equal(cdp.searchParams.get("token"), "tok");
    assert.equal(cdp.searchParams.get("profile"), "profile123");
    assert.deepEqual(requests[0], { method: "POST", path: "/browser/quick", auth: "Bearer tok",
      body: { os: "lin", name: "browserarena" } });

    await provider.release(session.id);
    assert.deepEqual(requests.slice(1).map(r => `${r.method} ${r.path}`),
      ["DELETE /browser/profile123/web", "DELETE /browser/profile123"]);

    await assert.rejects(provider.create({ proxyCountry: "US" }), /not yet wired/);
    assert.equal(provider.computeCost(3600), 0.04);
  } finally {
    process.env.GOLOGIN_API_TOKEN = previous.token;
    process.env.GOLOGIN_API_URL = previous.api;
    if (previous.token === undefined) delete process.env.GOLOGIN_API_TOKEN;
    if (previous.api === undefined) delete process.env.GOLOGIN_API_URL;
    server.close();
  }
});
