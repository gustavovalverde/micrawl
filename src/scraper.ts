import { URL } from "node:url";
import chromium from "@sparticuz/chromium";
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  chromium as playwrightChromium,
  type Route,
} from "playwright-core";
import UserAgent from "user-agents";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";
import { isBlockedDomain, isBlockedExtension, shouldSkipResourceType } from "./scraper-filters.js";
import type {
  LoadStrategy,
  ScrapedPage,
  ScrapeErrorDetail,
  ScrapeFailure,
  ScrapeFailureMeta,
  ScrapeJob,
  ScrapePhase,
  ScrapeSuccess,
} from "./types/scrape.js";

const generateUserAgent = () =>
  new UserAgent({ deviceCategory: "desktop" }).toString();

export const buildContextOptions = (job: ScrapeJob): BrowserContextOptions => {
  const env = getEnv();
  const viewport = job.viewport ?? {
    width: env.SCRAPER_DEFAULT_VIEWPORT_WIDTH,
    height: env.SCRAPER_DEFAULT_VIEWPORT_HEIGHT,
  };

  const contextOptions: BrowserContextOptions = {
    ignoreHTTPSErrors: false,
    viewport,
    locale: job.locale ?? env.SCRAPER_DEFAULT_LOCALE,
    timezoneId: job.timezoneId ?? env.SCRAPER_DEFAULT_TIMEZONE,
    userAgent:
      job.userAgent ?? env.SCRAPER_DEFAULT_USER_AGENT ?? generateUserAgent(),
  };

  if (job.outboundProxyUrl) {
    contextOptions.proxy = { server: job.outboundProxyUrl };
  }

  return contextOptions;
};

export const buildExtraHeaders = (job: ScrapeJob): Record<string, string> => {
  const headers: Record<string, string> = {};

  if (job.basicAuthCredentials) {
    const encoded = Buffer.from(
      `${job.basicAuthCredentials.username}:${job.basicAuthCredentials.password}`,
    ).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  }

  if (job.headerOverrides) {
    Object.assign(headers, job.headerOverrides);
  }

  return headers;
};

let cachedChromiumExecutablePath: string | null | undefined;
let cachedBrowserPromise: Promise<Browser> | null = null;
let cachedBrowserInstance: Browser | null = null;

const resolveChromiumExecutablePath = async (): Promise<string | null> => {
  if (cachedChromiumExecutablePath !== undefined) {
    return cachedChromiumExecutablePath;
  }

  const env = getEnv();
  if (env.CHROMIUM_BINARY) {
    cachedChromiumExecutablePath = env.CHROMIUM_BINARY;
    return cachedChromiumExecutablePath;
  }

  // @sparticuz/chromium only ships Linux binaries. Fall back to the
  // Playwright-installed Chromium on non-Linux platforms.
  if (process.platform !== "linux") {
    cachedChromiumExecutablePath = null;
    return null;
  }

  const executablePath = await chromium.executablePath();
  if (!executablePath) {
    throw new Error(
      "Unable to resolve Chromium binary path from @sparticuz/chromium",
    );
  }

  cachedChromiumExecutablePath = executablePath;
  return executablePath;
};

/**
 * Launch a Chromium browser suited for the current environment.
 *
 * The serverless runtime penalises per-request cold starts, so we launch once
 * and reuse the instance via {@link getBrowser}. On disconnect we drop the
 * cached promise so future calls can recreate the browser.
 */
const launchBrowser = async (): Promise<Browser> => {
  const executablePath = await resolveChromiumExecutablePath();
  const launchOptions: Parameters<typeof playwrightChromium.launch>[0] = {
    headless: true,
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
    launchOptions.args = chromium.args;
  }

  const browserInstance = await playwrightChromium.launch(launchOptions);
  cachedBrowserInstance = browserInstance;
  browserInstance.on("disconnected", () => {
    cachedBrowserPromise = null;
    cachedBrowserInstance = null;
  });

  return browserInstance;
};

/**
 * Lazily retrieve a shared Chromium browser instance.
 *
 * Reusing the browser across jobs within the same invocation avoids
 * multi-second startup costs and helps stay within execution ceilings.
 * The promise guards against concurrent launch calls while still
 * surfacing the original error when Chromium fails to start.
 */
const getBrowser = async (): Promise<Browser> => {
  if (!cachedBrowserPromise) {
    cachedBrowserPromise = launchBrowser().catch((error) => {
      cachedBrowserPromise = null;
      throw error;
    });
  }

  return cachedBrowserPromise;
};

interface EvaluatedMetadata {
  description?: string | null;
  keywords?: string | null;
  author?: string | null;
  canonicalUrl?: string | null;
  sameOriginLinks: string[];
}

