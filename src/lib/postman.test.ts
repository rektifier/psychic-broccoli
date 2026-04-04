import { describe, it, expect } from 'vitest';
import { importPostmanCollection } from './postman';

function makeCollection(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    info: { name: 'Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [],
    ...overrides,
  });
}

describe('importPostmanCollection', () => {
  it('imports a simple GET request', () => {
    const json = makeCollection({
      item: [{
        name: 'Get Users',
        request: { method: 'GET', url: 'https://api.example.com/users' },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.collectionName).toBe('Test Collection');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('GET https://api.example.com/users');
  });

  it('imports a POST request with body', () => {
    const json = makeCollection({
      item: [{
        name: 'Create User',
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          body: { mode: 'raw', raw: '{"name":"test"}', options: { raw: { language: 'json' } } },
        },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('POST https://api.example.com/users');
    expect(result.files[0].content).toContain('{"name":"test"}');
  });

  it('creates separate files for folders', () => {
    const json = makeCollection({
      item: [
        {
          name: 'Auth',
          item: [
            { name: 'Login', request: { method: 'POST', url: 'https://api.example.com/login' } },
            { name: 'Logout', request: { method: 'POST', url: 'https://api.example.com/logout' } },
          ],
        },
        {
          name: 'Users',
          item: [
            { name: 'Get Users', request: { method: 'GET', url: 'https://api.example.com/users' } },
          ],
        },
      ],
    });
    const result = importPostmanCollection(json);
    expect(result.files).toHaveLength(2);
    expect(result.files.map(f => f.relativePath)).toContain('Auth.http');
    expect(result.files.map(f => f.relativePath)).toContain('Users.http');
  });

  it('handles URL object with protocol, host, path, and query', () => {
    const json = makeCollection({
      item: [{
        name: 'Search',
        request: {
          method: 'GET',
          url: {
            protocol: 'https',
            host: ['api', 'example', 'com'],
            path: ['users', 'search'],
            query: [
              { key: 'q', value: 'test', disabled: false },
              { key: 'disabled_param', value: 'skip', disabled: true },
            ],
          },
        },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('https://api.example.com/users/search?q=test');
    expect(result.files[0].content).not.toContain('disabled_param');
  });

  it('handles bearer auth from collection level', () => {
    const json = makeCollection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{authToken}}' }] },
      item: [{
        name: 'Protected',
        request: { method: 'GET', url: 'https://api.example.com/protected' },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('Authorization: Bearer {{authToken}}');
  });

  it('handles URL encoded body', () => {
    const json = makeCollection({
      item: [{
        name: 'Form Submit',
        request: {
          method: 'POST',
          url: 'https://api.example.com/form',
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'user', value: 'admin' },
              { key: 'pass', value: 'secret' },
            ],
          },
        },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('user=admin&pass=secret');
  });

  it('handles GraphQL body', () => {
    const json = makeCollection({
      item: [{
        name: 'GraphQL Query',
        request: {
          method: 'POST',
          url: 'https://api.example.com/graphql',
          body: {
            mode: 'graphql',
            graphql: { query: '{ users { id name } }' },
          },
        },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('users');
  });

  it('discovers variable references', () => {
    const json = makeCollection({
      item: [{
        name: 'Request',
        request: { method: 'GET', url: '{{baseUrl}}/api' },
      }],
      variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    });
    const result = importPostmanCollection(json);
    expect(result.discoveredVariables.find(v => v.key === 'baseUrl')?.value).toBe('https://api.example.com');
  });

  it('throws on invalid collection (missing info)', () => {
    expect(() => importPostmanCollection(JSON.stringify({ item: [] }))).toThrow();
  });

  it('normalizes invalid methods to GET', () => {
    const json = makeCollection({
      item: [{
        name: 'Bad Method',
        request: { method: 'INVALID', url: 'https://api.example.com' },
      }],
    });
    const result = importPostmanCollection(json);
    expect(result.files[0].content).toContain('GET https://api.example.com');
  });
});
