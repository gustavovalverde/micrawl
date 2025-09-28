import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

const runE2E = process.env.RUN_E2E === "true";
const e2eDescribe = runE2E ? describe : describe.skip;

/**
 * True E2E tests - no mocks, testing the complete system
 * These tests will actually launch a browser and scrape real pages
 *
 * Enable via `pnpm test:e2e` which sets RUN_E2E=true.
 */

e2eDescribe("E2E: /scrape route with real browser", () => {
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

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    const result = lines.find(
      (line: any) => line.status === "success" && line.data?.page,
    );
    expect(result).toBeDefined();
    expect(result!.targetUrl).toBe("https://example.com");
    expect(result!.data.page.httpStatusCode).toBeGreaterThanOrEqual(200);
    expect(result!.data.page.contents[0]?.body ?? "").toContain("Example Domain");

    const summary = lines.find((line: any) => line.summary)!;
    expect(summary.status).toBe("success");
    expect(summary.summary.succeeded).toBe(1);
    expect(summary.summary.failed).toBe(0);
    expect(summary.progress.succeeded).toBe(1);
  }, 60000); // Allow plenty of time for remote site

  it("handles 404 pages correctly", async () => {
    const res = await client.scrape.$post({
      json: {
        urls: ["https://example.com/404"],
        captureTextOnly: true,
      },
    });

    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    const firstResult = lines.find(
      (line: any) => line.status === "success" && line.data?.page,
    );
    expect(firstResult).toBeDefined();
    expect(firstResult!.targetUrl).toBe("https://example.com/404");
    expect(firstResult!.data.page.httpStatusCode).toBeGreaterThanOrEqual(400);
  }, 30000);

  it("scrapes multiple real URLs in batch", async () => {
    const res = await client.scrape.$post({
      json: {
        urls: ["https://example.com", "https://example.com/robots.txt"],
        captureTextOnly: true,
      },
    });

    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    // Should have 2 results + 1 summary
    expect(lines).toHaveLength(3);

    // Verify both URLs were scraped
    const successLines = lines.filter((line: any) => line.status === "success");
    expect(successLines.length).toBeGreaterThanOrEqual(2);
    expect(successLines[0].targetUrl).toBe("https://example.com");
    expect(successLines[1].targetUrl).toBe("https://example.com/robots.txt");

    const batchSummary = lines.find((line: any) => line.summary)!;
    expect(batchSummary.progress.completed).toBeGreaterThanOrEqual(2);

    // Check summary
    expect(lines[2].summary.succeeded + lines[2].summary.failed).toBe(2);
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

    const text = await res.text();
    const lines = text
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    // Should fail to connect
    const firstLine = lines.find((line: any) => line.status !== "progress");
    expect(firstLine?.status).not.toBe("success");
  }, 10000);
});

e2eDescribe("E2E: /health route with real browser check", () => {
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
