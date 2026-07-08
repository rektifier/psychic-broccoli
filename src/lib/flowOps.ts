// ─── Flow file operations ────────────────────────────────────────────────────
// Create/save/duplicate/delete operations for .pb-flow.json files in the open
// workspace. Disk writes go through lib/flowIO.ts; on success the flows store
// and flow tabs are updated. Editor-local UI state (flowUIState) stays in
// App.svelte and is cleaned up by the caller.

import { get } from 'svelte/store';
import { mkdir, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { workspace, flows, flowTabs, openFlowTab, closeFlowTab } from './stores';
import { createEmptyFlow, writeFlowFile, FLOWS_DIR } from './flowIO';
import { safeJoinPath } from './workspaceIO';
import type { FlowDefinition } from './types';

/** Slug used for a flow's file name, derived from its display name. */
function safeFlowFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed'
  );
}

/** Write a flow into the flows directory, register it and open its tab. */
async function writeNewFlow(rootPath: string, flow: FlowDefinition) {
  const safeName = safeFlowFileName(flow.name);
  const flowsDir = await join(rootPath, FLOWS_DIR);
  try {
    await mkdir(flowsDir, { recursive: true });
  } catch {
    /* exists */
  }
  const absolutePath = await join(flowsDir, `${safeName}.pb-flow.json`);
  const relativePath = `${FLOWS_DIR}/${safeName}.pb-flow.json`;

  await writeFlowFile(absolutePath, flow);
  flows.update((f) => ({ ...f, [relativePath]: flow }));
  openFlowTab(relativePath, flow.name);
}

/** Create a new empty flow with the given name and open it. */
export async function createFlow(name: string) {
  const rootPath = get(workspace).rootPath;
  if (!rootPath) return;

  await writeNewFlow(rootPath, createEmptyFlow(name));
}

/** Duplicate an existing flow under "<name> (copy)" with fresh step ids. */
export async function duplicateFlow(sourcePath: string) {
  const sourceFlow = get(flows)[sourcePath];
  if (!sourceFlow) return;
  const rootPath = get(workspace).rootPath;
  if (!rootPath) return;

  const newFlow = {
    ...sourceFlow,
    name: `${sourceFlow.name} (copy)`,
    steps: sourceFlow.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
  };

  await writeNewFlow(rootPath, newFlow);
}

/** Persist a flow definition and sync its tab label. */
export async function saveFlow(flowPath: string, flow: FlowDefinition) {
  const rootPath = get(workspace).rootPath;
  if (!rootPath) return;

  const absolutePath = await safeJoinPath(rootPath, flowPath);
  await writeFlowFile(absolutePath, flow);
  flows.update((f) => ({ ...f, [flowPath]: flow }));

  // Update tab label if the name changed
  flowTabs.update((ts) => ts.map((t) => (t.flowPath === flowPath ? { ...t, label: flow.name } : t)));
}

/** Delete a flow file (best effort) and drop it from the stores and tabs. */
export async function deleteFlow(path: string) {
  const rootPath = get(workspace).rootPath;
  if (!rootPath) return;

  try {
    const absolutePath = await safeJoinPath(rootPath, path);
    await remove(absolutePath);
  } catch {
    // Silently ignore - flow file may not exist on disk
  }

  flows.update((f) => {
    const updated = { ...f };
    delete updated[path];
    return updated;
  });
  closeFlowTab(path);
}
