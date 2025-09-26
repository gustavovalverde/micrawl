import { isProduction } from "./env.js";

type Level = "debug" | "info" | "warn" | "error";

type Payload = Record<string, unknown> | undefined;

const context = isProduction() ? "production" : "development";

const log = (level: Level, message: string, payload?: Payload) => {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
    ...(payload ?? {}),
  };

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else if (level === "info") {
    console.info(entry);
  } else {
    console.debug(entry);
  }
};

export const logger = {
  debug: (message: string, payload?: Payload) => log("debug", message, payload),
  info: (message: string, payload?: Payload) => log("info", message, payload),
  warn: (message: string, payload?: Payload) => log("warn", message, payload),
  error: (message: string, payload?: Payload) => log("error", message, payload),
};
