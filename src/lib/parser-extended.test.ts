import { describe, it, expect, vi } from 'vitest';
import {
  parseHttpFile,
  serializeHttpFile,
  substituteAll,
  substituteVariables,
  evaluatePbExpression,
  parseScriptText,
  executePbDirectives,
  applyRequestMutations,
  parseEnvironmentFile,
  getEnvironmentNames,
  resolveEnvironmentVariables,
  extractVariableRefs,
  createEmptyRequest,
  createFileNode,
  buildWorkspaceTree,
  getAllFileNodes,
  createEmptyFileNode,
} from './parser';
import type { SubstitutionContext, RequestMutations } from './parser';
import type { HttpResponse, NamedRequestResult, PbDirective } from './types';

// ─── Environment File Handling ──────────────────────────────────────────────

describe('parseEnvironmentFile', () => {
  it('parses valid JSON into an environment file', () => {
    const json = JSON.stringify({
      dev: { baseUrl: 'http://localhost:3000', token: 'dev-token' },
      prod: { baseUrl: 'https://api.example.com', token: 'prod-token' },
    });
    const result = parseEnvironmentFile(json);
    expect(result).not.toBeNull();
    expect(result!.dev.baseUrl).toBe('http://localhost:3000');
    expect(result!.prod.token).toBe('prod-token');
  });

  it('returns null for invalid JSON', () => {
    expect(parseEnvironmentFile('not json')).toBeNull();
    expect(parseEnvironmentFile('')).toBeNull();
    expect(parseEnvironmentFile('{invalid')).toBeNull();
  });

  it('parses environment with $shared section', () => {
    const json = JSON.stringify({
      $shared: { apiVersion: 'v1' },
      dev: { baseUrl: 'http://localhost' },
    });
    const result = parseEnvironmentFile(json);
    expect(result!.$shared.apiVersion).toBe('v1');
  });
});

describe('getEnvironmentNames', () => {
  it('returns environment names excluding $shared', () => {
    const envFile = {
      $shared: { apiVersion: 'v1' },
      dev: { baseUrl: 'http://localhost' },
      staging: { baseUrl: 'https://staging.example.com' },
      prod: { baseUrl: 'https://api.example.com' },
    };
    const names = getEnvironmentNames(envFile);
    expect(names).toEqual(['dev', 'staging', 'prod']);
    expect(names).not.toContain('$shared');
  });

  it('returns empty array for null input', () => {
    expect(getEnvironmentNames(null)).toEqual([]);
  });

  it('returns empty array when only $shared exists', () => {
    expect(getEnvironmentNames({ $shared: { key: 'val' } })).toEqual([]);
  });
});

describe('resolveEnvironmentVariables', () => {
  it('resolves env-specific variables', () => {
    const envFile = {
      dev: { baseUrl: 'http://localhost:3000', token: 'dev-tok' },
    };
    const result = resolveEnvironmentVariables('dev', envFile, null);
    expect(result.baseUrl).toBe('http://localhost:3000');
    expect(result.token).toBe('dev-tok');
  });

  it('merges $shared with env-specific (env-specific wins)', () => {
    const envFile = {
      $shared: { apiVersion: 'v1', baseUrl: 'http://shared' },
      dev: { baseUrl: 'http://localhost' },
    };
    const result = resolveEnvironmentVariables('dev', envFile, null);
    expect(result.baseUrl).toBe('http://localhost');
    expect(result.apiVersion).toBe('v1');
  });

  it('user env file overrides base env file', () => {
    const envFile = {
      dev: { token: 'base-token' },
    };
    const userEnvFile = {
      dev: { token: 'user-secret-token' },
    };
    const result = resolveEnvironmentVariables('dev', envFile, userEnvFile);
    expect(result.token).toBe('user-secret-token');
  });

  it('priority order: user env > base env > user $shared > base $shared', () => {
    // Resolution applies in order: base $shared → user $shared → base env → user env
    // Each layer overwrites the previous, so base env overrides user $shared.
    const envFile = {
      $shared: { a: 'base-shared', b: 'base-shared', c: 'base-shared', d: 'base-shared' },
      dev: { c: 'base-env', d: 'base-env' },
    };
    const userEnvFile = {
      $shared: { b: 'user-shared', d: 'user-shared' },
      dev: { d: 'user-env' },
    };
    const result = resolveEnvironmentVariables('dev', envFile, userEnvFile);
    expect(result.a).toBe('base-shared');
    expect(result.b).toBe('user-shared');
    expect(result.c).toBe('base-env');
    expect(result.d).toBe('user-env');
  });

  it('handles null envFile and userEnvFile', () => {
    const result = resolveEnvironmentVariables('dev', null, null);
    expect(result).toEqual({});
  });

  it('handles provider-based variables with placeholder', () => {
    const envFile = {
      dev: {
        secret: { provider: 'AzureKeyVault', secretName: 'my-secret' } as any,
      },
    };
    const result = resolveEnvironmentVariables('dev', envFile, null);
    expect(result.secret).toBe('[AzureKeyVault:my-secret]');
  });
});

