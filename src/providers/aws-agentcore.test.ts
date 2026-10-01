import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import {
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";

import { AwsAgentCoreProvider, type AgentCoreClient } from "./aws-agentcore.js";

const originalRegion = process.env.AWS_REGION;

const HOST = "bedrock-agentcore.us-east-1.amazonaws.com";
const PATH = "/browser-streams/aws.browser.v1/sessions/SESSION1/automation";
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/** Stands in for the SDK client: records commands and answers with `respond`. */
function fakeClient(
  credentials: Credentials,
  respond: (command: unknown) => unknown
): { client: AgentCoreClient; commands: unknown[] } {
  const commands: unknown[] = [];
  const client = {
    config: { credentials: async () => credentials },
    send: async (command: unknown) => {
      commands.push(command);
      return respond(command);
    },
  } as unknown as AgentCoreClient;
  return { client, commands };
}

function startedSession() {
  return {
    browserIdentifier: "aws.browser.v1",
    sessionId: "SESSION1",
    streams: { automationStream: { streamEndpoint: `wss://${HOST}${PATH}`, streamStatus: "ENABLED" } },
  };
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** SigV4 worked out by hand, independent of the SDK signer the provider uses. */
function expectedSignature(amzDate: string, signedHeaders: Record<string, string>): string {
  const names = Object.keys(signedHeaders).sort();
  const canonicalRequest = [
    "GET",
    PATH,
    "",
    ...names.map((n) => `${n}:${signedHeaders[n]}`),
    "",
    names.join(";"),
    sha256(""),
  ].join("\n");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/us-east-1/bedrock-agentcore/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), "us-east-1"), "bedrock-agentcore"), "aws4_request");
  return hmac(key, stringToSign).toString("hex");
}

beforeEach(() => {
  process.env.AWS_REGION = "us-east-1";
});

afterEach(() => {
  if (originalRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = originalRegion;
});

test("starts a session on the AWS-managed browser", async () => {
  const { client, commands } = fakeClient(
    { accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET },
    startedSession
  );

  const session = await new AwsAgentCoreProvider(client).create();

  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof StartBrowserSessionCommand);
  assert.deepEqual((commands[0] as StartBrowserSessionCommand).input, {
    browserIdentifier: "aws.browser.v1",
  });
  assert.equal(session.id, "SESSION1");
  assert.equal(session.cdpUrl, `wss://${HOST}${PATH}`);
});

test("signs the CDP connect with SigV4 over host and date", async () => {
  const { client } = fakeClient({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET }, startedSession);

  const { headers } = await new AwsAgentCoreProvider(client).create();

  assert.ok(headers);
  // Playwright sets Host from the URL, so only the signature and date travel.
  assert.deepEqual(Object.keys(headers).sort(), ["authorization", "x-amz-date"]);

  const amzDate = headers["x-amz-date"]!;
  assert.match(amzDate, /^\d{8}T\d{6}Z$/);
  assert.equal(
    headers.authorization,
    `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${amzDate.slice(0, 8)}/us-east-1/bedrock-agentcore/aws4_request, ` +
      `SignedHeaders=host;x-amz-date, ` +
      `Signature=${expectedSignature(amzDate, { host: HOST, "x-amz-date": amzDate })}`
  );
});

test("temporary credentials add a signed session token", async () => {
  const { client } = fakeClient(
    { accessKeyId: "ASIAEXAMPLE", secretAccessKey: SECRET, sessionToken: "session-token" },
    startedSession
  );

  const { headers } = await new AwsAgentCoreProvider(client).create();

  assert.ok(headers);
  assert.equal(headers["x-amz-security-token"], "session-token");

  const amzDate = headers["x-amz-date"]!;
  const signature = expectedSignature(amzDate, {
    host: HOST,
    "x-amz-date": amzDate,
    "x-amz-security-token": "session-token",
  });
  assert.match(headers.authorization!, /SignedHeaders=host;x-amz-date;x-amz-security-token,/);
  assert.ok(headers.authorization!.endsWith(`Signature=${signature}`));
});

test("a start without an automation stream is an error", async () => {
  const { client } = fakeClient({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET }, () => ({
    sessionId: "SESSION1",
  }));

  await assert.rejects(() => new AwsAgentCoreProvider(client).create(), /missing sessionId or automation/);
});

test("errors keep the status for throttling and drop the caller's ARN", async () => {
  const { client } = fakeClient({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET }, () => {
    throw Object.assign(
      new Error(
        "User: arn:aws:sts::123456789012:assumed-role/bench/i-0abc is not authorized to perform: " +
          "bedrock-agentcore:StartBrowserSession on resource: arn:aws:bedrock-agentcore:us-east-1:aws:browser/aws.browser.v1"
      ),
      { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }
    );
  });

  await assert.rejects(
    () => new AwsAgentCoreProvider(client).create(),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 403);
      assert.match(e.message, /StartBrowserSession failed: AccessDeniedException \(HTTP 403\)/);
      assert.doesNotMatch(e.message, /123456789012|arn:aws/);
      return true;
    }
  );
});

test("releasing stops the session", async () => {
  const { client, commands } = fakeClient({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET }, () => ({}));

  await new AwsAgentCoreProvider(client).release("SESSION1");

  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof StopBrowserSessionCommand);
  assert.deepEqual((commands[0] as StopBrowserSessionCommand).input, {
    browserIdentifier: "aws.browser.v1",
    sessionId: "SESSION1",
  });
});

test("a missing region fails on create, not on construction", async () => {
  delete process.env.AWS_REGION;

  const provider = new AwsAgentCoreProvider();
  await assert.rejects(() => provider.create(), /AWS_REGION/);
});

test("cost is the 1 vCPU / 4 GB ceiling, billed per second", () => {
  const provider = new AwsAgentCoreProvider();

  // $0.0895 per vCPU-hour + 4 GB at $0.00945 per GB-hour.
  assert.equal(provider.computeCost(3600), 0.1273);
  assert.equal(provider.computeCost(0), provider.computeCost(1));
});
