# @micrawl/api

HTTP interface for the Micrawl scraping engine. Ships a Hono app optimised for serverless hosts (Vercel by default) and streams scrape progress/results as NDJSON so any client can ingest pages in real time.

## Features

- **Built on @micrawl/core** – Reuses the shared Playwright/HTTP drivers and progress emitters.
- **Streaming responses** – Each job emits deterministic phases (`queued`, `navigating`, `capturing`, `completed`) plus a final summary.
- **Schema validation** – Zod-powered request surface keeps inputs predictable across deployments.
- **Serverless ready** – Designed for Vercel, but trivial to adapt to AWS Lambda, Cloudflare Workers, or standalone Node.

## Getting Started

```bash
pnpm install
pnpm --dir api dev   # or `vercel dev` if you prefer the Vercel runtime
```

Trigger a local scrape:

```bash
curl -N http://localhost:3000/scrape \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com"],"outputFormats":["markdown"]}'
```

Example stream (one JSON object per line):

```
{"status":"progress","phase":"queued","jobId":"...","targetUrl":"https://example.com"}
{"status":"progress","phase":"navigating","jobId":"..."}
{"status":"success","phase":"completed","jobId":"...","data":{"page":{"title":"Example Domain","contents":[{"format":"markdown","body":"# Example Domain\n..."}]}}}
{"status":"success","phase":"completed","summary":{"succeeded":1,"failed":0}}
```

## Deployment

1. Create a Vercel project pointing at the repo root.
2. Define environment variables (see root `README.md` and `api/src/config/env.ts`).
3. Deploy with `vercel deploy`.

The entrypoint is `api/index.ts`, which exports the configured Hono app for Vercel's Edge/Node runtimes.

## Package Interop

- **Core runtime** – All scraping heavy lifting is delegated to `@micrawl/core`; keep that dependency up to date for driver improvements.
- **MCP server** – Shares the same runtime, so you can run the API alongside the MCP server without competing browser instances by letting both rely on the core's shared Chromium lifecycle.

## Development Scripts

- `pnpm --dir api dev` – Run the Hono/Vercel dev server.
- `pnpm --dir api test` – Execute the full Vitest suite (unit + integration).
- `pnpm --dir api test:types` – Type-check the API surface.

## License

MIT. See the repository root for details.
