import { writable, derived, get } from 'svelte/store';
import type {
  HttpFile, HttpRequest, HttpResponse, Variable,
  EnvironmentFile, NamedRequestResult,
  Workspace, TreeNode, FileNode, FolderNode, RequestLocation,
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

/** Loading state. */
export const isLoading = writable<boolean>(false);

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

export const resolvedEnvVars = derived(
  [activeEnvironment, envFile, userEnvFile],
  ([$active, $envFile, $userEnvFile]) => {
    if (!$active) return {};
    return resolveEnvironmentVariables($active, $envFile, $userEnvFile);
  }
);

// ─── Named Request Results ──────────────────────────────────────────────────

export const namedResults = writable<Record<string, NamedRequestResult>>({});
export const dotenvVariables = writable<Record<string, string>>({});
