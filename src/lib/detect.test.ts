import { describe, it, expect } from 'vitest';
import { detectImportFormat, formatLabel } from './detect';

describe('detectImportFormat', () => {
  // ── Postman ──
  it('detects Postman collection by schema URL', () => {
    const content = JSON.stringify({
      info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
    });
    expect(detectImportFormat(content)).toBe('postman');
  });

  it('detects Postman collection by info.name + item array (fallback)', () => {
    const content = JSON.stringify({
      info: { name: 'Test' },
      item: [],
    });
    expect(detectImportFormat(content)).toBe('postman');
  });

  // ── Insomnia ──
  it('detects Insomnia v4 JSON export by _type', () => {
    const content = JSON.stringify({ _type: 'export', resources: [] });
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v4 JSON export by __export_format', () => {
    const content = JSON.stringify({ __export_format: 4, resources: [] });
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML by _type marker', () => {
    const content = '_type: export\nresources:\n  - name: test';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML collection export', () => {
    const content = 'type: collection.insomnia.rest/5.0\nname: My API\ncollection: []';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML spec export', () => {
    const content = 'type: spec.insomnia.rest/5.0\nname: My API\ncollection: []';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML environment export', () => {
    const content = 'type: environment.insomnia.rest/5.0\nname: Env';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML mock export', () => {
    const content = 'type: mock.insomnia.rest/5.0\nname: Mock';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  it('detects Insomnia v5 YAML mcpClient export', () => {
    const content = 'type: mcpClient.insomnia/5.0\nname: MCP';
    expect(detectImportFormat(content)).toBe('insomnia');
  });

  // ── OpenAPI ──
  it('detects OpenAPI 3.x JSON by openapi field', () => {
    const content = JSON.stringify({ openapi: '3.0.0', paths: {} });
    expect(detectImportFormat(content)).toBe('openapi');
  });

  it('detects Swagger 2.0 JSON by swagger field', () => {
    const content = JSON.stringify({ swagger: '2.0', paths: {} });
    expect(detectImportFormat(content)).toBe('openapi');
  });

  it('detects OpenAPI JSON by paths field alone', () => {
    const content = JSON.stringify({ paths: { '/users': {} } });
    expect(detectImportFormat(content)).toBe('openapi');
  });

  it('detects OpenAPI YAML by openapi marker', () => {
    const content = 'openapi: 3.0.0\ninfo:\n  title: Test\npaths: {}';
    expect(detectImportFormat(content)).toBe('openapi');
  });

  it('detects Swagger YAML by swagger marker', () => {
    const content = 'swagger: "2.0"\ninfo:\n  title: Test';
    expect(detectImportFormat(content)).toBe('openapi');
  });

  // ── Unknown / Invalid ──
  it('returns null for unrecognized JSON', () => {
    expect(detectImportFormat(JSON.stringify({ random: 'data' }))).toBeNull();
  });

  it('returns null for JSON arrays', () => {
    expect(detectImportFormat('[1, 2, 3]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(detectImportFormat('{invalid json')).toBeNull();
  });

  it('returns null for unrecognized text', () => {
    expect(detectImportFormat('just some text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectImportFormat('')).toBeNull();
  });
});

describe('formatLabel', () => {
  it('returns correct labels', () => {
    expect(formatLabel('postman')).toBe('Postman Collection');
    expect(formatLabel('insomnia')).toBe('Insomnia Export');
    expect(formatLabel('openapi')).toBe('OpenAPI / Swagger');
  });
});
