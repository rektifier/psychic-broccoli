import yaml from 'js-yaml';
import type { HttpMethod, HttpHeader, HttpRequest, ConvertedFile, ImportResult, Variable } from './types';
import { serializeHttpFile, extractVariableRefs } from './parser';

// ─── OpenAPI Types (subset needed for import) ────────────────────────────────

interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  servers?: OpenApiServer[];
  host?: string;           // Swagger 2.0
  basePath?: string;       // Swagger 2.0
  schemes?: string[];      // Swagger 2.0
  paths?: Record<string, PathItem>;
  security?: SecurityRequirement[];
  securityDefinitions?: Record<string, SecurityScheme>; // Swagger 2.0
  components?: { securitySchemes?: Record<string, SecurityScheme> };
}

interface OpenApiServer {
  url: string;
  variables?: Record<string, { default?: string; enum?: string[] }>;
}

interface PathItem {
  parameters?: Parameter[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  head?: Operation;
  options?: Operation;
  trace?: Operation;
}

interface Operation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  security?: SecurityRequirement[];
  deprecated?: boolean;
  consumes?: string[];      // Swagger 2.0
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'body'; // 'body' is Swagger 2.0
  required?: boolean;
  schema?: SchemaObject;
  type?: string;          // Swagger 2.0
  default?: unknown;
  example?: unknown;
}

interface RequestBody {
  content?: Record<string, { schema?: SchemaObject }>;
  required?: boolean;
}

interface SchemaObject {
  type?: string | string[];
  format?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  example?: unknown;
  enum?: unknown[];
  default?: unknown;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  additionalProperties?: boolean | SchemaObject;
}

type SecurityRequirement = Record<string, string[]>;

interface SecurityScheme {
  type: string;
  scheme?: string;
  name?: string;
  in?: string;
  flows?: unknown;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_METHODS = new Set<string>([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
]);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

const MAX_SCHEMA_DEPTH = 5;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse and convert an OpenAPI/Swagger spec (JSON or YAML) to .http files.
 *
 * Operations are grouped by their first tag into separate .http files.
 * Untagged operations are grouped by the first URL path segment.
 */
export function importOpenApiSpec(content: string): ImportResult {
  // Parse JSON or YAML
  let rawSpec: OpenApiSpec;
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    rawSpec = JSON.parse(content);
  } else {
    rawSpec = yaml.load(content) as OpenApiSpec;
  }

  if (!rawSpec || (!rawSpec.paths && !rawSpec.openapi && !rawSpec.swagger)) {
    throw new Error('Invalid OpenAPI spec: missing "paths" or version field');
  }

  // Dereference $ref entries in-place
  dereferenceRefs(rawSpec, rawSpec);
  const spec = rawSpec;

  const collectionName = spec.info?.title || 'OpenAPI Import';
  const baseUrl = resolveBaseUrl(spec);
  const securitySchemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const globalSecurity = spec.security ?? [];

  // Collect operations grouped by tag
  const tagGroups = new Map<string, { requests: HttpRequest[]; pathParams: Map<string, string> }>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathLevelParams = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const tag = operation.tags?.[0] ?? deriveTagFromPath(path);
      if (!tagGroups.has(tag)) {
        tagGroups.set(tag, { requests: [], pathParams: new Map() });
      }
      const group = tagGroups.get(tag)!;

      // Merge path-level and operation-level parameters
      const allParams = mergeParameters(pathLevelParams, operation.parameters ?? []);

      // Build the request
      const request = buildRequest(
        method, path, operation, allParams,
        securitySchemes, operation.security ?? globalSecurity,
      );
      group.requests.push(request);

