import type { Metadata } from "next";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { accessReport } from "@/lib/website-access";
import { accessMediaOrigin } from "@/lib/website-access-media";
import { AccessResults } from "./results";
export const metadata: Metadata = { title: "Website Access", description: "A reviewed 300-visit comparison across 20 difficult websites and five managed browser providers." };
export default function WebsiteAccess() {
  return <BenchmarkShell benchmark="website-access"><AccessResults report={accessReport} mediaPublished={!!accessMediaOrigin(process.env.WEBSITE_ACCESS_MEDIA_ORIGIN)} /></BenchmarkShell>;
}
