import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { parseCatalog } from "../src/catalog.ts";
import { normalizeTools } from "../src/extract.ts";
import { heuristicEdges, lookupFallbackEdges, rankAndCap } from "../src/match.ts";
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

test("caps producers at 8 but keeps a LIST_ producer", () => {
  const consumer = tool({
    slug: "TK_COMMENT",
    requiredInputs: [{ name: "issue_number", description: "Issue number" }],
  });
  const producers: NormalizedTool[] = [];
  for (let i = 0; i < 10; i++) {
    producers.push(
      tool({
        slug: `TK_MISC_ISSUE_${i}`,
        primaryOutputs: [
          { name: "number", description: "Issue number within the repository." },
        ],
      }),
    );
  }
  producers.push(
    tool({
      slug: "TK_LIST_ISSUES",
      primaryOutputs: [
        { name: "number", description: "Issue number within the repository." },
      ],
    }),
  );
  const raw = heuristicEdges([...producers, consumer]);
  const capped = rankAndCap(raw, [...producers, consumer]);
  const forComment = capped.filter(
    (e) => e.to === "TK_COMMENT" && e.label === "issue_number",
  );
  assert.ok(forComment.length <= 8);
  assert.ok(forComment.some((e) => e.from === "TK_LIST_ISSUES"));
});

test("drops deprecated producer when a live one exists", () => {
  const tools = [
    tool({
      slug: "TK_OLD_LIST_ISSUES",
      isDeprecated: true,
      primaryOutputs: [
        { name: "number", description: "Issue number within the repository." },
      ],
    }),
    tool({
      slug: "TK_LIST_ISSUES",
      primaryOutputs: [
        { name: "number", description: "Issue number within the repository." },
      ],
    }),
    tool({
      slug: "TK_COMMENT",
      requiredInputs: [{ name: "issue_number", description: "Issue number" }],
    }),
  ];
  const capped = rankAndCap(heuristicEdges(tools), tools);
  assert.ok(!capped.some((e) => e.from === "TK_OLD_LIST_ISSUES"));
  assert.ok(capped.some((e) => e.from === "TK_LIST_ISSUES"));
});

test("lookup fallback attaches LIST_PULL to unmatched pull_number", () => {
  const tools = [
    tool({
      slug: "TK_LIST_PULL_REQUESTS",
      primaryOutputs: [{ name: "title", description: "PR title" }],
    }),
    tool({
      slug: "TK_MERGE_A_PULL_REQUEST",
      requiredInputs: [{ name: "pull_number", description: "Pull request number" }],
    }),
  ];
  const existing = heuristicEdges(tools);
  const lookup = lookupFallbackEdges(tools, existing);
  assert.ok(
    lookup.some(
      (e) =>
        e.from === "TK_LIST_PULL_REQUESTS" &&
        e.to === "TK_MERGE_A_PULL_REQUEST" &&
        e.label === "pull_number",
    ),
  );
  assert.ok(!lookup.some((e) => e.label === "branch"));
});

test("lookup does not treat LIST as a resource token for listId", () => {
  const tools = [
    tool({
      slug: "TK_LIST_REPOSITORIES",
      primaryOutputs: [{ name: "id", description: "Repository id" }],
    }),
    tool({
      slug: "TK_LIST_ISSUES",
      primaryOutputs: [{ name: "number", description: "Issue number" }],
    }),
    tool({
      slug: "TK_DELETE_USER_LIST",
      requiredInputs: [
        { name: "listId", description: "The ID of the user list to delete" },
      ],
    }),
  ];
  const lookup = lookupFallbackEdges(tools, []);
  assert.equal(
    lookup.filter((e) => e.to === "TK_DELETE_USER_LIST" && e.label === "listId")
      .length,
    0,
  );
});

test("team slug output fills team_slug", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_LIST_TEAMS",
      primaryOutputs: [
        { name: "slug", description: "URL-friendly team identifier." },
      ],
    }),
    tool({
      slug: "TK_ADD_TEAM_MEMBER",
      requiredInputs: [{ name: "team_slug", description: "Team slug" }],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_LIST_TEAMS" &&
        e.to === "TK_ADD_TEAM_MEMBER" &&
        e.label === "team_slug",
    ),
  );
});

