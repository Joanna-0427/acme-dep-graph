import { readFileSync } from "fs";
import type { RawTool } from "./types.ts";

export function slugOf(tool: RawTool): string | undefined {
  const slug = tool.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

export function parseCatalog(data: unknown): RawTool[] {
  const raw = Array.isArray(data)
    ? data
    : ((data as { tools?: unknown; items?: unknown } | null)?.tools ??
      (data as { items?: unknown } | null)?.items ??
      []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RawTool[] = [];
  for (const tool of raw) {
    const slug = slugOf(tool);
    if (!slug) continue;
    if (seen.has(slug)) {
      console.warn(`duplicate slug ${slug}, keeping first`);
      continue;
    }
    seen.add(slug);
    out.push(tool);
  }
  return out;
}

export function loadCatalogFromPath(path: string): RawTool[] {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return parseCatalog(data);
}
