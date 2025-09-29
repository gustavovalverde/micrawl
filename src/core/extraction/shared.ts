import type { ScrapeJob } from "../../types/scrape.js";

/**
 * Build per-request headers shared by HTTP and Playwright drivers. Basic auth
 * is encoded once and header overrides are applied case-insensitively.
 */
export const buildExtraHeaders = (job: ScrapeJob): Record<string, string> => {
  const headers: Record<string, string> = {};

  if (job.basicAuthCredentials) {
    const encoded = Buffer.from(
      `${job.basicAuthCredentials.username}:${job.basicAuthCredentials.password}`,
    ).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  }

  if (job.headerOverrides) {
    Object.assign(headers, job.headerOverrides);
  }

  return headers;
};
