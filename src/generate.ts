/**
 * Generator entrypoint. Read a toolkit catalog, infer its dependencies, write a graph.
 *
 * How we run it:
 *   - The path to a toolkit's catalog JSON is passed as a CLI ARGUMENT, e.g.
 *     `node --import tsx src/generate.ts path/to/catalog.json`. We append it as the last
 *     argument, so reading the last argv entry works whatever else your command carries.
 *   - Write your graph to `dependency_graph.json` in the working directory.
 *   - For LLM access, the OpenAI SDK reads OPENAI_API_KEY / OPENAI_BASE_URL from the
 *     environment (set from your assessment page's AI credentials; the same are provided
 *     when we run your generator). Use an OpenRouter model id such as `openai/gpt-4o`.
 */
import { writeFileSync } from "fs";
import { pathToFileURL } from "url";
import { loadCatalogFromPath } from "./catalog.ts";
import { loadEnv } from "./env.ts";
import { normalizeTools } from "./extract.ts";
import { llmFillIn } from "./llm.ts";
import { heuristicEdges, lookupFallbackEdges, rankAndCap } from "./match.ts";
import type { Graph, GraphEdge, RawTool } from "./types.ts";
import { renderGraphHtml } from "./visualize.ts";

const OUT_PATH = "dependency_graph.json";

function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

export async function generate(
  tools: RawTool[],
  options?: { llm?: boolean },
): Promise<Graph> {
  const normalized = normalizeTools(tools);
  const nodes = normalized.map((t) =>
    t.service ? { id: t.slug, service: t.service } : { id: t.slug },
  );
  const heuristic = rankAndCap(heuristicEdges(normalized), normalized);
  const lookup = lookupFallbackEdges(normalized, heuristic);
  const base = uniqueEdges([...heuristic, ...lookup]);
  let llm: GraphEdge[] = [];
  if (options?.llm !== false) {
    llm = await llmFillIn(normalized, base);
  }
  return { nodes, edges: uniqueEdges([...base, ...llm]) };
}

async function main() {
  loadEnv();
  const catalogPath =
    process.argv.length > 2 ? process.argv[process.argv.length - 1] : undefined;
  if (!catalogPath) {
    throw new Error("pass the toolkit catalog path as the first argument");
  }
  const graph = await generate(loadCatalogFromPath(catalogPath));
  writeFileSync(OUT_PATH, JSON.stringify(graph, null, 2), "utf-8");
  writeFileSync("graph.html", renderGraphHtml(graph), "utf-8");
  console.error(
    `wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges to ${OUT_PATH}`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
