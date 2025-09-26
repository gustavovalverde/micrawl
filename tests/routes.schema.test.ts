import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const loadSchema = async () => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SCRAPER_TEXT_ONLY_DEFAULT = "true";
  process.env.SCRAPER_DEFAULT_TIMEOUT_MS = "45000";
  process.env.SCRAPER_MAX_URLS_PER_REQUEST = "5";
  process.env.SCRAPER_DEFAULT_LOCALE = "en-US";
  process.env.SCRAPER_DEFAULT_TIMEZONE = "America/New_York";
  return import("../src/routes.js");
};

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("scrapeRequestSchema", () => {
  it("applies default flags and lowercases header keys", async () => {
    const { scrapeRequestSchema } = await loadSchema();

    const result = scrapeRequestSchema.parse({
      urls: ["https://example.com"],
      headers: { "X-Custom": "Value" },
    });

    expect(result.captureTextOnly).toBe(true);
    expect(result.timeoutMs).toBe(45000);
    expect(result.headers).toEqual({ "x-custom": "Value" });
  });

  it("accepts overrides for locale, timezone, viewport, and userAgent", async () => {
    const { scrapeRequestSchema } = await loadSchema();

    const result = scrapeRequestSchema.parse({
      urls: ["https://example.com"],
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: { width: 1366, height: 768 },
      userAgent: "CustomUA",
    });

    expect(result.locale).toBe("en-GB");
    expect(result.timezoneId).toBe("Europe/London");
    expect(result.viewport).toEqual({ width: 1366, height: 768 });
    expect(result.userAgent).toBe("CustomUA");
  });

  it("enforces URL batch limits", async () => {
    const { scrapeRequestSchema } = await loadSchema();

    const parse = () =>
      scrapeRequestSchema.parse({
        urls: new Array(6).fill("https://example.com"),
      });

    expect(parse).toThrowError(/Batch limited to 5 URLs/);
  });
});
