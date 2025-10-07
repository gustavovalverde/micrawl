import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatBytes, saveScrapeResult } from "./files.js";
import { crawl, scrape } from "./scraper.js";

export interface MicrawlMcpServerOptions {
  version?: string;
}

function mcpError(operation: string, url: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  // Detect common issues and provide actionable suggestions
  const suggestions: string[] = [];

  if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
    suggestions.push(
      "Try increasing timeout: set SCRAPER_DEFAULT_TIMEOUT_MS=120000",
    );
    suggestions.push(
      "Or use HTTP driver: mention 'use HTTP driver' in your prompt",
    );
  }

  if (
    message.includes("ENOTFOUND") ||
    message.includes("DNS") ||
    message.includes("getaddrinfo")
  ) {
    suggestions.push("Check if URL is correct and accessible");
    suggestions.push("If behind VPN, ensure connection is active");
  }

  if (message.includes("403") || message.includes("Forbidden")) {
    suggestions.push("Website may block scrapers - try HTTP driver instead");
    suggestions.push(
      "Some sites require authentication or have anti-bot protection",
    );
  }

  if (message.includes("404") || message.includes("Not Found")) {
    suggestions.push("Verify the URL exists and is publicly accessible");
  }

  if (message.includes("ERR_SSL") || message.includes("certificate")) {
    suggestions.push(
      "SSL certificate issue - site may have invalid HTTPS setup",
    );
  }

  const helpText =
    suggestions.length > 0
      ? `\n\n💡 Suggestions:\n${suggestions.map((s) => `  • ${s}`).join("\n")}`
      : "";

  return {
    content: [
      {
        type: "text" as const,
        text: `❌ Failed to ${operation} ${url}\n\nError: ${message}${helpText}`,
      },
    ],
    isError: true,
  };
}

