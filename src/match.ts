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
  if (p === "sha" && ["sha", "commit_sha", "head_sha"].includes(c)) return true;
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
