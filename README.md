# Micrawl

**Modular web extraction tooling for APIs, AI agents, and data pipelines**

Micrawl is a monorepo that lets you mix-and-match:

- **API** - Serverless-ready scraping API with streaming NDJSON responses
- **MCP Server** - Local documentation assistant for AI agents (Claude Code, Cursor, etc.)
- **Core Library** - Shared scraping engine with Playwright and HTTP drivers

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgustavovalverde%2Fmicro-play)

---

## Table of Contents

- [Quick Start](#quick-start)
  - [Using the MCP Server (AI Agents)](#using-the-mcp-server-ai-agents)
  - [Using the API (HTTP)](#using-the-api-http)
- [What is Micrawl?](#what-is-micrawl)
  - [Key Features](#key-features)
- [Repository Structure](#repository-structure)
- [API Documentation](#api-documentation)
  - [Endpoint: POST `/scrape`](#endpoint-post-scrape)
  - [Request Parameters](#request-parameters)
  - [Response Format](#response-format)
  - [Client Examples](#client-examples)
- [MCP Server Documentation](#mcp-server-documentation)
  - [Available Tools](#available-tools)
  - [Installation](#installation)
- [Core Library (`@micrawl/core`)](#core-library-micrawlcore)
  - [Features](#features)
  - [Usage](#usage)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
- [Development](#development)
  - [Setup](#setup)
  - [Testing](#testing)
  - [Project Scripts](#project-scripts)
- [Deployment](#deployment)
  - [Vercel (API)](#vercel-api)
  - [MCP Server (Local)](#mcp-server-local)
- [Architecture](#architecture)
  - [Design Principles](#design-principles)
  - [Package Structure](#package-structure)
- [Roadmap](#roadmap)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## Quick Start

### Using the MCP Server (AI Agents)

```bash
# Build
pnpm install
pnpm build

# Configure Claude Code / Cursor
# Add to .claude/mcp.json or .cursor/mcp.json:
{
  "mcpServers": {
    "web-docs-saver": {
      "command": "node",
      "args": ["<path>/mcp-server/dist/stdio.js"]
    }
  }
}
```

**Then ask your AI:**
> "Save the Hono documentation from <https://hono.dev/docs> to ./docs"

See [MCP Server README](mcp-server/README.md) for full documentation.

### Using the API (HTTP)

```bash
# Local development
cd api
pnpm install
vercel dev

# Deploy to Vercel
vercel deploy
```

**Test the API:**

```bash
curl -N http://localhost:3000/scrape \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com"]}'
```

---

## What is Micrawl?

Micrawl is a cohesive toolkit for capturing, transforming, and streaming structured web content. The ecosystem is designed so you can:

- **Embed the core** in any Node.js service to run high-fidelity scraping jobs with Playwright or lightweight HTTP drivers.
- **Expose the API** to provide serverless endpoints that stream progress and results in NDJSON to any consumer.
- **Extend AI clients** via the MCP server so agents like Claude Code or Cursor can fetch and persist knowledge on demand.

Use the packages together for an end-to-end documentation pipeline, or independently for focused scraping, ingestion, or agent use cases.

### Key Features

✅ **Composable Packages** – Use the Core, API, or MCP server independently or in combination.
✅ **Clean Extraction** – Mozilla Readability removes navigation, ads, and chrome noise.
✅ **Multi-Format Outputs** – HTML, Markdown, and raw metadata for downstream indexing.
✅ **Adaptive Drivers** – Playwright for full-browser rendering, HTTP for fast static fetches, with auto-selection logic.
✅ **Streaming Interfaces** – Real-time NDJSON progress from the API and MCP notifications for agents.
✅ **Serverless & Local Friendly** – Tuned for Vercel/Lambda deployments while remaining easy to run on a laptop or inside Docker.
✅ **Type-Safe by Default** – Shared Zod schemas and TypeScript types across packages for confidence and reuse.

---

## Repository Structure

```
micro-play/
├── api/                    # Vercel serverless API
│   ├── src/
│   │   ├── index.ts       # Hono app
│   │   ├── routes.ts      # /scrape endpoint
│   │   └── scraper.ts     # Re-exports from @micrawl/core
│   └── tests/
├── mcp-server/             # Model Context Protocol server
│   ├── src/
│   │   ├── server.ts      # 2 MCP tools (fetch_page, save_docs)
│   │   ├── scraper.ts     # Wrapper around @micrawl/core
│   │   ├── files.ts       # File utilities
│   │   └── stdio.ts       # CLI entrypoint
│   └── tests/
├── packages/
│   └── core/               # Shared scraping engine
│       └── src/
│           ├── core/
│           │   └── extraction/
│           │       ├── playwright.ts
│           │       ├── http.ts
│           │       └── dispatcher.ts
│           └── types/
└── package.json            # Workspace root
```

---

## API Documentation

### Endpoint: POST `/scrape`

**Request:**

```json
{
  "urls": ["https://example.com"],
  "outputFormats": ["markdown"],
  "readability": true,
  "driver": "auto",
  "crawl": false
}
```

**Response (NDJSON stream):**

```json
{"status":"progress","phase":"queued","jobId":"...","targetUrl":"https://example.com"}
{"status":"progress","phase":"navigating","jobId":"...","targetUrl":"https://example.com"}
{"status":"progress","phase":"capturing","jobId":"...","targetUrl":"https://example.com"}
{"status":"success","phase":"completed","jobId":"...","data":{"page":{"url":"...","title":"...","contents":[{"format":"markdown","body":"..."}]}}}
{"status":"success","phase":"completed","jobId":"...","summary":{"succeeded":1,"failed":0}}
```

### Request Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | `string[]` | *required* | URLs to scrape (max 5) |
| `outputFormats` | `string[]` | `["html"]` | Output formats: `"html"`, `"markdown"` |
| `readability` | `boolean` | `true` | Use Mozilla Readability for clean content |
| `driver` | `string` | `"playwright"` | Driver: `"playwright"`, `"http"`, `"auto"` |
| `captureTextOnly` | `boolean` | `false` | Extract plain text only (faster) |
| `timeoutMs` | `number` | `45000` | Page load timeout (1000-120000) |
| `waitForSelector` | `string` | - | CSS selector to wait for |
| `basicAuth` | `object` | - | `{ username, password }` |
| `locale` | `string` | `"en-US"` | Browser locale |
| `viewport` | `object` | `{1920, 1080}` | `{ width, height }` |

### Response Format

Each line is a JSON object with:

- `status`: `"progress"`, `"success"`, `"fail"`, or `"error"`
- `phase`: Current phase (`"queued"`, `"navigating"`, `"capturing"`, `"completed"`)
- `jobId`: UUID for the entire batch
- `index`/`total`: Position in batch
- `progress`: `{ completed, remaining, succeeded, failed }`
- `driver`: Driver used (`"playwright"` or `"http"`)

**Success response includes:**

```json
{
  "data": {
    "page": {
      "url": "https://example.com",
      "title": "Example Domain",
      "httpStatusCode": 200,
      "durationMs": 914,
      "contents": [
        {
          "format": "markdown",
          "contentType": "text/markdown",
          "body": "# Example Domain\n\n...",
          "bytes": 1280
        }
      ],
      "metadata": {
        "sameOriginLinks": ["https://example.com/about"]
      }
    }
  }
}
```

### Client Examples

**Node.js:**

```typescript
import { createInterface } from "node:readline";

const res = await fetch("http://localhost:3000/scrape", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    urls: ["https://example.com"],
    outputFormats: ["markdown"]
  }),
});

const rl = createInterface({
  input: res.body as unknown as NodeJS.ReadableStream
});

for await (const line of rl) {
  const record = JSON.parse(line);

  if (record.status === "success" && record.data?.page) {
    console.log(record.data.page.contents[0].body);
  }
}
```

**Python:**

```python
import json
import requests

resp = requests.post(
    "http://localhost:3000/scrape",
    json={"urls": ["https://example.com"], "outputFormats": ["markdown"]},
    stream=True,
)

for raw in resp.iter_lines():
    if not raw:
        continue
    record = json.loads(raw.decode("utf-8"))

    if record["status"] == "success" and "data" in record:
        print(record["data"]["page"]["contents"][0]["body"])
```

---

## MCP Server Documentation

The MCP server provides a local documentation assistant for AI agents.

### Available Tools

#### `fetch_page`

Fetch clean documentation from a URL and return as markdown.

**Example:**
> "Get the content from <https://hono.dev/docs/getting-started>"

#### `save_docs`

Save documentation to your local filesystem. Supports:

- Single page
- Multiple pages (array of URLs)
- Entire site (with `crawl: true`)

**Examples:**
> "Save <https://hono.dev/docs> to ./docs"
> "Save <https://hono.dev/docs> to ./docs and crawl all pages"

### Installation

See [MCP Server README](mcp-server/README.md) for:

- Detailed installation instructions
- Configuration for Claude Code, Cursor, and other MCP clients
- Environment variables
- Usage examples
- Troubleshooting

---

## Core Library (`@micrawl/core`)

Shared scraping engine used by both API and MCP server.

### Features

- **Playwright Driver** - Full browser rendering for complex pages
- **HTTP Driver** - Fast, lightweight fetching for simple pages
- **Auto Driver** - Intelligent selection based on requirements
- **Mozilla Readability** - Clean article extraction
- **Multi-Format Output** - HTML, Markdown, or plain text
- **Type-Safe** - Full TypeScript support

### Usage

```typescript
import { runScrapeJob } from "@micrawl/core";
import type { ScrapeJob } from "@micrawl/core/types";

const job: ScrapeJob = {
  targetUrl: "https://example.com",
  outputFormats: ["markdown"],
  captureTextOnly: false,
  driver: "playwright",
  timeoutMs: 60000,
  readability: true
};

const result = await runScrapeJob(
  job,
  "job-123",
  { index: 1, total: 1, targetUrl: job.targetUrl },
  async (phase) => console.log(phase)
);

if (result.status === "success") {
  console.log(result.data.page.contents[0].body);
}
```

---

## Configuration

### Environment Variables

#### Core Scraper

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRAPER_DEFAULT_TIMEOUT_MS` | `45000` | Default timeout for page loads |
| `SCRAPER_TEXT_ONLY_DEFAULT` | `true` | Extract plain text by default |
| `SCRAPER_MAX_URLS_PER_REQUEST` | `5` | Max URLs per batch |
| `SCRAPER_DEFAULT_LOCALE` | `en-US` | Browser locale |
| `SCRAPER_DEFAULT_TIMEZONE` | `America/New_York` | Browser timezone |
| `SCRAPER_DEFAULT_VIEWPORT_WIDTH` | `1920` | Viewport width |
| `SCRAPER_DEFAULT_VIEWPORT_HEIGHT` | `1080` | Viewport height |
| `SCRAPER_DEFAULT_DRIVER` | `playwright` | Default driver |
| `CHROMIUM_BINARY` | *(auto)* | Custom Chromium path |

#### API Specific

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRAPER_HEALTHCHECK_URL` | `https://example.com/` | Health check URL |

#### MCP Server Specific

| Variable | Default | Description |
|----------|---------|-------------|
| `MICRAWL_DOCS_DIR` | `./docs` | Directory for saved docs |

---

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```

### Testing

```bash
# Run all tests
pnpm test

# API tests only
pnpm --filter @micrawl/api test

# MCP server tests only
pnpm --filter @micrawl/mcp-server test

# Core library tests only
pnpm --filter @micrawl/core test
```

### Project Scripts

- `pnpm build` - Build all packages
- `pnpm test` - Run all tests
- `pnpm lint` - Lint all code
- `pnpm format` - Format all code

---

## Deployment

### Vercel (API)

```bash
cd api
vercel deploy
```

**Environment variables to set:**

- `SCRAPER_DEFAULT_TIMEOUT_MS`
- `SCRAPER_TEXT_ONLY_DEFAULT`
- `SCRAPER_DEFAULT_DRIVER`

### MCP Server (Local)

The MCP server is designed to run locally on developer machines:

1. Build: `pnpm build`
2. Configure in your AI client (Claude Code, Cursor)
3. Restart the AI client

---

## Architecture

### Design Principles

Micrawl follows **cognitive load minimization** principles:

- **Deep modules** - Simple interfaces, complex implementation hidden
- **Single source of truth** - Core library shared by all packages
- **No shallow abstractions** - Direct, clear code paths
- **Self-describing** - Tools and parameters use natural language

See [cognitive-load.md](cognitive-load.md) for detailed design philosophy.

### Package Structure

**Monorepo Layout:**

- `api/` - Serverless API application
- `mcp-server/` - MCP server application
- `packages/core/` - Shared library
- Root workspace manages all packages

**Separation of Concerns:**

- API handles HTTP/streaming concerns
- MCP server handles stdio/local concerns
- Core library handles scraping logic

**No Code Duplication:**

- Both API and MCP use `@micrawl/core`
- Consistent behavior across transports
- Single test suite for scraping logic

---

## Roadmap

### Phase 1: Local Intelligence (Current)

- ✅ Clean documentation extraction
- ✅ Multi-format output (HTML, Markdown)
- ✅ Smart driver selection
- ✅ Streaming API
- ✅ MCP server for AI agents

### Phase 2: Enhanced MCP (Planned)

- 🔄 Local documentation search (`search_docs` tool)
- 🔄 Code example extraction
- 🔄 Project dependency auto-saver
- 🔄 Documentation URL discovery (via AI delegation)

### Phase 3: Advanced Features (Future)

- Semantic search with embeddings
- Multi-source search (local + web)
- Interactive tutorial generation
- Documentation freshness detection

See [mcp-server/docs/development-plan.md](mcp-server/docs/development-plan.md) for detailed roadmap.

---

## Security

Security is a priority for Micrawl. Key security features:

**MCP Server:**
- stdio-only transport (no network exposure)
- Path traversal protection
- Input validation with Zod schemas
- No command execution with user input

**API:**
- Request validation and rate limiting
- Secure driver selection
- Timeout controls
- Error handling without information leakage

For detailed security information:
- [MCP Server Security Documentation](mcp-server/docs/security.md)
- [GitHub Security Advisories](https://github.com/gustavovalverde/micro-play/security/advisories)

**Reporting Vulnerabilities:**
Please report security issues via [GitHub Security Advisories](https://github.com/gustavovalverde/micro-play/security/advisories), not public issues.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Run linter: `pnpm lint`
6. Submit a pull request

**Security Contributions:**
- Security issues should be reported privately via GitHub Security Advisories
- Include proof of concept and impact assessment
- Follow coordinated disclosure practices

---

## License

MIT - See [LICENSE](LICENSE) for details

---

## Support

- **Issues**: [GitHub Issues](https://github.com/gustavovalverde/micro-play/issues)
- **Documentation**: [MCP Server Docs](mcp-server/README.md)
- **Roadmap**: [Development Plan](mcp-server/docs/development-plan.md)
