/** Public, provider-neutral report format. Session credentials and internal IDs never belong here. */
export const OUTCOMES = ["accessible", "bot_block", "login_wall", "uncertain", "site_error", "network_error", "capture_error"] as const;
export type Outcome = typeof OUTCOMES[number];
export interface AccessVisit {
  id: string; site: string; provider: string; round: number; outcome: Outcome; reason: string; reviewed: boolean;
  screenshot: { file: string; sha256: string } | null;
  replay: { file: string; kind: "original" | "followup"; sha256: string; durationSeconds: number } | null;
}
export interface AccessReport {
  schemaVersion: 1; id: string; date: string; title: string; rounds: number; observationMs: number;
  providers: { id: string; name: string }[];
  sites: { id: string; domain: string; url: string; source: string }[];
  visits: AccessVisit[];
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const fields = (x: Record<string,unknown>, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k));
const webUrl = (x: unknown) => { try { const u = new URL(String(x)); return ["https:","http:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const unique = (values: string[]) => new Set(values).size === values.length;
const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Invalid access report: ${message}`); }
export function parseAccessReport(input: unknown): AccessReport {
  check(record(input), "object required");
  check(fields(input,["schemaVersion","id","date","title","rounds","observationMs","providers","sites","visits"]), "unknown report field");
  check(input.schemaVersion === 1 && text(input.id) && text(input.title) && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date)), "metadata");
  check(Number.isInteger(input.rounds) && Number(input.rounds) > 0 && Number.isFinite(input.observationMs) && Number(input.observationMs) > 0, "protocol");
  check(Array.isArray(input.providers) && input.providers.length > 0 && input.providers.every(p => record(p) && fields(p,["id","name"]) && text(p.id) && text(p.name)), "providers");
  check(Array.isArray(input.sites) && input.sites.length > 0 && input.sites.every(s => record(s) && fields(s,["id","domain","url","source"]) && text(s.id) && text(s.domain) && text(s.source) && typeof s.url === "string" && webUrl(s.url)), "sites");
  const providers = input.providers as AccessReport["providers"], sites = input.sites as AccessReport["sites"];
  check(unique(providers.map(p => p.id)) && unique(sites.map(s => s.id)), "duplicate providers/sites");
  check(Array.isArray(input.visits), "visits");
  const allowed = new Set(["id", "site", "provider", "round", "outcome", "reason", "reviewed", "screenshot", "replay"]);
  for (const v of input.visits) {
    check(record(v) && Object.keys(v).every(k => allowed.has(k)), "private or unknown visit field");
    check(text(v.id) && text(v.reason) && v.reviewed === true && OUTCOMES.includes(v.outcome as Outcome), "reviewed outcome");
    check(providers.some(p => p.id === v.provider) && sites.some(s => s.id === v.site) && Number.isInteger(v.round) && Number(v.round) >= 1 && Number(v.round) <= Number(input.rounds), "visit slot");
    check(v.screenshot === null || (record(v.screenshot) && fields(v.screenshot,["file","sha256"]) && /^[a-z0-9-]+\.jpg$/.test(String(v.screenshot.file)) && hash(v.screenshot.sha256)), "screenshot evidence");
    check(v.replay === null || (record(v.replay) && fields(v.replay,["file","kind","sha256","durationSeconds"]) && /^[a-z0-9-]+\.mp4$/.test(String(v.replay.file)) && hash(v.replay.sha256) && ["original", "followup"].includes(String(v.replay.kind)) && Number.isFinite(v.replay.durationSeconds) && Number(v.replay.durationSeconds) > 0), "replay evidence");
    check(v.outcome !== "accessible" || v.screenshot !== null, "accessible outcome requires original screenshot");
  }
  const visits = input.visits as unknown as AccessVisit[];
  check(unique(visits.map(v => v.id)) && unique(visits.map(v => `${v.provider}/${v.site}/${v.round}`)), "duplicate visit");
  check(visits.length === providers.length * sites.length * Number(input.rounds), "incomplete planned denominator");
  return input as unknown as AccessReport;
}
export function providerScores(report: AccessReport) {
  return report.providers.map(provider => {
    const visits = report.visits.filter(v => v.provider === provider.id);
    const successes = visits.filter(v => v.outcome === "accessible");
    return { ...provider, accessible: successes.length, planned: report.sites.length * report.rounds,
      sitesAccessible: new Set(successes.map(v => v.site)).size, totalSites: report.sites.length };
  }).sort((a, b) => b.accessible - a.accessible || a.name.localeCompare(b.name));
}
