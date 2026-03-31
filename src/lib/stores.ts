import { writable, derived, get } from 'svelte/store';
import type {
  HttpFile, HttpRequest, HttpResponse, Variable,
  EnvironmentFile, NamedRequestResult, PbAssertionResult,
  Workspace, TreeNode, FileNode, FolderNode, RequestLocation,
  FlowDefinition, FlowRunRecord, FlowRunStatus, FlowStepResult,
} from './types';
import { createEmptyRequest, resolveEnvironmentVariables, getEnvironmentNames, serializeHttpFile } from './parser';

// ─── Workspace ──────────────────────────────────────────────────────────────

/** The workspace tree (root folder → subfolders → .http files → requests). */
export const workspace = writable<Workspace>({
  rootPath: null,
  rootName: 'No folder open',
  tree: [],
});

/** Currently selected request location (file path + request index). */
export const selectedLocation = writable<RequestLocation | null>(null);

/** The active response (from the last executed request). */
export const currentResponse = writable<HttpResponse | null>(null);

/** The resolved request that produced the current response. */
export const currentSentRequest = writable<{ method: string; url: string; headers: Record<string, string>; body: string } | null>(null);

/** Loading state. */
export const isLoading = writable<boolean>(false);

// ─── Tabs ────────────────────────────────────────────────────────────────────

export type BottomTab = 'body' | 'assertions' | 'before-send' | 'after-receive';
export type ResponseTab = 'body' | 'headers' | 'request' | 'assertions';

export interface Tab {
  location: RequestLocation;
  /** Display label for the tab */
  label: string;
  /** Cached response for this tab */
  response: HttpResponse | null;
  /** The raw sent request for the Request tab in ResponseViewer */
  sentRequest: { method: string; url: string; headers: Record<string, string>; body: string } | null;
  /** Last active section tab (Body/Assertions) */
  bottomTab: BottomTab;
  /** Last active response tab (Body/Headers/Request/Assertions) */
  responseTab: ResponseTab;
}

function tabKey(loc: RequestLocation): string {
  return `${loc.filePath}::${loc.requestIndex}`;
}

/** Ordered list of pinned tabs. */
export const tabs = writable<Tab[]>([]);

/** Key of the currently active tab (null = preview mode, no pinned tab active). */
export const activeTabKey = writable<string | null>(null);

/** Whether the current selection is a preview (not pinned). */
export const isPreview = derived(
  [selectedLocation, tabs],
  ([$loc, $tabs]) => {
    if (!$loc) return false;
    return !$tabs.some(t => tabKey(t.location) === tabKey($loc));
  }
);

/** Pin a request as a tab. If already pinned, just activate it. */
export function pinTab(loc: RequestLocation, label: string) {
  const key = tabKey(loc);
  tabs.update(ts => {
    if (ts.some(t => tabKey(t.location) === key)) return ts;
    return [...ts, { location: loc, label, response: null, sentRequest: null, bottomTab: 'body', responseTab: 'body' }];
  });
  selectedLocation.set(loc);
  activeTabKey.set(key);
  // Restore cached response for this tab
  const tab = get(tabs).find(t => tabKey(t.location) === key);
  currentResponse.set(tab?.response ?? null);
  currentSentRequest.set(tab?.sentRequest ?? null);
}

/** Activate an existing tab. */
export function activateTab(loc: RequestLocation) {
  const key = tabKey(loc);
  const tab = get(tabs).find(t => tabKey(t.location) === key);
  if (!tab) return;
  // Save current tab's response before switching
  cacheCurrentTabResponse();
  selectedLocation.set(loc);
  activeTabKey.set(key);
  currentResponse.set(tab.response);
  currentSentRequest.set(tab.sentRequest);
}

/** Close a tab. If it was active, activate an adjacent tab or clear selection. */
export function closeTab(loc: RequestLocation) {
  const key = tabKey(loc);
  const currentTabs = get(tabs);
  const idx = currentTabs.findIndex(t => tabKey(t.location) === key);
  if (idx === -1) return;

  const wasActive = get(activeTabKey) === key;
  tabs.update(ts => ts.filter(t => tabKey(t.location) !== key));

  if (wasActive) {
    const remaining = get(tabs);
    if (remaining.length > 0) {
      const nextIdx = Math.min(idx, remaining.length - 1);
      activateTab(remaining[nextIdx].location);
    } else {
      selectedLocation.set(null);
      activeTabKey.set(null);
      currentResponse.set(null);
      currentSentRequest.set(null);
    }
  }
}

/** Save the current response into the active tab's cache. */
export function cacheCurrentTabResponse(
  sentReq?: { method: string; url: string; headers: Record<string, string>; body: string } | null,
) {
  const key = get(activeTabKey);
  if (!key) return;
  const resp = get(currentResponse);
  tabs.update(ts => ts.map(t =>
    tabKey(t.location) === key
      ? { ...t, response: resp, sentRequest: sentReq !== undefined ? sentReq : t.sentRequest }
      : t
  ));
}

