import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TilionProvider } from "./tilion.js";
import { SessionCreationError } from "../types.js";

test("Tilion requests residential regions, rejects wrong placement, and reports release failures", async () => {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let wrongRegion = false;
  let releaseFails = false;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ method: req.method!, path: req.url!, body });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") {
      res.writeHead(releaseFails ? 500 : 204); res.end();
    } else res.end(JSON.stringify({ session_id: "fixture", connect_url: "ws://fixture",
      region: wrongRegion ? "fr" : body.region }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.TILION_API_KEY, base: process.env.TILION_BASE_URL };
  process.env.TILION_API_KEY = "fixture";
  process.env.TILION_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const provider = new TilionProvider();
    for (const country of provider.proxyCountries) {
      const session = await provider.create({ proxyCountry: country });
      assert.deepEqual(requests.at(-1)!.body, { residential: true, region: country.toLowerCase(),
        proxy_rotation: "per_session", idle_timeout: 90 });
      await provider.release(session.id);
    }
    await provider.create();
    assert.deepEqual(requests.at(-1)!.body, { residential: false });
    await provider.release("fixture");
    const before = requests.length;
    for (const country of ["FR", "BR", "IN", "JP"] as const) {
      await assert.rejects(() => provider.create({ proxyCountry: country }), /did not verify residential exits/);
    }
    assert.equal(requests.length, before, "unverified countries must never create a paid session");
    wrongRegion = true;
    await assert.rejects(() => provider.create({ proxyCountry: "US" }), /requested region us, returned fr/);
    assert.deepEqual(requests.at(-1), { method: "DELETE", path: "/v1/session/fixture", body: {} });
    releaseFails = true;
    await assert.rejects(() => provider.create({ proxyCountry: "US" }), (error: unknown) => {
      assert.ok(error instanceof SessionCreationError);
      assert.equal(error.sessionId, "fixture");
      assert.match(error.message, /requested region us, returned fr/);
      assert.match(error.cleanupError!, /tilion release 500/);
      assert.equal(error.releaseMs, null);
      return true;
    });
    await assert.rejects(() => provider.release("fixture"), /tilion release 500/);
  } finally {
    for (const [key, value] of [["TILION_API_KEY", previous.key], ["TILION_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
