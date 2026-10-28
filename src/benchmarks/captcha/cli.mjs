import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { configuration, PROVIDERS } from "./protocol.mjs";
import { runCampaign } from "./main.mjs";

// Keep unrelated lifecycle options from silently changing the meaning of a run.
export function parseCaptchaArgs(args, env = process.env) {
  const values = new Map();
  const allowed = new Set(["benchmark", "provider", "runs", "concurrency", "out", "preflight"]);
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unsupported CAPTCHA argument: ${args[i]}`);
    const [, key, inline] = match;
    if (values.has(key)) throw new Error(`Duplicate --${key}`);
    if (key === "preflight") {
      if (inline !== undefined) throw new Error("--preflight takes no value");
      values.set(key, true);
    } else {
      const value = inline ?? args[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value`);
      values.set(key, value);
    }
  }
  if (values.has("benchmark") && values.get("benchmark") !== "captcha") throw new Error("Expected --benchmark=captcha");
  const config = configuration({
    providers: String(values.get("provider") ?? env.PROVIDER ?? PROVIDERS.join(",")).split(",").map(name => name.trim()),
    rounds: Number(values.get("runs") ?? env.RUNS ?? 5),
    concurrency: Number(values.get("concurrency") ?? env.CONCURRENCY ?? 3),
  });
  return { config, output: values.get("out") ?? env.OUTPUT, preflightOnly: values.has("preflight") };
}

export async function runCaptchaCli(args, repository, run = runCampaign, env = process.env) {
  const { config, output, preflightOnly } = parseCaptchaArgs(args, env);
  const destination = output ?? join(repository, ".captcha-runs", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`);
  await run(config, destination, repository, { preflightOnly });
}
