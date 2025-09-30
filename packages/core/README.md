# @micrawl/core

Core scraping engine for Micrawl - a serverless-friendly web scraper with Playwright and HTTP driver support.

## Features

- **Dual Driver Support**: Playwright (full browser) and HTTP (lightweight) drivers
- **Auto Mode**: Automatically selects the best driver based on requirements
- **Multi-Format Output**: HTML, Markdown (via h2m-parser)
- **Progress Tracking**: Phase-based progress events (queued → navigating → capturing)
- **Rich Metadata**: Extract titles, descriptions, canonical URLs, same-origin links
- **Serverless-Optimized**: Chromium via `@sparticuz/chromium`, resource blocking
- **Flexible Configuration**: Per-request locale, viewport, headers, proxy, basic auth

## Installation

```bash
npm install @micrawl/core
# or
pnpm add @micrawl/core
# or
yarn add @micrawl/core
```

## Usage

```typescript
import { runScrapeJob } from "@micrawl/core";
import type { ScrapeJob } from "@micrawl/core/types";

const job: ScrapeJob = {
  targetUrl: "https://example.com",
  outputFormats: ["markdown"],
  captureTextOnly: false,
  timeoutMs: 30000,
  driver: "auto", // or "playwright" | "http"
};

const result = await runScrapeJob(
  job,
  "job-id",
  { index: 1, total: 1, targetUrl: job.targetUrl },
  async (phase) => {
    console.log(`Phase: ${phase}`);
  }
);

if (result.status === "success") {
  console.log(result.data.page.contents);
} else {
  console.error(result.errors);
}
```

## API

### `runScrapeJob(job, jobId, position, emitPhase)`

Main scraper entry point.

**Parameters:**
- `job: ScrapeJob` - Scraping configuration
- `jobId: string` - Unique job identifier
- `position: { index: number; total: number; targetUrl: string }` - Position in batch
- `emitPhase: (phase: string) => Promise<void>` - Progress callback

**Returns:** `Promise<ScrapeSuccess | ScrapeFailure>`

### `resolveDriverName(job)`

Determines which driver will be used for a job.

**Parameters:**
- `job: ScrapeJob` - Scraping configuration

**Returns:** `ScrapeDriverName` - `"playwright"` or `"http"`

### Types

Import types from `@micrawl/core/types`:

```typescript
import type {
  ScrapeJob,
  ScrapeSuccess,
  ScrapeFailure,
  ScrapeError,
  ScrapeProgressUpdate,
  ScrapeSummary,
  ScrapeDriverName,
  ContentFormat,
} from "@micrawl/core/types";
```

## Configuration

Set environment variables to configure defaults (see `src/config/env.ts`):

```bash
SCRAPER_DEFAULT_TIMEOUT_MS=45000
SCRAPER_TEXT_ONLY_DEFAULT=true
SCRAPER_DEFAULT_DRIVER=playwright  # or "http" | "auto"
SCRAPER_DEFAULT_LOCALE=en-US
SCRAPER_DEFAULT_TIMEZONE=America/New_York
CHROMIUM_BINARY=/path/to/chromium  # optional
```

## Driver Selection

### Playwright Driver

- Full browser rendering (Chromium)
- JavaScript execution
- DOM manipulation
- Supports `waitForSelector`
- Markdown conversion requires DOM

**Use when:**
- Page requires JavaScript
- Need to wait for dynamic content
- Markdown output requested

### HTTP Driver

- Lightweight HTTP fetch
- No browser overhead
- Fast for static pages
- HTML-only output

**Use when:**
- Static HTML pages
- `captureTextOnly: true`
- No DOM requirements

### Auto Mode (Default)

Automatically selects:
- **HTTP** if `captureTextOnly: true` and no DOM features needed
- **Playwright** otherwise

## Output Formats

### HTML

Raw HTML from the page (after JavaScript execution if using Playwright):

```typescript
{
  format: "html",
  contentType: "text/html",
  body: "<html>...</html>",
  bytes: 12345
}
```

### Markdown

Converted using h2m-parser (requires Playwright driver):

```typescript
{
  format: "markdown",
  contentType: "text/markdown",
  body: "# Heading\n\nParagraph...",
  bytes: 234
}
```

## Error Handling

```typescript
const result = await runScrapeJob(job, jobId, position, emitPhase);

if (result.status === "success") {
  // result.data.page.contents[0].body
} else if (result.status === "fail") {
  // result.errors[].message
}
```

## Examples

### Scrape with Markdown Output

```typescript
import { runScrapeJob } from "@micrawl/core";

const result = await runScrapeJob(
  {
    targetUrl: "https://example.com",
    outputFormats: ["markdown"],
    timeoutMs: 30000,
  },
  "job-1",
  { index: 1, total: 1, targetUrl: "https://example.com" },
  async (phase) => console.log(`Phase: ${phase}`)
);
```

### Use HTTP Driver for Static Pages

```typescript
const result = await runScrapeJob(
  {
    targetUrl: "https://example.com",
    driver: "http",
    outputFormats: ["html"],
  },
  "job-2",
  { index: 1, total: 1, targetUrl: "https://example.com" },
  async () => {}
);
```

### Custom Viewport and Locale

```typescript
const result = await runScrapeJob(
  {
    targetUrl: "https://example.com",
    locale: "en-GB",
    viewport: { width: 1366, height: 768 },
    userAgent: "Mozilla/5.0 ...",
  },
  "job-3",
  { index: 1, total: 1, targetUrl: "https://example.com" },
  async () => {}
);
```

## Related Packages

- **[@micrawl/mcp-server](https://www.npmjs.com/package/@micrawl/mcp-server)** - MCP server for AI assistants
- **[micrawl](https://github.com/gustavovalverde/micro-play)** - HTTP API and full project

## License

MIT - See [LICENSE](./LICENSE) for details

## Contributing

See the main [repository](https://github.com/gustavovalverde/micro-play) for contribution guidelines.