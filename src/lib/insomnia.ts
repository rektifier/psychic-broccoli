import yaml from 'js-yaml';
import type { HttpMethod, HttpHeader, Variable, ConvertedFile, ImportResult } from './types';
import { serializeHttpFile, extractVariableRefs } from './parser';

// ─── Shared Types ──────────────────────────────────────────────────────────

interface InsomniaHeader {
  name: string;
  value: string;
  disabled?: boolean;
}

interface InsomniaParam {
  name: string;
  value: string;
  disabled?: boolean;
}

interface InsomniaBody {
  mimeType?: string;
  text?: string;
  params?: { name: string; value: string; disabled?: boolean; type?: string }[];
}

interface InsomniaAuth {
  type?: string;
  token?: string;
  username?: string;
  password?: string;
  addTo?: string;
  key?: string;
  value?: string;
  disabled?: boolean;
  prefix?: string;
}

// ─── v5 YAML Types ─────────────────────────────────────────────────────────

interface V5Export {
  type: string;          // "collection.insomnia.rest/5.0"
  schema_version: string;
  name: string;
  collection: V5Item[];
  environments?: V5Environment;
  cookieJar?: unknown;
}

interface V5Item {
  name: string;
  url?: string;
  method?: string;
  headers?: InsomniaHeader[];
  parameters?: InsomniaParam[];
  pathParameters?: InsomniaParam[];
  body?: InsomniaBody;
  authentication?: InsomniaAuth;
  children?: V5Item[];
  meta?: { id?: string; sortKey?: number; description?: string };
  settings?: unknown;
}

interface V5Environment {
  name?: string;
  data?: Record<string, unknown>;
  meta?: { id?: string };
}

// ─── v4 JSON Types ─────────────────────────────────────────────────────────

interface V4Export {
  _type: 'export';
  __export_format: number;
  resources: V4Resource[];
}

interface V4Resource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  description?: string;
  metaSortKey?: number;
  method?: string;
  url?: string;
  headers?: InsomniaHeader[];
  parameters?: InsomniaParam[];
  body?: InsomniaBody;
  authentication?: InsomniaAuth;
  data?: Record<string, unknown>;
}

// ─── Valid HTTP methods ────────────────────────────────────────────────────

const VALID_METHODS = new Set<string>([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
]);

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Parse and convert an Insomnia export (v4 JSON or v5 YAML) to .http files.
 */
export function importInsomniaExport(content: string): ImportResult {
  // Detect format: v5 YAML starts with "type:" or contains the schema marker
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return importV4Json(content);
  }
  return importV5Yaml(content);
}

// ─── v5 YAML Import ───────────────────────────────────────────────────────

function importV5Yaml(content: string): ImportResult {
  const data = yaml.load(content) as V5Export;

  if (!data?.collection || !Array.isArray(data.collection)) {
    throw new Error('Invalid Insomnia v5 export: missing "collection" array');
  }

  const collectionName = data.name || 'Imported';
  const nameById = new Map<string, string>();
  collectV5Names(data.collection, nameById);

  // Extract environment variables
  const envVars: Variable[] = [];
  if (data.environments?.data) {
    for (const [key, value] of Object.entries(data.environments.data)) {
      if (typeof value === 'string') {
        envVars.push({ key, value });
      }
    }
  }

  // Walk the collection tree
  const files: ConvertedFile[] = [];
  const topLevelRequests: V5Item[] = [];

  for (const item of data.collection) {
    if (item.children && item.children.length > 0) {
      collectV5Files(item, '', files, nameById);
    } else if (item.url || item.method) {
      topLevelRequests.push(item);
    }
  }

  if (topLevelRequests.length > 0) {
    const requests = topLevelRequests.map(r => convertV5Request(r, nameById));
    const httpContent = serializeHttpFile(requests, envVars);
    files.push({
      relativePath: `${sanitizeFilename(collectionName)}.http`,
      content: httpContent,
    });
  }

  const discoveredVariables = extractVariableRefs(files, envVars);

  return { files, collectionName, variables: envVars, discoveredVariables };
}

