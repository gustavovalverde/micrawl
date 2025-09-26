import { describe, expect, it } from "vitest";
import {
  isBlockedDomain,
  isBlockedExtension,
  shouldSkipResourceType,
} from "../src/scraper-filters.js";

describe("scraper filters", () => {
  it("flags disallowed file extensions", () => {
    expect(isBlockedExtension(new URL("https://site.example/report.pdf"))).toBe(true);
    expect(isBlockedExtension(new URL("https://site.example/index.html"))).toBe(false);
  });

  it("identifies analytics/ad domains", () => {
    expect(isBlockedDomain("stats.google-analytics.com")).toBe(true);
    expect(isBlockedDomain("cdn.example.com")).toBe(false);
  });

  it("skips heavy resource types", () => {
    expect(shouldSkipResourceType("image")).toBe(true);
    expect(shouldSkipResourceType("document")).toBe(false);
  });
});
