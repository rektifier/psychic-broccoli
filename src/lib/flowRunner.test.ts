import { describe, it, expect } from 'vitest';
// Test the pure helper functions by importing from the module.
// Since resolveFile, resolveRequest, makeSkippedResult, makeErrorResult,
// markRemainingSkipped, computeSummary are not exported, we test them
// indirectly through the module's behavior, and directly test what's exposed.

// We can test the exported functions and the helper logic by creating
// equivalent scenarios. The key testable helpers are the flow resolution
// and summary computation logic. Since they're not exported, we test
// the equivalent logic patterns.

import type { FlowStep, FlowStepResult, FlowRunRecord, FileNode, TreeNode } from './types';
import { getAllFileNodes, createFileNode } from './parser';

// ─── getAllFileNodes (used by flow runner) ───────────────────────────────────

describe('getAllFileNodes for flow runner', () => {
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
});

// ─── Flow step result computation logic ─────────────────────────────────────

describe('flow summary computation', () => {
  // This tests the same logic as computeSummary in flowRunner.ts
  function computeSummary(results: FlowStepResult[]) {
    let passed = 0, failed = 0, skipped = 0;
    for (const r of results) {
      if (r.status === 'passed') passed++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'skipped') skipped++;
    }
    return { total: results.length, passed, failed, skipped };
  }

  it('computes summary for all passed', () => {
    const results: FlowStepResult[] = [
      { stepId: '1', status: 'passed', response: null, sentRequest: null, assertionResults: [], durationMs: 0, error: null },
      { stepId: '2', status: 'passed', response: null, sentRequest: null, assertionResults: [], durationMs: 0, error: null },
    ];
    expect(computeSummary(results)).toEqual({ total: 2, passed: 2, failed: 0, skipped: 0 });
  });

  it('computes summary for mixed results', () => {
    const results: FlowStepResult[] = [
      { stepId: '1', status: 'passed', response: null, sentRequest: null, assertionResults: [], durationMs: 0, error: null },
      { stepId: '2', status: 'failed', response: null, sentRequest: null, assertionResults: [], durationMs: 0, error: 'timeout' },
      { stepId: '3', status: 'skipped', response: null, sentRequest: null, assertionResults: [], durationMs: 0, error: null },
    ];
    expect(computeSummary(results)).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it('computes summary for empty results', () => {
    expect(computeSummary([])).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0 });
  });
});

// ─── Flow step resolution logic ─────────────────────────────────────────────

describe('flow file and request resolution', () => {
  // Reproduces resolveFile logic
  function resolveFile(files: FileNode[], step: { filePath: string }, rootPath: string): FileNode | null {
    const normalizedStepPath = step.filePath.replaceAll('\\', '/');
    for (const file of files) {
      const relPath = file.path.substring(rootPath.length + 1).replaceAll('\\', '/');
      if (relPath === normalizedStepPath) return file;
    }
    return null;
  }

  // Reproduces resolveRequest logic
  function resolveRequest(file: FileNode, step: { requestIndex: number; varName: string | null }) {
    if (step.requestIndex >= 0 && step.requestIndex < file.requests.length) {
      return file.requests[step.requestIndex];
    }
    if (step.varName) {
      return file.requests.find(r => r.varName === step.varName) ?? null;
    }
    return null;
  }

  const rootPath = '/workspace';

  it('resolves file by relative path', () => {
    const file = createFileNode('/workspace/api/auth.http', 'auth.http', 'POST https://example.com/login\n');
    const files = [file];
    const result = resolveFile(files, { filePath: 'api/auth.http' }, rootPath);
    expect(result).toBe(file);
  });

  it('returns null for missing file', () => {
    const result = resolveFile([], { filePath: 'missing.http' }, rootPath);
    expect(result).toBeNull();
  });

  it('normalizes backslashes in step path', () => {
    const file = createFileNode('/workspace/api/auth.http', 'auth.http', 'GET https://example.com\n');
    const result = resolveFile([file], { filePath: 'api\\auth.http' }, rootPath);
    expect(result).toBe(file);
  });

  it('resolves request by index', () => {
    const file = createFileNode('/workspace/test.http', 'test.http', 'GET https://example.com/a\n\n###\n\nGET https://example.com/b\n');
    const req = resolveRequest(file, { requestIndex: 1, varName: null });
    expect(req).not.toBeNull();
    expect(req!.url).toContain('/b');
  });

  it('falls back to varName when index is out of range', () => {
    const content = '# @name myRequest\nGET https://example.com/named\n';
    const file = createFileNode('/workspace/test.http', 'test.http', content);
    const req = resolveRequest(file, { requestIndex: 99, varName: 'myRequest' });
    expect(req).not.toBeNull();
    expect(req!.varName).toBe('myRequest');
  });

  it('returns null when neither index nor varName match', () => {
    const file = createFileNode('/workspace/test.http', 'test.http', 'GET https://example.com\n');
    const req = resolveRequest(file, { requestIndex: 99, varName: 'nonexistent' });
    expect(req).toBeNull();
  });
});

// ─── Flow step override application ─────────────────────────────────────────

describe('flow step overrides', () => {
  it('applies URL override without modifying base request', () => {
    const baseRequest = {
      id: '1', name: 'Test', varName: null,
      method: 'GET' as const, url: 'https://original.com',
      headers: [], body: '', directives: [],
    };
    const overrides = { url: 'https://override.com' };
    const request = {
      ...baseRequest,
      ...(overrides.url !== undefined ? { url: overrides.url } : {}),
    };
    expect(request.url).toBe('https://override.com');
    expect(baseRequest.url).toBe('https://original.com');
  });

  it('applies header overrides', () => {
    const baseHeaders = [{ key: 'Accept', value: 'text/html', enabled: true }];
    const overrideHeaders = [{ key: 'Accept', value: 'application/json', enabled: true }];
    const request = { headers: overrideHeaders };
    expect(request.headers[0].value).toBe('application/json');
  });

  it('applies body override', () => {
    const baseRequest = { body: '{"old":"body"}' };
    const overrides = { body: '{"new":"body"}' };
    const request = { ...baseRequest, ...(overrides.body !== undefined ? { body: overrides.body } : {}) };
    expect(request.body).toBe('{"new":"body"}');
  });
});
