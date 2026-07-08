import { describe, it, expect } from 'vitest';
import type { TreeNode, FileNode, FolderNode, HttpRequest } from './types';
import {
  visitNodes,
  findFile,
  findFolder,
  getAllFileNodes,
  collectFilePaths,
  removeNodeByPath,
  filterTreeByQuery,
} from './tree';

function req(partial: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: partial.id ?? 'r1',
    name: partial.name ?? 'Request',
    varName: partial.varName ?? null,
    method: partial.method ?? 'GET',
    url: partial.url ?? 'https://example.com',
    headers: [],
    body: '',
    directives: [],
    ...partial,
  };
}

function file(path: string, requests: HttpRequest[] = []): FileNode {
  const name = path.split('/').pop() ?? path;
  return {
    type: 'file',
    name,
    path,
    requests,
    variables: [],
    dirty: false,
    savedContent: '',
  };
}

function folder(path: string, children: TreeNode[]): FolderNode {
  const name = path.split('/').pop() ?? path;
  return { type: 'folder', name, path, children, expanded: false };
}

const tree: TreeNode[] = [
  file('/ws/auth.http', [req({ name: 'Login', url: 'https://api.test/login', varName: 'login' })]),
  folder('/ws/users', [
    file('/ws/users/crud.http', [req({ name: 'Get user', method: 'GET' })]),
    folder('/ws/users/admin', [file('/ws/users/admin/roles.http')]),
  ]),
];

describe('visitNodes', () => {
  it('visits every node depth-first', () => {
    const paths: string[] = [];
    visitNodes(tree, (n) => paths.push(n.path));
    expect(paths).toEqual([
      '/ws/auth.http',
      '/ws/users',
      '/ws/users/crud.http',
      '/ws/users/admin',
      '/ws/users/admin/roles.http',
    ]);
  });

  it('handles an empty tree', () => {
    const visited: string[] = [];
    visitNodes([], (n) => visited.push(n.path));
    expect(visited).toEqual([]);
  });
});

describe('findFile', () => {
  it('finds a file at the top level', () => {
    expect(findFile(tree, '/ws/auth.http')?.name).toBe('auth.http');
  });

  it('finds a nested file', () => {
    expect(findFile(tree, '/ws/users/admin/roles.http')?.name).toBe('roles.http');
  });

  it('returns null for a missing path', () => {
    expect(findFile(tree, '/ws/nope.http')).toBeNull();
  });

  it('does not match a folder with the given path', () => {
    expect(findFile(tree, '/ws/users')).toBeNull();
  });
});

describe('findFolder', () => {
  it('finds a top-level folder', () => {
    expect(findFolder(tree, '/ws/users')?.name).toBe('users');
  });

  it('finds a nested folder', () => {
    expect(findFolder(tree, '/ws/users/admin')?.name).toBe('admin');
  });

  it('returns null for a missing path', () => {
    expect(findFolder(tree, '/ws/missing')).toBeNull();
  });

  it('does not match a file with the given path', () => {
    expect(findFolder(tree, '/ws/auth.http')).toBeNull();
  });
});

describe('getAllFileNodes', () => {
  it('collects all files depth-first', () => {
    expect(getAllFileNodes(tree).map((f) => f.path)).toEqual([
      '/ws/auth.http',
      '/ws/users/crud.http',
      '/ws/users/admin/roles.http',
    ]);
  });

  it('returns an empty array for an empty tree', () => {
    expect(getAllFileNodes([])).toEqual([]);
  });
});

describe('collectFilePaths', () => {
  it('collects all file paths', () => {
    expect(collectFilePaths(tree)).toEqual([
      '/ws/auth.http',
      '/ws/users/crud.http',
      '/ws/users/admin/roles.http',
    ]);
  });
});

describe('removeNodeByPath', () => {
  it('removes a top-level file', () => {
    const result = removeNodeByPath(tree, '/ws/auth.http');
    expect(collectFilePaths(result)).toEqual(['/ws/users/crud.http', '/ws/users/admin/roles.http']);
  });

  it('removes a nested folder and its subtree', () => {
    const result = removeNodeByPath(tree, '/ws/users/admin');
    expect(collectFilePaths(result)).toEqual(['/ws/auth.http', '/ws/users/crud.http']);
    expect(findFolder(result, '/ws/users/admin')).toBeNull();
  });

  it('returns a new tree without mutating the original', () => {
    const result = removeNodeByPath(tree, '/ws/users/crud.http');
    expect(result).not.toBe(tree);
    expect(findFile(tree, '/ws/users/crud.http')).not.toBeNull();
  });

  it('leaves the tree unchanged for a missing path', () => {
    expect(collectFilePaths(removeNodeByPath(tree, '/ws/nope'))).toEqual(collectFilePaths(tree));
  });
});

describe('filterTreeByQuery', () => {
  it('matches on file name', () => {
    const result = filterTreeByQuery(tree, 'auth');
    expect(collectFilePaths(result)).toEqual(['/ws/auth.http']);
  });

  it('matches on request name case-insensitively', () => {
    const result = filterTreeByQuery(tree, 'GET USER');
    expect(collectFilePaths(result)).toEqual(['/ws/users/crud.http']);
  });

  it('matches on request url and varName', () => {
    expect(collectFilePaths(filterTreeByQuery(tree, 'api.test'))).toEqual(['/ws/auth.http']);
    expect(collectFilePaths(filterTreeByQuery(tree, 'login'))).toEqual(['/ws/auth.http']);
  });

  it('expands folders that contain matches', () => {
    const result = filterTreeByQuery(tree, 'roles');
    const users = result[0] as FolderNode;
    expect(users.type).toBe('folder');
    expect(users.expanded).toBe(true);
    const admin = users.children[0] as FolderNode;
    expect(admin.expanded).toBe(true);
  });

  it('drops folders with no matches', () => {
    const result = filterTreeByQuery(tree, 'no-such-thing');
    expect(result).toEqual([]);
  });
});
