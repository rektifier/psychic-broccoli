import { describe, it, expect } from 'vitest';
import type { FileNode, TreeNode } from './types';
import { getAllFileNodes, createFileNode } from './parser';

// ─── getAllFileNodes (used by flow runner to resolve step targets) ───────────

describe('getAllFileNodes', () => {
  function makeFileNode(path: string, name: string): FileNode {
    return createFileNode(path, name, `GET https://example.com/${name}\n`);
  }

  it('collects files from a flat tree', () => {
    const tree: TreeNode[] = [
      makeFileNode('/root/a.http', 'a.http'),
      makeFileNode('/root/b.http', 'b.http'),
    ];
    const files = getAllFileNodes(tree);
    expect(files).toHaveLength(2);
  });

  it('collects files from nested folders', () => {
    const tree: TreeNode[] = [
      {
        type: 'folder',
        name: 'sub',
        path: '/root/sub',
        children: [makeFileNode('/root/sub/c.http', 'c.http')],
        expanded: false,
      },
      makeFileNode('/root/a.http', 'a.http'),
    ];
    const files = getAllFileNodes(tree);
    expect(files).toHaveLength(2);
  });

  it('returns empty for empty tree', () => {
    expect(getAllFileNodes([])).toEqual([]);
  });

  it('handles deeply nested folders', () => {
    const tree: TreeNode[] = [{
      type: 'folder', name: 'a', path: '/root/a', expanded: false,
      children: [{
        type: 'folder', name: 'b', path: '/root/a/b', expanded: false,
        children: [makeFileNode('/root/a/b/deep.http', 'deep.http')],
      }],
    }];
    const files = getAllFileNodes(tree);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('deep.http');
  });
});

// ─── createFileNode (used by flow runner for workspace tree) ─────────────────

describe('createFileNode', () => {
  it('parses requests from content', () => {
    const node = createFileNode('/root/test.http', 'test.http', 'GET https://example.com\n\n###\n\nPOST https://example.com\n');
    expect(node.requests).toHaveLength(2);
    expect(node.requests[0].method).toBe('GET');
    expect(node.requests[1].method).toBe('POST');
  });

  it('creates a default request for empty content', () => {
    const node = createFileNode('/root/empty.http', 'empty.http', '');
    expect(node.requests).toHaveLength(1);
    expect(node.requests[0].method).toBe('GET');
  });

  it('preserves varName from @name directive', () => {
    const node = createFileNode('/root/test.http', 'test.http', '# @name login\nPOST https://example.com/login\n');
    expect(node.requests[0].varName).toBe('login');
  });

  it('starts as not dirty', () => {
    const node = createFileNode('/root/test.http', 'test.http', 'GET https://example.com\n');
    expect(node.dirty).toBe(false);
  });
});
