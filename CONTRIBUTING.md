# Contributing to Browser Arena

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/nottelabs/browserarena
cd browserarena
npm install
cp .env.example .env  # add your provider API keys
```

Requires Node.js >= 18.

### CLI (benchmark runner)

```bash
npm run dev -- --provider=notte --runs=10
```

### Web (leaderboard frontend)

```bash
cd web
npm install
npm run dev
```

## Adding a New Provider

1. Create a new file in `src/providers/` (e.g. `src/providers/my-provider.ts`)
2. Implement the `ProviderClient` interface from `src/types.ts`:
   - `name`: provider identifier (uppercase)
   - `create()`: create a browser session, return `{ id, cdpUrl }`
   - `release(id)`: tear down the session
   - `computeCost(seconds)`: return estimated cost in USD
3. Register your provider in `src/providers/index.ts`
4. Add the required environment variable(s) to `.env.example`
5. Run the benchmark to verify: `npm run dev -- --provider=my-provider --runs=10`
6. To show it on the website, add an entry to `PROVIDERS` in `web/lib/providers.ts` (display name, URL, logo in `web/public/logos/`, region, one-line description) and its pricing to `web/lib/pricing.ts`. The leaderboard and all site copy (FAQ, SEO metadata, `llms.txt`, OG image, including the provider count) are derived from that list, so no hardcoded strings need editing. Set `marketed: false` to show a provider on the leaderboard without listing it in the copy.

## Running Benchmarks

```bash
# Single provider, 100 runs
npm run bench -- --provider=notte --runs=100

# Multiple providers
npm run bench -- --provider=notte,steel --runs=100

# Concurrent sessions
npm run bench -- --provider=notte --runs=100 --concurrency=10
```

Results are written to `results/<benchmark>/<provider>/<date>/`.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `npm run build` passes in both root and `web/`
4. Open a PR with a clear description of what you changed and why

## Reporting Issues

Use [GitHub Issues](https://github.com/nottelabs/browserarena/issues) to report bugs or suggest improvements.

## Security

If you discover a security vulnerability, please follow the process in [SECURITY.md](./SECURITY.md). Do not open a public issue.