export function createMicrawlMcpServer(options: MicrawlMcpServerOptions = {}) {
  const server = new McpServer({
    name: "micrawl-mcp",
    version: options.version ?? "0.2.0",
  });

  server.tool(
    "fetch_page",
    "Fetch clean documentation from a URL and return as markdown. Example: 'Get the content from https://hono.dev/docs/getting-started'",
    {
      url: z.string().url().describe("URL to fetch"),
    },
    async ({ url }) => {
      try {
        const result = await scrape({ url, readability: true });

        const markdownLength = result.markdown.length;
        const MAX_PREVIEW = 8000; // ~2000 tokens

        // For large content, show preview and suggest saving instead
        if (markdownLength > MAX_PREVIEW) {
          const preview = result.markdown.slice(0, MAX_PREVIEW);
          const remaining = markdownLength - MAX_PREVIEW;

          return {
            content: [
              {
                type: "text",
                text: `# ${result.title}

URL: ${result.url}
⚠️ Content is large (${formatBytes(markdownLength)}). Showing first ${formatBytes(MAX_PREVIEW)}...

${preview}

---
[... ${remaining} more characters truncated]

💡 To save the full content: ask me to save it with save_docs instead`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `# ${result.title}\n\nURL: ${result.url}\n\n${result.markdown}`,
            },
          ],
        };
      } catch (error) {
        return mcpError("fetch", url, error);
      }
    },
  );

  server.tool(
    "save_docs",
    "Save documentation to your local filesystem. Supports single page, multiple pages, or entire site. Example: 'Save https://hono.dev/docs to ./docs'",
    {
      url: z
        .union([z.string().url(), z.array(z.string().url())])
        .describe("Single URL, or array of URLs to save"),
      outDir: z
        .string()
        .optional()
        .default(process.env.MICRAWL_DOCS_DIR || "./docs")
        .describe(
          "Local directory to save files (default: ./docs or MICRAWL_DOCS_DIR)",
        ),
      crawl: z
        .boolean()
        .optional()
        .default(false)
        .describe("Follow links to save entire site (default: false)"),
      maxPages: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum pages when crawling (default: 20)"),
      maxDepth: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .default(2)
        .describe("Link depth when crawling (default: 2)"),
    },
    async ({ url, outDir, crawl: shouldCrawl, maxPages, maxDepth }) => {
      const savedFiles: Array<{
        filepath: string;
        existed: boolean;
        size: number;
      }> = [];
      const errors: string[] = [];

      try {
        if (Array.isArray(url)) {
          for (const singleUrl of url) {
            try {
              const result = await scrape({
                url: singleUrl,
                readability: true,
              });
              const saveResult = await saveScrapeResult(result, outDir, {
                frontMatter: true,
                organizeByDomain: true,
              });
              savedFiles.push(saveResult);
            } catch (error) {
              errors.push(
                `${singleUrl}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          // Calculate statistics
          const totalBytes = savedFiles.reduce((sum, f) => sum + f.size, 0);
          const overwritten = savedFiles.filter((f) => f.existed).length;
          const newFiles = savedFiles.length - overwritten;

          const summary = [
            `✅ Saved ${savedFiles.length}/${url.length} pages to ${outDir}`,
            `   New: ${newFiles}, Overwritten: ${overwritten}`,
            `   Total size: ${formatBytes(totalBytes)}`,
            ``,
            ...savedFiles.map(
              (file, i) =>
                `${i + 1}. ${file.filepath} (${formatBytes(file.size)})${file.existed ? " [overwritten]" : ""}`,
            ),
            ...(errors.length > 0 ? ["", "⚠️ Errors:", ...errors] : []),
          ].join("\n");

          return {
            content: [{ type: "text", text: summary }],
          };
        }

        if (shouldCrawl) {
          for await (const result of crawl(url, {
            maxDepth,
            maxPages,
            readability: true,
          })) {
            try {
              const saveResult = await saveScrapeResult(result, outDir, {
                frontMatter: true,
                depth: result.depth,
                organizeByDomain: true,
              });
              savedFiles.push(saveResult);

              // Send progress notification
              server.notification({
                method: "notifications/progress",
                params: {
                  progressToken: `crawl-${Date.now()}`,
                  progress: savedFiles.length,
                  total: maxPages,
                } as never,
              });
            } catch (saveError) {
              errors.push(`Failed to save ${result.url}: ${saveError}`);
            }
          }

          // Calculate statistics
          const totalBytes = savedFiles.reduce((sum, f) => sum + f.size, 0);
          const overwritten = savedFiles.filter((f) => f.existed).length;
          const newFiles = savedFiles.length - overwritten;

          const summary = [
            `✅ Crawled and saved ${savedFiles.length} pages to ${outDir}`,
            `   New: ${newFiles}, Overwritten: ${overwritten}`,
            `   Total size: ${formatBytes(totalBytes)}`,
            ``,
            ...savedFiles.map(
              (file, i) =>
                `${i + 1}. ${file.filepath} (${formatBytes(file.size)})${file.existed ? " [overwritten]" : ""}`,
            ),
            ...(errors.length > 0 ? ["", "⚠️ Errors:", ...errors] : []),
          ].join("\n");

          return {
            content: [{ type: "text", text: summary }],
          };
        }

        const result = await scrape({ url, readability: true });
        const saveResult = await saveScrapeResult(result, outDir, {
          frontMatter: true,
          organizeByDomain: true,
        });

        const overwriteWarning = saveResult.existed
          ? " [overwritten existing file]"
          : "";

        return {
          content: [
            {
              type: "text",
              text: `✅ Saved: ${saveResult.filepath} (${formatBytes(saveResult.size)})${overwriteWarning}\n\nTitle: ${result.title}\nURL: ${result.url}`,
            },
          ],
        };
      } catch (error) {
        const urlStr = Array.isArray(url) ? url[0] : url;
        return mcpError("save", urlStr, error);
      }
    },
  );

  return { server };
}
