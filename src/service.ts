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
  "packages",
  "teams",
  "users",
  "git",
  "search",
];

const SLUG_RESOURCES: [string, string][] = [
  ["PULL_REQUEST", "pull"],
  ["PULLS", "pulls"],
  ["ISSUES", "issues"],
  ["ISSUE", "issues"],
  ["CODESPACE", "codespaces"],
  ["WORKFLOW", "actions"],
  ["MIGRATION", "migrations"],
  ["GIST", "gists"],
  ["REPO", "repos"],
  ["ORG", "orgs"],
  ["PROJECT", "projects"],
  ["CHECK", "checks"],
  ["PACKAGE", "packages"],
  ["TEAM", "teams"],
];

export function serviceOf(tool: RawTool, slug: string): string | undefined {
  const tags = (tool.tags ?? []).filter(
    (t: string) => typeof t === "string" && !HINT.has(t) && !t.endsWith("Hint"),
  );
  const domain = tags.find((t: string) => DOMAINS.includes(t.toLowerCase()));
  if (domain) return domain.toLowerCase();
  if (tags.length) {
    return [...tags].sort((a: string, b: string) => b.length - a.length)[0];
  }
  const upper = slug.toUpperCase();
  for (const [token, service] of SLUG_RESOURCES) {
    if (upper.includes(token)) return service;
  }
  const skip = new Set([
    "GITHUB",
    "LIST",
    "GET",
    "CREATE",
    "DELETE",
    "UPDATE",
    "SET",
    "ADD",
    "REMOVE",
    "CHECK",
    "A",
    "AN",
    "THE",
    "FOR",
    "OF",
    "TO",
    "MERGE",
  ]);
  const parts = slug.split("_").filter(Boolean);
  const resource = [...parts].reverse().find((p) => !skip.has(p));
  return resource?.toLowerCase();
}
