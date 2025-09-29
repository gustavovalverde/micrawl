import { logger } from "../../logger.js";
import { getEnv } from "../../config/index.js";
import type { ScrapeDriver } from "../../types/scrape-driver.js";
import type { ScrapeJob, ScrapeDriverName } from "../../types/scrape.js";
import { httpDriver } from "./http.js";
import { playwrightDriver } from "./playwright.js";

const DRIVER_MAP: Record<Exclude<ScrapeDriverName, "auto">, ScrapeDriver> = {
  playwright: playwrightDriver,
  http: httpDriver,
};

const chooseAutoDriver = (job: ScrapeJob): Exclude<ScrapeDriverName, "auto"> => {
  if (job.waitForSelector) {
    return "playwright";
  }

  const domSensitive =
    Boolean(job.viewport) ||
    Boolean(job.locale) ||
    Boolean(job.timezoneId) ||
    !job.captureTextOnly;

  if (!domSensitive) {
    return "http";
  }

  return "playwright";
};

export const resolveDriverName = (job: ScrapeJob): Exclude<ScrapeDriverName, "auto"> => {
  const requested = job.driver ?? getEnv().SCRAPER_DEFAULT_DRIVER;
  if (requested === "auto") {
    return chooseAutoDriver(job);
  }
  return requested;
};

export const resolveDriver = (job: ScrapeJob): ScrapeDriver => {
  const name = resolveDriverName(job);
  const driver = DRIVER_MAP[name];

  if (!driver) {
    logger.warn("Unknown driver requested; falling back to Playwright", {
      requested: job.driver,
    });
    return playwrightDriver;
  }

  return driver;
};
