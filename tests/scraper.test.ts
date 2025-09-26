import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeJob } from "../src/types/scrape.js";

const originalEnv = { ...process.env };

const withEnv = async () => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SCRAPER_DEFAULT_LOCALE = "en-US";
  process.env.SCRAPER_DEFAULT_TIMEZONE = "America/New_York";
  process.env.SCRAPER_DEFAULT_VIEWPORT_WIDTH = "1920";
  process.env.SCRAPER_DEFAULT_VIEWPORT_HEIGHT = "1080";
  process.env.SCRAPER_DEFAULT_USER_AGENT = "TestUA/1.0";
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
