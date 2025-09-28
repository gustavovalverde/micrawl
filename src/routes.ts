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
  ScrapePhase,
  ScrapeProgressUpdate,
  ScrapeSummary,
} from "./types/scrape.js";

const runtimeConfig = getEnv();

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

const normalizeTargetUrls = (
  urls: string[],
  ctx: z.RefinementCtx,
): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  urls.forEach((rawUrl, index) => {
    let parsed: URL;

    try {
      parsed = new URL(rawUrl);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid URL: ${rawUrl}`,
        path: ["urls", index],
      });
      return;
    }

    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported URL protocol: ${parsed.protocol}`,
        path: ["urls", index],
      });
      return;
    }

    parsed.hash = "";

    if (parsed.pathname !== "/") {
      const trimmedPath = parsed.pathname.replace(/\/+$/, "");
      parsed.pathname = trimmedPath === "" ? "/" : trimmedPath;
    }

    if (parsed.search) {
      parsed.searchParams.sort();
      parsed.search = parsed.searchParams.toString()
        ? `?${parsed.searchParams.toString()}`
        : "";
    }

    const canonical = parsed.toString();

    if (seen.has(canonical)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate target URL detected: ${canonical}`,
        path: ["urls", index],
      });
      return;
    }

    seen.add(canonical);
    normalized.push(canonical);
  });

  return normalized;
};

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

/**
 * Shape of the `/scrape` payload. Defaults favour the lightweight development
 * experience described in `README.md` and keep validation alongside the route
 * so future additions only touch this file.
 */
export const scrapeRequestSchema = z
  .object({
    urls: z
      .array(z.string().url())
      .min(1, "Provide at least one URL to scrape.")
      .max(
        runtimeConfig.SCRAPER_MAX_URLS_PER_REQUEST,
        `Batch limited to ${runtimeConfig.SCRAPER_MAX_URLS_PER_REQUEST} URLs per request.`,
      )
      .transform((value, ctx) => normalizeTargetUrls(value, ctx)),
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

/**
 * Register health and scrape routes on the provided Hono app. The streaming
 * handler emits one JSON line per job so clients can update progress bars
 * without buffering server-side summary work.
 */
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
        // We keep validation errors close to the route so the API returns a
        // compact payload instead of leaking Zod's verbose structure to
        // clients.
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

        for (const [jobIndex, job] of scrapeJobs.entries()) {
          const sequence = jobIndex + 1;
          const position = {
            index: sequence,
            total: totalJobs,
            targetUrl: job.targetUrl,
          } as const;

          const captureProgressSnapshot = (completedCount: number) => ({
            completed: completedCount,
            remaining: totalJobs - completedCount,
            succeeded: succeededCount,
            failed: failedCount,
          });

          const emitPhaseUpdate = async (
            phase: Exclude<ScrapePhase, "completed">,
            completedCount = sequence - 1,
          ) => {
            const snapshot = captureProgressSnapshot(completedCount);
            const payload: ScrapeProgressUpdate = {
              status: "progress",
              jobId,
              index: sequence,
              total: totalJobs,
              targetUrl: job.targetUrl,
              phase,
              progress: snapshot,
            };
            await stream.writeln(JSON.stringify(payload));
          };

          await emitPhaseUpdate("queued");

          try {
            const record = await runScrapeJob(
              job,
              jobId,
              position,
              async (phase) => {
                if (phase === "completed") return;
                await emitPhaseUpdate(phase);
              },
            );

            if (record.status === "success") {
              summary.succeeded += 1;
              succeededCount += 1;
            } else {
              summary.failed += 1;
              failedCount += 1;
              summary.failures.push(...record.errors);
            }

            const progress = {
              completed: sequence,
              remaining: totalJobs - sequence,
              succeeded: succeededCount,
              failed: failedCount,
            };

            await stream.writeln(
              JSON.stringify({
                ...record,
                progress,
                phase: "completed",
              }),
            );
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
            const progress = {
              completed: sequence,
              remaining: totalJobs - sequence,
              succeeded: succeededCount,
              failed: failedCount,
            };
            const payload: ScrapeError = {
              status: "error",
              jobId,
              index: sequence,
              total: totalJobs,
              targetUrl: job.targetUrl,
              message,
              progress,
              phase: "completed",
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
          phase: "completed",
        };

        // Emit the terminating summary so client loops know when to close down
        // their streaming readers without guessing.
        await stream.writeln(JSON.stringify(summaryRecord));
      });
    },
  );
};
