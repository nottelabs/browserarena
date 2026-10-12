import posthog from "posthog-js";

/**
 * PostHog for the public site. Everything goes through the first-party
 * `/ingest` rewrite in next.config.ts, so the site's strict CSP (connect-src
 * 'self') and ad blockers do not drop events.
 *
 * Visitors are anonymous: no identify() calls, and `identified_only` keeps
 * PostHog from creating a person profile for every visitor.
 */
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token) {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.posthog.com",
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
    // Benchmark tables are public data; nothing on the site is a secret, but
    // keep form inputs masked in replays all the same.
    session_recording: { maskAllInputs: true },
    debug: process.env.NODE_ENV === "development",
  });
} else if (process.env.NODE_ENV === "development") {
  console.error(
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured"
  );
}