// ─── Variable Substitution ──────────────────────────────────────────────────

describe('substituteVariables', () => {
  it('substitutes file-level variables', () => {
    const vars = [{ key: 'host', value: 'localhost' }, { key: 'port', value: '3000' }];
    expect(substituteVariables('http://{{host}}:{{port}}/api', vars))
      .toBe('http://localhost:3000/api');
  });

  it('leaves unresolved variables intact', () => {
    expect(substituteVariables('{{missing}}', [])).toBe('{{missing}}');
  });
});

describe('substituteAll - environment variables', () => {
  it('resolves environment variables when no file var matches', () => {
    const ctx: SubstitutionContext = {
      fileVariables: [],
      environmentVariables: { baseUrl: 'https://api.example.com' },
      namedResults: {},
    };
    expect(substituteAll('{{baseUrl}}/users', ctx)).toBe('https://api.example.com/users');
  });

  it('file variables take precedence over env variables', () => {
    const ctx: SubstitutionContext = {
      fileVariables: [{ key: 'baseUrl', value: 'http://local' }],
      environmentVariables: { baseUrl: 'https://remote' },
      namedResults: {},
    };
    expect(substituteAll('{{baseUrl}}', ctx)).toBe('http://local');
  });

  it('handles chained variable references (file var referencing env var)', () => {
    const ctx: SubstitutionContext = {
      fileVariables: [{ key: 'url', value: '{{baseUrl}}/api' }],
      environmentVariables: { baseUrl: 'https://example.com' },
      namedResults: {},
    };
    expect(substituteAll('{{url}}', ctx)).toBe('https://example.com/api');
  });

  it('resolves $dotenv variables via dynamic var placeholder', () => {
    // {{$dotenv KEY}} is matched by the dynamic variable regex first,
    // returning a placeholder. The simple var path handles {{$dotenv KEY}}
    // only when the dynamic regex doesn't match.
    const ctx: SubstitutionContext = {
      fileVariables: [],
      environmentVariables: {},
      namedResults: {},
      dotenvVariables: { SECRET_KEY: 'abc123' },
    };
    // Dynamic var regex catches $dotenv and returns placeholder
    expect(substituteAll('{{$dotenv SECRET_KEY}}', ctx)).toBe('[dotenv:SECRET_KEY]');
  });

  it('returns placeholder for $processEnv', () => {
    const ctx: SubstitutionContext = {
      fileVariables: [],
      environmentVariables: {},
      namedResults: {},
    };
    expect(substituteAll('{{$processEnv HOME}}', ctx)).toBe('[env:HOME]');
  });
});

// ─── Dynamic Variables ──────────────────────────────────────────────────────

