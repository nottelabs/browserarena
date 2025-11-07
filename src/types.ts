export type ProviderName =
  | "STEEL"
  | "BROWSERBASE"
  | "ANCHORBROWSER"
  | "HYPERBROWSER"
  | "KERNEL"
  | "KERNEL_HEADFUL"
  | "NOTTE"
  | "BROWSER_USE";

export type ProviderSession = {
  id: string;
  cdpUrl: string;
};

export interface ProviderClient {
  readonly name: ProviderName;
  /** Returns estimated cost in USD for given session duration. Note: some providers charge for startup/creation; others have tier-dependent rates. This is a simplified estimate. */
  computeCost(seconds: number): number;
  create(): Promise<ProviderSession>;
  release(id: string): Promise<void>;
}
