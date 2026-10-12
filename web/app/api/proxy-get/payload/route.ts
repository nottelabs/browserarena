import { PAYLOAD, PAYLOAD_SHA256 } from "../../../../../src/benchmarks/proxy-get/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(new Uint8Array(PAYLOAD), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(PAYLOAD.length),
    "Content-Encoding": "identity",
    "Cache-Control": "no-store, no-transform",
    "Access-Control-Allow-Origin": "*",
    "Timing-Allow-Origin": "*",
    "X-Benchmark-Payload": "proxy-get-v1",
    "X-Payload-SHA256": PAYLOAD_SHA256,
  } });
}
