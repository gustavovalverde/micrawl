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

const RESOURCE_TYPES_TO_SKIP = new Set<string>([
  "image",
  "media",
  "font",
  "stylesheet",
]);

export const isBlockedExtension = (url: URL): boolean => {
  const pathname = url.pathname;
  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }

  const extension = pathname.slice(dotIndex).toLowerCase();
  return DISALLOWED_FILE_EXTENSIONS.has(extension);
};

export const isBlockedDomain = (hostname: string): boolean =>
  ANALYTICS_AND_AD_DOMAINS.some((pattern) => hostname.includes(pattern));

export const shouldSkipResourceType = (resourceType: string): boolean =>
  RESOURCE_TYPES_TO_SKIP.has(resourceType);
