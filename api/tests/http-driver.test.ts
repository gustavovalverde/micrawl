import type { ScrapeJob } from "@micrawl/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHtmlResponse,
  createHttpJob,
  TEXT_ONLY_HTML,
} from "./fixtures/http.js";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const mutableGlobal = globalThis as typeof globalThis & {
  fetch?: typeof globalThis.fetch;
  AbortController: typeof globalThis.AbortController;
};

const loadDriver = async () => {
  vi.resetModules();
  process.env = { ...originalEnv };
  return import("../src/scraper.js");
};

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  if (originalFetch) {
    mutableGlobal.fetch = originalFetch;
  } else {
    delete mutableGlobal.fetch;
  }
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("httpDriver.run", () => {
  it("returns HTML and markdown content for simple pages", async () => {
    const html = `<!doctype html><html><head><title>Example</title><meta name="description" content="Demo page"><link rel="canonical" href="/home" /></head><body><h1>Hello</h1><a href="/about">About</a></body></html>`;
    const response = buildHtmlResponse(html);
    global.fetch = vi.fn().mockResolvedValue(response);

    const { httpDriver } = await loadDriver();
    const job: ScrapeJob = createHttpJob({
      targetUrl: "https://example.com/home",
      captureTextOnly: false,
      outputFormats: ["html", "markdown"],
    });

    const phaseSpy = vi.fn();
    const result = await httpDriver.run(
      job,
      "job-1",
      {
        index: 1,
        total: 1,
        targetUrl: job.targetUrl,
      },
      phaseSpy,
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error(`expected success, received ${result.status}`);
    }

    const page = result.data.page;
    const htmlContent = page.contents.find((item) => item.format === "html");
    const markdownContent = page.contents.find(
      (item) => item.format === "markdown",
    );

    expect(htmlContent).toBeDefined();
    expect(markdownContent).toBeDefined();
    expect(page.metadata?.canonicalUrl).toBe("https://example.com/home");
    expect(page.metadata?.sameOriginLinks).toContain(
      "https://example.com/about",
    );

    const phases = phaseSpy.mock.calls.map(([phase]) => phase);
    expect(phases).toEqual(["navigating", "capturing"]);
  });

  it("strips markup when captureTextOnly is true", async () => {
    global.fetch = vi.fn().mockResolvedValue(buildHtmlResponse(TEXT_ONLY_HTML));

    const { httpDriver } = await loadDriver();
    const job: ScrapeJob = createHttpJob({
      targetUrl: "https://example.com/plain",
      captureTextOnly: true,
      outputFormats: ["html"],
    });

    const result = await httpDriver.run(job, "job-plain", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error(`expected success, received ${result.status}`);
    }
    const htmlContent = result.data.page.contents.find(
      (item) => item.format === "html",
    );
    expect(htmlContent?.body).toBe("Hello World");
  });

  it("returns failure when fetch responds with non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      buildHtmlResponse("boom", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { httpDriver } = await loadDriver();
    const job: ScrapeJob = createHttpJob({
      targetUrl: "https://example.com/fail",
      captureTextOnly: false,
    });

    const result = await httpDriver.run(job, "job-fail", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("fail");
    if (result.status !== "fail") {
      throw new Error(`expected failure, received ${result.status}`);
    }
    expect(result.errors[0].httpStatusCode).toBe(500);
  });

  it("returns failure when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network boom"));

    const { httpDriver } = await loadDriver();
    const job: ScrapeJob = createHttpJob({
      targetUrl: "https://example.com/error",
      captureTextOnly: false,
    });

    const result = await httpDriver.run(job, "job-error", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("fail");
    if (result.status !== "fail") {
      throw new Error(`expected failure, received ${result.status}`);
    }
    expect(result.errors[0].message).toContain("network boom");
  });

  it("sends basic auth and header overrides to fetch", async () => {
    const html = `<!doctype html><html><body>hi</body></html>`;
    const mockFetch = vi.fn().mockResolvedValue(buildHtmlResponse(html));
    global.fetch = mockFetch;

    const { httpDriver } = await loadDriver();
    const job: ScrapeJob = createHttpJob({
      targetUrl: "https://headers.example",
      captureTextOnly: false,
      basicAuthCredentials: { username: "alice", password: "s3cret" },
      headerOverrides: { "x-tenant": "acme" },
      userAgent: "CustomUA/1.0",
    });

    const result = await httpDriver.run(job, "job-headers", {
      index: 1,
      total: 1,
      targetUrl: job.targetUrl,
    });

    expect(result.status).toBe("success");
    const [, init] = mockFetch.mock.calls.at(0) ?? [];
    expect(init).toBeDefined();
    expect(init?.headers).toMatchObject({
      Authorization: "Basic YWxpY2U6czNjcmV0",
      "x-tenant": "acme",
      "user-agent": "CustomUA/1.0",
    });
  });

  it("aborts when the HTTP driver exceeds the timeout budget", async () => {
    vi.useFakeTimers();
    const originalAbortController = globalThis.AbortController;
    const abortSpy = vi.fn();
    const controllers: AbortController[] = [];

    class TestAbortController extends originalAbortController {
      constructor() {
        super();
        controllers.push(this);
      }

      abort(reason?: unknown) {
        abortSpy(reason);
        super.abort(reason);
      }
    }

    mutableGlobal.AbortController = TestAbortController;

    try {
      global.fetch = vi
        .fn()
        .mockImplementation((_url, init: RequestInit | undefined) => {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              const abortHandler = () => reject(new Error("aborted"));
              signal.addEventListener("abort", abortHandler, { once: true });
              if ("onabort" in signal) {
                const original = signal.onabort;
                signal.onabort = (...args: unknown[]) => {
                  abortHandler();
                  return original?.apply(signal, args as never);
                };
              }
            }
          });
        });

      const { httpDriver } = await loadDriver();
      const job: ScrapeJob = createHttpJob({
        targetUrl: "https://slow.example",
        captureTextOnly: false,
        timeoutMs: 100,
      });

      const runPromise = httpDriver.run(job, "job-timeout", {
        index: 1,
        total: 1,
        targetUrl: job.targetUrl,
      });

      await Promise.resolve();
      expect(controllers.length).toBeGreaterThan(0);

      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      const result = await runPromise;

      expect(abortSpy).toHaveBeenCalled();
      expect(result.status).toBe("fail");
      if (result.status !== "fail") {
        throw new Error(`expected failure, received ${result.status}`);
      }
      expect(result.errors[0].message.toLowerCase()).toContain("aborted");
    } finally {
      mutableGlobal.AbortController = originalAbortController;
      vi.useRealTimers();
    }
  });
});

describe("verifyHttpDriver", () => {
  it("throws when healthcheck is not ok", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        buildHtmlResponse("", { status: 502, statusText: "Bad Gateway" }),
      );

    const { verifyHttpDriver } = await loadDriver();

    await expect(verifyHttpDriver()).rejects.toThrow(/502/);
  });
});
