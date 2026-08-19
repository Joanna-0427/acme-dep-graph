import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { parseCatalog } from "../src/catalog.ts";
import { normalizeTools } from "../src/extract.ts";
import { heuristicEdges } from "../src/match.ts";
import type { NormalizedTool } from "../src/types.ts";

test("tiny ACME catalog lists widgets into delete widget_id", () => {
  const tools = normalizeTools(
    parseCatalog(JSON.parse(readFileSync("tests/fixtures/tiny_catalog.json", "utf-8"))),
  );
  const edges = heuristicEdges(tools);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "ACME_LIST_WIDGETS" &&
        e.to === "ACME_DELETE_WIDGET" &&
        e.label === "widget_id",
    ),
  );
  assert.ok(!edges.some((e) => e.label === "owner"));
  assert.ok(!edges.some((e) => e.label === "user_id" || e.label === "id"));
});

function tool(partial: Partial<NormalizedTool> & { slug: string }): NormalizedTool {
  return {
    service: partial.service,
    isDeprecated: partial.isDeprecated ?? false,
    tags: partial.tags ?? [],
    requiredInputs: partial.requiredInputs ?? [],
    allInputs: partial.allInputs ?? partial.requiredInputs ?? [],
    primaryOutputs: partial.primaryOutputs ?? [],
    ...partial,
  };
}

test("issue number output fills issue_number consumer", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_CREATE_ISSUE",
      primaryOutputs: [
        {
          name: "number",
          description: "Issue number within the repository.",
          parentDefName: "CreateAnIssueResponse",
        },
      ],
    }),
    tool({
      slug: "TK_CREATE_ISSUE_COMMENT",
      requiredInputs: [
        { name: "issue_number", description: "Issue number" },
      ],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_CREATE_ISSUE" &&
        e.to === "TK_CREATE_ISSUE_COMMENT" &&
        e.label === "issue_number",
    ),
  );
});

test("issue comment id does not fill commit comment comment_id", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_CREATE_AN_ISSUE_COMMENT",
      primaryOutputs: [
        {
          name: "id",
          description: "Unique identifier of the issue comment.",
        },
      ],
    }),
    tool({
      slug: "TK_DELETE_COMMIT_COMMENT",
      requiredInputs: [
        { name: "comment_id", description: "The id of the commit comment" },
      ],
    }),
  ]);
  assert.equal(edges.length, 0);
});

test("refuses self-loops", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_GET_ISSUE",
      requiredInputs: [{ name: "issue_number", description: "Issue number" }],
      primaryOutputs: [
        { name: "number", description: "Issue number within the repository." },
      ],
    }),
  ]);
  assert.ok(!edges.some((e) => e.from === e.to));
});

test("migrationId consumer matches migration_id producer via snake_case", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_LIST_MIGRATIONS",
      primaryOutputs: [
        { name: "migration_id", description: "The ID of the repository migration" },
      ],
    }),
    tool({
      slug: "TK_ABORT_MIGRATION",
      requiredInputs: [
        { name: "migrationId", description: "The ID of the repository migration" },
      ],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_LIST_MIGRATIONS" &&
        e.to === "TK_ABORT_MIGRATION" &&
        e.label === "migrationId",
    ),
  );
});
