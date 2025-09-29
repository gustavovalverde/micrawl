import type { ScrapeDriverPhaseEmitter, ScrapeDriverPosition, ScrapeDriverResult } from "../../types/scrape-driver.js";
import type { ScrapeJob } from "../../types/scrape.js";
import { httpDriver, runHttpScrape, verifyHttpDriver } from "./http.js";
import {
  playwrightDriver,
  runPlaywrightScrape,
  verifyChromiumLaunch,
  closeSharedBrowser,
  buildContextOptions,
  buildExtraHeaders,
} from "./playwright.js";
import { resolveDriver, resolveDriverName } from "./dispatcher.js";

export const runScrapeJob = async (
  job: ScrapeJob,
  jobId: string,
  position: ScrapeDriverPosition,
  emitPhase?: ScrapeDriverPhaseEmitter,
): Promise<ScrapeDriverResult> => {
  const driver = resolveDriver(job);
  const driverName = resolveDriverName(job);
  const result = await driver.run(job, jobId, position, emitPhase);
  return { ...result, driver: driverName };
};

export { resolveDriver, resolveDriverName } from "./dispatcher.js";
export {
  playwrightDriver,
  runPlaywrightScrape,
  verifyChromiumLaunch,
  closeSharedBrowser,
  buildContextOptions,
  buildExtraHeaders,
} from "./playwright.js";
export { httpDriver, runHttpScrape, verifyHttpDriver };
