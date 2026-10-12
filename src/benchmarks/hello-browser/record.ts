import fs from "node:fs";
import path from "node:path";
import { type Browser, chromium } from "playwright-core";
import type { Page } from "playwright-core";
import type { ProviderClient } from "../../types.js";

export async function runRecordedSession(
  provider: ProviderClient,
  { url, outDir, onPage }: {
    url: string;
    outDir: string;
    /** Optional callback to run custom actions on the page instead of a simple goto. */
    onPage?: (page: Page) => Promise<void>;
  }
) {
  fs.mkdirSync(outDir, { recursive: true });

  console.error(`[RECORD] provider=${provider.name} url=${url}`);

  // 1. Create session (with recording flag for providers that need it)
  console.error(`[RECORD] Creating session...`);
  const { id, cdpUrl, headers } = await provider.create({ recording: true });
  console.error(`[RECORD] Session created: id=${id}`);

  let recordingId: string | undefined;
  let browser: Browser | null = null;

  try {
    // 2. Start recording for providers that require explicit start (Kernel)
    if (provider.startRecording) {
      console.error(`[RECORD] Starting recording...`);
      const rid = await provider.startRecording(id);
      if (rid) recordingId = rid;
      console.error(`[RECORD] Recording started${recordingId ? ` (id=${recordingId})` : ""}`);
    }

    // 3. Connect via CDP and run actions
    console.error(`[RECORD] Connecting over CDP...`);
    browser = await chromium.connectOverCDP(cdpUrl, headers ? { headers } : undefined);
    console.error(`[RECORD] Connected`);

    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    if (onPage) {
      await onPage(page);
    } else {
      console.error(`[RECORD] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      console.error(`[RECORD] Page loaded`);
      await page.waitForTimeout(2000);
    }

    await page.close();
    await browser.close();
    browser = null;
    console.error(`[RECORD] Browser closed`);

    // 4. Stop recording for providers that require explicit stop (Kernel)
    if (provider.stopRecording) {
      console.error(`[RECORD] Stopping recording...`);
      await provider.stopRecording(id, recordingId);
      console.error(`[RECORD] Recording stopped`);
    }
  } finally {
    // A provider that ends the session on disconnect has a no-op release, so a
    // failed run must still close the browser here or it keeps billing.
    if (browser && provider.releasesOnDisconnect) {
      await browser.close().catch((e: unknown) =>
        console.error(`[RECORD] Close after failure failed: ${(e as Error)?.message || e}`)
      );
    }
    // 5. Release the session
    try {
      console.error(`[RECORD] Releasing session...`);
      await provider.release(id);
      console.error(`[RECORD] Session released`);
    } catch (e) {
      console.error(`[RECORD] Release failed: ${(e as Error)?.message || e}`);
    }
  }

  // 6. Download the recording
  if (!provider.downloadRecording) {
    console.error(`[RECORD] Provider ${provider.name} does not support recording download`);
    return;
  }

  console.error(`[RECORD] Downloading recording...`);
  const result = await provider.downloadRecording(id, recordingId);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}${result.extension}`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, result.data);
  console.error(`[RECORD] Saved ${result.format} recording to ${outPath} (${(result.data.length / 1024).toFixed(1)} KB)`);
}
