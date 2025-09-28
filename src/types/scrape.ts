export type LoadStrategy = "load-event" | "wait-for-selector";

export type ScrapePhase = "queued" | "navigating" | "capturing" | "completed";

export type ContentFormat = "html" | "markdown";

export interface ScrapeJob {
  targetUrl: string;
  waitForSelector?: string;
  captureTextOnly: boolean;
  timeoutMs: number;
  basicAuthCredentials?: {
    username: string;
    password: string;
  };
  locale?: string;
  timezoneId?: string;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  outboundProxyUrl?: string;
  headerOverrides?: Record<string, string>;
  outputFormats?: ContentFormat[];
}

export interface ScrapedPage {
  url: string;
  title: string | null;
  httpStatusCode?: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  loadStrategy: LoadStrategy;
  contents: ScrapedContent[];
  metadata?: ScrapedMetadata;
}

export interface ScrapedMetadata {
  description?: string;
  keywords?: string[];
  author?: string;
  canonicalUrl?: string;
  sameOriginLinks: string[];
}

export interface ScrapedContent {
  format: ContentFormat;
  contentType: string;
  body: string;
  bytes: number;
}

export interface ScrapeFailureMeta {
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  loadStrategy: LoadStrategy;
}

export interface ScrapeErrorDetail {
  targetUrl: string;
  message: string;
  rawMessage?: string;
  httpStatusCode?: number;
  meta?: ScrapeFailureMeta;
}

export interface ScrapeRecordBase {
  status: "success" | "fail" | "error" | "progress";
  targetUrl?: string;
  jobId: string;
  index: number;
  total: number;
  phase?: ScrapePhase;
  progress?: {
    completed: number;
    remaining: number;
    succeeded: number;
    failed: number;
  };
}

export interface ScrapeProgressUpdate extends ScrapeRecordBase {
  status: "progress";
  phase: Exclude<ScrapePhase, "completed">;
}

export interface ScrapeSuccess extends ScrapeRecordBase {
  status: "success";
  data: {
    page: ScrapedPage;
  };
}

export interface ScrapeFailure extends ScrapeRecordBase {
  status: "fail";
  errors: ScrapeErrorDetail[];
}

export interface ScrapeError extends ScrapeRecordBase {
  status: "error";
  message: string;
  rawMessage?: string;
}

export interface ScrapeSummary extends ScrapeRecordBase {
  status: "success";
  summary: {
    succeeded: number;
    failed: number;
    failures: ScrapeErrorDetail[];
  };
}

export type ScrapeStreamMessage =
  | ScrapeProgressUpdate
  | ScrapeSuccess
  | ScrapeFailure
  | ScrapeError
  | ScrapeSummary;
