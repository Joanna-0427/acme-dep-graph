import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalogFromPath } from "../src/catalog.ts";
import { generate } from "../src/generate.ts";

const tools = loadCatalogFromPath("github_catalog.json");
const graph = await generate(tools, { llm: false });

function hasEdge(from: string, to: string, label: string): boolean {
  return graph.edges.some(
    (e) => e.from === from && e.to === to && e.label === label,
  );
}

test("provenance is 1.0", () => {
  const slugs = new Set(tools.map((t) => String(t.slug).toUpperCase()));
  assert.ok(graph.nodes.length > 0);
  for (const node of graph.nodes) {
    assert.ok(slugs.has(node.id.toUpperCase()), node.id);
  }
});

test("README issue comment depends on list issues", () => {
  assert.ok(
    hasEdge(
      "GITHUB_LIST_REPOSITORY_ISSUES",
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
      "issue_number",
    ),
  );
});

test("README merge depends on list pull requests", () => {
  assert.ok(
    hasEdge(
      "GITHUB_LIST_PULL_REQUESTS",
      "GITHUB_MERGE_A_PULL_REQUEST",
      "pull_number",
    ),
  );
});

test("create or get issue also supplies issue_number for comments", () => {
  assert.ok(
    hasEdge("GITHUB_GET_AN_ISSUE", "GITHUB_CREATE_AN_ISSUE_COMMENT", "issue_number") ||
      hasEdge(
        "GITHUB_CREATE_AN_ISSUE",
        "GITHUB_CREATE_AN_ISSUE_COMMENT",
        "issue_number",
      ),
  );
});

test("does not label edges with user-provided fields", () => {
  const banned = new Set(["owner", "repo", "body", "page", "per_page"]);
  for (const edge of graph.edges) {
    assert.ok(!banned.has(edge.label ?? ""), edge.label);
  }
});

test("workflow run is not a pull_number producer for merge", () => {
  assert.ok(
    !hasEdge(
      "GITHUB_GET_A_WORKFLOW_RUN",
      "GITHUB_MERGE_A_PULL_REQUEST",
      "pull_number",
    ),
  );
});

test("comment_id edges do not cross issue and commit comment types", () => {
  const issueFrom = new Set(
    graph.edges
      .filter(
        (e) => e.to === "GITHUB_DELETE_ISSUE_COMMENT" && e.label === "comment_id",
      )
      .map((e) => e.from),
  );
  const commitFrom = new Set(
    graph.edges
      .filter(
        (e) => e.to === "GITHUB_DELETE_COMMIT_COMMENT" && e.label === "comment_id",
      )
      .map((e) => e.from),
  );
  for (const from of issueFrom) {
    assert.ok(!commitFrom.has(from), from);
  }
});

test("abort migrationId is not fed by issue list", () => {
  assert.ok(
    !hasEdge(
      "GITHUB_LIST_REPOSITORY_ISSUES",
      "GITHUB_ABORT_REPOSITORY_MIGRATION",
      "migrationId",
    ),
  );
  for (const edge of graph.edges.filter(
    (e) => e.to === "GITHUB_ABORT_REPOSITORY_MIGRATION",
  )) {
    assert.equal(edge.label, "migrationId");
  }
});

test("graph has edges", () => {
  assert.ok(graph.edges.length > 0);
});
