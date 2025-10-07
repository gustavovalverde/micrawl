import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`;
}

export async function getFileSize(filepath: string): Promise<number> {
  try {
    const stats = await stat(filepath);
    return stats.size;
  } catch {
    return 0;
  }
}

export function urlToFilename(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100)
    .toLowerCase();
}

export function getOrganizedPath(
  url: string,
  baseDir: string,
): { dir: string; filename: string } {
  const urlObj = new URL(url);
  const domain = urlObj.hostname.replace(/^www\./, "");
  const filename = urlToFilename(url);

  return {
    dir: join(baseDir, domain),
    filename: filename.endsWith(".md") ? filename : `${filename}.md`,
  };
}

export interface SaveResult {
  filepath: string;
  existed: boolean;
  size: number;
}

export async function saveMarkdown(
  outDir: string,
  filename: string,
  content: string,
): Promise<SaveResult> {
  await mkdir(outDir, { recursive: true });

  const filepath = join(
    outDir,
    filename.endsWith(".md") ? filename : `${filename}.md`,
  );

  // Check if file already exists
  let existed = false;
  try {
    await stat(filepath);
    existed = true;
  } catch {
    // File doesn't exist, which is fine
  }

  await writeFile(filepath, content, "utf8");

  const finalStats = await stat(filepath);

  return {
    filepath,
    existed,
    size: finalStats.size,
  };
}

export function withFrontmatter(
  markdown: string,
  metadata: {
    url: string;
    title: string;
    scrapedAt: string;
    depth?: number;
  },
): string {
  const stringify = (value: string): string => JSON.stringify(value);

  const frontmatter = [
    "---",
    `url: ${stringify(metadata.url)}`,
    `title: ${stringify(metadata.title)}`,
    `scraped_at: ${stringify(metadata.scrapedAt)}`,
    ...(metadata.depth !== undefined ? [`depth: ${metadata.depth}`] : []),
    "---",
    "",
  ].join("\n");

  return frontmatter + markdown;
}

export async function saveScrapeResult(
  result: { url: string; title: string; markdown: string },
  outDir: string,
  options: {
    filename?: string;
    frontMatter?: boolean;
    depth?: number;
    organizeByDomain?: boolean;
  } = {},
): Promise<SaveResult> {
  let dir = outDir;
  let fname = options.filename || urlToFilename(result.url);

  // Organize by domain if requested
  if (options.organizeByDomain) {
    const organized = getOrganizedPath(result.url, outDir);
    dir = organized.dir;
    fname = organized.filename.replace(/\.md$/, ""); // Remove .md as saveMarkdown adds it
  }

  const content = options.frontMatter
    ? withFrontmatter(result.markdown, {
        url: result.url,
        title: result.title,
        scrapedAt: new Date().toISOString(),
        ...(options.depth !== undefined && { depth: options.depth }),
      })
    : result.markdown;

  return saveMarkdown(dir, fname, content);
}
