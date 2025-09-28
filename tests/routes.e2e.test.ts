import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";
import type {
  ScrapeStreamMessage,
  ScrapeSuccess,
  ScrapeSummary,
} from "../src/types/scrape.js";

const runE2E = process.env.RUN_E2E === "true";
const e2eDescribe = runE2E ? describe : describe.skip;

const parseStreamLines = (raw: string): ScrapeStreamMessage[] =>
  raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as ScrapeStreamMessage);

/**
 * True E2E tests - no mocks, testing the complete system
 * These tests will actually launch a browser and scrape real pages
 *
 * Enable via `pnpm test:e2e` which sets RUN_E2E=true.
 */

e2eDescribe("E2E: /scrape route with real browser", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test client type is dynamic
  let client: any; // Type inference doesn't work well with testClient in tests

  beforeAll(() => {
    const app = createApp();
    client = testClient(app);
  });

  it("scrapes a real webpage (httpbin.org)", async () => {
    // Using example.com as it's simple HTML
    const res = await client.scrape.$post({
      json: {
        urls: ["https://example.com"],
        captureTextOnly: false,
      },
    });

    expect(res.status).toBe(200);

    const lines = parseStreamLines(await res.text());

    const result = lines.find(
      (line): line is ScrapeSuccess =>
        line.status === "success" && "data" in line,
    );
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.targetUrl).toBe("https://example.com");
    expect(result.data.page.httpStatusCode).toBeGreaterThanOrEqual(200);
    expect(result.data.page.contents[0]?.body ?? "").toContain(
      "Example Domain",
    );

    const summary = lines.find(
      (line): line is ScrapeSummary =>
        line.status === "success" && "summary" in line,
    );
    expect(summary).toBeDefined();
    if (!summary) return;
    expect(summary.status).toBe("success");
    expect(summary.summary.succeeded).toBe(1);
    expect(summary.summary.failed).toBe(0);
    expect(summary.progress?.succeeded).toBe(1);
  }, 60000); // Allow plenty of time for remote site

  it("handles 404 pages correctly", async () => {
    const res = await client.scrape.$post({
      json: {
        urls: ["https://example.com/404"],
        captureTextOnly: true,
      },
    });

    expect(res.status).toBe(200);

    const lines = parseStreamLines(await res.text());

    const firstResult = lines.find(
      (line): line is ScrapeSuccess =>
        line.status === "success" && "data" in line,
    );
    expect(firstResult).toBeDefined();
    if (!firstResult) return;
    expect(firstResult.targetUrl).toBe("https://example.com/404");
    expect(firstResult.data.page.httpStatusCode).toBeGreaterThanOrEqual(400);
  }, 30000);

  it("scrapes multiple real URLs in batch", async () => {
    const res = await client.scrape.$post({
      json: {
        urls: ["https://example.com", "https://example.com/robots.txt"],
        captureTextOnly: true,
      },
    });

    expect(res.status).toBe(200);

    const lines = parseStreamLines(await res.text());

    expect(lines.length).toBeGreaterThanOrEqual(3);

    const successLines = lines.filter(
      (line): line is ScrapeSuccess =>
        line.status === "success" && "data" in line,
    );
    expect(successLines.length).toBeGreaterThanOrEqual(2);
    expect(successLines[0].targetUrl).toBe("https://example.com");
    expect(successLines[1].targetUrl).toBe("https://example.com/robots.txt");

    const batchSummary = lines.find(
      (line): line is ScrapeSummary =>
        line.status === "success" && "summary" in line,
    );
    expect(batchSummary).toBeDefined();
    if (!batchSummary) return;
    expect(batchSummary.progress?.completed).toBeGreaterThanOrEqual(2);
    expect(batchSummary.summary.succeeded + batchSummary.summary.failed).toBe(
      2,
    );
  }, 60000); // Even longer timeout for multiple pages

  it("respects timeout settings", async () => {
    // Using a non-routable IP to force a timeout
    const res = await client.scrape.$post({
      json: {
        urls: ["https://10.255.255.1"],
        timeoutMs: 3000, // 3 second timeout
      },
    });

    expect(res.status).toBe(200);

    const lines = parseStreamLines(await res.text());

    const firstLine = lines.find((line) => line.status !== "progress");
    expect(firstLine?.status).not.toBe("success");
  }, 10000);
});

e2eDescribe("E2E: /health route with real browser check", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test client type is dynamic
  let client: any; // Type inference doesn't work well with testClient in tests

  beforeAll(() => {
    const app = createApp();
    client = testClient(app);
  });

  it("health check verifies real browser availability", async () => {
    const res = await client.health.$get({});

    const body = await res.json();

    if (res.status === 200) {
      expect(body).toEqual({ status: "healthy" });
    } else {
      expect(res.status).toBe(503);
      expect(body.status).toBe("unhealthy");
      expect(String(body.error ?? "").toLowerCase()).toContain("browser");
    }
  }, 15000); // Browser launch can take time
});

/**
 * Note: These E2E tests require:
 * 1. Chromium/Chrome to be installed (via playwright install)
 * 2. Network access to the public internet (example.com)
 * 3. More time to run (hence the extended timeouts)
 *
 * In CI/CD, you might want to:
 * - Run these separately from unit/integration tests
 * - Use a local test server instead of httpbin.org
 * - Add retry logic for flaky network tests
 */
