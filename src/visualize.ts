import type { Graph } from "./types.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderGraphHtml(graph: Graph): string {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const byService = new Map<string, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const service = node.service ?? "other";
    const list = byService.get(service) ?? [];
    list.push(node);
    byService.set(service, list);
  }
  const services = [...byService.keys()].sort();
  const nodeBlocks = services
    .map((service) => {
      const nodes = (byService.get(service) ?? [])
        .map((node) => {
          const isConnected = connected.has(node.id);
          return `<span class="node" data-id="${escapeHtml(node.id)}" data-connected="${isConnected}" data-service="${escapeHtml(service)}">${escapeHtml(node.id)}</span>`;
        })
        .join("\n");
      return `<section class="service" data-service="${escapeHtml(service)}"><h2>${escapeHtml(service)}</h2><div class="nodes">${nodes}</div></section>`;
    })
    .join("\n");
  const edgeBlocks = graph.edges
    .map(
      (edge) =>
        `<li class="edge" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" data-label="${escapeHtml(edge.label ?? "")}">${escapeHtml(edge.from)} → ${escapeHtml(edge.to)} <code>${escapeHtml(edge.label ?? "")}</code></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Toolkit dependency graph</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 1.5rem; color: #111; }
    header { position: sticky; top: 0; background: #fff; padding-bottom: 1rem; }
    input[type="search"] { width: min(40rem, 100%); padding: 0.4rem 0.6rem; }
    .node { display: inline-block; margin: 0.15rem; padding: 0.15rem 0.4rem; background: #eef; border-radius: 4px; font-size: 12px; }
    .node[data-connected="false"] { background: #eee; color: #888; }
    body[data-default="connected"] .node[data-connected="false"] { display: none; }
    .edge.hidden, .node.hidden, .service.hidden { display: none; }
    code { background: #f4f4f4; padding: 0 0.25rem; }
  </style>
</head>
<body data-default="connected">
  <header>
    <h1>Toolkit dependency graph</h1>
    <p>${graph.nodes.length} nodes, ${graph.edges.length} edges. Default view hides isolated tools.</p>
    <input type="search" id="q" placeholder="Filter by slug or label"/>
    <label><input type="checkbox" id="connected-only" checked/> Connected only</label>
  </header>
  ${nodeBlocks}
  <h2>Edges</h2>
  <ul id="edges">${edgeBlocks}</ul>
  <script>
    const q = document.getElementById("q");
    const connectedOnly = document.getElementById("connected-only");
    function apply() {
      const term = (q.value || "").toLowerCase();
      document.body.dataset.default = connectedOnly.checked ? "connected" : "all";
      for (const node of document.querySelectorAll(".node")) {
        const id = node.dataset.id.toLowerCase();
        node.classList.toggle("hidden", term && !id.includes(term));
      }
      for (const edge of document.querySelectorAll(".edge")) {
        const hay = (edge.dataset.from + " " + edge.dataset.to + " " + edge.dataset.label).toLowerCase();
        edge.classList.toggle("hidden", term && !hay.includes(term));
      }
    }
    q.addEventListener("input", apply);
    connectedOnly.addEventListener("change", apply);
  </script>
</body>
</html>`;
}
