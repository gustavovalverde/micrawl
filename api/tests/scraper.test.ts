import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeJob, ScrapeFailure, ScrapeSuccess } from "@micrawl/core/types";

const originalEnv = { ...process.env };

const withEnv = async () => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SCRAPER_DEFAULT_LOCALE = "en-US";
  process.env.SCRAPER_DEFAULT_TIMEZONE = "America/New_York";
  process.env.SCRAPER_DEFAULT_VIEWPORT_WIDTH = "1920";
  process.env.SCRAPER_DEFAULT_VIEWPORT_HEIGHT = "1080";
  process.env.SCRAPER_DEFAULT_USER_AGENT = "TestUA/1.0";
  process.env.SCRAPER_DEFAULT_DRIVER = "playwright";
  return import("../src/scraper.js");
};

const baseJob: ScrapeJob = {
  targetUrl: "https://example.com",
  captureTextOnly: true,
  timeoutMs: 1000,
};

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildContextOptions", () => {
  it("uses environment defaults when job omits overrides", async () => {
    const { buildContextOptions } = await withEnv();

    const options = buildContextOptions(baseJob);

    expect(options.locale).toBe("en-US");
    expect(options.timezoneId).toBe("America/New_York");
    expect(options.viewport).toEqual({ width: 1920, height: 1080 });
    expect(options.userAgent).toBe("TestUA/1.0");
  });

  it("prefers job overrides when provided", async () => {
    const { buildContextOptions } = await withEnv();

    const options = buildContextOptions({
      ...baseJob,
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: { width: 1366, height: 768 },
      userAgent: "CustomUA/2.0",
    });

    expect(options.locale).toBe("en-GB");
    expect(options.timezoneId).toBe("Europe/London");
    expect(options.viewport).toEqual({ width: 1366, height: 768 });
    expect(options.userAgent).toBe("CustomUA/2.0");
  });

  it("attaches proxy when outboundProxyUrl is present", async () => {
    const { buildContextOptions } = await withEnv();

    const options = buildContextOptions({
      ...baseJob,
      outboundProxyUrl: "http://proxy:8080",
    });

    expect(options.proxy).toEqual({ server: "http://proxy:8080" });
  });
});

describe("buildExtraHeaders", () => {
  it("builds basic auth header when credentials exist", async () => {
    const { buildExtraHeaders } = await withEnv();

    const headers = buildExtraHeaders({
      ...baseJob,
      basicAuthCredentials: { username: "alice", password: "secret" },
      headerOverrides: { "x-tenant": "acme" },
    });

    expect(headers.Authorization).toBe("Basic YWxpY2U6c2VjcmV0");
    expect(headers["x-tenant"]).toBe("acme");
  });

  it("returns empty object when no overrides apply", async () => {
    const { buildExtraHeaders } = await withEnv();

    const headers = buildExtraHeaders(baseJob);

    expect(headers).toEqual({});
  });
});


describe("playwrightDriver", () => {
  it("exposes the Playwright driver for reuse", async () => {
    const { playwrightDriver, runPlaywrightScrape, verifyChromiumLaunch, closeSharedBrowser } = await withEnv();

    expect(playwrightDriver.name).toBe("playwright");
    expect(playwrightDriver.run).toBe(runPlaywrightScrape);
    expect(playwrightDriver.verify).toBe(verifyChromiumLaunch);
    expect(playwrightDriver.close).toBe(closeSharedBrowser);
  });
});

describe("runScrapeJob", () => {
  it("delegates to the HTTP driver when requested", async () => {
    const { runScrapeJob, httpDriver } = await withEnv();

    const success: ScrapeSuccess = {
      status: "success",
      jobId: "job-1",
      index: 1,
      total: 1,
      targetUrl: "https://example.com",
      phase: "completed",
      data: {
        page: {
          url: "https://example.com",
          title: "Example",
          httpStatusCode: 200,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
          loadStrategy: "load-event",
          contents: [],
        },
      },
    };

    const spy = vi
      .spyOn(httpDriver, "run")
      .mockResolvedValue(success);

    const job: ScrapeJob = {
      targetUrl: "https://example.com",
      captureTextOnly: true,
      timeoutMs: 5000,
      driver: "http",
    };

    const result = await runScrapeJob(job, "job-1", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ ...success, driver: "http" });
    spy.mockRestore();
  });

  it("falls back to Playwright when driver is omitted", async () => {
    const { runScrapeJob, playwrightDriver } = await withEnv();

    const failure: ScrapeFailure = {
      status: "fail",
      jobId: "job-2",
      index: 1,
      total: 1,
      targetUrl: "https://example.com",
      phase: "completed",
      errors: [
        {
          targetUrl: "https://example.com",
          message: "boom",
          rawMessage: "boom",
          meta: {
            targetUrl: "https://example.com",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 1,
            loadStrategy: "load-event",
          },
        },
      ],
    };

    const spy = vi
      .spyOn(playwrightDriver, "run")
      .mockResolvedValue(failure);

    const job: ScrapeJob = {
      targetUrl: "https://example.com",
      captureTextOnly: true,
      timeoutMs: 5000,
    };

    const result = await runScrapeJob(job, "job-2", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ ...failure, driver: "playwright" });
    spy.mockRestore();
  });
});

describe("resolveDriverName", () => {
  it("chooses http for auto captureTextOnly jobs", async () => {
    const { resolveDriverName } = await withEnv();
    const result = resolveDriverName({
      ...baseJob,
      captureTextOnly: true,
      timeoutMs: 5000,
      driver: "auto",
    });
    expect(result).toBe("http");
  });

  it("chooses playwright when waitForSelector is provided", async () => {
    const { resolveDriverName } = await withEnv();
    const result = resolveDriverName({
      ...baseJob,
      captureTextOnly: true,
      waitForSelector: "#main",
      timeoutMs: 5000,
      driver: "auto",
    });
    expect(result).toBe("playwright");
  });

  it("chooses playwright when captureTextOnly is false", async () => {
    const { resolveDriverName } = await withEnv();
    const result = resolveDriverName({
      ...baseJob,
      captureTextOnly: false,
      timeoutMs: 5000,
      driver: "auto",
    });
    expect(result).toBe("playwright");
  });
});


describe("resolveDriverName default", () => {
  it("uses SCRAPER_DEFAULT_DRIVER when driver hint is omitted", async () => {
    await withEnv();
    process.env.SCRAPER_DEFAULT_DRIVER = "http";
    vi.resetModules();
    const { resolveDriverName: resolveWithHttp } = await import("../src/scraper.js");
    expect(resolveWithHttp({ ...baseJob, driver: undefined })).toBe("http");
  });
});
