import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGraphHtml } from "../src/visualize.ts";

const graph = {
  nodes: [
    { id: "TK_LIST_ISSUES", service: "issues" },
    { id: "TK_COMMENT", service: "issues" },
    { id: "TK_ISOLATED", service: "other" },
  ],
  edges: [
    { from: "TK_LIST_ISSUES", to: "TK_COMMENT", label: "issue_number" },
  ],
};

test("html includes connected node ids and edge labels", () => {
  const html = renderGraphHtml(graph);
  assert.match(html, /TK_LIST_ISSUES/);
  assert.match(html, /TK_COMMENT/);
  assert.match(html, /issue_number/);
  assert.match(html, /<input/);
});

test("default view marks connected nodes only", () => {
  const html = renderGraphHtml(graph);
  assert.match(html, /data-default="connected"/);
  assert.match(html, /data-connected="true"[^>]*TK_LIST_ISSUES|TK_LIST_ISSUES[^>]*data-connected="true"/);
  assert.match(html, /TK_ISOLATED/);
  assert.match(html, /data-connected="false"/);
});

test("groups by service", () => {
  const html = renderGraphHtml(graph);
  assert.match(html, /issues/);
});
