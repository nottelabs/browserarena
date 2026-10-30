import raw from "../../results/website-access/2026-10-28/run.json";
import { parseAccessReport } from "../../src/benchmarks/website-access/schema";
export const accessReport = parseAccessReport(raw);
