import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  basename: vi.fn(async (p: string) => p.split('/').pop() ?? p),
  dirname: vi.fn(async (p: string) => p.split('/').slice(0, -1).join('/')),
}));

vi.mock('./requestExec', () => ({
  executeHttpRequest: vi.fn(),
}));

vi.mock('./flowRunner', () => ({
  runFlow: vi.fn(),
}));

import { emit, listen } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { executeHttpRequest } from './requestExec';
import { runFlow } from './flowRunner';
import {
  collectWorkspaceRequests,
  executeRequestSilently,
  executeFlowSilently,
  snapshotLastResult,
  handleBridgeRequest,
  startMcpBridge,
} from './mcpBridge';
import {
  workspace,
  activeEnvironment,
  envFile,
  userEnvFile,
  pbGlobals,
  pbFileOverrides,
  namedResults,
  dotenvVariables,
  currentResponse,
  pbAssertionResults,
  varSourcePrefs,
} from './stores';
import type { ExecutedRequest } from './requestExec';
import type { FileNode, HttpRequest, HttpResponse, FlowRunRecord } from './types';

const mockedEmit = vi.mocked(emit);
const mockedListen = vi.mocked(listen);
const mockedReadTextFile = vi.mocked(readTextFile);
const mockedExecute = vi.mocked(executeHttpRequest);
const mockedRunFlow = vi.mocked(runFlow);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: 'req-1',
    name: 'Get user',
    varName: null,
    method: 'GET',
    url: 'https://api.example.com/users/1',
    headers: [],
    body: '',
    directives: [],
    ...overrides,
  };
}

function makeFileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    type: 'file',
    name: 'users.http',
    path: '/ws/users.http',
    requests: [makeRequest()],
    variables: [],
    dirty: false,
    savedContent: '',
    ...overrides,
  };
}

function makeResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"id":1}',
    time: 42,
    size: 8,
    ...overrides,
  };
}

function makeExecuted(overrides: Partial<ExecutedRequest> = {}): ExecutedRequest {
  return {
    sentRequest: { method: 'GET', url: 'https://api.example.com/users/1', headers: {}, body: '' },
    response: makeResponse(),
    assertionResults: [{ label: 'Should return 200', passed: true }],
    beforeSend: { setVars: {}, globalVars: {} },
    afterReceive: { setVars: {}, globalVars: {} },
    namedResult: null,
    ...overrides,
  };
}

function makeRunRecord(overrides: Partial<FlowRunRecord> = {}): FlowRunRecord {
  return {
    id: 'run-1',
    flowName: 'Smoke',
    flowFilePath: '.flows/smoke.pb-flow.json',
    environment: null,
    startedAt: '2026-07-08T00:00:00Z',
    completedAt: '2026-07-08T00:00:01Z',
    status: 'completed',
    stepResults: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    ...overrides,
  };
}

