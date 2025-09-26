# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the Micrawl service code: `index.ts` boots the Hono app, `routes.ts` defines `/scrape`, `scraper.ts` wraps Playwright, `env.ts` centralizes configuration, and `logger.ts` provides structured logging.
- `src/types/` contains shared TypeScript types; update these before touching implementation.
- `tests/` mirrors the runtime modules with Vitest suites (integration, schema, scraper, optional E2E).
- `api/index.ts` is the Vercel entrypoint exporting the Hono app—no other entrypoints are used.

## Build, Test, and Development Commands
- `pnpm install` – install dependencies (pnpm is required; lockfile is pnpm-based).
- `vercel dev` – run the service locally on `http://localhost:3000` with live reload.
- `vercel build` / `vercel deploy` – create preview or production bundles.
- `pnpm test` – run Vitest suites (unit + integration; E2E skipped unless `RUN_E2E=true`).
- `pnpm test:types` – TypeScript surface check (`tsc --noEmit`).

## Coding Style & Naming Conventions
- TypeScript with ES modules, two-space indentation, no semi-enforced formatter—follow existing style.
- Prefer descriptive scraper vocabulary (`ScrapeJob`, `ScrapeSuccess`, `progress`) and keep modules “deep” by expanding `routes.ts` / `scraper.ts` rather than adding thin helpers.
- Configuration and defaults live in `env.ts`; document new variables there and in the README.

## Testing Guidelines
- Vitest powers all automated tests (`tests/`). Keep test names aligned with routes/modules (`routes.integration.test.ts`, `scraper.test.ts`).
- For streaming behaviour, add fixtures under `tests/routes.integration.test.ts` and use NDJSON lines to assert progress/summary output.
- E2E Playwright tests remain optional; enable with `RUN_E2E=true pnpm test` when validating real browser runs.

## Commit & Pull Request Guidelines
- Use concise, imperative commit messages (e.g., “Add progress counters to stream”).
- PRs should: describe the change, list validation commands (`pnpm test`, etc.), note config/env additions, and attach sample NDJSON output or screenshots when relevant.
- Link issues or TODO references where applicable, and keep unrelated changes out of a single PR.

## Architecture Notes
- Request flow: `routes.ts` validates → `runScrapeJob` executes Playwright → records stream as NDJSON with live `progress` counters → final summary closes the connection.
- Every streamed line shares the same `jobId`; use it to correlate logs and NDJSON.
