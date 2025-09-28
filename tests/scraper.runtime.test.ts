import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setupScraperMocks = () => {
  const page = {
    setDefaultTimeout: vi.fn(),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({
      status: () => 200,
      headers: () => ({ "content-type": "text/html" }),
      body: async () => Buffer.from("<html></html>", "utf8"),
    }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue("Example content"),
    content: vi.fn().mockResolvedValue("<html></html>"),
    title: vi.fn().mockResolvedValue("Example"),
    close: vi.fn().mockResolvedValue(undefined),
  } as const;

  const context = {
    route: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  } as const;

  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as const;

  const launchMock = vi.fn().mockResolvedValue(browser);

  vi.doMock("playwright-core", () => ({
    chromium: { launch: launchMock },
  }));

  vi.doMock("@sparticuz/chromium", () => ({
    default: {
      args: ["--single-process"],
      executablePath: vi.fn().mockResolvedValue(null),
    },
  }));

  return { launchMock, browser, context, page };
};

const resetMocks = () => {
  vi.doUnmock("playwright-core");
  vi.doUnmock("@sparticuz/chromium");
};

describe("runScrapeJob runtime behaviour", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMocks();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reuses the launched browser across jobs", async () => {
    const { launchMock, browser, page } = setupScraperMocks();
    const { runScrapeJob } = await import("../src/scraper.js");

    const baseJob = {
      targetUrl: "https://example.com",
      captureTextOnly: true,
      timeoutMs: 5_000,
    };

    const first = await runScrapeJob(baseJob, "job-1", {
      index: 1,
      total: 1,
      targetUrl: baseJob.targetUrl,
    });

    const second = await runScrapeJob(baseJob, "job-2", {
      index: 1,
      total: 1,
      targetUrl: baseJob.targetUrl,
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(page.waitForSelector).toHaveBeenCalledWith("body", expect.any(Object));
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", expect.any(Object));
  });

  it("fails fast for disallowed file extensions", async () => {
    const { launchMock } = setupScraperMocks();
    const { runScrapeJob } = await import("../src/scraper.js");

    const job = {
      targetUrl: "https://example.com/report.pdf",
      captureTextOnly: true,
      timeoutMs: 5_000,
    };

    const result = await runScrapeJob(job, "job-blocked", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("fail");
    if (result.status !== "fail") {
      throw new Error("Expected failure envelope for disallowed extension");
    }
    expect(result.errors[0]?.message).toContain("Disallowed file extension");
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("navigates during health verification", async () => {
    const { browser, context, page } = setupScraperMocks();
    const { verifyChromiumLaunch } = await import("../src/scraper.js");

    await verifyChromiumLaunch();

    expect(browser.newContext).toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "domcontentloaded",
      timeout: 5_000,
    });
    expect(page.waitForLoadState).toHaveBeenCalledWith("domcontentloaded", {
      timeout: 5_000,
    });
    expect(page.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it("generates markdown content when requested", async () => {
    const { page } = setupScraperMocks();
    const { runScrapeJob } = await import("../src/scraper.js");

    page.content.mockResolvedValueOnce(
      "<html><head><title>Hello Page</title></head><body><h1>Hello</h1><p>World.</p></body></html>",
    );

    const job = {
      targetUrl: "https://example.com",
      captureTextOnly: false,
      timeoutMs: 5_000,
      outputFormats: ["markdown" as const],
    };

    const result = await runScrapeJob(job, "job-markdown", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    const contents = result.data.page.contents;
    expect(contents).toHaveLength(1);
    const markdownEntry = contents[0];
    expect(markdownEntry.format).toBe("markdown");
    expect(markdownEntry.contentType).toBe("text/markdown");
    expect(markdownEntry.body).toContain("# Hello");
    expect(markdownEntry.body).toContain("World.");
    expect(markdownEntry.body).not.toContain("<h1>");
  });
});
