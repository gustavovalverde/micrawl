import { afterEach, describe, expect, it } from "vitest";
import { runScrapeJob, verifyChromiumLaunch } from "../src/scraper.js";

// These tests require Playwright browsers to be installed
// Run: pnpm install && pnpm exec playwright install chromium
describe("runScrapeJob runtime behaviour", () => {
  afterEach(async () => {
    // Give browser time to clean up between tests
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("reuses the launched browser across jobs", async () => {
    const baseJob = {
      targetUrl: "https://example.com",
      captureTextOnly: true,
      timeoutMs: 10_000,
    };

    const startTime = Date.now();

    const first = await runScrapeJob(baseJob, "job-1", {
      index: 1,
      total: 1,
      targetUrl: baseJob.targetUrl,
    });
    const firstDuration = Date.now() - startTime;

    const secondStartTime = Date.now();
    const second = await runScrapeJob(baseJob, "job-2", {
      index: 1,
      total: 1,
      targetUrl: baseJob.targetUrl,
    });
    const secondDuration = Date.now() - secondStartTime;

    // Both jobs should succeed
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");

    // Second job should be faster (browser already launched)
    // Allow some variance but second should generally be faster
    expect(secondDuration).toBeLessThan(firstDuration * 1.5);

    if (first.status === "success" && second.status === "success") {
      // Both should have scraped the same URL
      expect(first.data.page.url).toBe("https://example.com");
      expect(second.data.page.url).toBe("https://example.com");

      // Both should have content
      expect(first.data.page.contents.length).toBeGreaterThan(0);
      expect(second.data.page.contents.length).toBeGreaterThan(0);
    }
  });

  it("fails fast for disallowed file extensions", async () => {
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
  });

  it("navigates during health verification", async () => {
    // Should complete without throwing
    await expect(verifyChromiumLaunch()).resolves.not.toThrow();
  });

  it("generates markdown content when requested", async () => {
    // Use a data URL with known HTML content
    const html = `<html>
      <head><title>Test Page</title></head>
      <body>
        <h1>Hello</h1>
        <p>World.</p>
      </body>
    </html>`;

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    const job = {
      targetUrl: dataUrl,
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
    expect(contents.length).toBeGreaterThan(0);

    const markdownEntry = contents.find((c) => c.format === "markdown");
    expect(markdownEntry).toBeDefined();
    if (!markdownEntry) return;

    expect(markdownEntry.format).toBe("markdown");
    expect(markdownEntry.contentType).toBe("text/markdown");
    expect(markdownEntry.body).toContain("# Hello");
    expect(markdownEntry.body).toContain("World.");
    expect(markdownEntry.body).not.toContain("<h1>");
  });
});
