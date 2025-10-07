# @micrawl/mcp-server Changelog

All notable changes to this package will be tracked here. This file summarises the restructure that landed the MCP transport alongside the Micrawl core runtime.

## 0.1.0 - 2025-10-07

### Added
- Initial MCP stdio transport exposing `fetch_page` and `save_docs`, backed by `@micrawl/core` scraping drivers.
- Domain-aware markdown storage with YAML front matter and byte-size reporting for saved files.
- Progress notifications for multi-page crawls and helpful error guidance (timeouts, DNS failures, forbidden responses).
- Dockerfile and docker-compose templates for running the server with preinstalled Chromium.
