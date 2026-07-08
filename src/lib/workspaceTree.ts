// Workspace tree builder: turn .http files discovered on disk into the
// TreeNode structure (FolderNode/FileNode) used by the sidebar. Extracted
// from parser.ts. Pure TreeNode walkers and lookups live in tree.ts.

import type { TreeNode, FileNode, FolderNode } from './types';
import { parseHttpFile, serializeHttpFile, createEmptyRequest } from './parser';

// ─── Workspace Tree Builder ─────────────────────────────────────────────────

/**
 * An entry discovered on disk: a file path + its raw content.
 * The path is relative to the workspace root.
 */
export interface DiscoveredFile {
  /** Absolute path */
  absolutePath: string;
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
  /** Raw file contents */
  content: string;
}

/** A directory discovered on disk with no .http files (empty or non-http-only). */
export interface DiscoveredFolder {
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
}

/**
 * Create a FileNode from a parsed .http file.
 */
export function createFileNode(absolutePath: string, fileName: string, content: string): FileNode {
  const { requests, variables } = parseHttpFile(content);
  const reqs = requests.length > 0 ? requests : [createEmptyRequest()];
  const savedContent = serializeHttpFile(reqs, variables);
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables,
    dirty: false,
    savedContent,
  };
}

/**
 * Build a workspace tree from a flat list of discovered .http files and optional empty folders.
 * All FolderNode.path values are absolute (joining rootDir with the relative folder path).
 *
 * Input:  [ { relativePath: "Customers/auth.http", ... }, ... ]
 * Output: FolderNode("Customers") → FileNode("auth.http") → requests
 */
export function buildWorkspaceTree(
  files: DiscoveredFile[],
  emptyFolders: DiscoveredFolder[] = [],
  rootDir = '',
): TreeNode[] {
  const root: TreeNode[] = [];

  // Build an absolute path from the root and a relative folder path.
  // Uses the same separator logic as the absolutePath values in DiscoveredFile.
  function absPath(relPath: string): string {
    if (!rootDir) return relPath;
    const sep = rootDir.includes('\\') ? '\\' : '/';
    return rootDir + sep + relPath.replaceAll('/', sep);
  }

  function ensureFolder(relativePath: string): void {
    const parts = relativePath.split('/');
    let currentLevel = root;
    let currentRelPath = '';

    for (const folderName of parts) {
      currentRelPath += (currentRelPath ? '/' : '') + folderName;

      let folder = currentLevel.find(
        (n): n is FolderNode => n.type === 'folder' && n.name === folderName,
      );

      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: absPath(currentRelPath),
          children: [],
          expanded: false,
        };
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }
  }

  // Pre-create all discovered empty/empty-subtree folder paths so they appear in the tree
  const sortedFolders = [...emptyFolders]
    .filter((f) => !f.relativePath.startsWith('.'))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const folder of sortedFolders) {
    ensureFolder(folder.relativePath);
  }

  // Sort files so folder structure is stable
  const sorted = [...files]
    .filter((f) => !f.relativePath.startsWith('.'))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    const parts = file.relativePath.split('/');
    const fileName = parts.pop()!;

    // Walk/create folder path
    let currentLevel = root;
    let currentRelPath = '';

    for (const folderName of parts) {
      currentRelPath += (currentRelPath ? '/' : '') + folderName;

      let folder = currentLevel.find(
        (n): n is FolderNode => n.type === 'folder' && n.name === folderName,
      );

      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: absPath(currentRelPath),
          children: [],
          expanded: false,
        };
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }

    // Create file node at the correct level
    const fileNode = createFileNode(file.absolutePath, fileName, file.content);
    currentLevel.push(fileNode);
  }

  return root;
}

/**
 * Create a new empty .http file node for adding to the tree.
 */
export function createEmptyFileNode(absolutePath: string, fileName: string): FileNode {
  const reqs = [createEmptyRequest('New Request')];
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables: [],
    dirty: true,
    savedContent: '',
  };
}
