import { z } from "zod";

/**
 * Accept common textual boolean representations so collaborators can set env
 * vars without memorising exact casing.
 */
const booleanLike = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => {
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off", ""].includes(value)) return false;
    throw new Error(`Invalid boolean string: ${value}`);
  });

const booleanFromEnv = z.boolean().or(booleanLike);

/**
 * Central definition of runtime settings. Defaults mirror the README examples
 * to minimise surprises when deploying to Vercel or running locally.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .catch("development"),
    SCRAPER_DEFAULT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .catch(45_000),
    SCRAPER_TEXT_ONLY_DEFAULT: booleanFromEnv.catch(true),
    SCRAPER_MAX_URLS_PER_REQUEST: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .catch(5),
    SCRAPER_DEFAULT_LOCALE: z.string().trim().min(2).catch("en-US"),
    SCRAPER_DEFAULT_TIMEZONE: z
      .string()
      .trim()
      .min(1)
      .catch("America/New_York"),
    SCRAPER_DEFAULT_VIEWPORT_WIDTH: z.coerce
      .number()
      .int()
      .min(320)
      .max(4096)
      .catch(1920),
    SCRAPER_DEFAULT_VIEWPORT_HEIGHT: z.coerce
      .number()
      .int()
      .min(320)
      .max(4096)
      .catch(1080),
    SCRAPER_DEFAULT_USER_AGENT: z.string().trim().min(1).optional(),
    CHROMIUM_BINARY: z.string().url().optional(),
  })
  .passthrough();

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export const getEnv = (): Env => {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
};

export const isProduction = () => getEnv().NODE_ENV === "production";
