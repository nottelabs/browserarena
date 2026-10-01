export type ProviderName =
  | "STEEL"
  | "BROWSERBASE"
  | "ANCHORBROWSER"
  | "HYPERBROWSER"
  | "KERNEL"
  | "KERNEL_HEADFUL"
  | "NOTTE"
  | "BROWSER_USE"
  | "TILION"
  | "LIGHTPANDA"
  | "BROWSERLESS"
  | "CLOUDFLARE"
  | "AWS_AGENTCORE";

export type ProviderSession = {
  id: string;
  cdpUrl: string;
  /** Non-secret settings requested by the adapter, for benchmark provenance. */
  configuration?: Record<string, string | number | boolean>;
  /** Sent with the CDP connect request, for providers that authenticate it with headers rather than the URL. */
  headers?: Record<string, string>;
};

export type ProxyCountry = "US" | "FR" | "BR" | "IN" | "JP";
export type SessionOptions = { recording?: boolean; proxyCountry?: ProxyCountry };

/** A create response returned a real session which failed validation. */
export class SessionCreationError extends Error {
  constructor(message: string, readonly sessionId: string,
    readonly cleanupError: string | null, readonly releaseMs: number | null) {
    super(message);
    this.name = "SessionCreationError";
  }
}

export interface RecordingResult {
  data: Buffer;
  format: "mp4" | "json" | "m3u8";
  extension: string;
}

export interface ProviderClient {
  readonly name: ProviderName;
  /**
   * True when the provider has no session API: connecting over CDP starts the
   * session, and the runners end it with browser.close() instead of release().
   */
  readonly releasesOnDisconnect?: boolean;
  /** Returns estimated cost in USD for given session duration. Note: some providers charge for startup/creation; others have tier-dependent rates. This is a simplified estimate. */
  computeCost(seconds: number): number;
  /** Country targeting is opt-in; absent means this integration is not verified. */
  readonly proxyCountries?: readonly ProxyCountry[];
  readonly proxyUnsupportedReason?: string;
  create(opts?: SessionOptions): Promise<ProviderSession>;
  release(id: string): Promise<void>;
  /** Provider-metered traffic, when available after release. */
  getProxyBytes?(id: string): Promise<number | null>;

  /** Called before CDP connect to begin recording (only needed for providers with explicit start). */
  startRecording?(sessionId: string): Promise<string | void>;
  /** Called after session work is done but before release (only for explicit stop). */
  stopRecording?(sessionId: string, recordingId?: string): Promise<void>;
  /** Download the recording after the session has been released/stopped. */
  downloadRecording?(sessionId: string, recordingId?: string): Promise<RecordingResult>;
}
