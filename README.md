# Micrawl Scraper Service

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgustavovalverde%2Fmicro-play&env=SCRAPER_DEFAULT_TIMEOUT_MS,SCRAPER_TEXT_ONLY_DEFAULT,SCRAPER_MAX_URLS_PER_REQUEST&envDescription=Configure%20the%20scraper%20service&envLink=https%3A%2F%2Fgithub.com%2Fyour-username%2Fmicro-play%23configuration&project-name=micrawl-scraper&repository-name=micrawl-scraper)

A serverless-friendly scraper API that accepts a list of URLs, runs Playwright against each one, and streams the results back as newline-delimited JSON (NDJSON). The request stays synchronous, but you get per-URL feedback as soon as each scrape completes.

## Table of Contents

- [Micrawl Scraper Service](#micrawl-scraper-service)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Getting Started](#getting-started)
    - [Local development](#local-development)
    - [Deploying to Vercel](#deploying-to-vercel)
  - [Streaming Response Model](#streaming-response-model)
    - [Request schema](#request-schema)
    - [Response at a glance](#response-at-a-glance)
    - [Why streaming instead of async?](#why-streaming-instead-of-async)
    - [Reading the stream step-by-step](#reading-the-stream-step-by-step)
  - [Client Recipes](#client-recipes)
    - [Node.js / TypeScript](#nodejs--typescript)
    - [Python](#python)
  - [Development Workflow](#development-workflow)
    - [Testing](#testing)
    - [Manual smoke test](#manual-smoke-test)
- [Configuration](#configuration)
- [Roadmap \& Known Gaps](#roadmap--known-gaps)
- [Project Layout](#project-layout)
- [Code Map](#code-map)

## Overview

- **Streaming-first synchronous API** – immediate per-URL feedback without async queues.
- **Playwright hardened for serverless** – Chromium via `@sparticuz/chromium`, resource blocking, per-request overrides (locale, viewport, user agent, proxy, headers, basic auth).
- **Structured validation & logging** – Zod validates each request and every streamed record shares a `jobId` for log correlation.
- **Progress counters baked in** – clients can render progress bars with no extra bookkeeping.

Core modules live in `src/`:

- `index.ts` – Hono app bootstrap & logging middleware
- `routes.ts` – `/scrape` handler + NDJSON streaming
- `scraper.ts` – Playwright orchestration
- `env.ts` – typed environment configuration
- `logger.ts` – structured logger

## Getting Started

### Local development

```bash
pnpm install
vercel dev
# open http://localhost:3000
```

Smoke test the scraper locally:

```bash
curl -N \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com"]}' \
  http://localhost:3000/scrape
```

`-N` disables curl’s output buffering so you see each line as soon as it arrives.

### Deploying to Vercel

```bash
pnpm install
vercel build
vercel deploy
```

## Streaming Response Model

### Request schema

```jsonc
{
  "urls": ["https://example.com", "https://example.org"],
  "captureTextOnly": true,
  "waitForSelector": ".main",
  "timeoutMs": 45000,
  "basicAuth": { "username": "alice", "password": "s3cret" },
  "locale": "en-GB",
  "timezoneId": "Europe/London",
  "viewport": { "width": 1366, "height": 768 },
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_1)…",
  "proxyUrl": "http://proxy:8080",
  "headers": { "x-tenant": "acme" }
}
```

Micrawl normalizes every URL you send before the scrape starts. Trailing hashes
are stripped, repeated slashes collapse to a single `/`, query parameters are
sorted for stable caching, and duplicate targets are rejected with a validation
error. Only `http://` and `https://` origins are accepted; everything else (for
example `ftp://` or `file://`) is rejected up front so you can fix the payload
without guessing.

### Response at a glance

Micrawl streams a sequence of newline-delimited JSON records for every batch:

1. One or more `status: "progress"` records announce the current phase of the
   scrape (`queued`, `navigating`, `capturing`).
2. A terminal record for the URL (`success`, `fail`, or `error`).
3. A final summary record (`status: "success"`) once the batch concludes.

All records include:

- `jobId`: UUID shared by the entire batch.
- `index` / `total`: position within the batch (summary uses `total + 1`).
- `progress`: counters `{ completed, remaining, succeeded, failed }` computed at
  the time the record was emitted so dashboards can update without manual math.
- `phase`: current scrape phase; `progress` lines report `queued`, `navigating`,
  or `capturing`, while terminal records and the summary use `completed`.
- `targetUrl`: the normalized URL being processed (omitted on the summary).

Payload blocks vary by status:

- `data.page` on `status: "success"` now includes a `metadata` object with
  `description`, `keywords`, `author`, `canonicalUrl`, and a `sameOriginLinks`
  array for quick link graph traversal.
- `errors` on `status: "fail"` (scraper caught the issue and returned details).
- `message` on `status: "error"` (unexpected exception in the pipeline).
- `summary` on the final line summarising successes, failures, and error list.

```jsonc
{"status":"progress","phase":"queued","jobId":"2f1c...","index":1,"total":1,"targetUrl":"https://example.com/","progress":{"completed":0,"remaining":1,"succeeded":0,"failed":0}}
{"status":"progress","phase":"navigating","jobId":"2f1c...","index":1,"total":1,"targetUrl":"https://example.com/","progress":{"completed":0,"remaining":1,"succeeded":0,"failed":0}}
{"status":"progress","phase":"capturing","jobId":"2f1c...","index":1,"total":1,"targetUrl":"https://example.com/","progress":{"completed":0,"remaining":1,"succeeded":0,"failed":0}}
{"status":"success","phase":"completed","jobId":"2f1c...","index":1,"total":1,"targetUrl":"https://example.com/","progress":{"completed":1,"remaining":0,"succeeded":1,"failed":0},"data":{"page":{"url":"https://example.com/","title":"Example Domain","content":"<html>...","contentType":"text/html","bytes":1280,"httpStatusCode":200,"startedAt":"2025-09-26T17:30:41.128Z","finishedAt":"2025-09-26T17:30:42.042Z","durationMs":914,"loadStrategy":"load-event","metadata":{"description":"Example Domain","keywords":["example"],"author":"Example Team","canonicalUrl":"https://example.com/","sameOriginLinks":["https://example.com/about/"]}}}}
{"status":"success","phase":"completed","jobId":"2f1c...","index":2,"total":1,"progress":{"completed":1,"remaining":0,"succeeded":1,"failed":0},"summary":{"succeeded":1,"failed":0,"failures":[]}}
```

### Why streaming instead of async?

Traditional scraper APIs either block until every URL finishes or force you into submit/poll workflows. Streaming keeps the single HTTP request but emits each job result as soon as it’s ready, so you get:

1. **Real-time visibility** – dashboards and logs can show progress immediately.
2. **Lower peak memory** – you can process pages incrementally instead of buffering an entire batch.

If you prefer the old-school “single JSON response,” just buffer the lines until you consume the summary, then parse the combined output.

### Reading the stream step-by-step

```bash
curl -N \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com","https://example.org"]}' \
  http://localhost:3000/scrape
```

- `curl -N` disables stdout buffering so you visibly see the stream.
- Each line is valid JSON terminated by `\n`. Process them as they arrive for real-time behaviour, or buffer them for the traditional experience.
- Expect a few `status: "progress"` heartbeats before each result. Use the
  `phase` field (`queued` → `navigating` → `capturing`) to drive UI state or
  logs.
- The final line (with `summary`) is the definitive “batch complete” signal.
- If the connection closes before the summary arrives, assume the batch ended early and inspect logs (every line shares the same `jobId`).

## Client Recipes

### Node.js / TypeScript

```ts
import { createInterface } from "node:readline";

const res = await fetch("http://localhost:3000/scrape", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ urls: ["https://example.com", "https://example.org"] }),
});

if (!res.body) throw new Error("missing response body");

const rl = createInterface({ input: res.body as unknown as NodeJS.ReadableStream });

for await (const line of rl) {
  if (!line) continue;
  const record = JSON.parse(line);

  if (record.status === "progress") {
    console.log(
      `[${record.index}/${record.total}] → ${record.phase}`,
      record.targetUrl,
      record.progress,
    );
    continue;
  }

  if (record.status === "success" && record.data?.page) {
    console.log(`[${record.index}/${record.total}] ✅`, record.targetUrl, record.progress);
  } else if (record.status === "fail") {
    console.warn(`[${record.index}/${record.total}] ❌`, record.targetUrl, record.errors);
  } else {
    console.log("Batch summary", record.summary);
  }
}
```

### Python

```python
import json
import requests

resp = requests.post(
    "http://localhost:3000/scrape",
    json={"urls": ["https://example.com", "https://example.org"]},
    stream=True,
)

for raw in resp.iter_lines():
    if not raw:
        continue
    record = json.loads(raw.decode("utf-8"))

    if record["status"] == "progress":
        print(
            f"{record['index']}/{record['total']} → {record['phase']}",
            record.get("targetUrl"),
            record["progress"],
        )
        continue

    if record["status"] == "success" and "data" in record:
        print(f"{record['index']}/{record['total']} ✅ {record.get('targetUrl')}", record["progress"])
    elif record["status"] == "fail":
        print(f"{record['index']}/{record['total']} ❌ {record.get('targetUrl')}: {record['errors']}")
    else:
        print("Summary:", record.get("summary"))
```

Any framework that exposes a streaming response (Axios with `responseType: 'stream'`, Go’s `http.Client`, Rust’s `reqwest`, browser `ReadableStream`) can adopt the same loop: read each line, parse JSON, act on `status`, watch for the summary.

## Development Workflow

### Testing

- `pnpm test` – unit + integration suites (Vitest, `hono/testing`). Real Playwright E2E tests are skipped unless you opt in.
- `pnpm test:types` – TypeScript surface check (`tsc --noEmit`).
- `pnpm test:e2e` – opt-in browser-based E2E smoke tests (sets `RUN_E2E=true` and runs only `tests/routes.e2e.test.ts`).
  - Run `npx playwright install chromium` once on your machine before executing this command so Playwright’s default Chromium binary is available (we only ship the Sparticuz build for Linux deployments).

### Manual smoke test

```bash
vercel dev
curl -N \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com"]}' \
  http://localhost:3000/scrape
```

`Ctrl+C` cleanly stops the dev server: the SIGINT handler closes the shared
Chromium instance before the process exits, so you won’t end up with orphaned
browser processes between runs.

## Configuration

All environment variables are documented and validated in `src/env.ts`:

- `SCRAPER_DEFAULT_TIMEOUT_MS` (default `45000`)
- `SCRAPER_TEXT_ONLY_DEFAULT` (default `true`)
- `SCRAPER_MAX_URLS_PER_REQUEST` (default `5`)
- `SCRAPER_DEFAULT_LOCALE` (default `en-US`)
- `SCRAPER_DEFAULT_TIMEZONE` (default `America/New_York`)
- `SCRAPER_DEFAULT_VIEWPORT_WIDTH` (default `1920`)
- `SCRAPER_DEFAULT_VIEWPORT_HEIGHT` (default `1080`)
- `SCRAPER_DEFAULT_USER_AGENT` (optional explicit UA; otherwise `user-agents` generates one)
- `SCRAPER_HEALTHCHECK_URL` (default `https://example.com/`; used by `/health` to verify outbound navigation)
- `CHROMIUM_BINARY` (optional path override for the Chromium executable)

## Roadmap & Known Gaps

- Rate limiting / API keys – planned middleware to keep shared deployments safe.
- Request-level timeout guard – add an abort controller so slow batches don’t run indefinitely even if individual `timeoutMs` values are high.
- `/health` navigation smoke – health check currently launches Chromium but doesn’t visit a URL; upcoming change will fetch a lightweight page.
- Payload size ceiling – large HTML bodies presently stream in full; future work will cap and annotate oversized responses.
- Metrics export – logs are structured, but there is no OTEL/StatsD emitter yet.

## Project Layout

```text
src/
  index.ts      # Hono app setup + logging middleware
  env.ts        # Zod env schema
  logger.ts     # Structured console logger
  routes.ts     # HTTP contracts + NDJSON streaming
  scraper.ts    # Direct Playwright integration
  types/        # Shared scraper domain types
api/index.ts    # Vercel entrypoint exporting Hono app
```

## Code Map

- `createApp()` (`src/index.ts`) wires the logging middleware, routes, and the
  shared-browser shutdown hook. Runtime signals are routed through
  `closeSharedBrowser()` so local runs don’t leak Chromium.
- `registerRoutes()` (`src/routes.ts`) validates payloads with the schema in
  `scrapeRequestSchema` and streams each result from `runScrapeJob()`. The
  streamed summary is computed in the same loop so clients never wait for
  post-processing.
- `runScrapeJob()` (`src/scraper.ts`) owns all Playwright orchestration. It
  consults the helpers in `src/scraper-filters.ts` before navigation, reuses the
  cached browser from `getBrowser()`, and surfaces failures through the typed
  envelopes in `src/types/scrape.ts`.
- `tests/routes.*.test.ts` mock only the scraper entry points—if a new helper is
  exported from `src/scraper.ts` (e.g. the shutdown helper), remember to add it
  to the mocks so integration tests continue to isolate route logic.

Questions? Open an issue or reach out to the maintainer.