const flowJson = JSON.stringify({
  version: 1,
  name: 'Smoke',
  description: '',
  steps: [
    {
      id: 's1',
      filePath: 'users.http',
      requestIndex: 0,
      varName: null,
      aliasLocked: false,
      label: 'GET /users/1',
      continueOnFailure: false,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  workspace.set({ rootPath: null, rootName: '', tree: [] });
  activeEnvironment.set(null);
  envFile.set(null);
  userEnvFile.set(null);
  pbGlobals.set({});
  pbFileOverrides.set({});
  namedResults.set({});
  dotenvVariables.set({});
  currentResponse.set(null);
  pbAssertionResults.set([]);
  varSourcePrefs.set({});
});

// ─── collectWorkspaceRequests ────────────────────────────────────────────────

describe('collectWorkspaceRequests', () => {
  it('returns [] when no workspace is open', () => {
    expect(collectWorkspaceRequests()).toEqual([]);
  });

  it('lists every request with workspace-relative paths', () => {
    const file = makeFileNode({
      path: '/ws/api/users.http',
      requests: [makeRequest(), makeRequest({ id: 'req-2', name: 'Create user', method: 'POST' })],
    });
    workspace.set({
      rootPath: '/ws',
      rootName: 'ws',
      tree: [{ type: 'folder', name: 'api', path: '/ws/api', children: [file], expanded: true }],
    });

    expect(collectWorkspaceRequests()).toEqual([
      {
        filePath: 'api/users.http',
        requestIndex: 0,
        name: 'Get user',
        method: 'GET',
        url: 'https://api.example.com/users/1',
      },
      {
        filePath: 'api/users.http',
        requestIndex: 1,
        name: 'Create user',
        method: 'POST',
        url: 'https://api.example.com/users/1',
      },
    ]);
  });
});

// ─── executeRequestSilently ──────────────────────────────────────────────────

describe('executeRequestSilently', () => {
  it('throws when no workspace folder is open', async () => {
    await expect(
      executeRequestSilently({ filePath: 'users.http', requestIndex: 0 }),
    ).rejects.toThrow('No workspace folder is open');
  });

  it('throws when the file is not in the workspace', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    await expect(
      executeRequestSilently({ filePath: 'missing.http', requestIndex: 0 }),
    ).rejects.toThrow('File not found in workspace: missing.http');
  });

  it('throws when the request index is out of range', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    await expect(
      executeRequestSilently({ filePath: 'users.http', requestIndex: 5 }),
    ).rejects.toThrow('No request at index 5 in users.http');
  });

  it('executes the request and maps the result shape', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    mockedExecute.mockResolvedValue(makeExecuted());

    const result = await executeRequestSilently({ filePath: 'users.http', requestIndex: 0 });

    expect(result).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"id":1}',
      time: 42,
      assertions: [{ label: 'Should return 200', passed: true }],
    });
  });

  it('uses the fully-resolved store variables for the active environment', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    envFile.set({ $shared: { shared: 'a' }, dev: { host: 'dev.example.com' } });
    activeEnvironment.set('dev');
    pbGlobals.set({ token: 'g-123' });
    mockedExecute.mockResolvedValue(makeExecuted());

    await executeRequestSilently({ filePath: 'users.http', requestIndex: 0 });

    const ctx = mockedExecute.mock.calls[0][1];
    expect(ctx.environmentVariables).toMatchObject({
      shared: 'a',
      host: 'dev.example.com',
      token: 'g-123',
    });
  });

  it('resolves a non-active environment fresh from the env files', async () => {
    const file = makeFileNode();
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [file] });
    envFile.set({
      $shared: { shared: 'a' },
      dev: { host: 'dev.example.com' },
      prod: { host: 'prod.example.com' },
    });
    activeEnvironment.set('dev');
    pbGlobals.set({ token: 'g-123' });
    pbFileOverrides.set({ [file.path]: { userId: '42' } });
    mockedExecute.mockResolvedValue(makeExecuted());

    await executeRequestSilently({
      filePath: 'users.http',
      requestIndex: 0,
      environment: 'prod',
    });

    const ctx = mockedExecute.mock.calls[0][1];
    expect(ctx.environmentVariables).toEqual({
      shared: 'a',
      host: 'prod.example.com',
      token: 'g-123',
      userId: '42',
    });
  });

  it('falls back to pb globals only when no environment exists', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    pbGlobals.set({ token: 'g-123' });
    mockedExecute.mockResolvedValue(makeExecuted());

    await executeRequestSilently({ filePath: 'users.http', requestIndex: 0 });

    const ctx = mockedExecute.mock.calls[0][1];
    expect(ctx.environmentVariables).toEqual({ token: 'g-123' });
  });

  it('never commits pb effects or named results to the stores', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
    mockedExecute.mockResolvedValue(
      makeExecuted({
        afterReceive: { setVars: { a: '1' }, globalVars: { b: '2' } },
        namedResult: {
          name: 'login',
          result: {
            request: { url: 'u', method: 'GET', headers: {}, body: '' },
            response: makeResponse(),
          },
        },
      }),
    );

    await executeRequestSilently({ filePath: 'users.http', requestIndex: 0 });

    expect(get(namedResults)).toEqual({});
    expect(get(pbGlobals)).toEqual({});
    expect(get(pbFileOverrides)).toEqual({});
    expect(get(currentResponse)).toBeNull();
  });
});

// ─── executeFlowSilently ─────────────────────────────────────────────────────

