import { runScrapeJob } from "@micrawl/core";
import type { ScrapeJob } from "@micrawl/core/types";

export interface ScrapeOptions {
  url: string;
  timeoutMs?: number;
  driver?: "playwright" | "http" | "auto";
  readability?: boolean;
}

export interface ScrapeResult {
  url: string;
  title: string;
  markdown: string;
  links: string[];
  durationMs: number;
}

export async function scrape(options: ScrapeOptions): Promise<ScrapeResult> {
  const job: ScrapeJob = {
    targetUrl: options.url,
    outputFormats: ["markdown"],
    captureTextOnly: false,
    driver: options.driver ?? "playwright",
    timeoutMs: options.timeoutMs ?? 60000,
    readability: options.readability ?? true,
  };

  const result = await runScrapeJob(
    job,
    `scrape-${Date.now()}`,
    { index: 1, total: 1, targetUrl: options.url },
    async () => {},
  );

  if (result.status !== "success") {
    const error = result.errors?.[0]?.message || "Scrape failed";
    throw new Error(`Failed to scrape ${options.url}: ${error}`);
  }

  const page = result.data.page;
  const markdownContent = page.contents.find((c) => c.format === "markdown");

  if (!markdownContent) {
    throw new Error(`No markdown content returned for ${options.url}`);
  }

  return {
    url: page.url,
    title: page.title || "Untitled",
    markdown: markdownContent.body,
    links: page.metadata?.sameOriginLinks || [],
    durationMs: page.durationMs,
  };
}

export async function* crawl(
  startUrl: string,
  options: {
    maxDepth?: number;
    maxPages?: number;
    timeoutMs?: number;
    readability?: boolean;
  } = {},
): AsyncGenerator<ScrapeResult & { depth: number }> {
  const maxDepth = options.maxDepth ?? 2;
  const maxPages = options.maxPages ?? 20;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [
    { url: startUrl, depth: 0 },
  ];

  let scraped = 0;

  while (queue.length > 0 && scraped < maxPages) {
    const item = queue.shift();
    if (!item) break;

    const { url, depth } = item;

    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const result = await scrape({
        url,
        timeoutMs: options.timeoutMs,
        readability: options.readability,
      });
      scraped++;

      yield { ...result, depth };

      if (depth < maxDepth) {
        for (const link of result.links) {
          if (!visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error);
    }
  }
}
