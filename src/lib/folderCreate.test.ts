import { describe, it, expect, beforeEach } from 'vitest';
import { generateFolderName } from './folderCreate';
import { addFolderToTree, renameFolderInTree, workspace } from './stores';
import { get } from 'svelte/store';
import type { FolderNode } from './types';

// ─── generateFolderName ──────────────────────────────────────────────────────

describe('generateFolderName', () => {
  it('returns new-folder when no siblings exist', () => {
    expect(generateFolderName(new Set())).toBe('new-folder');
  });

  it('returns new-folder-2 when new-folder already exists', () => {
    expect(generateFolderName(new Set(['new-folder']))).toBe('new-folder-2');
  });

  it('increments counter past all existing collisions', () => {
    expect(generateFolderName(new Set(['new-folder', 'new-folder-2', 'new-folder-3']))).toBe('new-folder-4');
  });
});

// ─── addFolderToTree ─────────────────────────────────────────────────────────

describe('addFolderToTree', () => {
  function makeFolder(path: string, name: string): FolderNode {
    return { type: 'folder', name, path, children: [], expanded: true };
  }

  beforeEach(() => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [] });
  });

  it('adds a folder to the root when parentPath is null', () => {
    addFolderToTree(null, makeFolder('/ws/apis', 'apis'));
    const tree = get(workspace).tree;
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: 'folder', name: 'apis', path: '/ws/apis', expanded: true, children: [] });
  });

  it('adds a subfolder inside an existing folder', () => {
    workspace.set({
      rootPath: '/ws',
      rootName: 'ws',
      tree: [makeFolder('/ws/apis', 'apis')],
    });
    addFolderToTree('/ws/apis', makeFolder('/ws/apis/v1', 'v1'));
    const tree = get(workspace).tree;
    const parent = tree[0] as FolderNode;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toMatchObject({ type: 'folder', name: 'v1', path: '/ws/apis/v1' });
  });

  it('newly added folder is expanded with empty children', () => {
    addFolderToTree(null, makeFolder('/ws/empty', 'empty'));
    const node = get(workspace).tree[0] as FolderNode;
    expect(node.expanded).toBe(true);
    expect(node.children).toEqual([]);
  });
});

// ─── renameFolderInTree ──────────────────────────────────────────────────────

describe('renameFolderInTree', () => {
  beforeEach(() => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [] });
  });

  it('updates the folder name and path at root level', () => {
    workspace.set({
      rootPath: '/ws',
      rootName: 'ws',
      tree: [{ type: 'folder', name: 'old', path: '/ws/old', children: [], expanded: true }],
    });
    renameFolderInTree('/ws/old', '/ws/renamed', 'renamed');
    const tree = get(workspace).tree;
    expect(tree[0]).toMatchObject({ type: 'folder', name: 'renamed', path: '/ws/renamed' });
  });

  it('updates paths of children recursively', () => {
    workspace.set({
      rootPath: '/ws',
      rootName: 'ws',
      tree: [{
        type: 'folder', name: 'apis', path: '/ws/apis', expanded: true,
        children: [
          { type: 'file', name: 'auth.http', path: '/ws/apis/auth.http', requests: [], variables: [], dirty: false, savedContent: '' },
          { type: 'folder', name: 'v2', path: '/ws/apis/v2', children: [], expanded: false },
        ],
      }],
    });
    renameFolderInTree('/ws/apis', '/ws/services', 'services');
    const folder = get(workspace).tree[0] as FolderNode;
    expect(folder.path).toBe('/ws/services');
    expect(folder.children[0]).toMatchObject({ path: '/ws/services/auth.http' });
    expect(folder.children[1]).toMatchObject({ path: '/ws/services/v2' });
  });
});
