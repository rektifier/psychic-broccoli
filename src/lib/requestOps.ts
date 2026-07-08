// ─── Request operations ──────────────────────────────────────────────────────
// Store-driven orchestration for named requests: running a dependency chain
// in topological order and assigning/clearing `# @name` aliases. The actual
// send is injected by the caller (App.svelte's manual sendRequest), which
// owns the UI stores the send updates.

import { get } from 'svelte/store';
import { workspace, namedResults, updateRequestInTree, addToast } from './stores';
import { getAllFileNodes, findFile } from './tree';
import type { HttpRequest } from './types';

/** Resolve the full dependency chain in topological order, then run each unsent request. */
export async function runAllRequests(
  names: string[],
  send: (request: HttpRequest) => Promise<void>,
) {
  const allFiles = getAllFileNodes(get(workspace).tree);
  const depRe = /\{\{(\w+)\.(?:request|response)\./g;

  // Build a lookup: varName -> HttpRequest
  const requestByName = new Map<string, HttpRequest>();
  for (const file of allFiles) {
    for (const req of file.requests) {
      if (req.varName) requestByName.set(req.varName, req);
    }
  }

  // Collect transitive dependencies in execution order (deepest first)
  const ordered: string[] = [];
  const visited = new Set<string>();

  function resolve(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const req = requestByName.get(name);
    if (!req) return;
    // Find this request's own dependencies
    const text = `${req.url} ${req.headers.map((h) => h.value).join(' ')} ${req.body}`;
    let match;
    const re = new RegExp(depRe.source, 'g');
    while ((match = re.exec(text)) !== null) {
      resolve(match[1]);
    }
    ordered.push(name);
  }

  for (const name of names) {
    resolve(name);
  }

  // Execute in order, skipping already-sent requests
  for (const name of ordered) {
    if (get(namedResults)[name]) continue;
    const req = requestByName.get(name);
    if (req) await send(req);
  }
}

/** Set or clear a request's `# @name` alias, rejecting duplicates. */
export function nameRequest(filePath: string, requestIndex: number, varName: string) {
  const tree = get(workspace).tree;
  const file = findFile(tree, filePath);
  if (!file) return;
  const req = file.requests[requestIndex];
  if (!req) return;
  // Block duplicate names
  if (varName) {
    const duplicate = getAllFileNodes(tree).some((f) =>
      f.requests.some(
        (r, ri) => r.varName === varName && !(f.path === filePath && ri === requestIndex),
      ),
    );
    if (duplicate) {
      addToast(`Name "${varName}" is already in use`);
      return;
    }
  }
  // Remove old name from namedResults if it changed or was cleared
  if (req.varName && req.varName !== varName) {
    namedResults.update((nr) => {
      const updated = { ...nr };
      delete updated[req.varName!];
      return updated;
    });
  }
  updateRequestInTree(filePath, requestIndex, { ...req, varName: varName || null });
}