function collectV5Names(items: V5Item[], nameById: Map<string, string>): void {
  for (const item of items) {
    if (item.meta?.id && item.name && (item.url || item.method)) {
      nameById.set(item.meta.id, sanitizeVarName(item.name));
    }
    if (item.children) {
      collectV5Names(item.children, nameById);
    }
  }
}

function collectV5Files(
  folder: V5Item,
  parentPath: string,
  files: ConvertedFile[],
  nameById: Map<string, string>,
): void {
  const folderPath = parentPath
    ? `${parentPath}/${sanitizeFilename(folder.name)}`
    : sanitizeFilename(folder.name);

  const requests: V5Item[] = [];
  const subfolders: V5Item[] = [];

  for (const child of folder.children ?? []) {
    if (child.children && child.children.length > 0) {
      subfolders.push(child);
    } else if (child.url || child.method) {
      requests.push(child);
    }
  }

  if (requests.length > 0) {
    const converted = requests.map(r => convertV5Request(r, nameById));
    const content = serializeHttpFile(converted, []);
    files.push({ relativePath: `${folderPath}.http`, content });
  }

  for (const sub of subfolders) {
    collectV5Files(sub, folderPath, files, nameById);
  }
}

function convertV5Request(
  item: V5Item,
  nameById: Map<string, string>,
): { id: string; name: string; varName: null; method: HttpMethod; url: string; headers: HttpHeader[]; body: string } {
  const method = normalizeMethod(item.method ?? 'GET');

  // Build URL: replace :param with pathParameter values, then append query params
  let rawUrl = item.url || 'https://';
  if (item.pathParameters) {
    for (const p of item.pathParameters) {
      rawUrl = rawUrl.replace(`:${p.name}`, p.value);
    }
  }
  rawUrl = appendQueryParams(rawUrl, item.parameters);
  const url = convertTemplateVars(rawUrl, nameById);

  const headers = buildHeaders(item.headers, item.body, item.authentication, nameById);
  const rawBody = buildBody(item.body);
  const body = convertTemplateVars(rawBody, nameById);

  return {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || `${method} ${url}`,
    varName: null,
    method,
    url,
    headers,
    body,
  };
}

// ─── v4 JSON Import ───────────────────────────────────────────────────────

function importV4Json(content: string): ImportResult {
  const data: V4Export = JSON.parse(content);

  if (!data.resources || !Array.isArray(data.resources)) {
    throw new Error('Invalid Insomnia export: missing "resources" array');
  }

  // Build lookup maps
  const childrenOf = new Map<string, V4Resource[]>();
  for (const r of data.resources) {
    const pid = r.parentId ?? '__root__';
    let list = childrenOf.get(pid);
    if (!list) { list = []; childrenOf.set(pid, list); }
    list.push(r);
  }
  for (const children of childrenOf.values()) {
    children.sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0));
  }

  const workspaces = data.resources.filter(r => r._type === 'workspace');
  const workspaceId = workspaces[0]?._id ?? null;
  const collectionName = workspaces[0]?.name || 'Imported';

  // Extract base environment variables
  const baseEnvVars = extractV4EnvVars(data.resources, workspaceId);

  const nameById = new Map<string, string>();
  for (const r of data.resources) {
    if (r._type === 'request' && r.name) {
      nameById.set(r._id, sanitizeVarName(r.name));
    }
  }

  const files: ConvertedFile[] = [];
  const rootChildren = workspaceId
    ? (childrenOf.get(workspaceId) ?? [])
    : (childrenOf.get('__root__') ?? []);

  const topLevelRequests: V4Resource[] = [];
  for (const child of rootChildren) {
    if (child._type === 'request_group') {
      collectV4Files(child, '', files, childrenOf, nameById);
    } else if (child._type === 'request') {
      topLevelRequests.push(child);
    }
  }

  if (topLevelRequests.length > 0) {
    const requests = topLevelRequests.map(r => convertV4Request(r, nameById));
    const httpContent = serializeHttpFile(requests, baseEnvVars);
    files.push({
      relativePath: `${sanitizeFilename(collectionName)}.http`,
      content: httpContent,
    });
  }

  const discoveredVariables = extractVariableRefs(files, baseEnvVars);

  return { files, collectionName, variables: baseEnvVars, discoveredVariables };
}

