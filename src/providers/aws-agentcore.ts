import { Sha256 } from "@aws-crypto/sha256-js";
import {
  BedrockAgentCoreClient,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

// The AWS-managed browser every account has, so there is nothing to create first.
const BROWSER_ID = "aws.browser.v1";
const SERVICE = "bedrock-agentcore";

/** The part of the SDK client the provider uses, so tests can substitute it. */
export type AgentCoreClient = Pick<BedrockAgentCoreClient, "send"> & {
  config: Pick<BedrockAgentCoreClient["config"], "credentials">;
};

// Amazon Bedrock AgentCore Browser. Credentials come from the standard AWS
// chain (environment keys, shared config or an instance role) and need
// bedrock-agentcore:StartBrowserSession, StopBrowserSession and
// ConnectBrowserAutomationStream.
export class AwsAgentCoreProvider implements ProviderClient {
  readonly name = "AWS_AGENTCORE";
  private _client: AgentCoreClient | null;

  constructor(client?: AgentCoreClient) {
    this._client = client ?? null;
  }

  computeCost(seconds: number): number {
    // $0.0895 per vCPU-hour plus $0.00945 per GB-hour, billed per second with a
    // 1-second minimum (aws.amazon.com/bedrock/agentcore/pricing). AWS bills
    // the CPU and peak memory actually used, which the benchmark cannot see,
    // so this is the ceiling: the full 1 vCPU / 4 GB a browser session gets.
    const perHour = 0.0895 + 4 * 0.00945;
    const billedSeconds = Math.max(1, seconds);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  private region(): string {
    return requireEnv("AWS_REGION");
  }

  private client(): AgentCoreClient {
    if (!this._client) {
      this._client = new BedrockAgentCoreClient({ region: this.region() });
    }
    return this._client;
  }

  async create(): Promise<ProviderSession> {
    const client = this.client();
    let id: string | undefined;
    let cdpUrl: string | undefined;
    try {
      const session = await client.send(
        new StartBrowserSessionCommand({ browserIdentifier: BROWSER_ID })
      );
      id = session.sessionId;
      cdpUrl = session.streams?.automationStream?.streamEndpoint;
    } catch (e: unknown) {
      throw describeError("StartBrowserSession", e);
    }
    if (!id || !cdpUrl) {
      throw new Error("Invalid AgentCore response: missing sessionId or automation stream endpoint");
    }
    return { id, cdpUrl, headers: await this.signConnect(client, cdpUrl) };
  }

  /**
   * The automation stream only accepts a SigV4-signed upgrade request, so the
   * signature travels as headers. Signs the same request as the AWS Python
   * SDK's `BrowserClient.generate_ws_headers`: a GET covering host and date.
   */
  private async signConnect(
    client: AgentCoreClient,
    cdpUrl: string
  ): Promise<Record<string, string>> {
    const url = new URL(cdpUrl);
    const signer = new SignatureV4({
      service: SERVICE,
      region: this.region(),
      credentials: client.config.credentials,
      sha256: Sha256,
      applyChecksum: false,
    });
    const signed = await signer.sign(
      new HttpRequest({
        method: "GET",
        protocol: "https:",
        hostname: url.hostname,
        path: url.pathname,
        headers: { host: url.host },
      })
    );
    // Playwright sets Host itself from the URL.
    const { host: _host, ...headers } = signed.headers;
    return headers;
  }

  async release(id: string): Promise<void> {
    try {
      await this.client().send(
        new StopBrowserSessionCommand({ browserIdentifier: BROWSER_ID, sessionId: id })
      );
    } catch (e: unknown) {
      throw describeError("StopBrowserSession", e);
    }
  }
}

/**
 * IAM errors spell out the caller's ARN, account id included, and failure
 * messages are committed with the results. Keeps the HTTP status so the
 * runners can still recognise throttling.
 */
function describeError(operation: string, e: unknown): Error {
  const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = err?.$metadata?.httpStatusCode;
  const message = (err?.message ?? String(e)).replace(/arn:aws[^\s"']*/g, "[redacted arn]");
  return Object.assign(
    new Error(
      `AgentCore ${operation} failed: ${err?.name ?? "Error"}${status ? ` (HTTP ${status})` : ""} - ${message}`
    ),
    { status }
  );
}
