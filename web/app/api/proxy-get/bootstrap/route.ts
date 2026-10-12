export const dynamic = "force-dynamic";

export function GET() {
  return new Response('<!doctype html><html><head><title>Proxy GET runner</title><link rel="icon" href="data:,"></head><body></body></html>', {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
