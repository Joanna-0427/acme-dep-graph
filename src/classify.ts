const USER_PROVIDED = new Set([
  "owner",
  "repo",
  "org",
  "organization",
  "username",
  "account",
  "body",
  "title",
  "message",
  "commit_message",
  "commit_title",
  "description",
  "name",
  "page",
  "per_page",
  "sort",
  "direction",
  "state",
  "since",
  "type",
  "labels",
  "assignee",
  "creator",
  "mentioned",
  "draft",
  "merge_method",
  "q",
  "query",
]);

export function snakeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function isUserProvided(name: string): boolean {
  return USER_PROVIDED.has(snakeName(name));
}

export function isIdentifierField(name: string, description: string): boolean {
  if (isUserProvided(name)) return false;
  const snake = snakeName(name);
  if (
    /(_id|_number|_sha|_token|_ref|_slug)$/.test(snake) ||
    /^(sha|node_id|id)$/.test(snake)
  ) {
    return true;
  }
  const desc = description.toLowerCase();
  if (/\b(the id of|identifier of|issue number|pull request number|migration id)\b/.test(desc)) {
    return true;
  }
  return false;
}

export function resourceTypeOf(args: {
  fieldName: string;
  description: string;
  parentDefName?: string;
  slug: string;
  service?: string;
}): string {
  const snake = snakeName(args.fieldName);
  const slug = args.slug.toUpperCase();
  const text = `${args.fieldName} ${args.description} ${args.parentDefName ?? ""} ${args.slug} ${args.service ?? ""}`
    .toLowerCase()
    .replace(/_/g, " ");

  if (snake === "issue_number") return "issue";
  if (snake === "pull_number" || snake === "pull_request_id") return "pull_request";
  if (snake === "comment_number") return "discussion_comment";
  if (snake === "milestone_number") return "milestone";
  if (snake === "migration_id") return "migration";

  if (/issue comment/.test(text) || slug.includes("ISSUE_COMMENT")) return "issue_comment";
  if (/commit comment/.test(text) || slug.includes("COMMIT_COMMENT")) return "commit_comment";
  if (/gist comment/.test(text) || /GIST.*COMMENT/.test(slug)) return "gist_comment";
  if (/review comment/.test(text) || slug.includes("REVIEW_COMMENT")) return "review_comment";
  if (/discussion comment/.test(text) || slug.includes("DISCUSSION_COMMENT")) {
    return "discussion_comment";
  }
  if (/pull request/.test(text) || slug.includes("PULL_REQUEST")) return "pull_request";
  if (/milestone/.test(text)) return "milestone";
  if (/discussion/.test(text) && /number/.test(snake)) return "discussion";
  if (/\bissue\b/.test(text) || /(?:^|_)ISSUE(?:_|$)/.test(slug)) return "issue";
  if (/migration/.test(text) || snake.startsWith("migration")) return "migration";
  if (snake === "file_sha" || /\bblob\b/.test(text)) return "blob";
  if (
    snake === "sha" ||
    snake === "commit_sha" ||
    snake === "head_sha" ||
    /\bcommit sha\b/.test(text)
  ) {
    return "commit";
  }

  if (snake === "id" || snake === "number") {
    const ofThe =
      /(?:identifier|id|number) (?:of|for) (?:the )?([a-z0-9 ]+?)(?:\.|$)/i.exec(
        args.description,
      );
    if (ofThe) {
      const token = ofThe[1].trim().replace(/\s+/g, "_").replace(/s$/, "");
      if (token) return snakeName(token);
    }
  }

  const base = snake.replace(/_(id|number|sha|token|ref|slug)$/, "");
  if (base && base !== snake) return base;
  return "unknown";
}