      // Collect path parameters for file-level @variable declarations
      for (const param of allParams) {
        if (param.in === 'path' && !group.pathParams.has(param.name)) {
          group.pathParams.set(param.name, resolveParamDefault(param));
        }
      }
    }
  }

  // Convert groups to .http files
  const files: ConvertedFile[] = [];
  for (const [tag, group] of tagGroups) {
    const variables: Variable[] = [];
    for (const [key, value] of group.pathParams) {
      variables.push({ key, value });
    }

    const httpContent = serializeHttpFile(group.requests, variables);
    files.push({
      relativePath: `${sanitizeFilename(collectionName)}/${sanitizeFilename(tag)}.http`,
      content: httpContent,
    });
  }

  // Build known variables (baseUrl + auth placeholders)
  const knownVars: Variable[] = [{ key: 'baseUrl', value: baseUrl }];
  addAuthVariables(securitySchemes, globalSecurity, knownVars);

  const discoveredVariables = extractVariableRefs(files, knownVars);

  return {
    files,
    collectionName,
    variables: knownVars,
    discoveredVariables,
  };
}

// ─── Base URL Resolution ─────────────────────────────────────────────────────

function resolveBaseUrl(spec: OpenApiSpec): string {
  // OpenAPI 3.x
  if (spec.servers && spec.servers.length > 0) {
    let url = spec.servers[0].url;
    const vars = spec.servers[0].variables;
    if (vars) {
      for (const [name, def] of Object.entries(vars)) {
        url = url.replace(`{${name}}`, def.default ?? '');
      }
    }
    return url;
  }

  // Swagger 2.0
  if (spec.host) {
    const scheme = spec.schemes?.[0] ?? 'https';
    const basePath = spec.basePath ?? '';
    return `${scheme}://${spec.host}${basePath}`;
  }

  return '';
}

// ─── Request Building ────────────────────────────────────────────────────────

function buildRequest(
  method: string,
  path: string,
  operation: Operation,
  params: Parameter[],
  securitySchemes: Record<string, SecurityScheme>,
  security: SecurityRequirement[],
): HttpRequest {
  const upperMethod = method.toUpperCase();
  const normalizedMethod: HttpMethod = VALID_METHODS.has(upperMethod) ? upperMethod as HttpMethod : 'GET';

  // Build URL: {{baseUrl}} + path with {param} -> {{param}}
  let url = `{{baseUrl}}${path.replace(/\{(\w+)\}/g, '{{$1}}')}`;

  // Append required query parameters
  const requiredQuery = params.filter(p => p.in === 'query' && p.required);
  if (requiredQuery.length > 0) {
    const qs = requiredQuery.map(p => `${p.name}=${resolveParamDefault(p)}`).join('&');
    url += `?${qs}`;
  }

  // Build headers
  const headers: HttpHeader[] = [];

  // Auth header
  const authHeader = resolveAuth(securitySchemes, security);
  if (authHeader) {
    headers.push(authHeader);
  }

  // Header parameters
  for (const param of params) {
    if (param.in === 'header') {
      headers.push({
        key: param.name,
        value: resolveParamDefault(param),
        enabled: true,
      });
    }
  }

  // Request body - check Swagger 2.0 body parameter first
  let body = '';
  const bodyParam = params.find(p => p.in === 'body');
  if (bodyParam?.schema) {
    const ct = operation.consumes?.[0] ?? 'application/json';
    headers.push({ key: 'Content-Type', value: ct, enabled: true });
    const generated = generateBodyFromSchema(bodyParam.schema, 0);
    if (generated !== undefined) {
      body = JSON.stringify(generated, null, 2);
    }
  } else if (operation.requestBody) {
    const jsonContent = operation.requestBody.content?.['application/json'];
    if (jsonContent?.schema) {
      headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
      const generated = generateBodyFromSchema(jsonContent.schema, 0);
      if (generated !== undefined) {
        body = JSON.stringify(generated, null, 2);
      }
    } else {
      // Check for other content types
      const contentTypes = Object.keys(operation.requestBody.content ?? {});
      if (contentTypes.length > 0) {
        const ct = contentTypes[0];
        const schema = operation.requestBody.content![ct]?.schema;
        if (ct.includes('form-urlencoded') || ct.includes('multipart')) {
          headers.push({ key: 'Content-Type', value: ct, enabled: true });
          // Generate form body from schema properties
          if (schema?.properties) {
            body = Object.entries(schema.properties)
              .map(([key, prop]) => `${key}=${schemaStubValue(prop)}`)
              .join('&');
          }
        } else {
          headers.push({ key: 'Content-Type', value: ct, enabled: true });
          if (schema) {
            const generated = generateBodyFromSchema(schema, 0);
            if (generated !== undefined) {
              body = typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2);
            }
          }
        }
      }
    }
  }

  // Request name
  const name = operation.summary || operation.operationId || `${upperMethod} ${path}`;

  return {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    varName: operation.operationId ?? null,
    method: normalizedMethod,
    url,
    headers,
    body,
    directives: [],
  };
}

