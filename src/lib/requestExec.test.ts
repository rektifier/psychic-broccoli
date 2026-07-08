import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeHttpRequest } from './requestExec';
import type { HttpInvokeResult } from './requestExec';
import type { SubstitutionContext } from './parser';
import type { HttpRequest } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
const invokeMock = vi.mocked(invoke);

function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: 'r1',
    name: 'Test request',
    varName: null,
    method: 'GET',
    url: 'https://example.com/api',
    headers: [],
    body: '',
    directives: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SubstitutionContext> = {}): SubstitutionContext {
  return {
    fileVariables: [],
    environmentVariables: {},
    namedResults: {},
    dotenvVariables: {},
    ...overrides,
  };
}

function mockResponse(overrides: Partial<HttpInvokeResult> = {}): void {
  invokeMock.mockResolvedValueOnce({
    status: 200,
    status_text: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"id": 7}',
    body_encoding: 'utf8',
    size: 9,
    ...overrides,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('executeHttpRequest', () => {
  it('substitutes variables into url, headers, and body', async () => {
    mockResponse();
    const request = makeRequest({
      method: 'POST',
      url: '{{baseUrl}}/users',
      headers: [
        { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
        { key: 'X-Disabled', value: 'nope', enabled: false },
      ],
      body: '{"name": "{{userName}}"}',
    });
    const ctx = makeCtx({
      environmentVariables: { baseUrl: 'https://api.test', token: 'abc123' },
      fileVariables: [{ key: 'userName', value: 'mikael' }],
    });

    const result = await executeHttpRequest(request, ctx);

    expect(result.sentRequest.url).toBe('https://api.test/users');
    expect(result.sentRequest.headers).toEqual({ Authorization: 'Bearer abc123' });
    expect(result.sentRequest.body).toBe('{"name": "mikael"}');
    expect(invokeMock).toHaveBeenCalledWith('http_request', {
      payload: {
        method: 'POST',
        url: 'https://api.test/users',
        headers: { Authorization: 'Bearer abc123' },
        body: '{"name": "mikael"}',
      },
    });
  });

  it('sends null body for bodyless methods', async () => {
    mockResponse();
    await executeHttpRequest(makeRequest({ method: 'GET', body: 'ignored' }), makeCtx());
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ payload: { body: null } });
  });

  it('skips directives the user has disabled', async () => {
    mockResponse();
    const request = makeRequest({
      directives: [
        {
          type: 'assert',
          expr: 'pb.response.status == 500',
          label: 'disabled assert',
          enabled: false,
        },
        { type: 'set', key: 'userId', expr: 'pb.response.body.$.id', enabled: false },
      ],
    });

    const result = await executeHttpRequest(request, makeCtx());

    expect(result.assertionResults).toEqual([]);
    expect(result.afterReceive.setVars).toEqual({});
  });

  it('runs enabled directives and returns their effects without mutating the context', async () => {
    mockResponse();
    const ctx = makeCtx();
    const request = makeRequest({
      directives: [
        { type: 'assert', expr: 'pb.response.status == 200', label: 'status ok' },
        { type: 'set', key: 'userId', expr: 'pb.response.body.$.id' },
        { type: 'global', key: 'lastStatus', expr: 'pb.response.status' },
      ],
    });

    const result = await executeHttpRequest(request, ctx);

    expect(result.assertionResults).toEqual([{ label: 'status ok', passed: true }]);
    expect(result.afterReceive.setVars).toEqual({ userId: '7' });
    expect(result.afterReceive.globalVars).toEqual({ lastStatus: '200' });
    expect(ctx.environmentVariables).toEqual({});
    expect(ctx.namedResults).toEqual({});
  });

  it('returns a named result for the alias without mutating the caller map', async () => {
    mockResponse();
    const ctx = makeCtx();
    const result = await executeHttpRequest(makeRequest(), ctx, { alias: 'login' });

    expect(result.namedResult?.name).toBe('login');
    expect(result.namedResult?.result.response.status).toBe(200);
    expect(ctx.namedResults).toEqual({});
  });

  it("lets directives reference the request's own alias", async () => {
    mockResponse();
    const request = makeRequest({
      directives: [
        { type: 'assert', expr: '{{login.response.body.$.id}} == 7', label: 'own alias resolves' },
      ],
    });

    const result = await executeHttpRequest(request, makeCtx(), { alias: 'login' });

    expect(result.assertionResults).toEqual([{ label: 'own alias resolves', passed: true }]);
  });

  it('applies beforeSend mutations and reports beforeSend vars via onBeforeInvoke', async () => {
    mockResponse();
    const request = makeRequest({
      beforeSend: 'pb.set("request.header.X-Trace", "trace-1")\npb.set("runId", "42")',
    });
    const seen: Array<{ headers: Record<string, string>; setVars: Record<string, string> }> = [];

    const result = await executeHttpRequest(request, makeCtx(), {
      onBeforeInvoke(sent, beforeSend) {
        seen.push({ headers: sent.headers, setVars: beforeSend.setVars });
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].headers['X-Trace']).toBe('trace-1');
    expect(seen[0].setVars).toEqual({ runId: '42' });
    expect(result.sentRequest.headers['X-Trace']).toBe('trace-1');
    expect(result.beforeSend.setVars).toEqual({ runId: '42' });
  });

  it('passes through binary body metadata from the backend', async () => {
    mockResponse({ body: 'AAEC/w==', body_encoding: 'base64', size: 4 });

    const result = await executeHttpRequest(makeRequest(), makeCtx());

    expect(result.response.bodyEncoding).toBe('base64');
    expect(result.response.body).toBe('AAEC/w==');
    expect(result.response.size).toBe(4);
  });

  it('defaults to utf8 and computed size when the backend omits the new fields', async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      status_text: 'OK',
      headers: {},
      body: 'hello',
    });

    const result = await executeHttpRequest(makeRequest(), makeCtx());

    expect(result.response.bodyEncoding).toBe('utf8');
    expect(result.response.size).toBe(5);
  });

  it('propagates network failures to the caller', async () => {
    invokeMock.mockRejectedValueOnce('Connection failed - check that the server is reachable');
    await expect(executeHttpRequest(makeRequest(), makeCtx())).rejects.toBe(
      'Connection failed - check that the server is reachable',
    );
  });
});
