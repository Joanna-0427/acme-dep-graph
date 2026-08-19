# Dependency Graph Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a catalog-driven generator that writes `dependency_graph.json` (and `graph.html`) of producer→consumer identifier edges for any Composio toolkit.

**Architecture:** Hybrid pipeline in small TypeScript modules: load catalog → extract primary payload fields only → classify identifier vs user-provided → typed heuristic match with rank/cap → optional LLM fill-in for unmatched consumers → assemble graph. Never harvest nested `$defs` (User.id, Milestone.number). Never hardcode a GitHub edge list.

**Tech Stack:** Node.js, TypeScript via `tsx`, `node:test`, OpenAI SDK (`openai/gpt-4o` via Litmus `OPENAI_BASE_URL` / `OPENAI_API_KEY`).

## Global Constraints

- Catalog path is the last CLI argument; write `dependency_graph.json` at cwd.
- `generator.json` run command stays `node --import tsx src/generate.ts`.
- Node ids are catalog slugs; provenance must be 1.0.
- Edges are `producer → consumer` with `label` = consumer input field.
- Do not emit edges labeled `owner`, `repo`, `org`, `body`, `title`, `page`, `per_page`, or other user-provided fields.
- Optional identifier inputs are not consumers.
- Primary payload only for producers (follow `data` `$ref`, then list wrappers `issues` / `pull_requests` / `items`; do not recurse nested objects).
- At most 8 producers per `(consumer, label)`; never drop a typed list/search producer of the same resource.
- LLM is optional fill-in; on failure keep heuristic edges. Do not put API keys in source; read `.env` (gitignored) plus process env.
- Model id: `openai/gpt-4o`. Commit after each task. TDD: failing test first.

## File map

- Create: `src/types.ts` — Graph / Field / NormalizedTool
- Create: `src/env.ts` — load gitignored `.env` into `process.env`
- Create: `src/catalog.ts` — parse catalog JSON
- Create: `src/service.ts` — domain service from tags/slug
- Create: `src/extract.ts` — primary-payload I/O extraction
- Create: `src/classify.ts` — user-provided vs identifier + resource type
- Create: `src/match.ts` — heuristic edges, rank/cap, lookup fallback
- Create: `src/llm.ts` — LLM fill-in + validation
- Create: `src/visualize.ts` — static HTML
- Modify: `src/generate.ts` — orchestrate + CLI
- Modify: `package.json` — add `test` script
- Create: `tests/fixtures/tiny_catalog.json`
- Create: `tests/*.test.ts`
- Create: `.env` locally only (already gitignored as `.env*`)

---

### Task 1: Catalog loader + types

**Files:**
- Create: `src/types.ts`
- Create: `src/catalog.ts`
- Create: `tests/catalog.test.ts`
- Modify: `package.json` (add `"test": "node --import tsx --test tests/*.test.ts"`)

**Interfaces:**
- Consumes: raw catalog JSON
- Produces: `parseCatalog(data: unknown): RawTool[]`, `slugOf(tool: RawTool): string | undefined`, `loadCatalogFromPath(path: string): RawTool[]`

- [ ] **Step 1: Add test script and failing catalog tests**

Add to `package.json` scripts: `"test": "node --import tsx --test tests/*.test.ts"`.

Create `tests/catalog.test.ts`:

```ts
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
```

Create stub `src/types.ts` and `src/catalog.ts` that export the names but do not implement behavior (throw or return `[]`) so tests fail on assertions, not import errors.

`src/types.ts`:

```ts
export type RawTool = Record<string, any>;

export interface GraphNode {
  id: string;
  service?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Field {
  name: string;
  description: string;
  parentDefName?: string;
}

export interface NormalizedTool {
  slug: string;
  service?: string;
  isDeprecated: boolean;
  tags: string[];
  requiredInputs: Field[];
  allInputs: Field[];
  primaryOutputs: Field[];
}
```

`src/catalog.ts` stub:

```ts
import type { RawTool } from "./types.ts";

export function slugOf(tool: RawTool): string | undefined {
  return undefined;
}

export function parseCatalog(data: unknown): RawTool[] {
  return [];
}

export function loadCatalogFromPath(path: string): RawTool[] {
  return [];
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL (`parseCatalog` returns `[]`, length assertions fail).

- [ ] **Step 3: Implement catalog loader**

```ts
import { readFileSync } from "fs";
import type { RawTool } from "./types.ts";

