// Workspace tree utilities: typed walkers and lookups over TreeNode[].

import type { TreeNode, FileNode, FolderNode } from './types';

/** Depth-first visit of every node in the tree. */
export function visitNodes(nodes: TreeNode[], visit: (node: TreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'folder') visitNodes(node.children, visit);
  }
}

/** Find a FileNode by absolute path. */
export function findFile(nodes: TreeNode[], filePath: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === filePath) return node;
    if (node.type === 'folder') {
      const found = findFile(node.children, filePath);
      if (found) return found;
    }
  }
  return null;
}

/** Find a FolderNode by absolute path. */
export function findFolder(nodes: TreeNode[], folderPath: string): FolderNode | null {
  for (const node of nodes) {
    if (node.type === 'folder') {
      if (node.path === folderPath) return node;
      const found = findFolder(node.children, folderPath);
      if (found) return found;
    }
  }
  return null;
}

/** All FileNodes in the tree, depth-first. */
export function getAllFileNodes(nodes: TreeNode[]): FileNode[] {
  const result: FileNode[] = [];
  visitNodes(nodes, (node) => {
    if (node.type === 'file') result.push(node);
  });
  return result;
}

/** Absolute paths of every file in the tree, depth-first. */
export function collectFilePaths(nodes: TreeNode[]): string[] {
  return getAllFileNodes(nodes).map((f) => f.path);
}

/** Remove the node with the given path (and its subtree). Returns a new tree. */
export function removeNodeByPath(nodes: TreeNode[], path: string): TreeNode[] {
  return nodes
    .filter((n) => n.path !== path)
    .map((n) => (n.type === 'folder' ? { ...n, children: removeNodeByPath(n.children, path) } : n));
}

/**
 * Filter the tree to files whose name or requests match the query
 * (request name, url, method or `# @name`). Folders that contain a match
 * are kept and expanded.
 */
export function filterTreeByQuery(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.toLowerCase();
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      const fileMatch = node.name.toLowerCase().includes(q);
      const reqMatch = node.requests.some(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.method.toLowerCase().includes(q) ||
          (r.varName && r.varName.toLowerCase().includes(q)),
      );
      if (fileMatch || reqMatch) result.push(node);
    } else {
      const filteredChildren = filterTreeByQuery(node.children, query);
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren, expanded: true });
      }
    }
  }
  return result;
}
