export type UrlNormalizationIssue =
  | "invalid_url"
  | "unsupported_protocol"
  | "duplicate_url";

export class UrlNormalizationError extends Error {
  constructor(
    message: string,
    readonly issue: UrlNormalizationIssue,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "UrlNormalizationError";
  }
}

export const SUPPORTED_PROTOCOLS = new Set<string>(["http:", "https:"]);

const trimPathname = (pathname: string): string => {
  if (pathname === "/") return pathname;
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

export const canonicalizeUrl = (rawUrl: string): string => {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlNormalizationError(
      `Invalid URL: ${rawUrl}`,
      "invalid_url",
      rawUrl,
    );
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlNormalizationError(
      `Unsupported URL protocol: ${parsed.protocol}`,
      "unsupported_protocol",
      parsed.protocol,
    );
  }

  parsed.hash = "";
  parsed.pathname = trimPathname(parsed.pathname);

  if (parsed.searchParams.size > 0) {
    parsed.searchParams.sort();
    const sortedQuery = parsed.searchParams.toString();
    parsed.search = sortedQuery ? `?${sortedQuery}` : "";
  }

  return parsed.toString();
};

export const canonicalizeUrlList = (urls: readonly string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of urls) {
    const canonical = canonicalizeUrl(candidate);
    if (seen.has(canonical)) {
      throw new UrlNormalizationError(
        `Duplicate target URL detected: ${canonical}`,
        "duplicate_url",
        canonical,
      );
    }
    seen.add(canonical);
    normalized.push(canonical);
  }

  return normalized;
};
