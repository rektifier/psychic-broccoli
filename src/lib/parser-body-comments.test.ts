import { describe, it, expect } from 'vitest';
import { parseHttpFile, serializeHttpFile } from './parser';

// ─── Issue #161: # and // lines inside request bodies must be preserved ─────
//
// Once a body has started (after the blank line following the headers),
// lines starting with `#` or `//` are body CONTENT and must pass through
// verbatim — except the directive forms (`# @name`, `# @pb.*`) and `###`
// separators, which keep their current meaning.

describe('parseHttpFile - comment-like lines inside bodies (issue #161)', () => {
  it('preserves column-0 #, indented #, and // lines in a GraphQL-style body', () => {
    const src = [
      'POST https://example.com/graphql',
      'Content-Type: application/json',
      '',
      'query {',
      '# top-level GraphQL comment',
      '  # indented GraphQL comment',
      '// slash comment',
      '  user { id }',
      '}',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toBe(
      [
        'query {',
        '# top-level GraphQL comment',
        '  # indented GraphQL comment',
        '// slash comment',
        '  user { id }',
        '}',
      ].join('\n'),
    );
  });

  it('round-trips a body with comment lines without losing them (parse → serialize → parse)', () => {
    const src = [
      '@host = example.com',
      '',
      'POST https://{{host}}/graphql',
      'Content-Type: application/json',
      '',
      'query {',
      '# top-level GraphQL comment',
      '  # indented GraphQL comment',
      '// slash comment',
      '  user { id }',
      '}',
    ].join('\n');

    const parsed = parseHttpFile(src);
    const serialized = serializeHttpFile(parsed.requests, parsed.variables);
    const reparsed = parseHttpFile(serialized);

    expect(reparsed.variables).toEqual([{ key: 'host', value: 'example.com' }]);
    expect(reparsed.requests).toHaveLength(1);
    expect(reparsed.requests[0].body).toBe(
      [
        'query {',
        '# top-level GraphQL comment',
        '  # indented GraphQL comment',
        '// slash comment',
        '  user { id }',
        '}',
      ].join('\n'),
    );
  });

  it('preserves a body starting with // (JS-style snippet)', () => {
    const src = [
      'POST https://example.com/exec',
      'Content-Type: text/plain',
      '',
      '// initialize counter',
      'const a = 1;',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests[0].body).toBe('// initialize counter\nconst a = 1;');
  });

  it('preserves a body starting with a shebang / shell comments', () => {
    const src = [
      'POST https://example.com/run-script',
      'Content-Type: text/plain',
      '',
      '#!/bin/sh',
      '# print a greeting',
      'echo hello',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests[0].body).toBe('#!/bin/sh\n# print a greeting\necho hello');
  });

  it('treats #not-a-directive and # plain text body lines as body content (YAML-style)', () => {
    const src = [
      'POST https://example.com/yaml',
      'Content-Type: application/yaml',
      '',
      '#not-a-directive',
      '# plain text comment',
      'key: value',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests[0].body).toBe('#not-a-directive\n# plain text comment\nkey: value');
    // And none of it leaked into headers or directives
    expect(requests[0].headers).toHaveLength(1);
    expect(requests[0].directives).toHaveLength(0);
  });

  // ── Regression guards: behavior that must NOT change ──

  it('still strips comments before the request line and between request line and headers', () => {
    const src = [
      '# file-level comment',
      '// another file-level comment',
      'GET https://example.com/users',
      '# comment between request line and headers',
      'Accept: application/json',
      '',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].headers).toHaveLength(1);
    expect(requests[0].headers[0].key).toBe('Accept');
    expect(requests[0].body).toBe('');
  });

  it('still treats # @name after a body as a directive splitting requests', () => {
    const src = [
      'POST https://example.com/first',
      'Content-Type: application/json',
      '',
      '{"a": 1}',
      '# @name next',
      'GET https://example.com/second',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toBe('{"a": 1}');
    expect(requests[0].varName).toBeNull();
    expect(requests[1].varName).toBe('next');
    expect(requests[1].url).toBe('https://example.com/second');
  });

  it('still consumes # @pb.assert(...) after a body as a directive, not body content', () => {
    const src = [
      'POST https://example.com/api',
      'Content-Type: application/json',
      '',
      '{"a": 1}',
      '',
      '# @pb.assert(pb.response.status == 200, "OK")',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toBe('{"a": 1}');
    expect(requests[0].directives).toHaveLength(1);
    expect(requests[0].directives[0].type).toBe('assert');
  });

  it('still consumes # @pb.set(...) after a body as a directive', () => {
    const src = [
      'POST https://example.com/api',
      'Content-Type: application/json',
      '',
      '{"a": 1}',
      '# @pb.set("token", pb.response.body.$.token)',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests[0].body).toBe('{"a": 1}');
    expect(requests[0].directives).toHaveLength(1);
    expect(requests[0].directives[0].type).toBe('set');
  });

  it('still recognizes # @pb.beforeSend / # @pb.afterReceive section markers after a body', () => {
    const src = [
      'POST https://example.com/api',
      'Content-Type: application/json',
      '',
      '{"a": 1}',
      '',
      '# @pb.beforeSend',
      '# @pb.set("request.url", "https://override.com")',
      '# @pb.afterReceive',
      '# @pb.set("result", pb.response.body.$.data)',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests[0].body).toBe('{"a": 1}');
    expect(requests[0].beforeSend).toContain('pb.set("request.url", "https://override.com")');
    expect(requests[0].afterReceive).toContain('pb.set("result", pb.response.body.$.data)');
  });

  it('still terminates the request at a ### separator after a body', () => {
    const src = [
      'POST https://example.com/a',
      'Content-Type: application/json',
      '',
      '{"a": 1}',
      '###',
      'GET https://example.com/b',
    ].join('\n');

    const { requests } = parseHttpFile(src);
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toBe('{"a": 1}');
    expect(requests[1].method).toBe('GET');
    expect(requests[1].body).toBe('');
  });
});
