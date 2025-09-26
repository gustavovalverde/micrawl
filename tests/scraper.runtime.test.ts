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
    const { launchMock, browser } = setupScraperMocks();
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
    expect(result.errors[0]?.message).toContain("Disallowed file extension");
    expect(launchMock).not.toHaveBeenCalled();
  });
});
