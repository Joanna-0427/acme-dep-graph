import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPrimaryOutputs, extractInputs } from "../src/extract.ts";

test("uses CreateAnIssueResponse as primary, not nested User", () => {
  const fields = extractPrimaryOutputs({
    outputParameters: {
      properties: { data: { $ref: "#/$defs/CreateAnIssueResponse" } },
      $defs: {
        User: {
          properties: { id: { description: "User ID." } },
        },
        CreateAnIssueResponse: {
          properties: {
            number: { description: "Issue number within the repository." },
            id: { description: "Unique identifier for the issue." },
            user: { $ref: "#/$defs/User" },
          },
        },
      },
    },
  });
  const names = fields.map((f) => f.name).sort();
  assert.deepEqual(names, ["id", "number"]);
  assert.equal(
    fields.find((f) => f.name === "number")?.description,
    "Issue number within the repository.",
  );
  assert.equal(
    fields.find((f) => f.name === "number")?.parentDefName,
    "CreateAnIssueResponse",
  );
});

test("walks list wrapper issues[] to the item type", () => {
  const fields = extractPrimaryOutputs({
    outputParameters: {
      properties: { data: { $ref: "#/$defs/ListRepositoryIssuesResponse" } },
      $defs: {
        User: { properties: { id: { description: "User ID" } } },
        Issue: {
          properties: {
            number: { description: "Issue number within the repository." },
            user: { $ref: "#/$defs/User" },
          },
        },
        ListRepositoryIssuesResponse: {
          properties: {
            issues: { type: "array", items: { $ref: "#/$defs/Issue" } },
          },
        },
      },
    },
  });
  assert.deepEqual(fields.map((f) => f.name), ["number"]);
  assert.equal(fields[0].parentDefName, "Issue");
});

test("does not treat nested PullRequest on a workflow run as primary", () => {
  const fields = extractPrimaryOutputs({
    outputParameters: {
      properties: { data: { $ref: "#/$defs/GetAWorkflowRunResponse" } },
      $defs: {
        PullRequest: {
          properties: { number: { description: "The pull request number" } },
        },
        GetAWorkflowRunResponse: {
          properties: {
            id: { description: "The workflow run id" },
            pull_requests: {
              type: "array",
              items: { $ref: "#/$defs/PullRequest" },
            },
          },
        },
      },
    },
  });
  assert.ok(fields.some((f) => f.name === "id"));
  assert.ok(!fields.some((f) => f.name === "number"));
});

test("stops on $ref cycles", () => {
  const fields = extractPrimaryOutputs({
    outputParameters: {
      properties: { data: { $ref: "#/$defs/Loop" } },
      $defs: {
        Loop: {
          properties: {
            next: { $ref: "#/$defs/Loop" },
            id: { description: "id" },
          },
        },
      },
    },
  });
  assert.ok(fields.some((f) => f.name === "id"));
});

test("extractInputs returns required and all fields", () => {
  const { required, all } = extractInputs({
    inputParameters: {
      properties: {
        owner: { description: "repo owner" },
        issue_number: { description: "Issue number" },
      },
      required: ["issue_number"],
    },
  });
  assert.deepEqual(
    required.map((f) => f.name),
    ["issue_number"],
  );
  assert.equal(all.length, 2);
});

test("anyOf unions object branches without following nested refs", () => {
  const fields = extractPrimaryOutputs({
    outputParameters: {
      properties: {
        data: {
          anyOf: [
            { properties: { id: { description: "Widget id" } } },
            {
              properties: {
                id: { description: "Widget id" },
                name: { description: "Widget name" },
                owner: { $ref: "#/$defs/User" },
              },
            },
          ],
        },
      },
      $defs: {
        User: { properties: { id: { description: "User ID" } } },
      },
    },
  });
  assert.deepEqual(fields.map((f) => f.name).sort(), ["id", "name"]);
});
