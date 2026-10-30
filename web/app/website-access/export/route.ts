import { accessReport } from "@/lib/website-access";
export function GET() {
  return Response.json(accessReport, { headers: { "Content-Disposition": `attachment; filename="website-access-${accessReport.date}.json"` } });
}
