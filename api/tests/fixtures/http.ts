import type { ScrapeJob } from "@micrawl/core/types";

export const SIMPLE_HTML = `<!doctype html><html><head><title>Example</title><meta name="description" content="Demo page"><link rel="canonical" href="/home" /></head><body><h1>Hello</h1><a href="/about">About</a></body></html>`;
export const TEXT_ONLY_HTML = `<!doctype html><html><body><h1>Hello</h1><p>World</p></body></html>`;
export const BASIC_HTML = `<!doctype html><html><body>hi</body></html>`;

export const buildHtmlResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
    ...init,
  });

export const createHttpJob = (overrides: Partial<ScrapeJob> = {}): ScrapeJob => ({
  targetUrl: "https://example.com",
  captureTextOnly: true,
  timeoutMs: 5_000,
  ...overrides,
});
