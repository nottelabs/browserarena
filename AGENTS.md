# Agent notes

- Website checks: `npm --prefix web test` runs the unit tests (`web/lib/*.test.ts`). `npm --prefix web run test:layout` runs Playwright against `next start` on port 3030, so run `npm --prefix web run build` first.
- On a freshly started local server, the benchmark shell's prefetches of `/`, `/proxies`, `/throughput` and provider pages can take 20+ seconds. Client navigations (run pickers, `router.push`) wait behind them, so a picker test can time out locally and still pass in CI.
- Vercel previews are behind Vercel SSO. For scripted checks, send the project's automation bypass secret in the `x-vercel-protection-bypass` header, or use `vercel curl <path> --deployment <url>`.
