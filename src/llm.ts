import {
  isIdentifierField,
  isUserProvided,
  resourceTypeOf,
} from "./classify.ts";
import type { Field, GraphEdge, NormalizedTool } from "./types.ts";

export type ChatComplete = (args: {
  system: string;
  user: string;
}) => Promise<string>;

function fieldType(tool: NormalizedTool, field: Field): string {
  return resourceTypeOf({
    fieldName: field.name,
    description: field.description,
    parentDefName: field.parentDefName,
    slug: tool.slug,
    service: tool.service,
  });
}

function unmatchedConsumers(
  tools: NormalizedTool[],
  existing: GraphEdge[],
): { tool: NormalizedTool; input: Field }[] {
  const covered = new Set(existing.map((e) => `${e.to}\0${e.label ?? ""}`));
  const out: { tool: NormalizedTool; input: Field }[] = [];
  for (const tool of tools) {
    for (const input of tool.requiredInputs) {
      if (isUserProvided(input.name)) continue;
      if (!isIdentifierField(input.name, input.description)) continue;
      if (covered.has(`${tool.slug}\0${input.name}`)) continue;
      out.push({ tool, input });
    }
  }
  return out;
}

function parseEdges(text: string): GraphEdge[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < 0) return [];
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  if (!Array.isArray(parsed)) return [];
  const edges: GraphEdge[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const from = String(row.from ?? "");
    const to = String(row.to ?? "");
    const label = String(row.label ?? "");
    if (!from || !to || !label) continue;
    edges.push({ from, to, label });
  }
  return edges;
}

export function validateLlmEdges(
  proposed: GraphEdge[],
  tools: NormalizedTool[],
): GraphEdge[] {
  const bySlug = new Map(tools.map((t) => [t.slug, t]));
  const kept: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const edge of proposed) {
    if (edge.from === edge.to) continue;
    const from = bySlug.get(edge.from);
    const to = bySlug.get(edge.to);
    if (!from || !to || !edge.label) continue;
    if (isUserProvided(edge.label)) continue;
    const input = to.requiredInputs.find((i) => i.name === edge.label);
    if (!input || !isIdentifierField(input.name, input.description)) continue;
    const consumerType = fieldType(to, input);
    const producerTypes = new Set(from.primaryOutputs.map((o) => fieldType(from, o)));
    if (producerTypes.size && !producerTypes.has(consumerType)) continue;
    const key = `${edge.from}\0${edge.to}\0${edge.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(edge);
  }
  return kept;
}

async function defaultComplete(args: {
  system: string;
  user: string;
}): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "openai/gpt-4o",
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: 0,
  });
  return res.choices[0]?.message?.content ?? "[]";
}

function summarize(tool: NormalizedTool): object {
  return {
    slug: tool.slug,
    service: tool.service,
    required_ids: tool.requiredInputs
      .filter((i) => !isUserProvided(i.name) && isIdentifierField(i.name, i.description))
      .map((i) => ({ name: i.name, description: i.description })),
    produces: tool.primaryOutputs.map((o) => ({
      name: o.name,
      description: o.description,
    })),
  };
}

export async function llmFillIn(
  tools: NormalizedTool[],
  existing: GraphEdge[],
  complete: ChatComplete = defaultComplete,
): Promise<GraphEdge[]> {
  const missing = unmatchedConsumers(tools, existing).slice(0, 40);
  if (!missing.length) return [];
  const byService = new Map<string, typeof missing>();
  for (const item of missing) {
    const key = item.tool.service ?? "other";
    const list = byService.get(key) ?? [];
    list.push(item);
    byService.set(key, list);
  }
  const system =
    "You propose tool dependency edges. Return a JSON array of {from, to, label} only. from is a producer slug, to is a consumer slug, label is the consumer input the producer fills. Identifier-like fields only. Never use owner, repo, org, body, title, page, per_page as labels.";
  const extra: GraphEdge[] = [];
  let batches = 0;
  try {
    for (const group of byService.values()) {
      if (batches >= 4) break;
      batches += 1;
      const slugs = new Set(group.map((g) => g.tool.slug));
      const service = group[0]?.tool.service;
      const related = tools.filter(
        (t) => slugs.has(t.slug) || (service && t.service === service),
      );
      const user = JSON.stringify({
        unmatched: group.map((g) => ({
          slug: g.tool.slug,
          input: g.input.name,
          description: g.input.description,
        })),
        tools: related.slice(0, 80).map(summarize),
      });
      const text = await complete({ system, user });
      extra.push(...parseEdges(text));
    }
  } catch (err) {
    console.error("llm fill-in failed, keeping heuristic edges", err);
    return [];
  }
  return validateLlmEdges(extra, tools);
}
