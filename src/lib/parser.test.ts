import { describe, it, expect } from 'vitest';
import { parseHttpFile, substituteAll, serializeHttpFile } from './parser';
import type { SubstitutionContext } from './parser';
import type { NamedRequestResult } from './types';

// ─── @name directive parsing ────────────────────────────────────────────────

describe('@name directive parsing', () => {
  it('parses simple alphanumeric @name', () => {
    const content = `# @name loginRequest\nGET https://example.com/api/login\n`;
    const result = parseHttpFile(content);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].varName).toBe('loginRequest');
  });

  it('parses @name with underscore', () => {
    const content = `# @name my_request\nGET https://example.com\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBe('my_request');
  });

  it('parses @name with hyphen', () => {
    const content = `# @name bankID-NO\nPOST https://example.com/auth\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBe('bankID-NO');
  });

  it('parses @name with multiple hyphens', () => {
    const content = `# @name my-long-name-123\nGET https://example.com\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBe('my-long-name-123');
  });

  it('parses @name with // comment style', () => {
    const content = `// @name bankID-SE\nGET https://example.com\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBe('bankID-SE');
  });

  it('rejects @name with spaces (only first word captured)', () => {
    // The regex [\w-]+ will stop at space, and trailing content won't match
    const content = `# @name has space\nGET https://example.com\n`;
    const result = parseHttpFile(content);
    // "has space" should not match since it contains a space
    expect(result.requests[0].varName).toBeNull();
  });

  it('rejects @name with special characters like dots', () => {
    const content = `# @name invalid.name\nGET https://example.com\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBeNull();
  });

  it('request without @name has null varName', () => {
    const content = `GET https://example.com\n`;
    const result = parseHttpFile(content);
    expect(result.requests[0].varName).toBeNull();
  });
});

// ─── Request variable reference resolution ──────────────────────────────────

describe('request variable reference resolution', () => {
  const mockNamedResults: Record<string, NamedRequestResult> = {
    'loginRequest': {
      request: { method: 'POST', url: 'https://example.com/login', headers: {}, body: '{}' },
      response: {
        status: 200, statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
        body: '{"token":"abc123","user":{"id":42,"name":"Test"}}',
        time: 100, size: 50,
      },
    },
    'bankID-NO': {
      request: { method: 'POST', url: 'https://example.com/auth', headers: {}, body: '{}' },
      response: {
        status: 200, statusText: 'OK',
        headers: { 'Set-Cookie': 'session=xyz' },
        body: '{"id":"sess-123","status":"pending"}',
        time: 200, size: 35,
      },
    },
    'my-long-name': {
      request: { method: 'GET', url: 'https://example.com/data', headers: {}, body: '' },
      response: {
        status: 200, statusText: 'OK',
        headers: {},
        body: '{"value":99}',
        time: 50, size: 12,
      },
    },
  };

  function makeCtx(namedResults: Record<string, NamedRequestResult> = mockNamedResults): SubstitutionContext {
    return {
      fileVariables: [],
      environmentVariables: {},
      namedResults,
      dotenvVariables: {},
    };
  }

  it('resolves simple @name reference (no hyphens)', () => {
    const input = '{{loginRequest.response.body.$.token}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('abc123');
  });

  it('resolves @name reference with hyphen', () => {
    const input = '{{bankID-NO.response.body.$.id}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('sess-123');
  });

  it('resolves @name reference with multiple hyphens', () => {
    const input = '{{my-long-name.response.body.$.value}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('99');
  });

  it('resolves nested JSONPath with hyphenated name', () => {
    const input = '{{bankID-NO.response.body.$.status}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('pending');
  });

  it('resolves response headers with hyphenated name', () => {
    const input = '{{bankID-NO.response.headers.Set-Cookie}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('session=xyz');
  });

  it('resolves full body with wildcard', () => {
    const input = '{{bankID-NO.response.body.*}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('{"id":"sess-123","status":"pending"}');
  });

  it('leaves unresolved references intact', () => {
    const input = '{{nonExistent.response.body.$.id}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('{{nonExistent.response.body.$.id}}');
  });

  it('resolves hyphenated name in a URL with other text', () => {
    const input = 'https://example.com/session/{{bankID-NO.response.body.$.id}}/status';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('https://example.com/session/sess-123/status');
  });

  it('resolves multiple references in one string', () => {
    const input = '{{loginRequest.response.body.$.token}}-{{bankID-NO.response.body.$.id}}';
    const result = substituteAll(input, makeCtx());
    expect(result).toBe('abc123-sess-123');
  });
});

// ─── @name round-trip (parse -> serialize -> parse) ─────────────────────────

describe('@name serialization round-trip', () => {
  it('preserves hyphenated @name through serialize/parse cycle', () => {
    const content = [
      '# @name bankID-NO',
      'POST https://example.com/auth',
      'Content-Type: application/json',
      '',
      '{"country": "NO"}',
    ].join('\n');

    const parsed = parseHttpFile(content);
    expect(parsed.requests[0].varName).toBe('bankID-NO');

    const serialized = serializeHttpFile(parsed.requests, parsed.variables);
    const reparsed = parseHttpFile(serialized);
    expect(reparsed.requests[0].varName).toBe('bankID-NO');
  });

  it('preserves simple @name through round-trip', () => {
    const content = '# @name createPost\nGET https://example.com/posts\n';
    const parsed = parseHttpFile(content);
    const serialized = serializeHttpFile(parsed.requests, parsed.variables);
    const reparsed = parseHttpFile(serialized);
    expect(reparsed.requests[0].varName).toBe('createPost');
  });
});

// ─── End-to-end: parse file with chained requests ──────────────────────────

describe('end-to-end: chained requests with hyphenated @name', () => {
  it('parses a file with hyphenated @name and reference', () => {
    const content = [
      '# @name bankID-NO',
      'POST https://example.com/auth/session',
      'Content-Type: application/json',
      '',
      '{"country": "NO"}',
      '',
      '###',
      '',
      'GET https://example.com/auth/session/{{bankID-NO.response.body.$.id}}',
    ].join('\n');

    const parsed = parseHttpFile(content);
    expect(parsed.requests).toHaveLength(2);
    expect(parsed.requests[0].varName).toBe('bankID-NO');
    expect(parsed.requests[1].url).toContain('{{bankID-NO.response.body.$.id}}');

    // Simulate resolving the second request URL after first request completes
    const namedResults: Record<string, NamedRequestResult> = {
      'bankID-NO': {
        request: { method: 'POST', url: 'https://example.com/auth/session', headers: {}, body: '{}' },
        response: {
          status: 200, statusText: 'OK', headers: {},
          body: '{"id":"sess-456"}',
          time: 100, size: 20,
        },
      },
    };

    const resolvedUrl = substituteAll(parsed.requests[1].url, {
      fileVariables: [],
      environmentVariables: {},
      namedResults,
      dotenvVariables: {},
    });

    expect(resolvedUrl).toBe('https://example.com/auth/session/sess-456');
  });
});
