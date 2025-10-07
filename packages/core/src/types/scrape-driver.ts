import type {
  ScrapeFailure,
  ScrapeJob,
  ScrapePhase,
  ScrapeSuccess,
} from "./scrape.js";

export interface ScrapeDriverPosition {
  index: number;
  total: number;
  targetUrl: string;
}

export type ScrapeDriverResult = ScrapeSuccess | ScrapeFailure;

export type ScrapeDriverPhaseEmitter = (
  phase: Exclude<ScrapePhase, "completed">,
) => Promise<void> | void;

export interface ScrapeDriver {
  /**
   * Canonical identifier for the driver (e.g., "playwright", "http").
   */
  readonly name: string;
  run(
    job: ScrapeJob,
    jobId: string,
    position: ScrapeDriverPosition,
    emitPhase?: ScrapeDriverPhaseEmitter,
  ): Promise<ScrapeDriverResult>;
  verify?: () => Promise<void>;
  close?: () => Promise<void>;
}
