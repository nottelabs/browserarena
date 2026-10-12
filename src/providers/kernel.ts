import type { ProviderClient, ProviderSession, RecordingResult, SessionOptions, ProxyCountry } from "../types.js";
import { PROXY_COUNTRIES } from "../benchmarks/proxy-get/schema.js";
import { requireEnv } from "../utils/env.js";
import { randomUUID } from "node:crypto";
import Kernel from "@onkernel/sdk";

function createKernelClient(): () => Promise<Kernel> {
  let client: Kernel | null = null;
  return async () => {
    if (!client) {
      const apiKey = requireEnv("KERNEL_API_KEY");
      client = new Kernel({ apiKey });
    }
    return client;
  };
}

const getClient = createKernelClient();

// Proxy configurations are separate resources. Each measured session owns one,
// and tracks it for cleanup, including browser creation failures.
class KernelProxySessions {
  private proxies = new Map<string, string>();

  async create(headless: boolean, country?: ProxyCountry): Promise<ProviderSession> {
    const client = await getClient();
    let proxyId: string | undefined;
    if (country) {
      const proxy = await client.proxies.create({ name: `browserarena-${country}-${randomUUID()}`, type: "residential", config: { country } }, { maxRetries: 0, timeout: 30_000 });
      if (!proxy.id) throw new Error("Kernel proxy response missing id");
      proxyId = proxy.id;
    }
    try {
      const created = await client.browsers.create({ headless,
        ...(proxyId ? { proxy: { id: proxyId } } : {}),
      }, { maxRetries: 0, timeout: 90_000 });
      if (proxyId) this.proxies.set(created.session_id, proxyId);
      return { id: created.session_id, cdpUrl: created.cdp_ws_url };
    } catch (error) {
      if (proxyId) await client.proxies.delete(proxyId, { maxRetries: 0, timeout: 30_000 });
      throw error;
    }
  }

  async release(id: string): Promise<void> {
    const client = await getClient();
    const proxyId = this.proxies.get(id);
    try {
      await client.browsers.deleteByID(id, proxyId ? { maxRetries: 0, timeout: 30_000 } : undefined);
    } finally {
      if (proxyId) {
        await client.proxies.delete(proxyId, { maxRetries: 0, timeout: 30_000 });
        this.proxies.delete(id);
      }
    }
  }
}

export class KernelProvider implements ProviderClient {
  readonly name = "KERNEL";
  readonly proxyCountries = PROXY_COUNTRIES;
  private proxySessions = new KernelProxySessions();
  private _replayId: string | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.06;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) return this.proxySessions.create(true, opts.proxyCountry);
    const created = await (await getClient()).browsers.create({ headless: true });
    const id = created.session_id;
    const cdpUrl = created.cdp_ws_url;
    if (!id || !cdpUrl) throw new Error("Invalid Kernel session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await this.proxySessions.release(id);
  }

  async startRecording(sessionId: string): Promise<string> {
    const client = await getClient();
    const replay = await client.browsers.replays.start(sessionId);
    this._replayId = replay.replay_id;
    return replay.replay_id;
  }

  async stopRecording(sessionId: string, recordingId?: string): Promise<void> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to stop");
    await client.browsers.replays.stop(rid, { id_or_name: sessionId });
  }

  async downloadRecording(sessionId: string, recordingId?: string): Promise<RecordingResult> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to download");

    const maxAttempts = 20;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await client.browsers.replays.download(rid, { id_or_name: sessionId });
        const blob = await response.blob();
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.length > 0) return { data: buf, format: "mp4", extension: ".mp4" };
      } catch {
        // replay may still be processing
      }
      console.error(`[RECORDING] Kernel replay not ready yet, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error("Kernel replay not available after max retries");
  }
}

export class KernelHeadfulProvider implements ProviderClient {
  readonly name = "KERNEL_HEADFUL";
  readonly proxyCountries = PROXY_COUNTRIES;
  private proxySessions = new KernelProxySessions();
  private _replayId: string | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.48;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) return this.proxySessions.create(false, opts.proxyCountry);
    const created = await (await getClient()).browsers.create({ headless: false });
    const id = created.session_id;
    const cdpUrl = created.cdp_ws_url;
    if (!id || !cdpUrl) throw new Error("Invalid Kernel session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await this.proxySessions.release(id);
  }

  async startRecording(sessionId: string): Promise<string> {
    const client = await getClient();
    const replay = await client.browsers.replays.start(sessionId);
    this._replayId = replay.replay_id;
    return replay.replay_id;
  }

  async stopRecording(sessionId: string, recordingId?: string): Promise<void> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to stop");
    await client.browsers.replays.stop(rid, { id_or_name: sessionId });
  }

  async downloadRecording(sessionId: string, recordingId?: string): Promise<RecordingResult> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to download");

    const maxAttempts = 20;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await client.browsers.replays.download(rid, { id_or_name: sessionId });
        const blob = await response.blob();
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.length > 0) return { data: buf, format: "mp4", extension: ".mp4" };
      } catch {
        // replay may still be processing
      }
      console.error(`[RECORDING] Kernel replay not ready yet, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error("Kernel replay not available after max retries");
  }
}
