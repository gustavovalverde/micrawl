export type LoadStrategy = "load-event" | "wait-for-selector";

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
}

export interface ScrapedPage {
  url: string;
  title: string | null;
  content: string;
  contentType: string;
  bytes: number;
  httpStatusCode?: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  loadStrategy: LoadStrategy;
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
  httpStatusCode?: number;
  meta?: ScrapeFailureMeta;
}

export interface ScrapeRecordBase {
  status: "success" | "fail" | "error";
  targetUrl?: string;
  jobId: string;
  index: number;
  total: number;
  progress?: {
    completed: number;
    remaining: number;
    succeeded: number;
    failed: number;
  };
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
  | ScrapeSuccess
  | ScrapeFailure
  | ScrapeError
  | ScrapeSummary;