const collectMetadata = async (page: Page): Promise<EvaluatedMetadata | undefined> => {
  try {
    return await page.evaluate(() => {
      const getMetaContent = (selector: string) =>
        document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? undefined;

      const description =
        getMetaContent('meta[name="description"]')
        ?? getMetaContent('meta[property="og:description"]');

      const keywords = getMetaContent('meta[name="keywords"]');
      const author =
        getMetaContent('meta[name="author"]')
        ?? getMetaContent('meta[property="article:author"]');

      const canonicalRaw = document
        .querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href?.trim();

      const canonicalUrl = (() => {
        if (!canonicalRaw) return undefined;
        try {
          const resolved = new URL(canonicalRaw, window.location.href);
          resolved.hash = '';
          return resolved.href;
        }
        catch {
          return undefined;
        }
      })();

      const sameOriginLinks: string[] = [];
      const seen = new Set<string>();

      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) return;

        try {
          const resolved = new URL(href, window.location.href);
          if (!['http:', 'https:'].includes(resolved.protocol)) return;
          if (resolved.origin !== window.location.origin) return;
          resolved.hash = '';
          const normalized = resolved.href;
          if (seen.has(normalized)) return;
          seen.add(normalized);
          sameOriginLinks.push(normalized);
        }
        catch {
          // Ignore malformed links
        }
      });

      return {
        description,
        keywords,
        author,
        canonicalUrl,
        sameOriginLinks,
      } satisfies EvaluatedMetadata;
    });
  }
  catch (error) {
    logger.debug("Metadata extraction failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

const mapErrorToPageError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (/timeout/i.test(message)) {
    return "Timed out while loading the page";
  }

  if (/net::ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return "DNS resolution failed for the requested host";
  }

  if (/net::ERR_CONNECTION/i.test(message)) {
    return "Connection error encountered while fetching the page";
  }

  return message;
};

/**
 * Execute a single scrape job and return either a success payload or a
 * structured failure.
 *
 * The function favours early exits and progressive streaming so consumers can
 * render progress in real time. It deliberately avoids closing the shared
 * browser, only disposing per-job contexts/pages.
 */
export const runScrapeJob = async (
  job: ScrapeJob,
  jobId: string,
  position: {
    index: number;
    total: number;
    targetUrl: string;
  },
  reportPhase?: (phase: ScrapePhase) => Promise<void> | void,
): Promise<ScrapeSuccess | ScrapeFailure> => {
  logger.info("Starting scrape job", {
    targetUrl: job.targetUrl,
    jobId,
    platform: process.platform,
    vercel: process.env.VERCEL,
    vercelRegion: process.env.VERCEL_REGION,
  });

  let scrapedPage: ScrapedPage | null = null;

  const notifyPhase = async (phase: ScrapePhase) => {
    if (!reportPhase) {
      return;
    }

    try {
      await reportPhase(phase);
    } catch (error) {
      logger.debug("Failed to report phase", {
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const loadStrategy: LoadStrategy = job.waitForSelector
    ? "wait-for-selector"
    : "load-event";
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  let finishedAtIso = startedAtIso;
  let durationMs = 0;
  let httpStatusCode: number | undefined;
  let failurePageError: string | null = null;

  try {
    const targetUrl = new URL(job.targetUrl);
    if (isBlockedExtension(targetUrl)) {
      throw new Error(`Disallowed file extension: ${targetUrl.pathname}`);
    }

    // Create browser context with proxy if configured
    const browser = await getBrowser();
    const contextOptions = buildContextOptions(job);
    context = await browser.newContext(contextOptions);

    // Set up request interception for ads and analytics
    await context.route("**/*", (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const resourceType = request.resourceType();

      if (isBlockedDomain(url.hostname)) {
        return route.abort();
      }

      // Skip certain resource types
      if (shouldSkipResourceType(resourceType)) {
        return route.abort();
      }

      if (isBlockedExtension(url)) {
        return route.abort();
      }

      return route.continue();
    });

    // Create page
    page = await context.newPage();
    page.setDefaultTimeout(job.timeoutMs);

    // Set headers
    const extraHeaders = buildExtraHeaders(job);
    if (Object.keys(extraHeaders).length > 0) {
      await page.setExtraHTTPHeaders(extraHeaders);
    }

    // Navigate to the page
    logger.info("Navigating to URL", { url: job.targetUrl, jobId });
    await notifyPhase("navigating");
    const response = await page.goto(job.targetUrl, {
      waitUntil: "load",
      timeout: job.timeoutMs,
    });
    httpStatusCode = response?.status();

    const readinessTimeout = Math.min(job.timeoutMs, 10_000);

    // Waiting for <body> and a network-idle window gives most SPAs enough time
    // to populate content while still respecting the caller's timeout budget.
    try {
      await page.waitForSelector("body", { timeout: readinessTimeout });
    } catch (error) {
      logger.info("Timed out waiting for <body> during scrape", {
        jobId,
        targetUrl: job.targetUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: readinessTimeout });
    } catch (error) {
      logger.info("Timed out waiting for network idle during scrape", {
        jobId,
        targetUrl: job.targetUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // Wait for selector if specified
    if (job.waitForSelector) {
      await page.waitForSelector(job.waitForSelector, {
        timeout: job.timeoutMs,
      });
    }

    await notifyPhase("capturing");

    // Get page content
    let payloadBody: string;
    let payloadContentType: string | undefined;

    if (job.captureTextOnly) {
      payloadBody = await page.evaluate(() => document.body?.innerText ?? "");
    } else if (response) {
      const headers = response.headers();
      payloadContentType = headers["content-type"];

      if (
        payloadContentType &&
        /application\/(json|ld\+json)|text\/(plain|csv)/i.test(
          payloadContentType,
        )
      ) {
        const buffer = await response.body();
        payloadBody = buffer ? buffer.toString("utf-8") : "";
      } else {
        payloadBody = await page.content();
      }
    } else {
      payloadBody = await page.content();
    }

    // Create scraped page result
    finishedAtIso = new Date().toISOString();
    durationMs = Date.now() - startedAtMs;

    const evaluatedMetadata = await collectMetadata(page);

    const keywordList = evaluatedMetadata?.keywords
      ?.split(",")
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);

    scrapedPage = {
      url: job.targetUrl,
      title: await page.title(),
      content: payloadBody,
      contentType: payloadContentType ?? "text/html",
      bytes: Buffer.byteLength(payloadBody, "utf8"),
      httpStatusCode,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      durationMs,
      loadStrategy,
      metadata: evaluatedMetadata
        ? {
            description: evaluatedMetadata.description ?? undefined,
            author: evaluatedMetadata.author ?? undefined,
            canonicalUrl: evaluatedMetadata.canonicalUrl ?? undefined,
            keywords: keywordList && keywordList.length > 0 ? keywordList : undefined,
            sameOriginLinks: evaluatedMetadata.sameOriginLinks ?? [],
          }
        : undefined,
    };

    logger.info("Scrape job completed successfully", {
      url: job.targetUrl,
      jobId,
      bytes: scrapedPage.bytes,
      status: scrapedPage.httpStatusCode,
      durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishedAtIso = new Date().toISOString();
    durationMs = Date.now() - startedAtMs;
    failurePageError = mapErrorToPageError(error);
    logger.error("Scrape job failed", {
      targetUrl: job.targetUrl,
      message,
      jobId,
      durationMs,
    });
  } finally {
    // Clean up resources
    if (page) {
      try {
        await page.close();
      } catch (e) {
        logger.warn("Failed to close page", { error: String(e), jobId });
      }
    }

    if (context) {
      try {
        await context.close();
      } catch (e) {
        logger.warn("Failed to close context", { error: String(e), jobId });
      }
    }
  }

  if (scrapedPage) {
    const successEnvelope: ScrapeSuccess = {
      status: "success",
      jobId,
      index: position.index,
      total: position.total,
      targetUrl: position.targetUrl,
      phase: "completed",
      data: {
        page: scrapedPage,
      },
    };
    return successEnvelope;
  }

  const fallbackMessage =
    failurePageError ?? "Scrape job completed without a payload";

  const failureMeta: ScrapeFailureMeta = {
    targetUrl: job.targetUrl,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs,
    loadStrategy,
  };

  const errorDetail: ScrapeErrorDetail = {
    targetUrl: job.targetUrl,
    message: mapErrorToPageError(fallbackMessage),
    httpStatusCode,
    meta: failureMeta,
  };

  const failureEnvelope: ScrapeFailure = {
    status: "fail",
    jobId,
    index: position.index,
    total: position.total,
    targetUrl: position.targetUrl,
    phase: "completed",
    errors: [errorDetail],
  };

  return failureEnvelope;
};

/**
 * Lightweight readiness probe that proves Chromium, context creation, and
 * basic navigation still work in the current environment.
 */
export const verifyChromiumLaunch = async () => {
  const env = getEnv();
  const healthcheckUrl = env.SCRAPER_HEALTHCHECK_URL ?? "https://example.com/";
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const timeoutMs = 5_000;
    const response = await page.goto(healthcheckUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (!response) {
      throw new Error("Healthcheck navigation did not return a response");
    }

    const status = response.status();
    if (status >= 400) {
      throw new Error(
        `Healthcheck navigation responded with status ${status} for ${healthcheckUrl}`,
      );
    }

    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  } finally {
    try {
      await page.close();
    } finally {
      await context.close();
    }
  }
};

/**
 * Close the shared Chromium browser if one is active.
 */
export const closeSharedBrowser = async () => {
  const browser = cachedBrowserInstance;
  cachedBrowserInstance = null;
  cachedBrowserPromise = null;

  if (!browser) return;

  try {
    await browser.close();
  } catch (error) {
    logger.warn("Failed to close shared browser", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
