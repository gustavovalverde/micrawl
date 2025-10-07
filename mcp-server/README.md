# Micrawl MCP Server

**AI-facing interface to the Micrawl scraping engine** – fetch pages, crawl sites, and persist structured knowledge through Model Context Protocol (MCP).

This server lets Claude Code, Cursor, Windsurf, and any MCP-compatible client tap directly into the shared Micrawl runtime for live browsing, markdown generation, and local storage workflows.

---

## Table of Contents

- [Micrawl MCP Server](#micrawl-mcp-server)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
  - [What is MCP?](#what-is-mcp)
  - [Available Tools](#available-tools)
    - [`fetch_page`](#fetch_page)
    - [`save_docs`](#save_docs)
  - [Installation](#installation)
    - [Prerequisites](#prerequisites)
    - [Local Development](#local-development)
    - [Using npx](#using-npx)
    - [Docker Image](#docker-image)
  - [Configuration](#configuration)
    - [Claude Code](#claude-code)
    - [Cursor](#cursor)
    - [Windsurf](#windsurf)
    - [Other MCP Clients](#other-mcp-clients)
  - [Environment Variables](#environment-variables)
    - [MCP Server Settings](#mcp-server-settings)
    - [Scraper Settings (from @micrawl/core)](#scraper-settings-from-micrawlcore)
    - [Example .env](#example-env)
  - [Usage Examples](#usage-examples)
    - [Fetching Content](#fetching-content)
    - [Saving Single Page](#saving-single-page)
    - [Saving Multiple Pages](#saving-multiple-pages)
    - [Crawling Entire Site](#crawling-entire-site)
  - [How It Works](#how-it-works)
    - [Data Flow](#data-flow)
    - [File Processing](#file-processing)
    - [Crawling Logic](#crawling-logic)
  - [Development](#development)
    - [Running Tests](#running-tests)
    - [Building](#building)
    - [Debugging](#debugging)
  - [Security](#security)
  - [Troubleshooting](#troubleshooting)
    - ["MCP server not found" in AI client](#mcp-server-not-found-in-ai-client)
    - [Files not saving](#files-not-saving)
    - [Scraping times out](#scraping-times-out)
    - [Chromium launch fails](#chromium-launch-fails)
    - [AI client doesn't use MCP tools](#ai-client-doesnt-use-mcp-tools)
  - [Architecture](#architecture)
    - [Package Structure](#package-structure)
    - [Dependencies](#dependencies)
    - [Design Principles](#design-principles)
  - [Roadmap](#roadmap)
    - [Phase 1: Current State ✅](#phase-1-current-state-)
    - [Phase 2: Enhanced Intelligence (Planned)](#phase-2-enhanced-intelligence-planned)
    - [Phase 3: Advanced Features (Future)](#phase-3-advanced-features-future)
  - [Contributing](#contributing)
  - [License](#license)
  - [Support](#support)

---

## Quick Start

```bash
# Build
pnpm install
pnpm --filter @micrawl/core build
pnpm --filter @micrawl/mcp-server build

# Configure your AI client
# Add to .claude/mcp.json or .cursor/mcp.json:
{
  "mcpServers": {
    "web-docs-saver": {
      "description": "Fetch and save structured content from websites",
      "command": "node",
      "args": ["<absolute-path>/mcp-server/dist/stdio.js"]
    }
  }
}

# Restart your AI client, then ask:
```

> "Save the Hono documentation from <https://hono.dev/docs> to ./docs"

> "Fetch <https://example.com> and show me the content"

---

## What is MCP?

The **Model Context Protocol** (MCP) is an open standard that lets AI assistants:

- **Call tools** (web scrapers, file systems, APIs)
- **Access resources** (documents, databases, cached content)
- **Receive notifications** (progress updates, status changes)

MCP uses stdio (standard input/output) for local integrations, making it perfect for developer tools.

---

## Available Tools

### `fetch_page`

Fetch clean documentation from a URL and return as markdown.

**Parameters:**

- `url` (required) - URL to fetch

**Example:**
> "Get the content from <https://hono.dev/docs/getting-started>"

> "Fetch <https://example.com>"

**What it does:**

1. Fetches the URL using smart driver selection (Playwright or HTTP)
2. Extracts clean content with Mozilla Readability
3. Converts to markdown
4. Returns the content in the AI conversation

**Use when:** You want to see/analyze content without saving it.

---

### `save_docs`

Save documentation to your local filesystem. Intelligently handles:

- **Single page** - Pass a URL string
- **Multiple pages** - Pass an array of URLs
- **Entire site** - Set `crawl: true` to follow links

**Parameters:**

- `url` (required) - Single URL or array of URLs
- `outDir` (required) - Local directory to save files (e.g., `./docs`)
- `crawl` (optional, default: `false`) - Follow links to save entire site
- `maxPages` (optional, default: `20`) - Maximum pages when crawling
- `maxDepth` (optional, default: `2`) - Link depth when crawling

**Examples:**

**Single page:**
> "Save <https://hono.dev/docs> to ./docs"

**Multiple pages:**
> "Save these URLs to ./docs: <https://hono.dev/docs/getting-started> and <https://hono.dev/docs/api>"

**Entire site (crawl):**
> "Save <https://hono.dev/docs> to ./docs and crawl all pages"

**What it does:**

1. Fetches URL(s) with clean extraction
2. Converts to markdown
3. Auto-generates filenames from URLs
4. Adds YAML frontmatter (url, title, timestamp, depth)
5. Saves to specified directory
6. Reports success with file paths

**Use when:** You want offline docs, building a knowledge base, or archiving documentation.

---

## Installation

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- AI client that supports MCP (Claude Code, Cursor, Windsurf, etc.)

### Local Development

1. **Clone and install:**

```bash
git clone <repository-url>
cd micro-play
pnpm install
```

2. **Build packages:**

```bash
# Build core library first
pnpm --filter @micrawl/core build

# Build MCP server
pnpm --filter @micrawl/mcp-server build
```

3. **Configure your AI client:**

See [Configuration](#configuration) section below for your specific client.

### Using npx

Run the published binary with npx to avoid cloning the repository. The command installs the package on demand and launches the stdio transport so you can wire it directly into your MCP client configuration.

```bash
npx @micrawl/mcp-server@latest
```

For Claude Desktop, point `.claude/mcp.json` at the npx invocation:

```json
{
  "mcpServers": {
    "micrawl": {
      "description": "Web documentation scraper",
      "command": "npx",
      "args": ["@micrawl/mcp-server@latest"],
      "env": {
        "MICRAWL_DOCS_DIR": "~/micrawl/data/docs",
        "MICRAWL_LLMS_DIR": "~/micrawl/data/llms"
      }
    }
  }
}
```

> Tip: add `--yes` to the args array if you want npx to skip the interactive install prompt.

### Docker Image

Pull the prebuilt container (or build it locally with the provided Dockerfile) and expose stdin/stdout so MCP clients can attach. The example mounts a local data directory for persisted markdown exports.

```bash
# Build locally (replace with docker pull micrawl/mcp-server:latest once published)
docker build -t micrawl/mcp-server -f mcp-server/Dockerfile .

# Run interactively so MCP clients can connect over stdio
docker run -it --rm \
  -v "$(pwd)/micrawl-data:/app/data" \
  micrawl/mcp-server
```

Configure Claude or another MCP client to execute the container on demand:

```json
{
  "mcpServers": {
    "micrawl": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "$(pwd)/micrawl-data:/app/data",
        "micrawl/mcp-server"
      ]
    }
  }
}
```

Set additional scraper environment variables with `-e NAME=value` pairs or the `env` object in your MCP client configuration.


---

## Configuration

### Claude Code

**Location:** `.claude/mcp.json` in your project, or `~/.claude/mcp.json` for global config

```json
{
  "mcpServers": {
    "web-docs-saver": {
      "description": "Fetch and save documentation from websites as clean markdown files. Use when user wants to download, save, or archive web documentation locally.",
      "command": "node",
      "args": ["/absolute/path/to/micro-play/mcp-server/dist/stdio.js"],
      "env": {
        "MICRAWL_DOCS_DIR": "./docs",
        "SCRAPER_DEFAULT_TIMEOUT_MS": "60000"
      },
      "metadata": {
        "triggers": ["documentation", "docs", "save", "fetch", "download", "archive", "website", "markdown"]
      }
    }
  }
}
```

**Pro tip:** Add rich `description` and `triggers` to help Claude Code discover your MCP server more often.

### Cursor

**Location:** `.cursor/mcp.json` in your project

```json
{
  "mcpServers": {
    "web-docs-saver": {
      "type": "command",
      "command": "node",
      "args": ["/absolute/path/to/micro-play/mcp-server/dist/stdio.js"],
      "env": {
        "MICRAWL_DOCS_DIR": "/Users/you/cursor-docs"
      }
    }
  }
}
```

### Windsurf

**Location:** `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "web-docs-saver": {
      "command": "node",
      "args": ["/absolute/path/to/micro-play/mcp-server/dist/stdio.js"]
    }
  }
}
```

### Other MCP Clients

Any MCP client with stdio support:

1. Use `node /absolute/path/to/stdio.js` as command
2. Pass environment variables via client config
3. Restart client to load MCP server

---

## Environment Variables

### MCP Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MICRAWL_DOCS_DIR` | `./docs` | Directory where `save_docs` writes files |

### Scraper Settings (from @micrawl/core)

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRAPER_DEFAULT_TIMEOUT_MS` | `60000` | Page load timeout (1000-120000 ms) |
| `SCRAPER_DEFAULT_DRIVER` | `playwright` | Driver: `playwright`, `http`, or `auto` |
| `SCRAPER_DEFAULT_LOCALE` | `en-US` | Browser locale |
| `SCRAPER_DEFAULT_TIMEZONE` | `America/New_York` | Browser timezone |
| `SCRAPER_DEFAULT_VIEWPORT_WIDTH` | `1920` | Viewport width (320-4096 px) |
| `SCRAPER_DEFAULT_VIEWPORT_HEIGHT` | `1080` | Viewport height (320-4096 px) |
| `CHROMIUM_BINARY` | *(auto)* | Custom Chromium binary path |

### Example .env

Create `.env` in your project root:

```bash
# Where to save docs
MICRAWL_DOCS_DIR=/Users/you/Documents/docs

# Scraper behavior
SCRAPER_DEFAULT_TIMEOUT_MS=60000
SCRAPER_DEFAULT_DRIVER=auto
```

---

## Usage Examples

### Fetching Content

**User asks:**
> "What's on <https://hono.dev/docs/getting-started>?"

> "Show me the content from <https://example.com>"

**AI calls:** `fetch_page({ url: "https://..." })`

**Result:** Clean markdown content shown in conversation

---

### Saving Single Page

**User asks:**
> "Save the Hono getting started guide to my docs folder"

**AI calls:** `save_docs({ url: "https://hono.dev/docs/getting-started", outDir: "./docs" })`

**Result:**

```
✅ Saved: ./docs/hono-dev-docs-getting-started.md

Title: Getting Started | Hono
URL: https://hono.dev/docs/getting-started
```

**File structure:**

```
docs/
└── hono-dev-docs-getting-started.md
```

---

### Saving Multiple Pages

**User asks:**
> "Save these 3 Hono docs pages: getting-started, routing, and middleware"

**AI calls:**

```typescript
save_docs({
  url: [
    "https://hono.dev/docs/getting-started",
    "https://hono.dev/docs/routing",
    "https://hono.dev/docs/middleware"
  ],
  outDir: "./docs"
})
```

**Result:**

```
✅ Saved 3/3 pages to ./docs

1. ./docs/hono-dev-docs-getting-started.md
2. ./docs/hono-dev-docs-routing.md
3. ./docs/hono-dev-docs-middleware.md
```

---

### Crawling Entire Site

**User asks:**
> "Save all the Hono documentation, crawl the whole site"

**AI calls:**

```typescript
save_docs({
  url: "https://hono.dev/docs",
  outDir: "./docs/hono",
  crawl: true,
  maxPages: 50,
  maxDepth: 3
})
```

**Result:**

```
✅ Crawled and saved 47 pages to ./docs/hono

1. ./docs/hono/hono-dev-docs.md (depth 0)
2. ./docs/hono/hono-dev-docs-getting-started.md (depth 1)
3. ./docs/hono/hono-dev-docs-api-request.md (depth 1)
... (44 more files)
```

**File structure:**

```
docs/
└── hono/
    ├── hono-dev-docs.md
    ├── hono-dev-docs-getting-started.md
    ├── hono-dev-docs-routing.md
    └── ... (44 more files)
```

---

## How It Works

### Data Flow

```
AI Client (Claude/Cursor)
       ↓ stdio
MCP Server (this package)
       ↓ imports
@micrawl/core (scraping engine)
       ↓ uses
Playwright or HTTP driver
       ↓ fetches
Website → Clean Markdown
```

### File Processing

1. **URL → Filename**
   - `https://hono.dev/docs/getting-started` → `hono-dev-docs-getting-started.md`
   - Removes protocol, replaces special chars with hyphens
   - Lowercased, max 100 chars

2. **Content Processing**
   - Mozilla Readability extracts main content
   - h2m-parser converts HTML → Markdown
   - Removes navigation, ads, footers

3. **Frontmatter (YAML)**

   ```yaml
   ---
   url: "https://hono.dev/docs/getting-started"
   title: "Getting Started | Hono"
   scraped_at: "2025-09-30T12:00:00.000Z"
   depth: 1
   ---

   # Getting Started

   ...
   ```

### Crawling Logic

When `crawl: true`:

1. Start at `url` (depth 0)
2. Extract all same-origin links from page
3. Queue links at depth + 1
4. Scrape each page, save markdown
5. Repeat until `maxDepth` or `maxPages` reached
6. Return summary of saved files

**Same-origin only** - Won't follow external links

---

## Development

### Running Tests

```bash
# All tests
pnpm --filter @micrawl/mcp-server test

# Watch mode
pnpm --filter @micrawl/mcp-server test --watch
```

### Building

```bash
pnpm --filter @micrawl/mcp-server build
```

Output: `mcp-server/dist/stdio.js` (entrypoint)

### Debugging

**Enable verbose logging:**

```bash
NODE_ENV=development node mcp-server/dist/stdio.js
```

**Logs show:**

- Tool invocations with parameters
- Scraping progress (queued → navigating → capturing)
- File saves with paths
- Errors with stack traces

**Test with MCP Inspector:**

```bash
npx @modelcontextprotocol/inspector node mcp-server/dist/stdio.js
```

Opens web UI to manually:

- Call `fetch_page` and `save_docs`
- Inspect tool schemas
- View server metadata

---

## Security

The Micrawl MCP Server is designed with security as a priority. Key security features:

- **stdio-only transport** - No network exposure, process isolation
- **Path traversal protection** - Validates all filesystem operations
- **Input validation** - All parameters validated with Zod schemas
- **No command execution** - No shell commands with user input
- **Minimal dependencies** - Only 3 direct dependencies

**Security Warning:** Only scrape documentation from trusted sources. Malicious websites could contain content designed to trick the AI into performing unintended actions.

---

## Troubleshooting

### "MCP server not found" in AI client

**Fix:**

1. Use **absolute paths** in config (not relative)
2. Rebuild: `pnpm --filter @micrawl/mcp-server build`
3. Restart AI client

### Files not saving

**Check:**

- `MICRAWL_DOCS_DIR` is writable
- Directory exists (MCP server creates subdirs, not root)
- No permission errors in logs

**Fix:**

```bash
mkdir -p ./docs
chmod 755 ./docs
```

### Scraping times out

**Fix:**

```bash
# Increase timeout (in .env or config)
SCRAPER_DEFAULT_TIMEOUT_MS=120000
```

Or tell AI to use HTTP driver:
> "Save <https://example.com> using the HTTP driver"

### Chromium launch fails

**Fix:**

```bash
# Install Chromium dependencies (Linux)
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# Or use HTTP driver (no browser needed)
SCRAPER_DEFAULT_DRIVER=http
```

### AI client doesn't use MCP tools

**Fix:**

1. Add rich `description` to config (see [Configuration](#configuration))
2. Add `triggers` keywords in metadata
3. Ask more explicitly: "Use the web-docs-saver MCP server to..."

---

## Architecture

### Package Structure

```
mcp-server/
├── src/
│   ├── server.ts         # MCP server (2 tools)
│   ├── scraper.ts        # Wrapper around @micrawl/core
│   ├── files.ts          # File utilities (save, frontmatter)
│   └── stdio.ts          # CLI entrypoint
├── tests/
│   └── stdio.integration.test.ts
├── dist/                 # Build output
├── package.json
└── tsconfig.json
```

**Total:** 315 lines of code (4 files)

### Dependencies

- **@modelcontextprotocol/sdk** - MCP protocol
- **@micrawl/core** - Scraping engine (shared with API)
- **zod** - Schema validation

**No duplication:** Scraping logic lives in `@micrawl/core`, used by both MCP server and HTTP API.

### Design Principles

Following [cognitive-load.md](../cognitive-load.md):

- **2 tools not 4** - Reduced choice paralysis
- **Natural names** - `fetch_page`, `save_docs` (not "scrape", "crawl")
- **Deep modules** - Simple interface, complex logic hidden
- **Smart defaults** - Readability/frontmatter always on
- **Example-driven** - Tool descriptions show real usage

**Before:** 4 tools, 363 lines, technical jargon 🧠+++
**After:** 2 tools, 315 lines, natural language 🧠

---

## Roadmap

### Phase 1: Current State ✅

- Clean documentation extraction with Mozilla Readability
- 2 simple tools (`fetch_page`, `save_docs`)
- Multi-format output (HTML, Markdown)
- Smart driver selection (Playwright, HTTP, auto)
- Crawling with depth/page limits

### Phase 2: Enhanced Intelligence (Planned)

- `search_docs` - Search local saved documentation
- Code example extraction from docs
- Auto-save project dependencies (via AI delegation)
- Documentation freshness detection

### Phase 3: Advanced Features (Future)

- Semantic search with embeddings
- Multi-source search (local + web)
- Interactive tutorial generation

See [docs/development-plan.md](docs/development-plan.md) for detailed roadmap.

---

## Contributing

See main [project README](../README.md) for contribution guidelines.

---

## License

MIT - See [LICENSE](../LICENSE) for details

---

## Support

- **Issues**: [GitHub Issues](https://github.com/gustavovalverde/micro-play/issues)
- **API Docs**: [Main README](../README.md)
- **Roadmap**: [Development Plan](docs/development-plan.md)