describe('executeFlowSilently', () => {
  beforeEach(() => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });
  });

  it('throws when no workspace folder is open', async () => {
    workspace.set({ rootPath: null, rootName: '', tree: [] });
    await expect(
      executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' }),
    ).rejects.toThrow('No workspace folder is open');
  });

  it('rejects paths that are not .pb-flow.json files', async () => {
    await expect(executeFlowSilently({ flowFilePath: 'users.http' })).rejects.toThrow(
      'Not a flow file (expected .pb-flow.json): users.http',
    );
  });

  it('throws when the flow file cannot be read', async () => {
    mockedReadTextFile.mockRejectedValue(new Error('ENOENT'));
    await expect(
      executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' }),
    ).rejects.toThrow('Flow file not found: .flows/smoke.pb-flow.json');
  });

  it('throws when the flow file is not valid JSON', async () => {
    mockedReadTextFile.mockResolvedValue('nonsense{');
    await expect(
      executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' }),
    ).rejects.toThrow('Flow file is not valid JSON: .flows/smoke.pb-flow.json');
  });

  it('throws when the JSON is not a flow definition', async () => {
    mockedReadTextFile.mockResolvedValue('{"name":"x"}');
    await expect(
      executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' }),
    ).rejects.toThrow('Not a valid flow file: .flows/smoke.pb-flow.json');
  });

  it('maps step results, splitting network errors out of failed', async () => {
    mockedReadTextFile.mockResolvedValue(flowJson);
    mockedRunFlow.mockResolvedValue(
      makeRunRecord({
        stepResults: [
          {
            stepId: 's1',
            status: 'failed',
            response: null,
            sentRequest: null,
            assertionResults: [],
            durationMs: 10,
            error: 'connection refused',
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    );

    const result = await executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' });

    expect(result.status).toBe('error');
    expect(result.steps).toEqual([
      {
        id: 's1',
        label: 'GET /users/1',
        status: 'error',
        durationMs: 10,
        assertions: [],
        error: 'connection refused',
      },
    ]);
    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0 });
  });

  it('reports failed when an assertion fails without a network error', async () => {
    mockedReadTextFile.mockResolvedValue(flowJson);
    mockedRunFlow.mockResolvedValue(
      makeRunRecord({
        stepResults: [
          {
            stepId: 's1',
            status: 'failed',
            response: makeResponse({ status: 500 }),
            sentRequest: null,
            assertionResults: [{ label: 'Should return 200', passed: false }],
            durationMs: 12,
            error: null,
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    );

    const result = await executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' });

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].assertions).toEqual([{ label: 'Should return 200', passed: false }]);
  });

  it('reports passed when all steps pass', async () => {
    mockedReadTextFile.mockResolvedValue(flowJson);
    mockedRunFlow.mockResolvedValue(
      makeRunRecord({
        stepResults: [
          {
            stepId: 's1',
            status: 'passed',
            response: makeResponse(),
            sentRequest: null,
            assertionResults: [],
            durationMs: 5,
            error: null,
          },
        ],
        summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      }),
    );

    const result = await executeFlowSilently({ flowFilePath: '.flows/smoke.pb-flow.json' });
    expect(result.status).toBe('passed');
  });

  it('passes the requested environment variables to runFlow', async () => {
    envFile.set({ $shared: {}, dev: { host: 'dev' }, prod: { host: 'prod' } });
    activeEnvironment.set('dev');
    pbGlobals.set({ token: 'g' });
    mockedReadTextFile.mockResolvedValue(flowJson);
    mockedRunFlow.mockResolvedValue(makeRunRecord());

    await executeFlowSilently({
      flowFilePath: '.flows/smoke.pb-flow.json',
      environment: 'prod',
    });

    const envVars = mockedRunFlow.mock.calls[0][3];
    expect(envVars).toEqual({ host: 'prod', token: 'g' });
    expect(mockedRunFlow.mock.calls[0][5]).toBe('prod');
  });
});

// ─── snapshotLastResult ──────────────────────────────────────────────────────

describe('snapshotLastResult', () => {
  it('returns null when no request has run yet', () => {
    expect(snapshotLastResult()).toBeNull();
  });

  it('returns the last response with assertion results', () => {
    currentResponse.set(makeResponse());
    pbAssertionResults.set([{ label: 'ok', passed: true }]);

    expect(snapshotLastResult()).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"id":1}',
      time: 42,
      assertions: [{ label: 'ok', passed: true }],
    });
  });
});

// ─── handleBridgeRequest ─────────────────────────────────────────────────────

describe('handleBridgeRequest', () => {
  it('responds ok with data for list_requests', async () => {
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [makeFileNode()] });

    await handleBridgeRequest({ id: 'r1', kind: 'list_requests', params: null });

    expect(mockedEmit).toHaveBeenCalledWith('mcp:response', {
      id: 'r1',
      ok: true,
      data: [
        {
          filePath: 'users.http',
          requestIndex: 0,
          name: 'Get user',
          method: 'GET',
          url: 'https://api.example.com/users/1',
        },
      ],
    });
  });

  it('responds with an error for unknown kinds', async () => {
    await handleBridgeRequest({ id: 'r2', kind: 'bogus', params: null });

    expect(mockedEmit).toHaveBeenCalledWith('mcp:response', {
      id: 'r2',
      ok: false,
      error: 'Unknown MCP bridge request: bogus',
    });
  });

  it('responds with the thrown error message when execution fails', async () => {
    await handleBridgeRequest({
      id: 'r3',
      kind: 'execute_request',
      params: { filePath: 'users.http', requestIndex: 0 },
    });

    expect(mockedEmit).toHaveBeenCalledWith('mcp:response', {
      id: 'r3',
      ok: false,
      error: 'No workspace folder is open',
    });
  });

  it('responds ok for get_last_result', async () => {
    currentResponse.set(makeResponse());

    await handleBridgeRequest({ id: 'r4', kind: 'get_last_result', params: null });

    const call = mockedEmit.mock.calls.find(
      (c) => (c[1] as { id: string }).id === 'r4',
    ) as unknown as [string, { ok: boolean; data: { status: number } }];
    expect(call[1].ok).toBe(true);
    expect(call[1].data.status).toBe(200);
  });
});

// ─── startMcpBridge ──────────────────────────────────────────────────────────

describe('startMcpBridge', () => {
  it('subscribes to mcp:request and dispatches payloads', async () => {
    const unlistenFn = () => {};
    mockedListen.mockResolvedValue(unlistenFn);

    const unlisten = await startMcpBridge();

    expect(mockedListen).toHaveBeenCalledWith('mcp:request', expect.any(Function));
    expect(unlisten).toBe(unlistenFn);

    // Drive the captured handler and verify it routes to handleBridgeRequest
    const handler = mockedListen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    handler({ payload: { id: 'x1', kind: 'bogus', params: null } });
    await vi.waitFor(() => {
      expect(mockedEmit).toHaveBeenCalledWith('mcp:response', {
        id: 'x1',
        ok: false,
        error: 'Unknown MCP bridge request: bogus',
      });
    });
  });
});
