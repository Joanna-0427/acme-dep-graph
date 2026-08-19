import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUserProvided,
  isIdentifierField,
  resourceTypeOf,
  snakeName,
} from "../src/classify.ts";

test("owner repo body and page are user-provided", () => {
  for (const name of ["owner", "repo", "org", "body", "title", "page", "per_page"]) {
    assert.equal(isUserProvided(name), true, name);
  }
});

test("issue_number migrationId sha and team_slug are identifiers", () => {
  assert.equal(isIdentifierField("issue_number", "Issue number"), true);
  assert.equal(isIdentifierField("migrationId", "The ID of the repository migration"), true);
  assert.equal(isIdentifierField("sha", "Commit SHA"), true);
  assert.equal(isIdentifierField("team_slug", "Team slug"), true);
});

test("owner is not an identifier even if description mentions id", () => {
  assert.equal(isIdentifierField("owner", "The id of the owner"), false);
});

test("branch is neither user-provided nor an identifier", () => {
  assert.equal(isUserProvided("branch"), false);
  assert.equal(isIdentifierField("branch", "Branch name"), false);
});

test("snakeName maps camelCase ids", () => {
  assert.equal(snakeName("migrationId"), "migration_id");
  assert.equal(snakeName("pullRequestId"), "pull_request_id");
  assert.equal(snakeName("issue_number"), "issue_number");
});

test("issue number field types as issue", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "number",
      description: "Issue number within the repository.",
      parentDefName: "CreateAnIssueResponse",
      slug: "GITHUB_CREATE_AN_ISSUE",
    }),
    "issue",
  );
});

test("issue comment id types as issue_comment", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "id",
      description: "Unique identifier of the issue comment.",
      parentDefName: "CreateAnIssueCommentResponse",
      slug: "GITHUB_CREATE_AN_ISSUE_COMMENT",
    }),
    "issue_comment",
  );
});

test("commit comment comment_id types as commit_comment", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "comment_id",
      description: "The id of the commit comment",
      slug: "GITHUB_DELETE_COMMIT_COMMENT",
    }),
    "commit_comment",
  );
});

test("gist comment comment_id types as gist_comment", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "comment_id",
      description: "comment id",
      slug: "GITHUB_DELETE_GIST_COMMENT",
    }),
    "gist_comment",
  );
});

test("comment_number types as discussion_comment", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "comment_number",
      description: "Discussion comment number",
      slug: "GITHUB_DELETE_DISCUSSION_COMMENT",
    }),
    "discussion_comment",
  );
});

test("pull_number types as pull_request", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "pull_number",
      description: "Pull request number",
      slug: "GITHUB_MERGE_A_PULL_REQUEST",
    }),
    "pull_request",
  );
});

test("a migrations service tag does not retype unrelated fields", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "org",
      description: "The organization name where the repository was unlocked.",
      parentDefName: "UnlockOrganizationRepositoryResponse",
      slug: "GITHUB_UNLOCK_ORGANIZATION_REPOSITORY",
      service: "migrations",
    }),
    "unknown",
  );
});

test("migration_id still types as migration on a migrations-tagged tool", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "migration_id",
      description: "The migration ID that the repository was part of.",
      slug: "GITHUB_UNLOCK_ORGANIZATION_REPOSITORY",
      service: "migrations",
    }),
    "migration",
  );
});

test("gist revision sha is gist, not commit", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "sha",
      description:
        "The SHA identifier of a specific gist revision. This is a 40-character hexadecimal string.",
      slug: "GITHUB_GET_GIST_REVISION",
    }),
    "gist",
  );
});

test("tree object sha is tree, not commit", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "sha",
      description: "The SHA1 checksum ID of the tree object.",
      parentDefName: "GitTree",
      slug: "GITHUB_GET_A_TREE",
    }),
    "tree",
  );
});

test("commit sha stays commit", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "sha",
      description: "SHA hash identifier of the commit.",
      parentDefName: "Commit",
      slug: "GITHUB_LIST_COMMITS",
    }),
    "commit",
  );
});

test("codespace_name is an identifier", () => {
  assert.equal(
    isIdentifierField(
      "codespace_name",
      "Unique name or identifier of the codespace, typically auto-generated upon creation.",
    ),
    true,
  );
});

test("clientMutationId is not an identifier", () => {
  assert.equal(
    isIdentifierField(
      "clientMutationId",
      "A unique identifier for the client performing the mutation.",
    ),
    false,
  );
});

test("listId on a user-list tool types as user_list", () => {
  assert.equal(
    resourceTypeOf({
      fieldName: "listId",
      description:
        "The ID of the user list to delete. This is a GitHub global node ID for the list.",
      slug: "GITHUB_DELETE_USER_LIST",
    }),
    "user_list",
  );
});