export function slugOf(tool: RawTool): string | undefined {
  const slug = tool.slug ?? tool.name ?? tool.function?.name;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

export function parseCatalog(data: unknown): RawTool[] {
  const raw = Array.isArray(data)
    ? data
    : (data as any)?.tools ?? (data as any)?.items ?? [];
  const seen = new Set<string>();
  const out: RawTool[] = [];
  for (const tool of raw) {
    const slug = slugOf(tool);
    if (!slug) continue;
    if (seen.has(slug)) {
      console.warn(`duplicate slug ${slug}, keeping first`);
      continue;
    }
    seen.add(slug);
    out.push(tool);
  }
  return out;
}

export function loadCatalogFromPath(path: string): RawTool[] {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return parseCatalog(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/types.ts src/catalog.ts tests/catalog.test.ts
git commit -m "Add catalog loader that keeps unique slugs."
```

---

### Task 2: Service tag

**Files:**
- Create: `src/service.ts`
- Create: `tests/service.test.ts`

**Interfaces:**
- Consumes: `RawTool`, slug string
- Produces: `serviceOf(tool: RawTool, slug: string): string | undefined`

- [ ] **Step 1: Write failing tests**

```ts
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
```

Stub `src/service.ts` with `export function serviceOf(): undefined { return undefined; }`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/service.test.ts`

Expected: FAIL (undefined vs `"issues"`)

- [ ] **Step 3: Implement serviceOf**

```ts
import type { RawTool } from "./types.ts";

const HINT = new Set([
  "openWorldHint",
  "mcpIgnore",
  "readOnlyHint",
  "idempotentHint",
  "updateHint",
  "destructiveHint",
  "createHint",
  "important",
  "GraphQL",
]);

const DOMAINS = [
  "issues",
  "pulls",
  "pull",
  "repos",
  "actions",
  "orgs",
  "codespaces",
  "projects",
  "gists",
  "migrations",
  "checks",
  "secret",
  "packages",
  "teams",
  "users",
  "git",
  "search",
];

export function serviceOf(tool: RawTool, slug: string): string | undefined {
  const tags = (tool.tags ?? []).filter(
    (t: string) => typeof t === "string" && !HINT.has(t) && !t.endsWith("Hint"),
  );
  const domain = tags.find((t: string) =>
    DOMAINS.includes(t.toLowerCase()),
  );
  if (domain) return domain.toLowerCase();
  if (tags.length) {
    return [...tags].sort((a: string, b: string) => b.length - a.length)[0];
  }
  const parts = slug.split("_").filter(Boolean);
  const skip = new Set([
    "GITHUB", "LIST", "GET", "CREATE", "DELETE", "UPDATE", "SET", "ADD",
    "REMOVE", "CHECK", "A", "AN", "THE", "FOR", "OF", "TO",
  ]);
  const resource = [...parts].reverse().find((p) => !skip.has(p));
  return resource?.toLowerCase();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service.ts tests/service.test.ts
git commit -m "Derive node service from domain tags, not hints."
```

---

### Task 3: Primary-payload extraction

**Files:**
- Create: `src/extract.ts`
- Create: `tests/extract.test.ts`

**Interfaces:**
- Consumes: `RawTool`
- Produces: `extractPrimaryOutputs(tool: RawTool): Field[]`, `extractInputs(tool: RawTool): { required: Field[]; all: Field[] }`, `normalizeTool(tool: RawTool): NormalizedTool | undefined`, `normalizeTools(tools: RawTool[]): NormalizedTool[]`

This is the quality-critical rule: start at `outputParameters.properties.data`, follow `$ref` / `items.$ref`, if the resolved object is a list wrapper walk `issues` / `pull_requests` / `items` / `data` array items, collect fields on that object only, do not recurse into nested `$ref` properties like `user`.

- [ ] **Step 1: Write failing extract tests**

```ts
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
            pull_requests: { type: "array", items: { $ref: "#/$defs/PullRequest" } },
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
        Loop: { properties: { next: { $ref: "#/$defs/Loop" }, id: { description: "id" } } },
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
  assert.deepEqual(required.map((f) => f.name), ["issue_number"]);
  assert.equal(all.length, 2);
});
```

Stub extract functions returning `[]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/extract.test.ts`

Expected: FAIL (empty arrays)

- [ ] **Step 3: Implement extract.ts**

Follow `$ref` with a visited set. Collection keys for wrappers: `issues`, `pull_requests`, `items`, `data`, `results`, `repositories`. If a property is an array of `$ref` objects, treat the resolved item as primary **only when the parent is the wrapper pointed to by `data`** — not when the parent is already a resource object (`GetAWorkflowRunResponse.pull_requests` is nested, skip). Heuristic: a schema is a list wrapper if it has no identifier-like own fields (`id`/`number`/`sha`/`slug`) and has exactly one array-of-objects property, or is named `List*Response` / `Search*Response`. `GetAWorkflowRunResponse` has `id` plus `pull_requests` → not a wrapper → collect `id` only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/extract.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "Extract primary payload fields, ignoring nested ids."
```

---

### Task 4: Classify identifier vs user-provided + resource type

**Files:**
- Create: `src/classify.ts`
- Create: `tests/classify.test.ts`

**Interfaces:**
- Consumes: field name, description, parent def, slug, service
- Produces: `isUserProvided(name: string): boolean`, `isIdentifierField(name: string, description: string): boolean`, `resourceTypeOf(args): string`, `snakeName(name: string): string`

- [ ] **Step 1: Write failing tests**

Cover: `owner`/`repo`/`body`/`page` are user-provided; `issue_number`, `migrationId`, `sha`, `team_slug` are identifiers; `branch` is neither user-provided-as-edge nor identifier; `number` + “Issue number” + `CreateAnIssueResponse` → `issue`; `id` + “issue comment” + `ISSUE_COMMENT` slug → `issue_comment`; commit comment vs gist comment; `migrationId` snake ≡ `migration_id`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement classify.ts**

`snakeName`: camelCase to snake_case, lower.

`isUserProvided`: set including `owner`, `repo`, `org`, `organization`, `username`, `account`, `body`, `title`, `message`, `commit_message`, `commit_title`, `description`, `name`, `page`, `per_page`, `sort`, `direction`, `state`, `since`, `type`, `labels`, `assignee`, `creator`, `mentioned`, `draft`, `merge_method`, `q`, `query`.

`isIdentifierField`: not user-provided; matches `/(_id|_number|_sha|_token|_ref|_slug)$/i` or camelCase `*Id`/`*Number`/`*Sha` or bare `sha`/`node_id` or description matches `/\\b(id|number|sha)\\b/i` of a resource.

`resourceTypeOf`: more specific phrases first (`issue comment`, `commit comment`, `gist comment`, `review comment`, `discussion comment`, `pull request`, `milestone`, `migration`, `workflow run`, …). Then field name minus `_id`/`_number` suffix. `number` + issue description → `issue`. `comment_number` → `discussion_comment`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/classify.ts tests/classify.test.ts
git commit -m "Classify identifier fields and resource types."
```

---

### Task 5: Typed heuristic matcher on a tiny non-GitHub catalog

**Files:**
- Create: `src/match.ts`
- Create: `tests/match.test.ts`
- Create: `tests/fixtures/tiny_catalog.json`

**Interfaces:**
- Consumes: `NormalizedTool[]`
- Produces: `heuristicEdges(tools: NormalizedTool[]): GraphEdge[]`

- [ ] **Step 1: Write tiny fixture and failing tests**

`tests/fixtures/tiny_catalog.json` — ACME toolkit: `ACME_LIST_WIDGETS` primary `id` “Unique identifier of the widget”; `ACME_DELETE_WIDGET` required `widget_id` + `owner`. Nested User.id on list response must not produce user edges.

Tests:
- list widgets → delete widget labeled `widget_id`
- no edge labeled `owner`
- nested user id does not create `user_id` edges
- create-issue-shaped tool (`number` + “Issue number”) → comment tool `issue_number`
- issue comment `id` does not feed a commit-comment `comment_id` consumer
- self-loop refused
- `migrationId` consumer matches `migration_id` producer field via snake_case

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement heuristicEdges**

For each consumer required identifier input, for each other tool’s primary outputs, match if `resourceTypeOf` equal AND name compatible:

- snake names equal, or
- producer `number` fills `{type}_number` / `{type}Number`, or
- producer `id` fills `{type}_id` / `{type}Id`, or
- producer `sha` fills `sha` / `commit_sha` / `head_sha` when both types are `commit`

Skip self-loops. Skip user-provided labels.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/match.ts tests/match.test.ts tests/fixtures/tiny_catalog.json
git commit -m "Match typed identifier producers to consumers."
```

---

### Task 6: Rank, cap, lookup fallback

**Files:**
- Modify: `src/match.ts`
- Modify: `tests/match.test.ts`

**Interfaces:**
- Produces: `rankAndCap(edges: GraphEdge[], tools: NormalizedTool[]): GraphEdge[]`, `lookupFallbackEdges(tools: NormalizedTool[], existing: GraphEdge[]): GraphEdge[]`

- [ ] **Step 1: Write failing tests**

- 10 typed producers for one consumer → at most 8 edges
- a `LIST_` producer of the same resource is kept even if others score higher
- deprecated producer dropped if a non-deprecated match exists
- unmatched `pull_number` consumer gets `LIST_`/`SEARCH_`/`FIND_` tool whose slug contains `PULL` as lookup fallback
- `branch` is not an edge label

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement rankAndCap + lookupFallbackEdges**

Score: list/search/get/create bonus, same service, non-deprecated, description mentions consumer param. Cap 8 per `(to, label)`. Lookup: if identifier consumer has zero edges, add list/search/find tools whose slug shares the resource token (`ISSUE` for `issue_number`, `PULL` for `pull_number`).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/match.ts tests/match.test.ts
git commit -m "Cap producers and add list/search lookup fallback."
```

---

### Task 7: Wire generate() heuristics + env loader

**Files:**
- Create: `src/env.ts`
- Modify: `src/generate.ts`
- Create: `tests/generate.test.ts`

**Interfaces:**
- Produces: `export async function generate(tools: RawTool[]): Promise<Graph>`
- `loadEnv()` reads `.env` into `process.env` without overriding existing vars
- CLI: last argv is catalog path; missing path or bad JSON exit 1; empty catalog writes empty graph exit 0

- [ ] **Step 1: Write failing generate tests**

- tiny catalog → nodes are ACME slugs, one `widget_id` edge, provenance 1.0
- empty catalog → `{ nodes: [], edges: [] }`
- every edge `from`/`to` is a node id; label is an input on `to`

Do not call LLM in this task (`generate` accepts optional `fillIn` that defaults to a no-op here, or `llmFillIn` is not wired yet).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement generate orchestration**

`normalizeTools` → nodes with `serviceOf` → `heuristicEdges` → `rankAndCap` → `lookupFallbackEdges` → unique edges → Graph.

`src/env.ts`: parse `.env` KEY=VALUE lines, skip comments, do not override `process.env`.

CLI `main`: `loadEnv()`; catalog from last argv; write `dependency_graph.json`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/generate.ts src/extract.ts tests/generate.test.ts
git commit -m "Wire heuristic graph generation from a catalog path."
```

---

### Task 8: LLM fill-in with validation and failure fallback

**Files:**
- Create: `src/llm.ts`
- Create: `tests/llm.test.ts`
- Modify: `src/generate.ts` to call `llmFillIn` after heuristics

**Interfaces:**
- Produces: `llmFillIn(tools: NormalizedTool[], existing: GraphEdge[], complete?: ChatComplete): Promise<GraphEdge[]>`
- `ChatComplete = (args: { system: string; user: string }) => Promise<string>`
- Default complete uses OpenAI SDK: `baseURL` from `OPENAI_BASE_URL`, `apiKey` from `OPENAI_API_KEY`, model `process.env.OPENAI_MODEL || "openai/gpt-4o"`
- Only call when some identifier consumer has zero heuristic producers
- Batches grouped by service; compact summaries only
- Validate: both slugs exist, label is required identifier on `to`, not user-provided, resource types compatible
- On throw/parse error: `console.error` and return `[]`

- [ ] **Step 1: Write failing tests with injected complete**

- unmatched consumer: mock returns `[{from,to,label}]` → kept
- mock returns hallucinated slug → dropped
- mock returns `owner` label → dropped
- mock throws → returns `[]` (caller keeps heuristics)
- no unmatched consumers → complete is never called

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement llm.ts and wire generate**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/llm.ts tests/llm.test.ts src/generate.ts
git commit -m "Add validated LLM fill-in with heuristic fallback."
```

---

### Task 9: Visualization

**Files:**
- Create: `src/visualize.ts`
- Create: `tests/visualize.test.ts`
- Modify: `src/generate.ts` to write `graph.html`

**Interfaces:**
- Produces: `renderGraphHtml(graph: Graph): string`

- [ ] **Step 1: Write failing tests**

HTML contains node ids that have edges, edge labels, a search input, and `service` grouping. Isolated nodes are not in the default node list (a `data-default="connected"` marker or class `connected-only`).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement static HTML (inline CSS/JS, no deps)**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/visualize.ts tests/visualize.test.ts src/generate.ts
git commit -m "Render a searchable static graph HTML visualization."
```

---

### Task 10: GitHub quality assertions + selfcheck

**Files:**
- Create: `tests/github_quality.test.ts`
- Modify: `src/generate.ts` / matcher if assertions fail (fix with tests)

**Interfaces:**
- Consumes: real `github_catalog.json` (heuristics only in this test by injecting a no-op LLM, or `generate(tools, { llm: false })`)

- [ ] **Step 1: Write failing quality tests** (may already pass if matcher is correct — if they pass immediately, they still lock the spec; if they fail, fix production code)

Assertions from the spec:

- provenance 1.0
- `GITHUB_LIST_REPOSITORY_ISSUES` → `GITHUB_CREATE_AN_ISSUE_COMMENT` `issue_number`
- `GITHUB_LIST_PULL_REQUESTS` → `GITHUB_MERGE_A_PULL_REQUEST` `pull_number`
- create issue and/or get issue also produce `issue_number` for create comment
- no labels `owner`/`repo`/`body`/`page`/`per_page`
- `GITHUB_GET_A_WORKFLOW_RUN` is not a `pull_number` producer for merge
- `comment_id` edges do not cross issue/commit/gist/review types
- `migrationId` consumer (`GITHUB_ABORT_REPOSITORY_MIGRATION`) has a producer if any migration list/get/create exists; if the catalog has no producer, lookup/LLM may fill — at least the consumer is classified as identifier
- graph has edges

Add `generate(tools, { llm?: boolean })` so this test is deterministic without the network.

- [ ] **Step 2: Run tests; if they fail, they fail on missing edges or extra nested edges — fix extract/match, not the assertions**

- [ ] **Step 3: Run `npm test` then `npm run selfcheck`**

Expected: all tests pass; selfcheck prints `edges` > 0 and `provenance_ratio` 1.

- [ ] **Step 4: Run generator on GitHub catalog (LLM on) and commit `graph.html`**

```bash
set -a && source .env && set +a
npm run generate -- github_catalog.json
```

Commit `graph.html` only (not `dependency_graph.json`, gitignored). Do not commit `.env`.

- [ ] **Step 5: Commit**

```bash
git add tests/github_quality.test.ts src/generate.ts graph.html
git commit -m "Lock GitHub README edges and commit the visualization."
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| CLI / generator.json / JSON shape | 7, 10 |
| Load array/{tools}/{items}, skip slug, empty, duplicates | 1 |
| Service from domain tags | 2 |
| Primary payload + list wrappers + cycles | 3 |
| User-provided vs identifier vs lookup/branch | 4, 6 |
| Typed aliases, comment subtypes, camelCase | 4, 5 |
| Rank/cap 8, keep LIST_, deprecated | 6 |
| LLM fill-in, validate, fallback, token-light batches | 8 |
| Visualization | 9 |
| README examples, nested PR refuse, tiny non-GitHub fixture | 5, 10 |
| Frequent commits | every task step 5 |
| Secrets not in git | `.env` gitignored; `src/env.ts` loader |

## Placeholder scan

No TBD. Function names used later match earlier tasks: `parseCatalog`, `extractPrimaryOutputs`, `heuristicEdges`, `rankAndCap`, `lookupFallbackEdges`, `llmFillIn`, `renderGraphHtml`, `generate`.
