import { describe, it, expect } from 'vitest';
import { importOpenApiSpec } from './openapi';

describe('importOpenApiSpec - OpenAPI 3.x', () => {
  it('imports a simple GET endpoint', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/users': {
          get: { summary: 'List Users', tags: ['Users'] },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.collectionName).toBe('Test API');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('GET {{baseUrl}}/users');
    expect(result.variables.find(v => v.key === 'baseUrl')?.value).toBe('https://api.example.com');
  });

  it('imports POST endpoint with JSON request body', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/users': {
          post: {
            summary: 'Create User',
            tags: ['Users'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string', format: 'email' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('POST {{baseUrl}}/users');
    expect(result.files[0].content).toContain('Content-Type: application/json');
    expect(result.files[0].content).toContain('"name"');
  });

  it('groups operations by tag into separate files', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/users': { get: { tags: ['Users'], summary: 'List' } },
        '/users/{id}': { get: { tags: ['Users'], summary: 'Get One' } },
        '/posts': { get: { tags: ['Posts'], summary: 'List Posts' } },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files).toHaveLength(2);
    const filePaths = result.files.map(f => f.relativePath);
    expect(filePaths.some(p => p.includes('Users'))).toBe(true);
    expect(filePaths.some(p => p.includes('Posts'))).toBe(true);
  });

  it('converts path params {param} to {{param}}', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/users/{userId}/posts/{postId}': {
          get: {
            summary: 'Get Post',
            tags: ['Posts'],
            parameters: [
              { name: 'userId', in: 'path', required: true, schema: { type: 'integer' } },
              { name: 'postId', in: 'path', required: true, schema: { type: 'integer' } },
            ],
          },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('{{baseUrl}}/users/{{userId}}/posts/{{postId}}');
  });

  it('includes required query parameters in URL', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/search': {
          get: {
            summary: 'Search',
            tags: ['Search'],
            parameters: [
              { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
              { name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 10 } },
            ],
          },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('?q=&limit=10');
  });

  it('handles bearer auth security scheme', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        '/protected': { get: { summary: 'Protected', tags: ['Auth'] } },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('Authorization: Bearer {{bearerToken}}');
    expect(result.variables.find(v => v.key === 'bearerToken')).toBeDefined();
  });

  it('resolves server URL variables', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      servers: [{
        url: 'https://{environment}.example.com/api/{version}',
        variables: {
          environment: { default: 'staging' },
          version: { default: 'v1' },
        },
      }],
      paths: { '/test': { get: { summary: 'Test' } } },
    });
    const result = importOpenApiSpec(spec);
    expect(result.variables.find(v => v.key === 'baseUrl')?.value).toBe('https://staging.example.com/api/v1');
  });

  it('uses operationId as varName', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/users': { get: { operationId: 'listUsers', summary: 'List Users', tags: ['Users'] } },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('# @name listUsers');
  });
});

describe('importOpenApiSpec - Swagger 2.0', () => {
  it('imports a Swagger 2.0 spec', () => {
    const spec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Legacy API', version: '1.0' },
      host: 'api.example.com',
      basePath: '/v1',
      schemes: ['https'],
      paths: {
        '/users': {
          get: { summary: 'List Users', tags: ['Users'] },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.collectionName).toBe('Legacy API');
    expect(result.variables.find(v => v.key === 'baseUrl')?.value).toBe('https://api.example.com/v1');
    expect(result.files[0].content).toContain('GET {{baseUrl}}/users');
  });

  it('handles Swagger 2.0 body parameter', () => {
    const spec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'API', version: '1.0' },
      host: 'api.example.com',
      paths: {
        '/users': {
          post: {
            summary: 'Create User',
            tags: ['Users'],
            parameters: [{
              name: 'body',
              in: 'body',
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
            }],
          },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('Content-Type: application/json');
    expect(result.files[0].content).toContain('"name"');
  });
});

describe('importOpenApiSpec - YAML', () => {
  it('imports an OpenAPI YAML spec', () => {
    const yaml = `
openapi: "3.0.0"
info:
  title: YAML API
  version: "1.0"
servers:
  - url: https://api.example.com
paths:
  /health:
    get:
      summary: Health Check
      tags:
        - System
`;
    const result = importOpenApiSpec(yaml);
    expect(result.collectionName).toBe('YAML API');
    expect(result.files[0].content).toContain('GET {{baseUrl}}/health');
  });
});

describe('importOpenApiSpec - edge cases', () => {
  it('throws on invalid spec', () => {
    expect(() => importOpenApiSpec(JSON.stringify({ invalid: true }))).toThrow();
  });

  it('derives tag from path when no tags specified', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/users': { get: { summary: 'List Users' } },
      },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].relativePath).toContain('Users');
  });

  it('generates body from schema with allOf', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/items': {
          post: {
            summary: 'Create Item',
            tags: ['Items'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { type: 'object', properties: { name: { type: 'string' } } },
                      { type: 'object', properties: { count: { type: 'integer' } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(spec);
    const body = result.files[0].content;
    expect(body).toContain('"name"');
    expect(body).toContain('"count"');
  });

  it('handles apiKey security scheme in header', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
      security: [{ apiKey: [] }],
      paths: { '/data': { get: { summary: 'Get Data', tags: ['Data'] } } },
    });
    const result = importOpenApiSpec(spec);
    expect(result.files[0].content).toContain('X-API-Key: {{X_API_Key}}');
  });
});