/** Preview a request (single-click). Replaces any existing preview but doesn't create a tab. */
export function previewRequest(loc: RequestLocation) {
  // Save current tab's response before switching away
  cacheCurrentTabResponse();
  selectedLocation.set(loc);
  activeTabKey.set(null);
  currentResponse.set(null);
  currentSentRequest.set(null);
}

/** Update tab label when a request is renamed. */
export function updateTabLabel(loc: RequestLocation, label: string) {
  const key = tabKey(loc);
  tabs.update(ts => ts.map(t =>
    tabKey(t.location) === key ? { ...t, label } : t
  ));
}

/** Update the active section tab (Body/Assertions) for a pinned tab. */
export function setTabBottomTab(loc: RequestLocation, bottomTab: BottomTab) {
  const key = tabKey(loc);
  tabs.update(ts => ts.map(t =>
    tabKey(t.location) === key ? { ...t, bottomTab } : t
  ));
}

/** Update the active response tab (Body/Headers/Request/Assertions) for a pinned tab. */
export function setTabResponseTab(loc: RequestLocation, responseTab: ResponseTab) {
  const key = tabKey(loc);
  tabs.update(ts => ts.map(t =>
    tabKey(t.location) === key ? { ...t, responseTab } : t
  ));
}

// ─── Derived: Active File & Request ─────────────────────────────────────────

/** Find a FileNode by path in the workspace tree. */
function findFileNode(nodes: TreeNode[], filePath: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === filePath) return node;
    if (node.type === 'folder') {
      const found = findFileNode(node.children, filePath);
      if (found) return found;
    }
  }
  return null;
}

/** The currently active file node. */
export const activeFile = derived(
  [workspace, selectedLocation],
  ([$ws, $loc]) => {
    if (!$loc) return null;
    return findFileNode($ws.tree, $loc.filePath);
  }
);

/** The currently selected request. */
export const activeRequest = derived(
  [activeFile, selectedLocation],
  ([$file, $loc]) => {
    if (!$file || !$loc) return null;
    return $file.requests[$loc.requestIndex] ?? null;
  }
);

/** File-level variables for the active file. */
export const activeFileVariables = derived(
  activeFile,
  ($file) => $file?.variables ?? []
);

// ─── Tree Mutation Helpers ──────────────────────────────────────────────────

/** Update a FileNode in the tree by path. Returns a new tree (immutable). */
function updateFileInTree(nodes: TreeNode[], filePath: string, updater: (f: FileNode) => FileNode): TreeNode[] {
  return nodes.map(node => {
    if (node.type === 'file' && node.path === filePath) {
      return updater(node);
    }
    if (node.type === 'folder') {
      return { ...node, children: updateFileInTree(node.children, filePath, updater) };
    }
    return node;
  });
}

/** Update a request within a file in the workspace tree. */
export function updateRequestInTree(filePath: string, requestIndex: number, updated: HttpRequest) {
  workspace.update(ws => ({
    ...ws,
    tree: updateFileInTree(ws.tree, filePath, file => {
      const requests = [...file.requests];
      requests[requestIndex] = updated;
      const currentContent = serializeHttpFile(requests, file.variables);
      const dirty = currentContent !== file.savedContent;
      return { ...file, requests, dirty };
    }),
  }));
}

/** Add a new request to a file. */
export function addRequestToFile(filePath: string) {
  const req = createEmptyRequest();
  let newIndex = 0;
  workspace.update(ws => ({
    ...ws,
    tree: updateFileInTree(ws.tree, filePath, file => {
      newIndex = file.requests.length;
      return { ...file, requests: [...file.requests, req], dirty: true };
    }),
  }));
  selectedLocation.set({ filePath, requestIndex: newIndex });
  currentResponse.set(null);
}

/** Delete a request from a file. */
export function deleteRequestFromFile(filePath: string, requestIndex: number) {
  workspace.update(ws => ({
    ...ws,
    tree: updateFileInTree(ws.tree, filePath, file => {
      if (file.requests.length <= 1) return file;
      return {
        ...file,
        requests: file.requests.filter((_, i) => i !== requestIndex),
        dirty: true,
      };
    }),
  }));

  // Fix selection
  const loc = get(selectedLocation);
  if (loc && loc.filePath === filePath) {
    const file = findFileNode(get(workspace).tree, filePath);
    if (file) {
      const maxIdx = file.requests.length - 1;
      if (loc.requestIndex > maxIdx) {
        selectedLocation.set({ filePath, requestIndex: Math.max(0, maxIdx) });
      }
    }
  }
}

/** Mark a file as saved (not dirty). */
export function markFileSaved(filePath: string) {
  workspace.update(ws => ({
    ...ws,
    tree: updateFileInTree(ws.tree, filePath, file => ({
      ...file,
      dirty: false,
      savedContent: serializeHttpFile(file.requests, file.variables),
    })),
  }));
}

/** Toggle a folder's expanded state. */
export function toggleFolder(folderPath: string) {
  function toggle(nodes: TreeNode[]): TreeNode[] {
    return nodes.map(node => {
      if (node.type === 'folder' && node.path === folderPath) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.type === 'folder') {
        return { ...node, children: toggle(node.children) };
      }
      return node;
    });
  }
  workspace.update(ws => ({ ...ws, tree: toggle(ws.tree) }));
}