function collectV4Files(
  folder: V4Resource,
  parentPath: string,
  files: ConvertedFile[],
  childrenOf: Map<string, V4Resource[]>,
  nameById: Map<string, string>,
): void {
  const folderPath = parentPath
    ? `${parentPath}/${sanitizeFilename(folder.name ?? 'unnamed')}`
    : sanitizeFilename(folder.name ?? 'unnamed');

  const children = childrenOf.get(folder._id) ?? [];
  const requests: V4Resource[] = [];
  const subfolders: V4Resource[] = [];

  for (const child of children) {
    if (child._type === 'request_group') subfolders.push(child);
    else if (child._type === 'request') requests.push(child);
  }

  if (requests.length > 0) {
    const converted = requests.map(r => convertV4Request(r, nameById));
    const content = serializeHttpFile(converted, []);
    files.push({ relativePath: `${folderPath}.http`, content });
  }

  for (const sub of subfolders) {
    collectV4Files(sub, folderPath, files, childrenOf, nameById);
  }
}

function convertV4Request(
  resource: V4Resource,
  nameById: Map<string, string>,
): { id: string; name: string; varName: null; method: HttpMethod; url: string; headers: HttpHeader[]; body: string } {
  const method = normalizeMethod(resource.method ?? 'GET');
  const rawUrl = appendQueryParams(resource.url || 'https://', resource.parameters);
  const url = convertTemplateVars(rawUrl, nameById);
  const headers = buildHeaders(resource.headers, resource.body, resource.authentication, nameById);
  const rawBody = buildBody(resource.body);
  const body = convertTemplateVars(rawBody, nameById);

  return {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: resource.name || `${method} ${url}`,
    varName: null,
    method,
    url,
    headers,
    body,
  };
}

function extractV4EnvVars(resources: V4Resource[], workspaceId: string | null): Variable[] {
  if (!workspaceId) return [];
  const baseEnv = resources.find(r => r._type === 'environment' && r.parentId === workspaceId);
  if (!baseEnv?.data) return [];
  const vars: Variable[] = [];
  for (const [key, value] of Object.entries(baseEnv.data)) {
    if (typeof value === 'string') vars.push({ key, value });
  }
  return vars;
}

// ─── Shared Request Conversion Helpers ─────────────────────────────────────

function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  return VALID_METHODS.has(upper) ? upper as HttpMethod : 'GET';
}

