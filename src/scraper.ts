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
import type {
  LoadStrategy,
  ScrapedPage,
  ScrapeErrorDetail,
  ScrapeFailure,
  ScrapeFailureMeta,
  ScrapeJob,
  ScrapeSuccess,
} from "./types/scrape.js";

const DISALLOWED_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".mp4",
  ".mp3",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

const ANALYTICS_AND_AD_DOMAINS = [
  ".doubleclick.",
  ".google-analytics.",
  ".googletagmanager.",
  ".googlesyndication.",
  ".googletagservices.",
  ".adservice.",
  ".adnxs.",
  ".ads-twitter.",
  ".facebook.",
  ".clarity.",
  ".nr-data.",
  ".bing.",
  ".amazon-adsystem.",
];

const RESOURCE_TYPES_TO_SKIP = new Set([
  "image",
  "media",
  "font",
  "stylesheet",
]);

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

let cachedChromiumExecutablePath: string | null | undefined = undefined;

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

export const runScrapeJob = async (
  job: ScrapeJob,
  jobId: string,
  position: {
    index: number;
    total: number;
    targetUrl: string;
  },
): Promise<ScrapeSuccess | ScrapeFailure> => {
  logger.info("Starting scrape job", {
    targetUrl: job.targetUrl,
    jobId,
    platform: process.platform,
    vercel: process.env.VERCEL,
    vercelRegion: process.env.VERCEL_REGION,
  });

  let scrapedPage: ScrapedPage | null = null;

  let browser: Browser | null = null;
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
    // Check if the URL has a disallowed extension
    const extension = new URL(job.targetUrl).pathname
      .split(".")
      .pop()
      ?.toLowerCase();
    if (extension && DISALLOWED_FILE_EXTENSIONS.has(`.${extension}`)) {
      throw new Error(`Disallowed file extension: ${extension}`);
    }

    // Get Chromium executable path from @sparticuz/chromium
    const executablePath = await resolveChromiumExecutablePath();

    const launchOptions: Parameters<typeof playwrightChromium.launch>[0] = {
      headless: true,
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
      launchOptions.args = chromium.args;
    }

    browser = await playwrightChromium.launch(launchOptions);

    // Create browser context with proxy if configured
    const contextOptions = buildContextOptions(job);
    context = await browser.newContext(contextOptions);

    // Set up request interception for ads and analytics
    await context.route("**/*", (route: Route) => {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();

      // Block analytics and ad domains
      if (ANALYTICS_AND_AD_DOMAINS.some((domain) => url.includes(domain))) {
        return route.abort();
      }

      // Skip certain resource types
      if (RESOURCE_TYPES_TO_SKIP.has(resourceType)) {
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
    const response = await page.goto(job.targetUrl, {
      waitUntil: "load",
      timeout: job.timeoutMs,
    });
    httpStatusCode = response?.status();

    // Wait for selector if specified
    if (job.waitForSelector) {
      await page.waitForSelector(job.waitForSelector, {
        timeout: job.timeoutMs,
      });
    }

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

    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        logger.warn("Failed to close browser", { error: String(e), jobId });
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
    errors: [errorDetail],
  };

  return failureEnvelope;
};

export const verifyChromiumLaunch = async () => {
  const executablePath = await resolveChromiumExecutablePath();

  const launchOptions: Parameters<typeof playwrightChromium.launch>[0] = {
    headless: true,
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
    launchOptions.args = chromium.args;
  }

  const browser = await playwrightChromium.launch(launchOptions);

  const page = await browser.newPage();
  await page.goto("about:blank");
  await page.close();
  await browser.close();
};
