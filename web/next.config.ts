import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  // React's development runtime uses eval() for call stacks. Production does not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://railway.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  // PostHog session replay compresses in a blob worker.
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ');

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Static shell instantly, cached benchmark output shared across instances,
  // and full prefetches for links that opt in.
  cacheComponents: true,
  partialPrefetching: true,
  // The dev server is opened at 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // The app imports benchmark code from the repo root, which also holds a lockfile.
  turbopack: { root: new URL("..", import.meta.url).pathname },
  // PostHog's API paths end in a slash; do not redirect them.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      { source: "/proxy-get", destination: "/proxies", permanent: true },
      { source: "/browser-throughput", destination: "/throughput", permanent: true },
    ];
  },
  async rewrites() {
    // First-party PostHog proxy: the CSP only allows this origin, and ad
    // blockers ignore same-origin requests.
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
      {
        // Only the empty benchmark document needs cross-origin country checks.
        // Keep the application-wide policy unchanged.
        source: "/api/proxy-get/bootstrap",
        headers: [{ key: "Content-Security-Policy", value:
          "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src data:; connect-src 'self' https: http:" }],
      },
    ];
  },
};

export default nextConfig;
