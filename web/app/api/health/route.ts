/**
 * Public health endpoint for uptime monitors.
 *
 *   https://www.browserarena.ai/api/health
 *
 * NOTE: use the `www.` host. The apex 307-redirects, and monitors that do not
 * follow redirects will record the 307 as either up or down — both wrong.
 *
 * The HTTP status carries the signal (200 ok / 503 degraded) so Better Stack,
 * Checkly, Cronitor, UptimeRobot and friends alert on it with zero config.
 */

import { loadHealthReport, type HealthStatus } from "@/lib/regression";

/**
 * Request-time evaluation. `results/` is traced into the lambda bundle, so the
 * `fs` read works here; what we specifically need from a dynamic route is the
 * *clock*. A dead cron produces no commit, so no rebuild — a build-time clock
 * could never notice its own data going stale.
 */
export const dynamic = "force-dynamic";

const VALID_CONCURRENCY = [1, 10];
const DEFAULT_PROVIDER = "NOTTE";

/** "browser-use" | "BROWSER_USE" -> "BROWSER_USE" */
function normalizeProvider(raw: string): string {
  return raw.trim().toUpperCase().replace(/-/g, "_");
}

function fail(message: string, status: number) {
  return Response.json(
    { status: "unknown", error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const benchmark = params.get("benchmark") ?? "hello-browser";
  if (benchmark !== "hello-browser") {
    return fail(`Unknown benchmark: ${benchmark}. Only hello-browser is supported.`, 400);
  }

  const concurrency = Number(params.get("concurrency") ?? 1);
  if (!VALID_CONCURRENCY.includes(concurrency)) {
    return fail(
      `Invalid concurrency. Must be one of: ${VALID_CONCURRENCY.join(", ")}`,
      400
    );
  }

  const providerParam = params.get("provider") ?? DEFAULT_PROVIDER;
  const scopeAll = providerParam.toLowerCase() === "all";
  const provider = scopeAll ? null : normalizeProvider(providerParam);

  const report = await loadHealthReport(benchmark, concurrency, new Date());

  const series = provider
    ? report.series.filter((s) => s.provider === provider)
    : report.series;

  if (provider && series.length === 0) {
    const known = report.series.map((s) => s.provider).join(", ");
    return fail(`Unknown provider: ${providerParam}. Known: ${known}`, 400);
  }

  const scoped =
    provider === null
      ? report
      : {
          ...report,
          series,
          stale: report.stale.filter((p) => p === provider),
          status: series[0].status,
          summary: series[0].summary,
        };

  const status: HealthStatus = scoped.status;
  // `unknown` (cold start, not enough history) must never page.
  const httpStatus = status === "degraded" || status === "stale" ? 503 : 200;
  const ageHours = series[0]?.ageHours ?? null;

  const headers: Record<string, string> = {
    "X-Health-Status": status,
    ...(ageHours !== null ? { "X-Health-Age-Hours": ageHours.toFixed(1) } : {}),
  };

  if (httpStatus === 503) {
    headers["Retry-After"] = "3600";
    // Short TTL rather than no-store. A regression stays open for days, and an
    // uncached 503 would mean every uptime check re-parses the full history
    // for the whole incident. Safe to cache: results only change on redeploy,
    // and each Vercel deployment gets its own cache, so a stale 503 cannot
    // outlive the fix. Kept to 60s so the age-based staleness check stays
    // accurate to within a minute.
    headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=60";
  } else {
    headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=600";
  }

  return Response.json(scoped, { status: httpStatus, headers });
}