test("caps keep CREATE of the same resource", () => {
  const consumer = tool({
    slug: "TK_CREATE_AN_ISSUE_COMMENT",
    requiredInputs: [{ name: "issue_number", description: "Issue number" }],
  });
  const producers: NormalizedTool[] = [];
  for (let i = 0; i < 10; i++) {
    producers.push(
      tool({
        slug: `TK_LIST_MISC_ISSUE_${i}`,
        primaryOutputs: [
          { name: "number", description: "Issue number within the repository." },
        ],
      }),
    );
  }
  producers.push(
    tool({
      slug: "TK_CREATE_AN_ISSUE",
      primaryOutputs: [
        { name: "number", description: "Issue number within the repository." },
      ],
    }),
  );
  const capped = rankAndCap(heuristicEdges([...producers, consumer]), [
    ...producers,
    consumer,
  ]);
  assert.ok(
    capped.some(
      (e) =>
        e.from === "TK_CREATE_AN_ISSUE" &&
        e.to === "TK_CREATE_AN_ISSUE_COMMENT" &&
        e.label === "issue_number",
    ),
  );
});

test("gist sha does not fill a commit sha consumer", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_LIST_COMMITS",
      primaryOutputs: [
        { name: "sha", description: "SHA hash identifier of the commit." },
      ],
    }),
    tool({
      slug: "TK_GET_GIST_REVISION",
      requiredInputs: [
        {
          name: "sha",
          description: "The SHA identifier of a specific gist revision.",
        },
      ],
    }),
  ]);
  assert.equal(edges.length, 0);
});

test("optional sha is not a consumer", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_LIST_COMMITS",
      primaryOutputs: [
        { name: "sha", description: "SHA hash identifier of the commit." },
      ],
    }),
    tool({
      slug: "TK_MERGE",
      requiredInputs: [{ name: "pull_number", description: "Pull request number" }],
      allInputs: [
        { name: "pull_number", description: "Pull request number" },
        { name: "sha", description: "SHA of the commit" },
      ],
    }),
  ]);
  assert.ok(!edges.some((e) => e.label === "sha"));
});

test("tree sha output fills tree_sha", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_GET_A_TREE",
      primaryOutputs: [
        { name: "sha", description: "The SHA1 checksum ID of the tree object." },
      ],
    }),
    tool({
      slug: "TK_GET_TREE",
      requiredInputs: [
        {
          name: "tree_sha",
          description: "The SHA1 checksum ID of the tree object.",
        },
      ],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_GET_A_TREE" &&
        e.to === "TK_GET_TREE" &&
        e.label === "tree_sha",
    ),
  );
});

test("exact field names match even when inferred types disagree", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_LIST_ADVISORIES",
      primaryOutputs: [
        { name: "ghsa_id", description: "The GitHub Security Advisory ID" },
      ],
    }),
    tool({
      slug: "TK_GET_ADVISORY",
      requiredInputs: [
        {
          name: "ghsa_id",
          description:
            "The GHSA (GitHub Security Advisory) identifier of the advisory.",
        },
      ],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_LIST_ADVISORIES" &&
        e.to === "TK_GET_ADVISORY" &&
        e.label === "ghsa_id",
    ),
  );
});

test("matching delivery_id names keep the edge when types disagree", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_GET_DELIVERY",
      primaryOutputs: [
        {
          name: "delivery_id",
          description: "Unique identifier of the webhook delivery.",
        },
      ],
    }),
    tool({
      slug: "TK_REDELIVER",
      requiredInputs: [
        {
          name: "delivery_id",
          description:
            "The unique identifier of a specific delivery for the webhook.",
        },
      ],
    }),
  ]);
  assert.ok(
    edges.some(
      (e) =>
        e.from === "TK_GET_DELIVERY" &&
        e.to === "TK_REDELIVER" &&
        e.label === "delivery_id",
    ),
  );
});

test("generic id does not match across types just because both are named id", () => {
  const edges = heuristicEdges([
    tool({
      slug: "TK_GET_ISSUE",
      primaryOutputs: [
        { name: "id", description: "Unique identifier for the issue." },
      ],
    }),
    tool({
      slug: "TK_GET_GRAPHQL_NODE",
      requiredInputs: [
        {
          name: "id",
          description: "The global node ID of the object to fetch.",
        },
      ],
    }),
  ]);
  assert.equal(edges.length, 0);
});
