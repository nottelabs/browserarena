/**
 * Tags links to notte.cc so Notte's own analytics can attribute visits that
 * started on Browser Arena. Other hosts are returned unchanged.
 */
export function withNotteUtm(url: string, campaign: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)notte\.cc$/.test(u.hostname)) return url;
    u.searchParams.set("utm_source", "browserarena");
    u.searchParams.set("utm_medium", "referral");
    u.searchParams.set("utm_campaign", campaign);
    return u.toString();
  } catch {
    return url;
  }
}
