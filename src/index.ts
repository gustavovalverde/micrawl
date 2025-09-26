import { Hono } from "hono";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes.js";
import { closeSharedBrowser } from "./scraper.js";

export const createApp = () => {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    await next();
    logger.info("Request completed", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      elapsedMs: Date.now() - startedAt,
    });
  });

  registerRoutes(app);

  app.get("/", (c) =>
    c.json({
      service: "micrawl scraper",
      docs: "POST /scrape to stream results, GET /health for readiness",
    }),
  );

  return app;
};

const app = createApp();

/**
 * Gracefully tear down shared resources on shutdown signals. Avoid calling
 * `process.exit` while running under Vitest so the test runner can complete.
 */
const handleShutdown = async (signal: NodeJS.Signals) => {
  logger.info("Received shutdown signal", { signal });
  await closeSharedBrowser();
  if (!process.env.VITEST) {
    process.exit(0);
  }
};

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);

export default app;
