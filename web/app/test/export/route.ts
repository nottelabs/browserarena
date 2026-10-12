import { PROXY_COUNTRIES } from "@/lib/proxy-get";
import { loadTestProxyHistory } from "../proxy-demo";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = params.get("country")?.toUpperCase() ?? "US";
  if (!PROXY_COUNTRIES.some(c => c === country)) return Response.json({ error: "Invalid country" }, { status: 400 });
  const date = params.get("date") ?? undefined;
  const history = await loadTestProxyHistory(country, date);
  if (date && !history.dates.includes(date)) return Response.json({ error: "No simulated day for this date" }, { status: 404 });
  return Response.json({ simulated: true, description: "Generated preview data, not benchmark measurements", ...history.selected }, {
    headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="simulated-proxy-get-${country}-${history.selectedDate ?? "empty"}.json"` },
  });
}
