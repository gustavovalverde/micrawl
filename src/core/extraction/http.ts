import { H2MParser } from "h2m-parser";
import { getEnv } from "../../config/index.js";
import { logger } from "../../logger.js";
import { isBlockedExtension } from "../../scraper-filters.js";
import type {
  ScrapeErrorDetail,
  ScrapeFailure,
  ScrapeFailureMeta,
  ScrapeJob,
  ScrapePhase,
  ScrapeSuccess,
} from "../../types/scrape.js";
import type {
  ScrapeDriver,
  ScrapeDriverPhaseEmitter,
  ScrapeDriverPosition,
  ScrapeDriverResult,
} from "../../types/scrape-driver.js";
import { buildExtraHeaders } from "./shared.js";

const markdownParser = new H2MParser({
  extract: { readability: false },
  markdown: { linkStyle: "inline" },
});

const DEFAULT_CONTENT_TYPE = "text/html";

const notifyPhase = async (
  emitter: ScrapeDriverPhaseEmitter | undefined,
  phase: Exclude<ScrapePhase, "completed">
) => {
  if (!emitter) return;
  try {
    await emitter(phase);
  } catch (error) {
    logger.debug("Failed to report HTTP driver phase", {
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const sanitizeText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractTitle = (html: string): string | null => {
  const match = html.match(/<title>(.*?)<\/title>/is);
  if (!match) return null;
  return decodeEntities(match[1].trim());
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

interface HtmlMetadata {
  description?: string;
  keywords?: string[];
  canonicalUrl?: string;
  sameOriginLinks: string[];
}

const extractMetadata = (html: string, baseUrl: URL): HtmlMetadata => {
  const descriptionMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  );
  const keywordsMatch = html.match(
    /<meta[^>]+name=["']keywords["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  );
  const canonicalMatch = html.match(
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i,
  );

  const sameOriginLinks = new Set<string>();
  const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(html))) {
    const href = linkMatch[1];
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin === baseUrl.origin) {
        resolved.hash = "";
        sameOriginLinks.add(resolved.toString());
      }
    } catch {
      continue;
    }
  }

  return {
    description: descriptionMatch ? decodeEntities(descriptionMatch[1].trim()) : undefined,
    keywords: keywordsMatch
      ? keywordsMatch[1]
          .split(",")
          .map((keyword) => decodeEntities(keyword.trim()))
          .filter((keyword) => keyword.length > 0)
      : undefined,
    canonicalUrl: canonicalMatch
      ? new URL(canonicalMatch[1].trim(), baseUrl).toString()
      : undefined,
    sameOriginLinks: Array.from(sameOriginLinks),
  };
};

const buildHttpSuccess = (
  job: ScrapeJob,
  jobId: string,
  position: ScrapeDriverPosition,
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  httpStatusCode: number,
  html: string,
  markdown: string | undefined,
  metadata: HtmlMetadata,
  contentType: string,
): ScrapeSuccess => ({
  status: "success",
  jobId,
  index: position.index,
  total: position.total,
  targetUrl: position.targetUrl,
  phase: "completed",
  data: {
    page: {
      url: job.targetUrl,
      title: extractTitle(html),
      httpStatusCode,
      startedAt,
      finishedAt,
      durationMs,
      loadStrategy: "load-event",
      contents: (() => {
        const formats = job.outputFormats && job.outputFormats.length > 0
          ? job.outputFormats
          : ["html"];

        const entries = [];

        const htmlBody = job.captureTextOnly ? sanitizeText(html) : html;
        const htmlBytes = Buffer.byteLength(htmlBody, "utf8");

        if (formats.includes("html") || !formats.includes("markdown")) {
          entries.push({
            format: "html" as const,
            contentType,
            body: htmlBody,
            bytes: htmlBytes,
          });
        }

        if (formats.includes("markdown") && markdown) {
          entries.push({
            format: "markdown" as const,
            contentType: "text/markdown",
            body: markdown,
            bytes: Buffer.byteLength(markdown, "utf8"),
          });
        }

        return entries.length > 0
          ? entries
          : [
              {
                format: "html" as const,
                contentType,
                body: htmlBody,
                bytes: htmlBytes,
              },
            ];
      })(),
      metadata: {
        description: metadata.description,
        canonicalUrl: metadata.canonicalUrl,
        keywords: metadata.keywords,
        sameOriginLinks: metadata.sameOriginLinks,
      },
    },
  },
});

const buildHttpFailure = (
  job: ScrapeJob,
  jobId: string,
  position: ScrapeDriverPosition,
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  httpStatusCode: number | undefined,
  rawMessage: string,
): ScrapeFailure => {
  const message = rawMessage || "HTTP scrape failed";
  const failureMeta: ScrapeFailureMeta = {
    targetUrl: job.targetUrl,
    startedAt,
    finishedAt,
    durationMs,
    loadStrategy: "load-event",
  };

  const errorDetail: ScrapeErrorDetail = {
    targetUrl: job.targetUrl,
    message,
    rawMessage: rawMessage || message,
    httpStatusCode,
    meta: failureMeta,
  };

  return {
    status: "fail",
    jobId,
    index: position.index,
    total: position.total,
    targetUrl: position.targetUrl,
    phase: "completed",
    errors: [errorDetail],
  };
};

export const runHttpScrape: ScrapeDriver["run"] = async (
  job,
  jobId,
  position,
  emitPhase,
): Promise<ScrapeDriverResult> => {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  logger.info("Starting HTTP scrape", {
    jobId,
    targetUrl: job.targetUrl,
  });

  const targetUrl = new URL(job.targetUrl);
  if (isBlockedExtension(targetUrl)) {
    return buildHttpFailure(
      job,
      jobId,
      position,
      startedAt,
      new Date().toISOString(),
      Date.now() - startedAtMs,
      undefined,
      `Disallowed file extension: ${targetUrl.pathname}`,
    );
  }

  const headers = buildExtraHeaders(job);
  if (job.userAgent) {
    headers["user-agent"] = job.userAgent;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), job.timeoutMs);

  try {
    await notifyPhase(emitPhase, "navigating");

    const response = await fetch(job.targetUrl, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const httpStatusCode = response.status;
    if (!response.ok) {
      logger.warn("HTTP scrape received non-OK status", {
        jobId,
        targetUrl: job.targetUrl,
        status: httpStatusCode,
      });
      return buildHttpFailure(
        job,
        jobId,
        position,
        startedAt,
        new Date().toISOString(),
        Date.now() - startedAtMs,
        httpStatusCode,
        `HTTP ${httpStatusCode} ${response.statusText}`,
      );
    }

    await notifyPhase(emitPhase, "capturing");

    const buffer = Buffer.from(await response.arrayBuffer());
    const html = buffer.toString("utf8");
    const contentType = response.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE;

    let markdown: string | undefined;
    const formats = job.outputFormats && job.outputFormats.length > 0
      ? job.outputFormats
      : ["html"];

    if (formats.includes("markdown")) {
      try {
        const result = await markdownParser.process(html, job.targetUrl);
        markdown = result.markdown;
      } catch (error) {
        logger.warn("HTTP markdown conversion failed", {
          jobId,
          targetUrl: job.targetUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const metadata = extractMetadata(html, targetUrl);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    logger.info("HTTP scrape completed", {
      jobId,
      targetUrl: job.targetUrl,
      status: httpStatusCode,
      bytes: buffer.byteLength,
      durationMs,
    });

    return buildHttpSuccess(
      job,
      jobId,
      position,
      startedAt,
      finishedAt,
      durationMs,
      httpStatusCode,
      html,
      markdown,
      metadata,
      contentType,
    );
  } catch (error) {
    clearTimeout(timeout);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const rawMessage = error instanceof Error ? error.message : String(error);

    logger.error("HTTP scrape failed", {
      jobId,
      targetUrl: job.targetUrl,
      error: rawMessage,
    });

    return buildHttpFailure(
      job,
      jobId,
      position,
      startedAt,
      finishedAt,
      durationMs,
      undefined,
      rawMessage,
    );
  }
};

export const verifyHttpDriver = async () => {
  const env = getEnv();
  const healthcheckUrl = env.SCRAPER_HEALTHCHECK_URL ?? "https://example.com/";
  const response = await fetch(healthcheckUrl, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `HTTP driver healthcheck failed with status ${response.status} ${response.statusText}`,
    );
  }
};

export const httpDriver: ScrapeDriver = {
  name: "http",
  run: runHttpScrape,
  verify: verifyHttpDriver,
};
