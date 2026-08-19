# Dependency graph generator

Date: 2026-08-18

A generator that reads any Composio toolkit catalog and writes `dependency_graph.json`: which tools produce identifiers that other tools need, so an agent knows what to ask the user versus which precursor action to run.

GitHub (`github_catalog.json`, 893 tools) is the development catalog. Relations must be inferred from the catalog handed in, never hardcoded as a finished GitHub graph.

## Goal

Given a catalog path, emit:

```json
{
  "nodes": [{ "id": "GITHUB_CREATE_AN_ISSUE", "service": "issues" }],
  "edges": [{ "from": "GITHUB_LIST_REPOSITORY_ISSUES", "to": "GITHUB_CREATE_AN_ISSUE_COMMENT", "label": "issue_number" }]
}
```

- Node `id` = catalog slug.
- Edge = producer → consumer. `label` = the consumer input the producer fills.
- Quality over density: useful sequencing edges, not “everything shares `owner`/`repo`.”

Required README examples that must appear:

- `GITHUB_LIST_REPOSITORY_ISSUES` → `GITHUB_CREATE_AN_ISSUE_COMMENT` (`issue_number`)
- `GITHUB_LIST_PULL_REQUESTS` → `GITHUB_MERGE_A_PULL_REQUEST` (`pull_number`)

Also: create/get of the same resource should be extra producers (create issue also yields `issue_number`). Multiple producers per consumer field are allowed.

## Working agreement

- Commit after each working slice (extractor, matcher, LLM fill-in, visualization, checks), not one giant commit at the end.
- Spend time on edge cases below; they dominate graph quality more than extra features.
- Do not hardcode a GitHub edge list. GitHub-derived *examples* in tests are fine; the generator must still compute them from the catalog.

## CLI and artifacts

- Entry: `src/generate.ts`. Catalog path is the last CLI argument.
- `generator.json` stays `{ "build": "npm install --legacy-peer-deps", "run": "node --import tsx src/generate.ts" }`.
- Writes `dependency_graph.json` at the working directory (repo root when we run it).
- Also writes a static visualization (e.g. `graph.html`) from the same graph.
- Language: TypeScript via `tsx` (already in the package). LLM via OpenAI SDK, `baseURL`/`apiKey` from env, model `openai/gpt-4o`.

## Pipeline

1. **Load** — JSON array or `{ tools }` / `{ items }`. Skip entries with no slug. Empty catalog → empty graph, not a crash.
2. **Normalize** — per tool: slug, service, required inputs (name, description, schema), primary output fields (name, description, parent def name).
3. **Classify inputs** — user-provided vs identifier vs lookup (rules below).
4. **Heuristic edges** — typed match of primary producers to identifier consumers. No LLM.
5. **Rank and cap** — keep the best producers per `(consumer, label)`.
6. **LLM fill-in** — only unmatched identifier consumers, plus lookup cases. Validate slugs and labels. On LLM failure, keep heuristics.
7. **Assemble** — every catalog slug is a node. Unique `{from,to,label}` edges. Write JSON + HTML.

## Service on nodes

`service` is a domain tag from `tool.tags`, not hint tags (`readOnlyHint`, `openWorldHint`, `mcpIgnore`, `createHint`, …).

Prefer a tag that is a GitHub-style resource area when present (`issues`, `pulls`, `repos`, `actions`, `orgs`, `codespaces`, `projects`, `gists`, …). If several domain tags exist, pick the most specific (longest / least common). If none, derive a coarse service from the slug after the toolkit prefix (`GITHUB_LIST_REPOSITORY_ISSUES` → `issues`). Missing service is allowed (`service` optional in the schema).

## Field classification

### User-provided (never an edge label)

Do not emit edges labeled with:

- Repo/user context: `owner`, `repo`, `org`, `organization`, `username` (actor), `account`
- Free text: `body`, `title`, `message`, `commit_message`, `commit_title`, `description`, `name` (unless the description clearly says it is an opaque id returned by another API)
- Pagination/sort/filter: `page`, `per_page`, `sort`, `direction`, `state`, `since`, `type`, `labels`, `assignee`, `creator`, `mentioned`
- Generic flags and method enums: `draft`, `merge_method`, `maintainer_can_modify`, `make_latest`, …

`branch`, `head`, `base`, `ref` are **not** user-provided *and* not identifier edges by default. They are lookup *inputs* to list/search tools (see Lookup). A tool that requires `branch` does not get an edge from “list branches” just because both mention a branch name — that is usually user context. Exception: `ref` / `sha` / `commit_sha` when the description says it is a commit SHA (identifier).

### Identifier consumers

Required inputs that look like resource handles:

- `*_id`, `*_number`, `*_sha`, `*_token`, `*_ref`, `*_slug` (e.g. `team_slug`)
- camelCase twins: `migrationId`, `pullRequestId`, `projectId`, `userId`, `listId`, `tierId`
- bare `sha`, `node_id` when required
- description contains “the id of”, “issue number”, “pull request number”, “migration id”, etc.

