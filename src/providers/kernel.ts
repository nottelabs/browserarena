import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
import { requireEnv } from "../utils/env.js";
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

export class KernelProvider implements ProviderClient {
  readonly name = "KERNEL";
  private _replayId: string | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.06;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(): Promise<ProviderSession> {
    const created = await (await getClient()).browsers.create({ headless: true });
    const id = created.session_id;
    const cdpUrl = created.cdp_ws_url;
    if (!id || !cdpUrl) throw new Error("Invalid Kernel session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await getClient()).browsers.deleteByID(id);
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
    await client.browsers.replays.stop(rid, { id: sessionId });
  }

  async downloadRecording(sessionId: string, recordingId?: string): Promise<RecordingResult> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to download");

    const maxAttempts = 20;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await client.browsers.replays.download(rid, { id: sessionId });
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
  private _replayId: string | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.48;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(): Promise<ProviderSession> {
    const created = await (await getClient()).browsers.create({ headless: false });
    const id = created.session_id;
    const cdpUrl = created.cdp_ws_url;
    if (!id || !cdpUrl) throw new Error("Invalid Kernel session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await getClient()).browsers.deleteByID(id);
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
    await client.browsers.replays.stop(rid, { id: sessionId });
  }

  async downloadRecording(sessionId: string, recordingId?: string): Promise<RecordingResult> {
    const client = await getClient();
    const rid = recordingId || this._replayId;
    if (!rid) throw new Error("No Kernel replay_id to download");

    const maxAttempts = 20;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await client.browsers.replays.download(rid, { id: sessionId });
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