function appendQueryParams(url: string, parameters?: InsomniaParam[]): string {
  const enabled = (parameters ?? []).filter(p => !p.disabled);
  if (enabled.length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + enabled.map(p => `${p.name}=${p.value}`).join('&');
}

function buildHeaders(
  headers?: InsomniaHeader[],
  body?: InsomniaBody,
  auth?: InsomniaAuth,
  nameById?: Map<string, string>,
): HttpHeader[] {
  const result: HttpHeader[] = [];

  if (auth && !auth.disabled) {
    const authHeader = resolveAuth(auth, nameById);
    if (authHeader) result.push(authHeader);
  }

  if (headers) {
    for (const h of headers) {
      result.push({
        key: h.name,
        value: nameById ? convertTemplateVars(h.value, nameById) : h.value,
        enabled: !h.disabled,
      });
    }
  }

  if (body?.mimeType) {
    const hasContentType = result.some(h => h.key.toLowerCase() === 'content-type' && h.enabled);
    if (!hasContentType) {
      result.push({ key: 'Content-Type', value: body.mimeType, enabled: true });
    }
  }

  return result;
}

function resolveAuth(auth: InsomniaAuth, nameById?: Map<string, string>): HttpHeader | null {
  switch (auth.type) {
    case 'bearer': {
      const token = auth.token ?? '';
      if (!token) return null;
      const resolved = nameById ? convertTemplateVars(token, nameById) : token;
      return { key: 'Authorization', value: `Bearer ${resolved}`, enabled: true };
    }
    case 'basic': {
      const username = auth.username ?? '';
      const password = auth.password ?? '';
      const resolvedUser = nameById ? convertTemplateVars(username, nameById) : username;
      const resolvedPass = nameById ? convertTemplateVars(password, nameById) : password;
      if (resolvedUser.includes('{{') || resolvedPass.includes('{{')) {
        return { key: 'Authorization', value: `Basic {{$base64 ${resolvedUser}:${resolvedPass}}}`, enabled: true };
      }
      const encoded = btoa(`${resolvedUser}:${resolvedPass}`);
      return { key: 'Authorization', value: `Basic ${encoded}`, enabled: true };
    }
    case 'apikey': {
      const key = auth.key;
      const value = auth.value;
      if (!key || !value) return null;
      if (auth.addTo === 'query') return null;
      const resolved = nameById ? convertTemplateVars(value, nameById) : value;
      return { key, value: resolved, enabled: true };
    }
    default:
      return null;
  }
}

function buildBody(body?: InsomniaBody): string {
  if (!body) return '';
  if (body.text != null) return body.text;
  if (body.params && body.params.length > 0) {
    const mime = body.mimeType ?? '';
    if (mime.includes('x-www-form-urlencoded')) {
      return body.params
        .filter(p => !p.disabled)
        .map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
        .join('&');
    }
    return body.params
      .filter(p => !p.disabled && p.type !== 'file')
      .map(p => `${p.name}=${p.value}`)
      .join('\n');
  }
  return '';
}

// ─── Template Variable Conversion ──────────────────────────────────────────

/**
 * Convert Insomnia's Nunjucks template syntax to .http variable syntax.
 *
 * Handles:
 *   {{ _.VAR_NAME }}  ->  {{VAR_NAME}}    (v5 underscore prefix)
 *   {{ varName }}     ->  {{varName}}      (trim whitespace)
 *   {% uuid 'v4' %}   ->  {{$guid}}
 *   {% timestamp %}   ->  {{$timestamp}}
 *   {% response 'body', 'req_xxx', '$.path' %}  ->  {{reqName.response.body.$.path}}
 */
function convertTemplateVars(text: string, nameById: Map<string, string>): string {
  let result = text;

  // Convert {% uuid %} and {% uuid 'v4' %} to {{$guid}}
  result = result.replace(/\{%\s*uuid\b.*?%\}/g, '{{$guid}}');

  // Convert {% timestamp %} to {{$timestamp}}
  result = result.replace(/\{%\s*timestamp\b.*?%\}/g, '{{$timestamp}}');

  // Convert {% response 'body', 'req_xxx', '$.path' %} to {{reqName.response.body.$.path}}
  result = result.replace(
    /\{%\s*response\s+'(body|header)',\s*'(\w+)',\s*'([^']+)'\s*%\}/g,
    (_match, bodyOrHeader, reqId, path) => {
      const reqName = nameById.get(reqId);
      if (reqName) {
        const part = bodyOrHeader === 'header' ? 'headers' : 'body';
        return `{{${reqName}.response.${part}.${path}}}`;
      }
      return `{{${reqId}.response.${bodyOrHeader === 'header' ? 'headers' : 'body'}.${path}}}`;
    },
  );

  // Strip the v5 underscore prefix: {{ _.VAR }} -> {{VAR}}
  result = result.replace(/\{\{\s*_\.\s*(\w[\w.]*)\s*\}\}/g, '{{$1}}');

  // Trim whitespace inside {{ variable }} -> {{variable}}
  result = result.replace(/\{\{\s+(\w[\w.]*)\s+\}\}/g, '{{$1}}');
  result = result.replace(/\{\{\s+(\w[\w.]*)\}\}/g, '{{$1}}');
  result = result.replace(/\{\{(\w[\w.]*)\s+\}\}/g, '{{$1}}');

  return result;
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unnamed';
}

function sanitizeVarName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}