describe('dynamic variables', () => {
  const emptyCtx: SubstitutionContext = {
    fileVariables: [],
    environmentVariables: {},
    namedResults: {},
  };

  it('resolves $randomInt with default range (0-1000)', () => {
    const result = substituteAll('{{$randomInt}}', emptyCtx);
    const num = parseInt(result, 10);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(1000);
  });

  it('resolves $randomInt with custom range', () => {
    const result = substituteAll('{{$randomInt 1 5}}', emptyCtx);
    const num = parseInt(result, 10);
    expect(num).toBeGreaterThanOrEqual(1);
    expect(num).toBeLessThanOrEqual(5);
  });

  it('resolves $timestamp as a number', () => {
    const result = substituteAll('{{$timestamp}}', emptyCtx);
    const num = parseInt(result, 10);
    expect(num).toBeGreaterThan(1000000000); // After 2001
  });

  it('resolves $datetime as ISO 8601 by default', () => {
    const result = substituteAll('{{$datetime}}', emptyCtx);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('leaves unknown dynamic variables intact', () => {
    const result = substituteAll('{{$unknownFunc}}', emptyCtx);
    expect(result).toBe('{{$unknownFunc}}');
  });
});

// ─── Pb Script Text Parsing ─────────────────────────────────────────────────

describe('parseScriptText', () => {
  it('returns empty array for empty/null input', () => {
    expect(parseScriptText('')).toEqual([]);
  });

  it('parses bare pb.set directives', () => {
    const result = parseScriptText('pb.set("token", pb.response.body.$.token)');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('set');
    expect((result[0] as any).key).toBe('token');
  });

  it('parses bare pb.assert directives', () => {
    const result = parseScriptText('pb.assert(pb.response.status == 200, "Status is 200")');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('assert');
  });

  it('parses bare pb.global directives', () => {
    const result = parseScriptText('pb.global("authToken", pb.response.body.$.token)');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('global');
    expect((result[0] as any).key).toBe('authToken');
  });

  it('parses comment-prefixed directives', () => {
    const result = parseScriptText('# @pb.set("key", "value")');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('set');
  });

  it('parses multiple directives', () => {
    const text = [
      'pb.set("token", pb.response.body.$.token)',
      'pb.assert(pb.response.status == 200, "OK")',
      'pb.global("shared", "val")',
    ].join('\n');
    const result = parseScriptText(text);
    expect(result).toHaveLength(3);
  });

  it('skips blank lines and pure comments', () => {
    const text = [
      '# This is a comment',
      '',
      'pb.set("key", "value")',
      '// Another comment',
    ].join('\n');
    const result = parseScriptText(text);
    expect(result).toHaveLength(1);
  });
});

// ─── evaluatePbExpression ───────────────────────────────────────────────────

describe('evaluatePbExpression', () => {
  const mockResponse: HttpResponse = {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json', 'X-Custom': 'hello' },
    body: '{"token":"abc","count":5,"items":[{"id":1}]}',
    time: 100,
    size: 50,
  };

  const mockRequest = {
    url: 'https://example.com/api',
    method: 'POST',
    headers: { 'Authorization': 'Bearer xyz' },
    body: '{"key":"value"}',
  };

  const ctx = {
    response: mockResponse,
    request: mockRequest,
    variables: { myVar: 'hello' },
    namedResults: {} as Record<string, NamedRequestResult>,
  };

  it('resolves pb.response.status', () => {
    expect(evaluatePbExpression('pb.response.status', ctx)).toBe(200);
  });

  it('resolves pb.response.statusText', () => {
    expect(evaluatePbExpression('pb.response.statusText', ctx)).toBe('OK');
  });

  it('resolves pb.response.body JSONPath', () => {
    expect(evaluatePbExpression('pb.response.body.$.token', ctx)).toBe('abc');
  });

  it('resolves pb.response.headers (case-insensitive)', () => {
    expect(evaluatePbExpression('pb.response.headers.content-type', ctx)).toBe('application/json');
    expect(evaluatePbExpression('pb.response.headers.X-Custom', ctx)).toBe('hello');
  });

  it('resolves pb.response.time and size', () => {
    expect(evaluatePbExpression('pb.response.time', ctx)).toBe(100);
    expect(evaluatePbExpression('pb.response.size', ctx)).toBe(50);
  });

  it('resolves pb.request.url', () => {
    expect(evaluatePbExpression('pb.request.url', ctx)).toBe('https://example.com/api');
  });

  it('resolves pb.request.method', () => {
    expect(evaluatePbExpression('pb.request.method', ctx)).toBe('POST');
  });

  it('resolves pb.request.headers', () => {
    expect(evaluatePbExpression('pb.request.headers.Authorization', ctx)).toBe('Bearer xyz');
  });

  it('evaluates comparison: ==', () => {
    expect(evaluatePbExpression('pb.response.status == 200', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.status == 404', ctx)).toBe(false);
  });

  it('evaluates comparison: !=', () => {
    expect(evaluatePbExpression('pb.response.status != 404', ctx)).toBe(true);
  });

  it('evaluates comparison: >, <, >=, <=', () => {
    expect(evaluatePbExpression('pb.response.status >= 200', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.status <= 200', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.status > 199', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.status < 201', ctx)).toBe(true);
  });

  it('evaluates string operations: contains, startsWith, endsWith', () => {
    expect(evaluatePbExpression('pb.response.body.$.token contains "bc"', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.body.$.token startsWith "ab"', ctx)).toBe(true);
    expect(evaluatePbExpression('pb.response.body.$.token endsWith "bc"', ctx)).toBe(true);
  });

  it('evaluates literals', () => {
    expect(evaluatePbExpression('null', ctx)).toBeNull();
    expect(evaluatePbExpression('true', ctx)).toBe(true);
    expect(evaluatePbExpression('false', ctx)).toBe(false);
    expect(evaluatePbExpression('42', ctx)).toBe(42);
    expect(evaluatePbExpression('"hello"', ctx)).toBe('hello');
  });

  it('evaluates negation', () => {
    expect(evaluatePbExpression('!false', ctx)).toBe(true);
    expect(evaluatePbExpression('!true', ctx)).toBe(false);
  });

  it('resolves {{variable}} references in expressions', () => {
    expect(evaluatePbExpression('{{myVar}}', ctx)).toBe('hello');
  });
});

// ─── executePbDirectives ────────────────────────────────────────────────────

describe('executePbDirectives', () => {
  const mockResponse: HttpResponse = {
    status: 200, statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
    body: '{"token":"secret123","user":"admin"}',
    time: 50, size: 30,
  };
  const mockRequest = { url: 'https://example.com', method: 'POST', headers: {}, body: '{}' };

  it('executes set directives to extract variables', () => {
    const directives: PbDirective[] = [
      { type: 'set', key: 'authToken', expr: 'pb.response.body.$.token' },
    ];
    const result = executePbDirectives(directives, mockResponse, mockRequest, {});
    expect(result.setVars.authToken).toBe('secret123');
  });

  it('executes global directives', () => {
    const directives: PbDirective[] = [
      { type: 'global', key: 'globalToken', expr: 'pb.response.body.$.token' },
    ];
    const result = executePbDirectives(directives, mockResponse, mockRequest, {});
    expect(result.globalVars.globalToken).toBe('secret123');
  });

  it('executes assert directives', () => {
    const directives: PbDirective[] = [
      { type: 'assert', expr: 'pb.response.status == 200', label: 'Status is 200' },
      { type: 'assert', expr: 'pb.response.status == 404', label: 'Status is 404' },
    ];
    const result = executePbDirectives(directives, mockResponse, mockRequest, {});
    expect(result.assertionResults).toHaveLength(2);
    expect(result.assertionResults[0].passed).toBe(true);
    expect(result.assertionResults[1].passed).toBe(false);
  });

  it('set vars are available to subsequent directives', () => {
    const directives: PbDirective[] = [
      { type: 'set', key: 'tok', expr: 'pb.response.body.$.token' },
      { type: 'assert', expr: '{{tok}} == "secret123"', label: 'Token matches' },
    ];
    const result = executePbDirectives(directives, mockResponse, mockRequest, {});
    expect(result.assertionResults[0].passed).toBe(true);
  });

  it('handles request mutation keys (request.url, request.header.*, request.body)', () => {
    const directives: PbDirective[] = [
      { type: 'set', key: 'request.url', expr: '"https://new-url.com"' },
      { type: 'set', key: 'request.header.X-Custom', expr: '"custom-val"' },
      { type: 'set', key: 'request.body', expr: '"new body"' },
    ];
    const result = executePbDirectives(directives, mockResponse, mockRequest, {});
    expect(result.requestMutations.url).toBe('https://new-url.com');
    expect(result.requestMutations.headers['X-Custom']).toBe('custom-val');
    expect(result.requestMutations.bodyFull).toBe('new body');
  });
});

// ─── applyRequestMutations ─────────────────────────────────────────────────

describe('applyRequestMutations', () => {
  const baseReq = {
    url: 'https://example.com',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer old' },
    body: '{"key":"value"}',
  };

  it('applies URL override', () => {
    const mutations: RequestMutations = { url: 'https://new.com', headers: {}, bodyPatches: [] };
    const result = applyRequestMutations(baseReq, mutations);
    expect(result.url).toBe('https://new.com');
  });

  it('applies header overrides (case-insensitive merge)', () => {
    const mutations: RequestMutations = {
      headers: { 'authorization': 'Bearer new' },
      bodyPatches: [],
    };
    const result = applyRequestMutations(baseReq, mutations);
    expect(result.headers['authorization']).toBe('Bearer new');
    expect(result.headers['Authorization']).toBeUndefined();
  });

  it('applies full body replacement', () => {
    const mutations: RequestMutations = { headers: {}, bodyPatches: [], bodyFull: '{"new":"body"}' };
    const result = applyRequestMutations(baseReq, mutations);
    expect(result.body).toBe('{"new":"body"}');
  });

  it('applies JSON body patches', () => {
    const mutations: RequestMutations = {
      headers: {},
      bodyPatches: [{ path: 'key', value: 'patched' }],
    };
    const result = applyRequestMutations(baseReq, mutations);
    expect(JSON.parse(result.body).key).toBe('patched');
  });

  it('does not mutate original request', () => {
    const mutations: RequestMutations = { url: 'https://other.com', headers: {}, bodyPatches: [] };
    applyRequestMutations(baseReq, mutations);
    expect(baseReq.url).toBe('https://example.com');
  });
});

// ─── extractVariableRefs ────────────────────────────────────────────────────

describe('extractVariableRefs', () => {
  it('extracts variable references from file content', () => {
    const files = [{ content: 'GET {{baseUrl}}/users\nAuthorization: Bearer {{token}}' }];
    const result = extractVariableRefs(files, []);
    expect(result.map(v => v.key)).toEqual(['baseUrl', 'token']);
  });

  it('uses known variable values when available', () => {
    const files = [{ content: '{{baseUrl}}/api' }];
    const known = [{ key: 'baseUrl', value: 'https://example.com' }];
    const result = extractVariableRefs(files, known);
    expect(result[0].value).toBe('https://example.com');
  });

  it('returns empty value for unknown variables', () => {
    const files = [{ content: '{{unknown}}' }];
    const result = extractVariableRefs(files, []);
    expect(result[0].value).toBe('');
  });

  it('skips dynamic variables (starting with $)', () => {
    const files = [{ content: '{{$randomInt}} {{$timestamp}} {{normalVar}}' }];
    const result = extractVariableRefs(files, []);
    expect(result.map(v => v.key)).toEqual(['normalVar']);
  });

  it('skips request variable references (containing dots)', () => {
    const files = [{ content: '{{login.response.body.$.token}} {{simpleVar}}' }];
    const result = extractVariableRefs(files, []);
    expect(result.map(v => v.key)).toEqual(['simpleVar']);
  });

  it('deduplicates and sorts results', () => {
    const files = [{ content: '{{z}} {{a}} {{z}} {{m}}' }];
    const result = extractVariableRefs(files, []);
    expect(result.map(v => v.key)).toEqual(['a', 'm', 'z']);
  });
});

// ─── Parser: file-level variables ───────────────────────────────────────────

describe('parseHttpFile - file-level variables', () => {
  it('parses @variable declarations', () => {
    const content = '@host = localhost\n@port = 3000\nGET http://{{host}}:{{port}}\n';
    const result = parseHttpFile(content);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({ key: 'host', value: 'localhost' });
    expect(result.variables[1]).toEqual({ key: 'port', value: '3000' });
  });

  it('variables can reference earlier variables', () => {
    const content = '@host = localhost\n@port = 3000\n@baseUrl = http://{{host}}:{{port}}\nGET {{baseUrl}}/api\n';
    const result = parseHttpFile(content);
    expect(result.variables[2]).toEqual({ key: 'baseUrl', value: 'http://localhost:3000' });
  });
});

// ─── Parser: multiple requests ──────────────────────────────────────────────

describe('parseHttpFile - multiple requests', () => {
  it('parses multiple requests separated by ###', () => {
    const content = [
      'GET https://example.com/users',
      '',
      '###',
      '',
      'POST https://example.com/users',
      'Content-Type: application/json',
      '',
      '{"name":"test"}',
    ].join('\n');
    const result = parseHttpFile(content);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].method).toBe('GET');
    expect(result.requests[1].method).toBe('POST');
    expect(result.requests[1].body).toBe('{"name":"test"}');
  });

  it('parses headers correctly', () => {
    const content = 'POST https://example.com\nContent-Type: application/json\nAuthorization: Bearer token\n';
    const result = parseHttpFile(content);
    expect(result.requests[0].headers).toHaveLength(2);
    expect(result.requests[0].headers[0].key).toBe('Content-Type');
    expect(result.requests[0].headers[1].value).toBe('Bearer token');
  });

  it('parses pb directives', () => {
    const content = [
      'GET https://example.com',
      '',
      '# @pb.set("token", pb.response.body.$.token)',
      '# @pb.assert(pb.response.status == 200, "OK")',
    ].join('\n');
    const result = parseHttpFile(content);
    expect(result.requests[0].directives).toHaveLength(2);
    expect(result.requests[0].directives[0].type).toBe('set');
    expect(result.requests[0].directives[1].type).toBe('assert');
  });

  it('parses beforeSend and afterReceive scripts', () => {
    const content = [
      'POST https://example.com',
      '',
      '# @pb.beforeSend',
      '# @pb.set("request.url", "https://override.com")',
      '# @pb.afterReceive',
      '# @pb.set("result", pb.response.body.$.data)',
    ].join('\n');
    const result = parseHttpFile(content);
    expect(result.requests[0].beforeSend).toContain('pb.set("request.url", "https://override.com")');
    expect(result.requests[0].afterReceive).toContain('pb.set("result", pb.response.body.$.data)');
  });
});

// ─── Workspace Tree Builder ─────────────────────────────────────────────────

describe('buildWorkspaceTree', () => {
  it('builds a flat tree from files in the root', () => {
    const files = [
      { absolutePath: '/root/api.http', relativePath: 'api.http', content: 'GET https://example.com\n' },
    ];
    const tree = buildWorkspaceTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('file');
    expect(tree[0].name).toBe('api.http');
  });

  it('builds nested folder structure', () => {
    const files = [
      { absolutePath: '/root/Users/auth.http', relativePath: 'Users/auth.http', content: 'GET https://example.com\n' },
      { absolutePath: '/root/Users/profile.http', relativePath: 'Users/profile.http', content: 'GET https://example.com\n' },
    ];
    const tree = buildWorkspaceTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('Users');
    expect((tree[0] as any).children).toHaveLength(2);
  });
});

describe('getAllFileNodes', () => {
  it('collects all file nodes from nested tree', () => {
    const files = [
      { absolutePath: '/root/a.http', relativePath: 'a.http', content: 'GET https://example.com\n' },
      { absolutePath: '/root/sub/b.http', relativePath: 'sub/b.http', content: 'GET https://example.com\n' },
    ];
    const tree = buildWorkspaceTree(files);
    const allFiles = getAllFileNodes(tree);
    expect(allFiles).toHaveLength(2);
  });
});

describe('createEmptyRequest', () => {
  it('creates a request with default values', () => {
    const req = createEmptyRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://');
    expect(req.name).toBe('New Request');
    expect(req.varName).toBeNull();
  });

  it('uses custom name when provided', () => {
    const req = createEmptyRequest('My Request');
    expect(req.name).toBe('My Request');
  });
});

describe('createEmptyFileNode', () => {
  it('creates a dirty file node with one empty request', () => {
    const node = createEmptyFileNode('/path/to/file.http', 'file.http');
    expect(node.type).toBe('file');
    expect(node.name).toBe('file.http');
    expect(node.dirty).toBe(true);
    expect(node.requests).toHaveLength(1);
  });
});
