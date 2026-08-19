import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "fs";
import { parseCatalog, slugOf, loadCatalogFromPath } from "../src/catalog.ts";

test("parseCatalog reads a raw array", () => {
  const tools = parseCatalog([{ slug: "ACME_LIST" }, { slug: "ACME_GET" }]);
  assert.equal(tools.length, 2);
});

test("parseCatalog reads { tools }", () => {
  const tools = parseCatalog({ tools: [{ slug: "ACME_LIST" }] });
  assert.equal(tools.length, 1);
});

test("parseCatalog reads { items }", () => {
  const tools = parseCatalog({ items: [{ slug: "ACME_LIST" }] });
  assert.equal(tools.length, 1);
});

test("parseCatalog skips tools with no slug", () => {
  const tools = parseCatalog([{ slug: "KEEP" }, { name: "nope" }, {}]);
  assert.deepEqual(tools.map(slugOf), ["KEEP"]);
});

test("parseCatalog empty list is empty", () => {
  assert.deepEqual(parseCatalog([]), []);
});

test("duplicate slugs keep the first", () => {
  const tools = parseCatalog([
    { slug: "DUP", name: "first" },
    { slug: "DUP", name: "second" },
  ]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "first");
});

test("loadCatalogFromPath reads a file", () => {
  const path = "tests/tmp-catalog.json";
  writeFileSync(path, JSON.stringify([{ slug: "X" }]));
  try {
    assert.equal(loadCatalogFromPath(path).length, 1);
  } finally {
    unlinkSync(path);
  }
});
