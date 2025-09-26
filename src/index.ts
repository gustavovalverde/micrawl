import { Hono } from "hono";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes.js";

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

export default app;
