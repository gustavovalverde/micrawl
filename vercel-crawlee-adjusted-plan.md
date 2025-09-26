# Adjusted Vercel + Crawlee Architecture Plan

## Purpose
This document captures the concrete adjustments we need to fold into the MVP so the Crawlee + Hono scraper deploys reliably on Vercel’s Node runtime while remaining ready to scale. It builds on the original `serverless-scraper-architecture.md` review and supersedes assumptions that no longer hold (e.g., shipping a full Chromium binary with the function bundle).

## Runtime Constraints We Must Respect
- Bundle size ≤ 250 MB uncompressed (~50 MB compressed). Keep the traced bundle lean via `includeFiles`/`excludeFiles` and by trimming direct dependencies.
- Execution window 300–800 s depending on Fluid Compute allocation; memory up to 4 GB on Pro/Enterprise.
- Request/response body hard cap 4.5 MB unless we stream. Prioritize NDJSON streaming for synchronous responses.
- File descriptor ceiling 1,024 per instance. Cap internal fan-out concurrency to stay well below this limit.

These limits inform the architecture decisions below.

## API Surface
- `POST /scrape` (sync path): Accepts a small batch of URLs, streams NDJSON chunks as each per-URL worker finishes, keeps the total job within the function window. Enforce per-URL timeout (45–60 s) and overall guardrail so we never exceed `maxDuration`.
- `POST /scrape/batch` (async path): Returns `202 Accepted` + `jobId`, enqueues each URL, and relies on background workers for long-running or large jobs. Pair with `GET /jobs/:id` for polling. Queue options: Vercel Queues (if available) or Upstash Redis/Kafka/SQS.
- `POST /worker`: Single URL → single Crawlee run with `maxConcurrency: 1`. The orchestrator calls this endpoint for each URL (sync fan-out) or the queue pushes here (async mode).

## Orchestrator Design Highlights
- Implement with Hono. Use Zod to validate inputs early and respond with clear errors.
- Use Hono’s `streamText` helper (or `stream`) to emit NDJSON. Document the streamed format so clients can parse incrementally.
- Bound parallel fetches to `/worker` (e.g., concurrency 5) to prevent descriptor exhaustion and to respect upstream site rate limits.
- Emit structured logs per URL chunk for traceability. Attach `requestId`/`jobId` context for observability.

## Worker Design Highlights
- Backed by `@crawlee/playwright` with default fingerprinting/session pool.
- Use `@sparticuz/chromium-min` + external `chromiumPack.tar` hosted on Blob/S3; resolve the executable at runtime and cache under `/tmp`.
- Launch Playwright via `playwright-core` (not the full `playwright` meta package) to keep bundle size down.
- Store Crawlee temp data in `/tmp/crawlee` with `persistStorage: false`. Ensure the directory exists before each run.
- Aggressively block non-text resources (images, fonts, analytics) using `playwrightUtils.blockRequests` to shorten run time and reduce data transfer.
- Respect per-request timeouts and surface structured failure payloads (URL, error message, timestamp).

## Dependency & Bundling Changes
- Direct dependencies: `@crawlee/playwright`, `@crawlee/core`, `@sparticuz/chromium-min`, `playwright-core`, `hono`, `zod`.
- Remove direct `@crawlee/browser` / `@crawlee/browser-pool`; they stay as transitive deps through `@crawlee/playwright`.
- Externalize `playwright-core` and `@sparticuz/chromium-min` if bundling with esbuild; otherwise let Vercel trace from `node_modules`.
- Configure `vercel.json` to set Node 20 runtime, `maxDuration` 800, memory 4096, and target region (e.g., `iad1`). Use `includeFiles`/`excludeFiles` to keep the traced package narrow.

## Operational Guardrails
- Rate limit and authenticate at the orchestrator level (API keys or signed tokens) to control abuse.
- Instrument alerting around timeouts, queue backlog depth, and chromium download failures.
- Stream responses by default when returning more than a few kilobytes to avoid the 4.5 MB body limit; document fallbacks for clients that cannot stream.
- For large payloads, persist full page bodies in Blob/S3 and stream only summaries plus storage locations; keep this path aligned with the async mode.
- Prewarm fonts/locales as needed for non-Latin pages using Sparticuz helpers.

## Implementation Checklist
1. Update dependencies (`package.json`) and host the Chromium pack asset. Verify cold start download path.
2. Add `vercel.json` with runtime/memory/duration settings and include/exclude lists.
3. Implement `/worker` Hono handler using Crawlee + Playwright with the constrained launch context.
4. Implement `/scrape` orchestrator with NDJSON streaming and bounded fan-out to `/worker`.
5. Stub `/scrape/batch` async mode with queue integration hook (Upstash/Vercel Queues) and `GET /jobs/:id` polling endpoint.
6. Add structured logging (requestId/jobId) and adjust observability stack.
7. Document streaming contract, error payloads, and queue semantics for client teams.

## Follow-Up Testing
- Integration test: orchestrator streaming workflow (pump two URLs, assert NDJSON semantics and per-URL structure).
- Integration test: worker timeout + error branch (simulate blocked resource or 404 and verify failure payload).
- Load smoke test: run small batch (≤5 URLs) to confirm file descriptor usage and streaming behaviour inside Vercel emulator or local serverless runner.
