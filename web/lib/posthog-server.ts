import { after } from "next/server";
import { PostHog } from "posthog-node";

/**
 * Server-side events for the public JSON endpoints and llms.txt, which are
 * read by uptime monitors, scripts and AI agents that never run the site's
 * JavaScript. Events are personless: no profile per caller, no IP stored.
 */
let client: PostHog | null = null;

function getClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  client ??= new PostHog(token, {
    host: process.env.POSTHOG_INGEST_HOST ?? "https://us.i.posthog.com",
    // Serverless: send each event right away rather than batching.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/** A coarse label for who is calling, from the User-Agent alone. */
export function callerKind(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (!ua) return "unknown";
  if (/(gptbot|chatgpt|oai-searchbot|claudebot|claude-user|anthropic|perplexity|google-extended|ccbot|bytespider|meta-externalagent)/.test(ua)) return "ai-agent";
  if (/(betterstack|better uptime|uptimerobot|checkly|cronitor|pingdom|statuscake|datadog|grafana)/.test(ua)) return "uptime-monitor";
  if (/(googlebot|bingbot|duckduckbot|yandex|baiduspider|applebot)/.test(ua)) return "search-crawler";
  if (/(curl|wget|python-requests|httpx|axios|node-fetch|undici|go-http-client|postman|insomnia)/.test(ua)) return "script";
  if (/(mozilla|safari|chrome|firefox)/.test(ua)) return "browser";
  return "other";
}

/**
 * Records one request after the response is sent, so it never adds latency.
 * Safe to call when PostHog is not configured.
 */
export function captureApiRequest(
  request: Request,
  route: string,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  const ph = getClient();
  if (!ph) return;
  const userAgent = request.headers.get("user-agent") ?? "";
  const url = new URL(request.url);
  after(async () => {
    ph.capture({
      distinctId: `api:${route}`,
      event: "api_requested",
      properties: {
        $process_person_profile: false,
        route,
        query: url.search.slice(0, 200),
        caller_kind: callerKind(userAgent),
        user_agent: userAgent.slice(0, 200),
        ...properties,
      },
    });
    await ph.flush();
  });
}
