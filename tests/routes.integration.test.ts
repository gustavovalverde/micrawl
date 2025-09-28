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
    runScrapeJobMock.mockImplementationOnce(async (_job, jobId, meta, reportPhase) => {
      await reportPhase?.("navigating");
      await reportPhase?.("capturing");

      return {
        status: "success",
        jobId,
        index: meta.index,
        total: meta.total,
        targetUrl: meta.targetUrl,
        data: {
          page: {
            url: "https://example.com",
            title: "Example",
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
            contents: [
              {
                format: "html",
                contentType: "text/html",
                body: "<html></html>",
                bytes: 10,
              },
            ],
            metadata: {
              description: "Example description",
              canonicalUrl: "https://example.com/",
              keywords: ["one", "two"],
              author: "Example Author",
              sameOriginLinks: ["https://example.com/about"],
            },
          },
        },
      };
    });

    const res = await client.scrape.$post({
      json: { urls: ["https://example.com"] },
    });

    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    expect(lines).toHaveLength(5);
    const progressEvents = lines.filter((line: any) => line.status === "progress");
    expect(progressEvents.map((event: any) => event.phase)).toEqual([
      "queued",
      "navigating",
      "capturing",
    ]);
    for (const event of progressEvents) {
      expect(event.progress).toMatchObject({
        completed: 0,
        remaining: 1,
        succeeded: 0,
        failed: 0,
      });
    }

    const result = lines.find(
      (line: any) => line.status === "success" && line.data?.page,
    )!;
    expect(result.jobId).toBeDefined();
    expect(result.index).toBe(1);
    expect(result.total).toBe(1);
    expect(result.targetUrl).toBe("https://example.com/");
    expect(result.phase).toBe("completed");
    expect(result.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 1,
      failed: 0,
    });
    expect(result.data.page.metadata).toEqual({
      description: "Example description",
      canonicalUrl: "https://example.com/",
      keywords: ["one", "two"],
      author: "Example Author",
      sameOriginLinks: ["https://example.com/about"],
    });
    expect(result.data.page.contents).toEqual([
      {
        format: "html",
        contentType: "text/html",
        body: "<html></html>",
        bytes: 10,
      },
    ]);
    const summary = lines.find((line: any) => line.summary)!;
    expect(summary.status).toBe("success");
    expect(summary.phase).toBe("completed");
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
      expect.objectContaining({
        targetUrl: "https://example.com/",
        outputFormats: ["html"],
      }),
      expect.any(String),
      expect.objectContaining({
        targetUrl: "https://example.com/",
        index: 1,
        total: 1,
      }),
      expect.any(Function),
    );
  });

  it("streams markdown payload when requested", async () => {
    runScrapeJobMock.mockImplementationOnce(async (job, jobId, meta, reportPhase) => {
      await reportPhase?.("navigating");
      await reportPhase?.("capturing");

      expect(job.outputFormats).toEqual(["markdown"]);
      expect(job.captureTextOnly).toBe(false);

      return {
        status: "success",
        jobId,
        index: meta.index,
        total: meta.total,
        targetUrl: meta.targetUrl,
        data: {
          page: {
            url: "https://example.com",
            title: "Example",
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
            contents: [
              {
                format: "markdown",
                contentType: "text/markdown",
                body: "# Heading\n",
                bytes: 11,
              },
            ],
          },
        },
      };
    });

    const res = await client.scrape.$post({
      json: { urls: ["https://example.com"], outputFormats: ["markdown"] },
    });

    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    const result = lines.find(
      (line: any) => line.status === "success" && line.data?.page,
    )!;

    expect(result.data.page.contents).toEqual([
      {
        format: "markdown",
        contentType: "text/markdown",
        body: "# Heading\n",
        bytes: 11,
      },
    ]);
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

    expect(lines).toHaveLength(3);
    const [queued, errorRecord, summary] = lines;

    expect(queued.status).toBe("progress");
    expect(queued.phase).toBe("queued");
    expect(queued.progress).toMatchObject({
      completed: 0,
      remaining: 1,
      succeeded: 0,
      failed: 0,
    });

    expect(errorRecord.status).toBe("error");
    expect(errorRecord.targetUrl).toBe("https://bad.example/");
    expect(errorRecord.message).toContain("boom");
    expect(errorRecord.phase).toBe("completed");
    expect(errorRecord.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 0,
      failed: 1,
    });

    expect(summary.summary.failed).toBe(1);
    expect(summary.phase).toBe("completed");
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

    expect(lines).toHaveLength(3);
    const [queued, failRecord, summary] = lines;

    expect(queued.status).toBe("progress");
    expect(queued.phase).toBe("queued");
    expect(queued.progress).toMatchObject({
      completed: 0,
      remaining: 1,
      succeeded: 0,
      failed: 0,
    });

    expect(failRecord.status).toBe("fail");
    expect(failRecord.phase).toBe("completed");
    expect(failRecord.errors[0].message).toContain("Timed out");
    expect(failRecord.errors[0].httpStatusCode).toBe(504);
    expect(failRecord.progress).toMatchObject({
      completed: 1,
      remaining: 0,
      succeeded: 0,
      failed: 1,
    });

    expect(summary.summary.failed).toBe(1);
    expect(summary.summary.failures[0].targetUrl).toBe(
      "https://broken.example",
    );
    expect(summary.phase).toBe("completed");
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
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
          contents: [
            {
              format: "html",
              contentType: "text/html",
              body: "<html></html>",
              bytes: 10,
            },
          ],
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
            httpStatusCode: 200,
            startedAt: "2025-09-26T00:00:00.000Z",
            finishedAt: "2025-09-26T00:00:01.000Z",
            durationMs: 1000,
            loadStrategy: "load-event",
            contents: [
              {
                format: "html",
                contentType: "text/html",
                body: "<html></html>",
                bytes: 20,
              },
            ],
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

    expect(lines).toHaveLength(5);

    const progressLines = lines.filter((line: any) => line.status === "progress");
    expect(progressLines).toHaveLength(2);
    expect(progressLines[0].phase).toBe("queued");
    expect(progressLines[1].phase).toBe("queued");

    const results = lines.filter(
      (line: any) => line.status === "success" && line.data?.page,
    );
    expect(results).toHaveLength(2);
    expect(results[0].targetUrl).toBe("https://example1.com/");
    expect(results[1].targetUrl).toBe("https://example2.com/");

    const summary = lines.find((line: any) => line.summary)!;
    expect(summary.progress).toMatchObject({
      completed: 2,
      remaining: 0,
      succeeded: 2,
      failed: 0,
    });
    expect(summary.index).toBe(3);
    expect(summary.phase).toBe("completed");
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
