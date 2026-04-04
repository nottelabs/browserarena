import type { ProviderClient } from "../types.js";
import { BrowserbaseProvider } from "./browserbase.js";
import { SteelProvider } from "./steel.js";
import { AnchorBrowserProvider } from "./anchorbrowser.js";
import { HyperbrowserProvider } from "./hyperbrowser.js";
import { KernelProvider, KernelHeadfulProvider } from "./kernel.js";
import { NotteProvider } from "./notte.js";
import { BrowserUseProvider } from "./browser-use.js";

export function getRequiredEnvVarsForProvider(name: string): string[] {
  const key = name.trim().toLowerCase();

  if (key === "browserbase" || key === "bb")
    return ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"];
  if (key === "steel") return ["STEEL_API_KEY"];
  if (key === "anchorbrowser" || key === "anchor") return ["ANCHORBROWSER_API_KEY"];
  if (key === "hyperbrowser" || key === "hyper") return ["HYPERBROWSER_API_KEY"];
  if (key === "kernel") return ["KERNEL_API_KEY"];
  if (key === "kernel-headed" || key === "kernel-headful") return ["KERNEL_API_KEY"];
  if (key === "notte") return ["NOTTE_API_KEY"];
  if (key === "browser-use" || key === "browseruse" || key === "bu")
    return ["BROWSER_USE_API_KEY"];
  throw new Error(`Unknown provider: ${name}`);
}

export function getMissingEnvVarsForProvider(name: string): string[] {
  return getRequiredEnvVarsForProvider(name).filter((n) => !process.env[n]);
}

export function resolveProvider(name: string): ProviderClient {
  const key = name.trim().toLowerCase();

  if (key === "browserbase" || key === "bb") return new BrowserbaseProvider();
  if (key === "steel") return new SteelProvider();
  if (key === "anchorbrowser" || key === "anchor")
    return new AnchorBrowserProvider();
  if (key === "hyperbrowser" || key === "hyper")
    return new HyperbrowserProvider();
  if (key === "kernel") return new KernelProvider();
  if (key === "kernel-headed" || key === "kernel-headful")
    return new KernelHeadfulProvider();
  if (key === "notte") return new NotteProvider();
  if (key === "browser-use" || key === "browseruse" || key === "bu")
    return new BrowserUseProvider();
  throw new Error(`Unknown provider: ${name}`);
}
