import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { parseCatalog } from "../src/catalog.ts";
import { generate } from "../src/generate.ts";

test("tiny catalog yields ACME slugs and a widget_id edge", async () => {
  const tools = parseCatalog(
    JSON.parse(readFileSync("tests/fixtures/tiny_catalog.json", "utf-8")),
  );
  const graph = await generate(tools, { llm: false });
  const ids = graph.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["ACME_DELETE_WIDGET", "ACME_LIST_WIDGETS"]);
  assert.ok(
    graph.edges.some(
      (e) =>
        e.from === "ACME_LIST_WIDGETS" &&
        e.to === "ACME_DELETE_WIDGET" &&
        e.label === "widget_id",
    ),
  );
  assert.equal(
    graph.nodes.filter((n) => ids.includes(n.id)).length / graph.nodes.length,
    1,
  );
});

test("empty catalog yields an empty graph", async () => {
  const graph = await generate([], { llm: false });
  assert.deepEqual(graph, { nodes: [], edges: [] });
});

test("every edge endpoint is a node and label is an input on to", async () => {
  const tools = parseCatalog(
    JSON.parse(readFileSync("tests/fixtures/tiny_catalog.json", "utf-8")),
  );
  const graph = await generate(tools, { llm: false });
  const ids = new Set(graph.nodes.map((n) => n.id));
  const bySlug = new Map(tools.map((t) => [t.slug, t]));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), edge.from);
    assert.ok(ids.has(edge.to), edge.to);
    const inputs = Object.keys(bySlug.get(edge.to)?.inputParameters?.properties ?? {});
    assert.ok(inputs.includes(edge.label ?? ""), edge.label);
  }
});
