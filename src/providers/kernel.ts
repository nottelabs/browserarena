import type { ProviderClient, ProviderSession } from "../types.js";
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

  computeCost(seconds: number): number {
    const perHour = 0.06; // Headless 1GB, billed per second
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
}

export class KernelHeadfulProvider implements ProviderClient {
  readonly name = "KERNEL_HEADFUL";

  computeCost(seconds: number): number {
    const perHour = 0.48; // Headful 8GB, billed per second
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
}
