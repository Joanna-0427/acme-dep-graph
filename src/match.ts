import {
  isIdentifierField,
  isUserProvided,
  resourceTypeOf,
  snakeName,
} from "./classify.ts";
import type { Field, GraphEdge, NormalizedTool } from "./types.ts";

function fieldType(tool: NormalizedTool, field: Field): string {
  return resourceTypeOf({
    fieldName: field.name,
    description: field.description,
    parentDefName: field.parentDefName,
    slug: tool.slug,
    service: tool.service,
  });
}

function namesCompatible(
  producer: Field,
  consumer: Field,
  producerType: string,
  consumerType: string,
): boolean {
  const p = snakeName(producer.name);
  const c = snakeName(consumer.name);
  if (p === c) return true;
  if (producerType !== consumerType) return false;
  if (p === "number" && (c === `${consumerType}_number` || c.endsWith("_number"))) {
    return true;
  }
  if (p === "id" && (c === `${consumerType}_id` || c.endsWith("_id"))) return true;
  if (p === "slug" && (c === `${consumerType}_slug` || c.endsWith("_slug"))) {
    return true;
  }
  if (p === "sha" && (c === "sha" || c.endsWith("_sha"))) return true;
  return false;
}

export function heuristicEdges(tools: NormalizedTool[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const consumer of tools) {
    for (const input of consumer.requiredInputs) {
      if (isUserProvided(input.name)) continue;
      if (!isIdentifierField(input.name, input.description)) continue;
      const consumerType = fieldType(consumer, input);
      for (const producer of tools) {
        if (producer.slug === consumer.slug) continue;
        for (const output of producer.primaryOutputs) {
          const producerType = fieldType(producer, output);
          if (producerType !== consumerType) continue;
          if (!namesCompatible(output, input, producerType, consumerType)) continue;
          const key = `${producer.slug}\0${consumer.slug}\0${input.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({
            from: producer.slug,
            to: consumer.slug,
            label: input.name,
          });
        }
      }
    }
  }
  return edges;
}

function bySlugMap(tools: NormalizedTool[]): Map<string, NormalizedTool> {
  return new Map(tools.map((t) => [t.slug, t]));
}

function isListSearchFind(slug: string): boolean {
  return /_(LIST|SEARCH|FIND)_/.test(slug);
}

const GENERIC_LOOKUP_TOKENS = new Set([
  "LIST",
  "SEARCH",
  "FIND",
  "GET",
  "CREATE",
  "DELETE",
  "UPDATE",
  "ID",
  "SHA",
  "NAME",
  "NUMBER",
  "REF",
  "TOKEN",
  "SLUG",
  "NODE",
  "ITEM",
  "DATA",
  "URL",
  "USER",
  "ORG",
  "REPO",
]);

function resourceTokenForLabel(label: string): string {
  const type = snakeName(label).replace(
    /_(id|number|sha|token|ref|slug|name)$/,
    "",
  );
  if (type === "pull_request" || type === "pull") return "PULL";
  if (type === "issue") return "ISSUE";
  const token = type.replace(/_/g, "").toUpperCase();
  if (!token || GENERIC_LOOKUP_TOKENS.has(token)) return "";
  return token;
}

function scoreEdge(
  edge: GraphEdge,
  toolsBySlug: Map<string, NormalizedTool>,
): number {
  const from = toolsBySlug.get(edge.from);
  const to = toolsBySlug.get(edge.to);
  if (!from || !to) return 0;
  let score = 0;
  if (isListSearchFind(from.slug)) score += 40;
  else if (/_GET_/.test(from.slug)) score += 25;
  else if (/_CREATE_/.test(from.slug)) score += 20;
  if (from.service && from.service === to.service) score += 10;
  if (!from.isDeprecated) score += 15;
  const output = from.primaryOutputs.find((f) => {
    const t = fieldType(from, f);
    return t === resourceTypeOf({
      fieldName: edge.label ?? "",
      description: to.requiredInputs.find((i) => i.name === edge.label)?.description ?? "",
      slug: to.slug,
      service: to.service,
    });
  });
  if (output && edge.label && output.description.toLowerCase().includes(snakeName(edge.label).replace(/_/g, " "))) {
    score += 5;
  }
  return score;
}

export function rankAndCap(
  edges: GraphEdge[],
  tools: NormalizedTool[],
): GraphEdge[] {
  const toolsBySlug = bySlugMap(tools);
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = `${edge.to}\0${edge.label ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }
  const out: GraphEdge[] = [];
  for (const group of groups.values()) {
    const live = group.filter((e) => !toolsBySlug.get(e.from)?.isDeprecated);
    const candidates = live.length ? live : group;
    const sorted = [...candidates].sort(
      (a, b) => scoreEdge(b, toolsBySlug) - scoreEdge(a, toolsBySlug),
    );
    const token = resourceTokenForLabel(group[0]?.label ?? "");
    const sameResource = (edge: GraphEdge) =>
      !!token && edge.from.includes(token);
    const lists = sorted.filter((e) => isListSearchFind(e.from) && sameResource(e));
    const creates = sorted.filter((e) => /_CREATE_/.test(e.from) && sameResource(e));
    const gets = sorted.filter(
      (e) => /_GET_/.test(e.from) && sameResource(e) && !isListSearchFind(e.from),
    );
    const kept: GraphEdge[] = [];
    const take = (pool: GraphEdge[], max: number) => {
      let n = 0;
      for (const edge of pool) {
        if (kept.length >= 8 || n >= max) break;
        if (kept.some((e) => e.from === edge.from)) continue;
        kept.push(edge);
        n += 1;
      }
    };
    const reserve = (creates.length ? 1 : 0) + (gets.length ? 1 : 0);
    take(lists, Math.max(1, 8 - reserve));
    take(creates, 1);
    take(gets, 1);
    take(sorted, 8 - kept.length);
    out.push(...kept);
  }
  return out;
}

export function lookupFallbackEdges(
  tools: NormalizedTool[],
  existing: GraphEdge[],
): GraphEdge[] {
  const covered = new Set(
    existing.map((e) => `${e.to}\0${e.label ?? ""}`),
  );
  const extra: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const consumer of tools) {
    for (const input of consumer.requiredInputs) {
      if (isUserProvided(input.name)) continue;
      if (!isIdentifierField(input.name, input.description)) continue;
      const key = `${consumer.slug}\0${input.name}`;
      if (covered.has(key)) continue;
      const token = resourceTokenForLabel(input.name);
      if (!token) continue;
      for (const producer of tools) {
        if (producer.slug === consumer.slug) continue;
        if (!isListSearchFind(producer.slug)) continue;
        if (!producer.slug.includes(token)) continue;
        const edgeKey = `${producer.slug}\0${key}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        extra.push({
          from: producer.slug,
          to: consumer.slug,
          label: input.name,
        });
      }
    }
  }
  return extra;
}