// ─── Environment State ──────────────────────────────────────────────────────

export const envFile = writable<EnvironmentFile | null>(null);
export const userEnvFile = writable<EnvironmentFile | null>(null);
export const activeEnvironment = writable<string | null>(null);

export const availableEnvironments = derived(
  [envFile, userEnvFile],
  ([$envFile, $userEnvFile]) => {
    const names = new Set<string>();
    for (const name of getEnvironmentNames($envFile)) names.add(name);
    for (const name of getEnvironmentNames($userEnvFile)) names.add(name);
    return Array.from(names).sort();
  }
);

/** Overrides injected by pb.set / pb.global directives at runtime. */
export const pbEnvOverrides = writable<Record<string, string>>({});

export const resolvedEnvVars = derived(
  [activeEnvironment, envFile, userEnvFile, pbEnvOverrides],
  ([$active, $envFile, $userEnvFile, $overrides]) => {
    const base = $active ? resolveEnvironmentVariables($active, $envFile, $userEnvFile) : {};
    return { ...base, ...$overrides };
  }
);

// ─── Named Request Results ──────────────────────────────────────────────────

export const namedResults = writable<Record<string, NamedRequestResult>>({});
export const dotenvVariables = writable<Record<string, string>>({});

// ─── Pb Script State ─────────────────────────────────────────────────────────

/** Assertion results from the most recent request's pb directives. */
export const pbAssertionResults = writable<PbAssertionResult[]>([]);

/** Workspace-global variables set via `# @pb.global(...)`. Persist across requests and files. */
export const pbGlobals = writable<Record<string, string>>({});

// ─── Error / Toast Notifications ────────────────────────────────────────────

export interface Toast {
  id: number;
  message: string;
  type: 'error' | 'warning' | 'info';
}

let nextToastId = 0;

export const toasts = writable<Toast[]>([]);

export function addToast(message: string, type: Toast['type'] = 'error', durationMs = 6000) {
  const id = nextToastId++;
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number) {
  toasts.update(t => t.filter(toast => toast.id !== id));
}

// ─── Test Flows ──────────────────────────────────────────────────────────────

/** All discovered flow definitions keyed by relative file path. */
export const flows = writable<Record<string, FlowDefinition>>({});

/** Relative path to the currently open flow file (null when no flow is open). */
export const activeFlowPath = writable<string | null>(null);

/** The active FlowDefinition, derived from flows + activeFlowPath. */
export const activeFlow = derived(
  [flows, activeFlowPath],
  ([$flows, $path]) => ($path ? $flows[$path] ?? null : null),
);

/** Live execution state for the currently running (or last-run) flow. */
export const flowRunState = writable<{
  status: FlowRunStatus;
  stepResults: FlowStepResult[];
} | null>(null);

/** Persisted history of flow run records, loaded from disk on workspace open. */
export const flowRunHistory = writable<FlowRunRecord[]>([]);

// ─── Flow Tabs ───────────────────────────────────────────────────────────────

export interface FlowTab {
  /** Relative path to the .pb-flow.json file (serves as unique key) */
  flowPath: string;
  /** Display label for the tab */
  label: string;
}

/** Open flow tabs (parallel to the request `tabs` store). */
export const flowTabs = writable<FlowTab[]>([]);

/** Path of the active flow tab (null when a request tab is active). */
export const activeFlowTabPath = writable<string | null>(null);

/** Open a flow as a tab. If already open, just activate it. */
export function openFlowTab(flowPath: string, label: string) {
  flowTabs.update(ts => {
    if (ts.some(t => t.flowPath === flowPath)) return ts;
    return [...ts, { flowPath, label }];
  });
  activateFlowTab(flowPath);
}

/** Activate an existing flow tab. Deactivates any active request tab. */
export function activateFlowTab(flowPath: string) {
  // Save current request tab response before switching away
  cacheCurrentTabResponse();
  activeFlowTabPath.set(flowPath);
  activeFlowPath.set(flowPath);
  // Deactivate request tab selection
  activeTabKey.set(null);
  selectedLocation.set(null);
  currentResponse.set(null);
  currentSentRequest.set(null);
}

/** Close a flow tab. If active, activate an adjacent tab or clear. */
export function closeFlowTab(flowPath: string) {
  const current = get(flowTabs);
  const idx = current.findIndex(t => t.flowPath === flowPath);
  if (idx === -1) return;

  const wasActive = get(activeFlowTabPath) === flowPath;
  flowTabs.update(ts => ts.filter(t => t.flowPath !== flowPath));

  if (wasActive) {
    const remaining = get(flowTabs);
    if (remaining.length > 0) {
      const nextIdx = Math.min(idx, remaining.length - 1);
      activateFlowTab(remaining[nextIdx].flowPath);
    } else {
      activeFlowTabPath.set(null);
      activeFlowPath.set(null);
    }
  }
}
