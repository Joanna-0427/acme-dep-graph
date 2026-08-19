import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceOf } from "../src/service.ts";

test("prefers a domain tag over hint tags", () => {
  const s = serviceOf(
    { tags: ["readOnlyHint", "issues", "openWorldHint"] },
    "GITHUB_LIST_REPOSITORY_ISSUES",
  );
  assert.equal(s, "issues");
});

test("falls back to slug resource token when no domain tag", () => {
  const s = serviceOf({ tags: ["readOnlyHint"] }, "GITHUB_MERGE_A_PULL_REQUEST");
  assert.equal(s, "pull");
});

test("returns undefined rather than a hint tag", () => {
  const s = serviceOf({ tags: ["readOnlyHint"] }, "TOOL");
  assert.notEqual(s, "readOnlyHint");
});