Optional identifier inputs are **not** consumers. Agents can execute without them. This avoids optional `sha` on merge wiring the whole commit graph into merge.

### Lookup (small extra set)

When a consumer needs an id and the agent might only have a *name* (branch, title, search query):

- Always include list/search/get/create of that resource as producers if the primary payload actually yields the id (this is still a normal identifier edge).
- Extra lookup: if heuristic matching misses because the list tool’s primary schema is wrapped oddly, LLM (or a slug-pattern fallback: slug contains `LIST_` / `SEARCH_` / `FIND_` plus the resource token) may add `list/search → consumer` labeled with the id.

The merge example is **not** a special branch→merge edge. It is `LIST_PULL_REQUESTS → MERGE` labeled `pull_number`. Branch is an input to the list call, supplied by the user or another step, not an edge label.

## Producer extraction (the quality-critical rule)

Do **not** harvest every `$defs` object. Nested `User.id`, `Label.id`, `Milestone.number`, `Repository.id` appear on almost every GitHub response and would create garbage edges.

**Primary payload only:**

1. Start at `outputParameters.properties.data`.
2. Follow `$ref` / `items.$ref` through `$defs`.
3. If the resolved object is a list wrapper, walk array `items` or the obvious collection property (`items`, `issues`, `pulls`, `data`).
4. Collect fields on that primary object (and its item type). Stop. Do not recurse into nested object properties (`user`, `labels`, `milestone`, `assignee`, `repository`, `pull_request` on an issue).

Examples from the GitHub catalog:

- `GITHUB_CREATE_AN_ISSUE` primary is `CreateAnIssueResponse`, not `Issue`. Field `number` description: “Issue number within the repository.” → produces `issue_number` (and `id` → `issue_id` if anything consumes it).
- `GITHUB_GET_AN_ISSUE` primary is `GetAnIssueResponse` — same.
- `GITHUB_CREATE_AN_ISSUE_COMMENT` primary `id` is “Unique identifier of the issue comment.” → `comment_id` typed as **issue comment**, not issue number.
- `GITHUB_GET_A_WORKFLOW_RUN` may *contain* a nested `PullRequest`; that does **not** make it a `pull_number` producer.

If `data` has no `$ref` (inline properties), use those properties as the primary object.

## Typed matching (no LLM)

Normalize names: snake_case and camelCase (`migration_id` ≡ `migrationId`). Exact name match is not enough by itself (`comment_id` is used for issue, commit, gist, and review comments).

Give every produced field and every consumer param a **resource type** derived from, in order:

1. Field/param description (“issue comment”, “pull request number”, “commit SHA”)
2. Primary def name (`CreateAnIssueResponse`, `CommitComment`)
3. Tool slug tokens (`ISSUE_COMMENT`, `COMMIT_COMMENT`, `GIST`, `PULL_REQUEST`, `MILESTONE`)
4. Domain `service` / tags

Match only when resource types are compatible:

| Producer field (primary) | Consumer | Resource type |
| --- | --- | --- |
| `number` + “issue number” | `issue_number` | issue |
| `number` + “pull request” | `pull_number`, `pull_request_id`, `pullRequestId` | pull_request |
| `number` + “milestone” | `milestone_number` | milestone |
| `number` + “discussion” | `discussion_number` | discussion |
| `id` + “issue comment” | `comment_id` on an *issue comment* tool | issue_comment |
| `id` + “commit comment” | `comment_id` on a *commit comment* tool | commit_comment |
| `id` + “gist comment” | `comment_id` on a *gist* tool | gist_comment |
| discussion `comment_number` | `comment_number` | discussion_comment |
| `sha` / `commit_sha` / `head_sha` | `sha`, `commit_sha`, `head_sha`, `file_sha` only if descriptions agree (file blob vs commit) | commit or blob |
| `run_id`, `job_id`, `workflow_id`, `check_run_id`, `gist_id`, `hook_id`, `runner_id`, `deployment_id`, `release_id`, `installation_id`, `artifact_id`, `codespace_name`, `team_slug`, … | same name / camelCase twin / description | that resource |

**Refuse:**

- `Milestone.number` nested on an issue → `issue_number` or `milestone_number` from GET_ISSUE (nested, not primary)
- `User.id` → `user_id` from issue payloads (nested). List-users / get-user primary payload *does* produce `user_id`
- `SimpleUser.id` (111 occurrences in this catalog) as a producer
- Self-loops
- `from`/`to` not in the catalog
- Label that is not an input on `to`
- Deprecated tools as producers unless they are the only typed match
- `owner` / `repo` / `body` / pagination as labels

## Ranking and caps

For each `(consumer slug, label)` keep at most **8** producers, scored:

