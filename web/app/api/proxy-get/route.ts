import { loadProxyGet, PROXY_COUNTRIES } from "@/lib/proxy-get";
import { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { captureApiRequest } from "@/lib/posthog-server";

export async function GET(request: Request) {
  captureApiRequest(request, "/api/proxy-get");
  const params = new URL(request.url).searchParams;
  const country = params.get("country")?.toUpperCase() || "US";
  if (!PROXY_COUNTRIES.some(c => c === country)) return Response.json({ error: "Country must be US, FR, BR, IN, JP" }, { status: 400 });
  const date = params.get("date");
  const overview = params.get("view") === "overview";
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    const history = await loadProxyGetHistory(country, date);
    if (!history.dates.includes(date)) return Response.json({ error: "No run recorded for this date" }, { status: 404 });
    return Response.json(overview ? history.overview : history.selected, { headers: { "Cache-Control": "no-store" } });
  }
  if (overview) return Response.json((await loadProxyGetHistory(country)).overview, { headers: { "Cache-Control": "no-store" } });
  return Response.json(await loadProxyGet(country), { headers: { "Cache-Control": "no-store" } });
}
