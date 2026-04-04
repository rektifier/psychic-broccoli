import { describe, it, expect } from 'vitest';
import { importInsomniaExport } from './insomnia';

describe('importInsomniaExport - v4 JSON', () => {
  function makeV4Export(resources: any[]) {
    return JSON.stringify({ _type: 'export', __export_format: 4, resources });
  }

  it('imports a simple request', () => {
    const content = makeV4Export([
      { _id: 'wrk_1', _type: 'workspace', name: 'My API', parentId: null },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'Get Users', method: 'GET', url: 'https://api.example.com/users' },
    ]);
    const result = importInsomniaExport(content);
    expect(result.collectionName).toBe('My API');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('GET https://api.example.com/users');
  });

  it('groups folder requests into separate files', () => {
    const content = makeV4Export([
      { _id: 'wrk_1', _type: 'workspace', name: 'API', parentId: null },
      { _id: 'grp_1', _type: 'request_group', parentId: 'wrk_1', name: 'Auth' },
      { _id: 'req_1', _type: 'request', parentId: 'grp_1', name: 'Login', method: 'POST', url: 'https://api.example.com/login' },
      { _id: 'grp_2', _type: 'request_group', parentId: 'wrk_1', name: 'Users' },
      { _id: 'req_2', _type: 'request', parentId: 'grp_2', name: 'List', method: 'GET', url: 'https://api.example.com/users' },
    ]);
    const result = importInsomniaExport(content);
    expect(result.files).toHaveLength(2);
    expect(result.files.map(f => f.relativePath)).toContain('Auth.http');
    expect(result.files.map(f => f.relativePath)).toContain('Users.http');
  });

  it('extracts base environment variables', () => {
    const content = makeV4Export([
      { _id: 'wrk_1', _type: 'workspace', name: 'API', parentId: null },
      { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', data: { baseUrl: 'https://api.example.com' } },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'Test', method: 'GET', url: '{{baseUrl}}/test' },
    ]);
    const result = importInsomniaExport(content);
    expect(result.variables.find(v => v.key === 'baseUrl')?.value).toBe('https://api.example.com');
  });

  it('handles request with headers and body', () => {
    const content = makeV4Export([
      { _id: 'wrk_1', _type: 'workspace', name: 'API', parentId: null },
      {
        _id: 'req_1', _type: 'request', parentId: 'wrk_1',
        name: 'Create', method: 'POST', url: 'https://api.example.com/data',
        headers: [{ name: 'Accept', value: 'application/json' }],
        body: { mimeType: 'application/json', text: '{"key":"value"}' },
      },
    ]);
    const result = importInsomniaExport(content);
    expect(result.files[0].content).toContain('Accept: application/json');
    expect(result.files[0].content).toContain('{"key":"value"}');
  });

  it('handles bearer auth', () => {
    const content = makeV4Export([
      { _id: 'wrk_1', _type: 'workspace', name: 'API', parentId: null },
      {
        _id: 'req_1', _type: 'request', parentId: 'wrk_1',
        name: 'Protected', method: 'GET', url: 'https://api.example.com/protected',
        authentication: { type: 'bearer', token: 'my-token' },
      },
    ]);
    const result = importInsomniaExport(content);
    expect(result.files[0].content).toContain('Authorization: Bearer my-token');
  });

  it('throws on missing resources array', () => {
    expect(() => importInsomniaExport(JSON.stringify({ _type: 'export' }))).toThrow();
  });
});

describe('importInsomniaExport - v5 YAML', () => {
  it('imports a simple v5 YAML collection', () => {
    const yaml = `
type: collection.insomnia.rest/5.0
schema_version: "5.0"
name: My API
collection:
  - name: Get Users
    url: https://api.example.com/users
    method: GET
`;
    const result = importInsomniaExport(yaml);
    expect(result.collectionName).toBe('My API');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('GET https://api.example.com/users');
  });

  it('handles nested folders in v5 YAML', () => {
    const yaml = `
type: collection.insomnia.rest/5.0
schema_version: "5.0"
name: My API
collection:
  - name: Auth
    children:
      - name: Login
        url: https://api.example.com/login
        method: POST
  - name: Users
    children:
      - name: List
        url: https://api.example.com/users
        method: GET
`;
    const result = importInsomniaExport(yaml);
    expect(result.files).toHaveLength(2);
  });

  it('extracts environment variables from v5 YAML', () => {
    const yaml = `
type: collection.insomnia.rest/5.0
schema_version: "5.0"
name: My API
collection:
  - name: Test
    url: "{{ _.baseUrl }}/test"
    method: GET
environments:
  name: Base
  data:
    baseUrl: https://api.example.com
`;
    const result = importInsomniaExport(yaml);
    expect(result.variables.find(v => v.key === 'baseUrl')?.value).toBe('https://api.example.com');
  });

  it('converts Insomnia template syntax to .http syntax', () => {
    const yaml = `
type: collection.insomnia.rest/5.0
schema_version: "5.0"
name: My API
collection:
  - name: Test
    url: "{{ _.baseUrl }}/test"
    method: GET
`;
    const result = importInsomniaExport(yaml);
    expect(result.files[0].content).toContain('{{baseUrl}}');
    expect(result.files[0].content).not.toContain('_.baseUrl');
  });

  it('throws on invalid v5 YAML (missing collection)', () => {
    const yaml = `
type: collection.insomnia.rest/5.0
name: Bad
`;
    expect(() => importInsomniaExport(yaml)).toThrow();
  });
});