1. Resource type match (required)
2. Producer slug looks like list/search/get/create of that resource (`LIST_`, `SEARCH_`, `FIND_`, `GET_A_`, `CREATE_`)
3. Same `service` as the consumer
4. Non-deprecated over deprecated
5. Prefer tools whose *primary* field description names the consumer param (`issue_number`) over weak aliases

This keeps list/create/get issue as producers for comments, and drops incidental workflow-run → merge.

If more than 8 pass, drop the lowest scores. Never drop the list/search producer of the same resource if it scored as a typed match — those are the README-shaped edges.

## LLM fill-in

Use only when:

- An identifier consumer has **zero** heuristic producers, or
- Lookup: consumer needs an id and no list/search producer was attached

Input per batch: compact summaries only (slug, service, required identifier params with descriptions, primary produced fields with descriptions). Never the raw 8MB catalog.

Output: JSON array of `{ from, to, label }`. Keep a row only if:

- both slugs exist in the catalog
- `label` is a required identifier input on `to`
- `label` is not in the user-provided set
- resource types are not obviously contradictory (issue producer → `pull_number` is dropped)

On timeout, parse error, missing `OPENAI_API_KEY` / `OPENAI_BASE_URL`, or quota error: log to stderr and continue with heuristic edges. Do not exit 1 if heuristics already produced a valid graph.

Do not send more than a small number of batches; this assessment has a token budget. Prefer grouping consumers by service.

## Visualization

Static `graph.html` generated from the JSON (no extra grader dependency). 893 isolated nodes are unreadable, so:

- Default view: only nodes that have at least one edge, clustered by `service`
- Search/filter by slug
- Edge labels visible
- Full node list available but not the default layout

Must make the two README examples inspectable without hunting.

## Error handling

| Situation | Behavior |
| --- | --- |
| No catalog argument | exit 1, short message |
| Unreadable / invalid JSON | exit 1 |
| Catalog is empty list | write `{ nodes: [], edges: [] }`, exit 0 |
| Tool missing slug | skip |
| Tool missing input/output schemas | node only, no edges from/to it unless the other side has schema |
| `$ref` cycle | visited-set; stop |
| `oneOf` / `anyOf` / `array` | union of object branches; walk `items` |
| LLM failure | heuristics only, stderr warning |
| Duplicate slugs | first wins; warn |

## Checks (local + selfcheck)

`npm run selfcheck` remains the grader-shaped invocation.

Additional local assertions (script or tests, run before calling the graph done):

- provenance = 1.0 (every node id is a catalog slug, case-insensitive as in selfcheck)
- every `from`/`to` is a node id
- every `label` is a real input on `to`
- README edges present (list issues → create comment `issue_number`; list PRs → merge `pull_number`)
- create issue and get issue are also `issue_number` producers for create comment (or at least create *or* get, plus list)
- no edges labeled `owner`, `repo`, `body`, `page`, `per_page`
- `GITHUB_GET_A_WORKFLOW_RUN` is not a `pull_number` producer for merge (nested PR)
- `comment_id` edges do not cross issue/commit/gist/review comment types
- `migrationId` / `migration_id` consumers attach to a migration list/get/create if present in the catalog
- graph has edges (has-edges gate)
- a second tiny fixture catalog (non-GitHub slugs) still yields slug-correct nodes and at least one inferred edge, proving we do not hardcode GitHub

## Catalog edge cases we already measured (GitHub)

- 197 distinct required inputs; `owner`/`repo` dominate (442/441). Ignoring them is mandatory.
- 89 identifier-like required names, including both `migration_id` and `migrationId`.
- `comment_id` (22) vs `comment_number` (6) vs gist/commit/issue/review: same param name, different resources.
- Primary def names are per-endpoint (`CreateAnIssueResponse`, `GetAnIssueResponse`), not a shared `Issue` type. Matching on def name `Issue` would miss create/get.
- `GITHUB_CREATE_AN_ISSUE` also `$def`s a `PullRequest` object; only the primary response’s `number` is the issue number.
- Nested `SimpleUser.id` appears on 111 tools; never a producer unless the user *is* the primary item (list collaborators, get user).
- 22 deprecated tools: prefer not to use as producers.
- 65 tools with no required inputs: nodes only unless they produce identifiers others consume.
- `name` is required 48 times (secrets, etc.): treat as user-provided.
- `branch` required 38 times: lookup input, not an identifier edge by default.

## Out of scope

- Multi-hop paths as single edges (list → get → comment). Direct producer → consumer only; the agent chains.
- Executing tools or calling GitHub/Composio APIs.
- A perfect graph of every optional parameter.
- Interactive visualization servers.

## Implementation order (commits)

1. Catalog load + primary-payload field extraction + fixture test catalog
2. Classifier + typed heuristic matcher + README assertions
3. Rank/cap + GitHub edge-case assertions (nested ids, comment types, camelCase)
4. LLM fill-in with validation and failure fallback
5. Visualization + `npm run selfcheck` green + tiny non-GitHub fixture
