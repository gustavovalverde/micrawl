export const DISALLOWED_FILE_EXTENSIONS = new Set<string>([
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".mp4",
  ".mp3",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

export const ANALYTICS_AND_AD_DOMAINS = [
  ".doubleclick.",
  ".google-analytics.",
  ".googletagmanager.",
  ".googlesyndication.",
  ".googletagservices.",
  ".adservice.",
  ".adnxs.",
  ".ads-twitter.",
  ".facebook.",
  ".clarity.",
  ".nr-data.",
  ".bing.",
  ".amazon-adsystem.",
];

/**
 * Resource types that don’t materially affect scraping results but consume
 * bandwidth/time. Keeping them in a shared set allows routing logic and tests
 * to stay in sync.
 */
const RESOURCE_TYPES_TO_SKIP = new Set<string>([
  "image",
  "media",
  "font",
  "stylesheet",
]);

/**
 * Return true when the URL’s extension is in the block list. We parse once and
 * share the logic across initial target validation and request interception.
 */
export const isBlockedExtension = (url: URL): boolean => {
  const pathname = url.pathname;
  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }

  const extension = pathname.slice(dotIndex).toLowerCase();
  return DISALLOWED_FILE_EXTENSIONS.has(extension);
};

/**
 * Return true when the hostname matches any of the analytics/ads fragments we
 * strip out to keep pages leaner and faster.
 */
export const isBlockedDomain = (hostname: string): boolean =>
  ANALYTICS_AND_AD_DOMAINS.some((pattern) => hostname.includes(pattern));

/**
 * Mirror the extension/domain helpers with a resource-type predicate so callers
 * don’t switch mental models when filtering requests.
 */
export const shouldSkipResourceType = (resourceType: string): boolean =>
  RESOURCE_TYPES_TO_SKIP.has(resourceType.toLowerCase());