// ─── Body Generation from JSON Schema ────────────────────────────────────────

function generateBodyFromSchema(schema: SchemaObject, depth: number): unknown {
  if (depth >= MAX_SCHEMA_DEPTH) return undefined;

  // Use example if available
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  // Handle allOf by merging
  if (schema.allOf && schema.allOf.length > 0) {
    const merged: SchemaObject = { type: 'object', properties: {}, required: [] };
    for (const sub of schema.allOf) {
      if (sub.properties) {
        merged.properties = { ...merged.properties, ...sub.properties };
      }
      if (sub.required) {
        merged.required = [...(merged.required ?? []), ...sub.required];
      }
    }
    return generateBodyFromSchema(merged, depth);
  }

  // Handle oneOf/anyOf - use first variant
  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateBodyFromSchema(schema.oneOf[0], depth);
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateBodyFromSchema(schema.anyOf[0], depth);
  }

  const type = resolveSchemaType(schema);

  switch (type) {
    case 'object': {
      if (!schema.properties) return {};
      const obj: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const val = generateBodyFromSchema(prop, depth + 1);
        if (val !== undefined) {
          obj[key] = val;
        }
      }
      return obj;
    }

    case 'array': {
      if (!schema.items) return [];
      const item = generateBodyFromSchema(schema.items, depth + 1);
      return item !== undefined ? [item] : [];
    }

    case 'string':
      return schemaStringValue(schema);

    case 'integer':
    case 'number':
      if (schema.enum && schema.enum.length > 0) return schema.enum[0];
      return 0;

    case 'boolean':
      return true;

    default:
      return 'string';
  }
}

function resolveSchemaType(schema: SchemaObject): string {
  if (typeof schema.type === 'string') return schema.type;
  // OpenAPI 3.1: type can be an array like ["string", "null"]
  if (Array.isArray(schema.type)) {
    return schema.type.find(t => t !== 'null') ?? 'string';
  }
  // Infer from properties/items
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return 'string';
}

function schemaStringValue(schema: SchemaObject): string {
  if (schema.enum && schema.enum.length > 0) return String(schema.enum[0]);

  switch (schema.format) {
    case 'email': return 'user@example.com';
    case 'date-time': return '2024-01-01T00:00:00Z';
    case 'date': return '2024-01-01';
    case 'time': return '00:00:00Z';
    case 'uri':
    case 'url': return 'https://example.com';
    case 'uuid': return '550e8400-e29b-41d4-a716-446655440000';
    case 'ipv4': return '192.168.1.1';
    case 'ipv6': return '::1';
    case 'hostname': return 'example.com';
    case 'password': return 'password';
    case 'binary':
    case 'byte': return '';
    default: return 'string';
  }
}

function schemaStubValue(schema: SchemaObject): string {
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  if (schema.enum && schema.enum.length > 0) return String(schema.enum[0]);
  const type = resolveSchemaType(schema);
  switch (type) {
    case 'integer':
    case 'number': return '0';
    case 'boolean': return 'true';
    default: return 'string';
  }
}

// ─── Auth Resolution ─────────────────────────────────────────────────────────

