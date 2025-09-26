import { testClient } from "hono/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the scraper module with functions directly in the factory
vi.mock("../src/scraper.js", () => ({
  runScrapeJob: vi.fn(),
  verifyChromiumLaunch: vi.fn(),
  buildContextOptions: vi.fn(),
  buildExtraHeaders: vi.fn(),
  closeSharedBrowser: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import { createApp } from "../src/index.js";
import { runScrapeJob, verifyChromiumLaunch } from "../src/scraper.js";

// Type the mocked functions
const runScrapeJobMock = vi.mocked(runScrapeJob);
const verifyChromiumLaunchMock = vi.mocked(verifyChromiumLaunch);

describe("/scrape route", () => {
  let client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const app = createApp();
    client = testClient(app);
  });

  it("streams successful job data and summary", async () => {
    runScrapeJobMock.mockImplementationOnce(async (_job, jobId, meta) => ({
      status: "success",
      jobId,
      index: meta.index,
      total: meta.total,
      targetUrl: meta.targetUrl,
      data: {
        page: {
          url: "https://example.com",
          title: "Example",
          content: "<html></html>",
          contentType: "text/html",
          bytes: 10,
          httpStatusCode: 200,
          startedAt: "2025-09-26T00:00:00.000Z",
          finishedAt: "2025-09-26T00:00:01.000Z",
          durationMs: 1000,
          loadStrategy: "load-event",
        },
      },
    }));

    const res = await client.scrape.$post({
      json: { urls: ["https://example.com"] },
    });

    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    const first = lines[0];
    expect(first.status).toBe("success");
    expect(first.jobId).toBeDefined();
    expect(first.index).toBe(1);
    expect(first.total).toBe(1);
    expect(first.targetUrl).toBe("https://example.com");
    expect(first.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 1,
      failed: 0,
    });
    expect(first.data.page.content).toBe("<html></html>");
    const summary = lines[1];
    expect(summary.status).toBe("success");
    expect(summary.index).toBe(2);
    expect(summary.total).toBe(1);
    expect(summary.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 1,
      failed: 0,
    });
    expect(summary.summary).toMatchObject({
      succeeded: 1,
      failed: 0,
    });
    expect(runScrapeJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUrl: "https://example.com" }),
      expect.any(String),
      expect.objectContaining({
        targetUrl: "https://example.com",
        index: 1,
        total: 1,
      }),
    );
  });

  it("emits failure payload when runScrapeJob throws", async () => {
    runScrapeJobMock.mockRejectedValueOnce(new Error("boom"));

    const res = await client.scrape.$post({
      json: { urls: ["https://bad.example"] },
    });

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    expect(lines[0].status).toBe("error");
    expect(lines[0].targetUrl).toBe("https://bad.example");
    expect(lines[0].message).toContain("boom");
    expect(lines[0].progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 0,
      failed: 1,
    });
    expect(lines[1].summary.failed).toBe(1);
  });

  it("streams fail record when scraper reports handled failure", async () => {
    runScrapeJobMock.mockImplementationOnce(async (_job, jobId, context) => ({
      status: "fail",
      jobId,
      index: context.index,
      total: context.total,
      targetUrl: context.targetUrl,
      errors: [
        {
          targetUrl: "https://broken.example",
          message: "Timed out while loading the page",
          httpStatusCode: 504,
        },
      ],
    }));

    const res = await client.scrape.$post({
      json: { urls: ["https://broken.example"] },
    });

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    const first = lines[0];
    expect(first.status).toBe("fail");
    expect(first.errors[0].message).toContain("Timed out");
    expect(first.errors[0].httpStatusCode).toBe(504);
    expect(first.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 0,
      failed: 1,
    });
    const summary = lines[1];
    expect(summary.summary.failed).toBe(1);
    expect(summary.summary.failures[0].targetUrl).toBe(
      "https://broken.example",
    );
  });

  it("validates request payload", async () => {
    const res = await client.scrape.$post({
      json: { urls: [] }, // Invalid: empty array
    });

    expect(res.status).toBe(400);
    const error = await res.json();
    expect(error.ok).toBe(false);
    expect(error.error).toBe("Invalid request payload");
  });

  it("handles multiple URLs in batch", async () => {
    runScrapeJobMock
      .mockImplementationOnce(async (_job, jobId, context) => ({
        status: "success",
        jobId,
        index: context.index,
        total: context.total,
        targetUrl: context.targetUrl,
        data: {
          page: {
            url: "https://example1.com",
            title: "Example 1",
            content: "<html></html>",
            contentType: "text/html",
            bytes: 10,
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
          },
        },
      }))
      .mockImplementationOnce(async (_job, jobId, context) => ({
        status: "success",
        jobId,
        index: context.index,
        total: context.total,
        targetUrl: context.targetUrl,
        data: {
          page: {
            url: "https://example2.com",
            title: "Example 2",
            content: "<html></html>",
            contentType: "text/html",
            bytes: 20,
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
          },
        },
      }));

    const res = await client.scrape.$post({
      json: { urls: ["https://example1.com", "https://example2.com"] },
    });

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    expect(lines).toHaveLength(3); // 2 results + 1 summary
    expect(lines[0].targetUrl).toBe("https://example1.com");
    expect(lines[1].targetUrl).toBe("https://example2.com");
    expect(lines[2].progress).toMatchObject({
      completed: 2,
      remaining: 0,
      succeeded: 2,
      failed: 0,
    });
    expect(lines[2].index).toBe(3);
  });
});

describe("/health route", () => {
  let client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const app = createApp();
    client = testClient(app);
  });

  it("returns healthy when verify succeeds", async () => {
    verifyChromiumLaunchMock.mockResolvedValueOnce(undefined);

    const res = await client.health.$get({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "healthy" });
  });

  it("returns unhealthy when verify fails", async () => {
    verifyChromiumLaunchMock.mockRejectedValueOnce(new Error("chrome down"));

    const res = await client.health.$get({});

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "unhealthy" });
  });
});
