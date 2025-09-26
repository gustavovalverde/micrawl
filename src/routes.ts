import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";
import { runScrapeJob, verifyChromiumLaunch } from "./scraper.js";
import type {
  ScrapeError,
  ScrapeErrorDetail,
  ScrapeJob,
  ScrapeSummary,
} from "./types/scrape.js";

const runtimeConfig = getEnv();

export const headerOverridesSchema = z
  .record(z.string().trim(), z.string().trim())
  .catch({})
  .transform((headers) => {
    const entries = Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]);
    return entries.length ? Object.fromEntries(entries) : undefined;
  });

const viewportSchema = z
  .object({
    width: z.coerce.number().int().min(320).max(4096),
    height: z.coerce.number().int().min(320).max(4096),
  })
  .optional();

export const scrapeRequestSchema = z
  .object({
    urls: z
      .array(z.string().url())
      .min(1, "Provide at least one URL to scrape.")
      .max(
        runtimeConfig.SCRAPER_MAX_URLS_PER_REQUEST,
        `Batch limited to ${runtimeConfig.SCRAPER_MAX_URLS_PER_REQUEST} URLs per request.`,
      ),
    mode: z.enum(["sync", "async"]).catch("sync"),
    captureTextOnly: z.boolean().catch(runtimeConfig.SCRAPER_TEXT_ONLY_DEFAULT),
    waitForSelector: z.string().trim().min(1).optional(),
    timeoutMs: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .catch(runtimeConfig.SCRAPER_DEFAULT_TIMEOUT_MS),
    basicAuth: z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .optional(),
    locale: z.string().trim().min(2).optional(),
    timezoneId: z.string().trim().min(1).optional(),
    viewport: viewportSchema,
    userAgent: z.string().trim().min(1).optional(),
    proxyUrl: z.string().url().optional(),
    headers: headerOverridesSchema,
  })
  .strict();

export const buildScrapeJob = (
  request: z.infer<typeof scrapeRequestSchema>,
  targetUrl: string,
): ScrapeJob => ({
  targetUrl,
  waitForSelector: request.waitForSelector,
  captureTextOnly: request.captureTextOnly,
  timeoutMs: request.timeoutMs,
  basicAuthCredentials: request.basicAuth,
  locale: request.locale,
  timezoneId: request.timezoneId,
  viewport: request.viewport,
  userAgent: request.userAgent,
  outboundProxyUrl: request.proxyUrl,
  headerOverrides: request.headers,
});

export const registerRoutes = (app: Hono) => {
  app.get("/health", async (c) => {
    try {
      await verifyChromiumLaunch();
      return c.json({ status: "healthy" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Health check failed", { message });
      return c.json({ status: "unhealthy", error: message }, 503);
    }
  });

  app.post(
    "/scrape",
    zValidator("json", scrapeRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            ok: false,
            error: "Invalid request payload",
            details: result.error.flatten(),
          },
          400,
        );
      }
    }),
    async (c) => {
      const jobRequest = c.req.valid("json");

      if (jobRequest.mode === "async") {
        return c.json(
          {
            ok: false,
            error: 'Async mode is not yet available. Submit with mode="sync".',
          },
          501,
        );
      }

      const jobId = randomUUID();
      const scrapeJobs = jobRequest.urls.map((url) =>
        buildScrapeJob(jobRequest, url),
      );

      logger.info("Accepted scrape batch", {
        jobId,
        totalJobs: scrapeJobs.length,
        captureTextOnly: jobRequest.captureTextOnly,
      });

      return streamText(c, async (stream) => {
        const totalJobs = scrapeJobs.length;
        const summary = {
          succeeded: 0,
          failed: 0,
          failures: [] as ScrapeErrorDetail[],
        };

        let succeededCount = 0;
        let failedCount = 0;

        let sequence = 0;

        for (const job of scrapeJobs) {
          sequence += 1;
          try {
            const record = await runScrapeJob(job, jobId, {
              index: sequence,
              total: totalJobs,
              targetUrl: job.targetUrl,
            });

            if (record.status === "success") {
              summary.succeeded += 1;
              succeededCount += 1;
              const enriched = {
                ...record,
                progress: {
                  completed: sequence,
                  remaining: totalJobs - sequence,
                  succeeded: succeededCount,
                  failed: failedCount,
                },
              };
              await stream.writeln(JSON.stringify(enriched));
            } else {
              summary.failed += 1;
              failedCount += 1;
              summary.failures.push(...record.errors);
              const enriched = {
                ...record,
                progress: {
                  completed: sequence,
                  remaining: totalJobs - sequence,
                  succeeded: succeededCount,
                  failed: failedCount,
                },
              };
              await stream.writeln(JSON.stringify(enriched));
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            summary.failed += 1;
            failedCount += 1;
            summary.failures.push({
              targetUrl: job.targetUrl,
              message,
            });
            logger.error("Unexpected error while scraping target", {
              jobId,
              targetUrl: job.targetUrl,
              error: message,
            });
            const payload: ScrapeError = {
              status: "error",
              jobId,
              index: sequence,
              total: totalJobs,
              targetUrl: job.targetUrl,
              message,
              progress: {
                completed: sequence,
                remaining: totalJobs - sequence,
                succeeded: succeededCount,
                failed: failedCount,
              },
            };
            await stream.writeln(JSON.stringify(payload));
          }
        }

        logger.info("Completed scrape batch", {
          jobId,
          totalJobs,
          jobsSucceeded: summary.succeeded,
          jobsFailed: summary.failed,
        });

        const summaryRecord: ScrapeSummary = {
          status: "success",
          jobId,
          index: totalJobs + 1,
          total: totalJobs,
          progress: {
            completed: totalJobs,
            remaining: 0,
            succeeded: summary.succeeded,
            failed: summary.failed,
          },
          summary: {
            succeeded: summary.succeeded,
            failed: summary.failed,
            failures: summary.failures,
          },
        };

        await stream.writeln(JSON.stringify(summaryRecord));
      });
    },
  );
};