function resolveAuth(
  schemes: Record<string, SecurityScheme>,
  security: SecurityRequirement[],
): HttpHeader | null {
  if (security.length === 0) return null;

  // Use the first security requirement
  const firstReq = security[0];
  const schemeName = Object.keys(firstReq)[0];
  if (!schemeName) return null;

  const scheme = schemes[schemeName];
  if (!scheme) return null;

  switch (scheme.type) {
    case 'http':
      if (scheme.scheme === 'bearer') {
        return { key: 'Authorization', value: 'Bearer {{bearerToken}}', enabled: true };
      }
      if (scheme.scheme === 'basic') {
        return { key: 'Authorization', value: 'Basic {{$base64 {{username}}:{{password}}}}', enabled: true };
      }
      return null;

    case 'apiKey':
      if (scheme.in === 'header' && scheme.name) {
        const varName = sanitizeVarName(scheme.name);
        return { key: scheme.name, value: `{{${varName}}}`, enabled: true };
      }
      // query-based apiKey is handled in URL - skip header
      return null;

    case 'oauth2':
      return { key: 'Authorization', value: 'Bearer {{accessToken}}', enabled: true };

    default:
      return null;
  }
}

function addAuthVariables(
  schemes: Record<string, SecurityScheme>,
  security: SecurityRequirement[],
  vars: Variable[],
): void {
  if (security.length === 0) return;

  const schemeName = Object.keys(security[0])[0];
  if (!schemeName) return;

  const scheme = schemes[schemeName];
  if (!scheme) return;

  switch (scheme.type) {
    case 'http':
      if (scheme.scheme === 'bearer') {
        vars.push({ key: 'bearerToken', value: '' });
      } else if (scheme.scheme === 'basic') {
        vars.push({ key: 'username', value: '' });
        vars.push({ key: 'password', value: '' });
      }
      break;
    case 'apiKey':
      if (scheme.name) {
        vars.push({ key: sanitizeVarName(scheme.name), value: '' });
      }
      break;
    case 'oauth2':
      vars.push({ key: 'accessToken', value: '' });
      break;
  }
}

// ─── Parameter Handling ──────────────────────────────────────────────────────

function mergeParameters(pathLevel: Parameter[], opLevel: Parameter[]): Parameter[] {
  // Operation-level params override path-level params with the same name+in
  const map = new Map<string, Parameter>();
  for (const p of pathLevel) map.set(`${p.in}:${p.name}`, p);
  for (const p of opLevel) map.set(`${p.in}:${p.name}`, p);
  return Array.from(map.values());
}

function resolveParamDefault(param: Parameter): string {
  if (param.example !== undefined) return String(param.example);
  if (param.default !== undefined) return String(param.default);
  if (param.schema?.example !== undefined) return String(param.schema.example);
  if (param.schema?.default !== undefined) return String(param.schema.default);
  if (param.schema?.enum && param.schema.enum.length > 0) return String(param.schema.enum[0]);

  // Type-based defaults
  const type = param.schema?.type ?? param.type ?? 'string';
  const resolvedType = Array.isArray(type) ? (type.find(t => t !== 'null') ?? 'string') : type;
  switch (resolvedType) {
    case 'integer':
    case 'number': return '0';
    case 'boolean': return 'true';
    default: return '';
  }
}

// ─── $ref Resolution ─────────────────────────────────────────────────────────

/**
 * Recursively resolve all `$ref` pointers in the spec in-place.
 * Only handles same-document JSON Pointer refs (e.g. "#/components/schemas/Pet").
 * Circular refs are detected via a seen-set and left unresolved.
 */
function dereferenceRefs(node: any, root: any, seen?: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (!seen) seen = new Set();

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (node[i] && typeof node[i] === 'object' && node[i].$ref) {
        node[i] = resolveRef(node[i].$ref, root, seen);
      }
      dereferenceRefs(node[i], root, seen);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (val && typeof val === 'object') {
      if (val.$ref) {
        node[key] = resolveRef(val.$ref, root, seen);
      }
      dereferenceRefs(node[key], root, seen);
    }
  }
}

function resolveRef(ref: string, root: any, seen: Set<string>): any {
  if (!ref.startsWith('#/')) return { _unresolved: ref };
  if (seen.has(ref)) return {}; // circular - return empty to avoid infinite loops
  seen.add(ref);

  const parts = ref.slice(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return {};
    current = current[part];
  }
  return current ?? {};
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function deriveTagFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return 'default';
  // Skip version segments like "v1", "v2"
  const first = segments[0];
  if (/^v\d+$/i.test(first) && segments.length > 1) return capitalize(segments[1]);
  return capitalize(first);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unnamed';
}

function sanitizeVarName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}
