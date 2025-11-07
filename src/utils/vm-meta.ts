import os from "node:os";

export interface VmMeta {
  region: string | null;
  instance_type: string | null;
  cloud: "aws" | "local";
  os: string;
  node_version: string;
  started_at: string;
}

const IMDS_BASE = "http://169.254.169.254";

async function getImdsToken(timeoutMs = 2000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${IMDS_BASE}/latest/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

async function fetchAwsMeta(path: string, token: string | null, timeoutMs = 2000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {};
    if (token) headers["X-aws-ec2-metadata-token"] = token;
    const res = await fetch(
      `${IMDS_BASE}/latest/meta-data/${path}`,
      { signal: controller.signal, headers },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

export async function collectVmMeta(): Promise<VmMeta> {
  const token = await getImdsToken();

  const [region, instanceType] = await Promise.all([
    process.env.AWS_REGION ?? fetchAwsMeta("placement/region", token),
    fetchAwsMeta("instance-type", token),
  ]);

  const isAws = region !== null || instanceType !== null;

  return {
    region: typeof region === "string" ? region : null,
    instance_type: instanceType,
    cloud: isAws ? "aws" : "local",
    os: `${os.platform()} ${os.arch()}`,
    node_version: process.version,
    started_at: new Date().toISOString(),
  };
}
