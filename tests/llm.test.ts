import { test } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedTool } from "../src/types.ts";
import { llmFillIn } from "../src/llm.ts";

function tool(partial: Partial<NormalizedTool> & { slug: string }): NormalizedTool {
  return {
    isDeprecated: false,
    tags: [],
    requiredInputs: [],
    allInputs: [],
    primaryOutputs: [],
    ...partial,
  };
}

const unmatched = [
  tool({
    slug: "TK_LIST_THINGS",
    service: "things",
    primaryOutputs: [
      { name: "thing_id", description: "The ID of the thing" },
    ],
  }),
  tool({
    slug: "TK_DELETE_THING",
    service: "things",
    requiredInputs: [{ name: "thing_id", description: "The ID of the thing" }],
  }),
];

test("keeps a valid mock proposal for an unmatched consumer", async () => {
  let called = 0;
  const extra = await llmFillIn(unmatched, [], async () => {
    called += 1;
    return JSON.stringify([
      { from: "TK_LIST_THINGS", to: "TK_DELETE_THING", label: "thing_id" },
    ]);
  });
  assert.ok(called > 0);
  assert.ok(
    extra.some(
      (e) =>
        e.from === "TK_LIST_THINGS" &&
        e.to === "TK_DELETE_THING" &&
        e.label === "thing_id",
    ),
  );
});

test("drops hallucinated slugs", async () => {
  const extra = await llmFillIn(unmatched, [], async () =>
    JSON.stringify([
      { from: "NOT_A_TOOL", to: "TK_DELETE_THING", label: "thing_id" },
    ]),
  );
  assert.equal(extra.length, 0);
});

test("drops owner labels", async () => {
  const extra = await llmFillIn(unmatched, [], async () =>
    JSON.stringify([
      { from: "TK_LIST_THINGS", to: "TK_DELETE_THING", label: "owner" },
    ]),
  );
  assert.equal(extra.length, 0);
});

test("returns empty when complete throws", async () => {
  const extra = await llmFillIn(unmatched, [], async () => {
    throw new Error("quota");
  });
  assert.deepEqual(extra, []);
});

test("does not call complete when every identifier already has a producer", async () => {
  let called = 0;
  await llmFillIn(
    unmatched,
    [{ from: "TK_LIST_THINGS", to: "TK_DELETE_THING", label: "thing_id" }],
    async () => {
      called += 1;
      return "[]";
    },
  );
  assert.equal(called, 0);
});
