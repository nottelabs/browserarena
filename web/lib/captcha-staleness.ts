/**
 * Staleness check for the daily CAPTCHA campaign.
 *
 * A campaign that halts leaves `.captcha-runs/needs-review` on the US West
 * runner, and every later run refuses to start until someone clears it. That
 * produces no commit, so only a scheduled check can notice. On 2026-11-13 one
 * halted campaign stopped publishing for a week without anyone seeing it.
 */

/** The run starts at 08:00 UTC and usually publishes by 10:00 UTC; 36h allows one slow day. */
export const CAPTCHA_STALENESS_HOURS = 36;

export interface CaptchaStaleness {
  /** finished_at of the newest campaign at `now`. */
  latest: string;
  ageHours: number;
  stale: boolean;
}

/** Null when no campaign had finished by `now`: there is nothing to be late against. */
export function captchaStaleness(
  campaigns: readonly { finished_at: string }[],
  now: Date,
  hours = CAPTCHA_STALENESS_HOURS
): CaptchaStaleness | null {
  const finished = campaigns
    .map((campaign) => Date.parse(campaign.finished_at))
    .filter((time) => Number.isFinite(time) && time <= now.getTime());
  if (finished.length === 0) return null;
  const latest = Math.max(...finished);
  const ageHours = (now.getTime() - latest) / 3_600_000;
  return { latest: new Date(latest).toISOString(), ageHours, stale: ageHours > hours };
}
