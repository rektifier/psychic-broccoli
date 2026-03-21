import type { HttpMethod, HttpHeader, HttpRequest, ConvertedFile, ImportResult } from './types';
import { serializeHttpFile, extractVariableRefs } from './parser';

// ─── Postman Collection v2.1 Types ─────────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[];       // folder
  request?: PostmanRequest;   // request
  variable?: PostmanVariable[];
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  url: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string | { content: string };
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
  query?: PostmanQuery[];
  variable?: PostmanVariable[];
}

interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: { key: string; value: string; disabled?: boolean }[];
  formdata?: { key: string; value: string; type?: string; disabled?: boolean }[];
  graphql?: { query: string; variables?: string };
  options?: {
    raw?: { language?: string };
  };
}

interface PostmanAuth {
  type: string;
  bearer?: { key: string; value: string }[];
  basic?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
}

interface PostmanVariable {
  key: string;
  value: string;
}

// ─── Valid HTTP methods ────────────────────────────────────────────────────

const VALID_METHODS = new Set<string>([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
]);

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Parse and convert a Postman Collection v2.1 JSON string to .http files.
 *
 * Folders in the collection become separate .http files.
 * Top-level requests (not in folders) are grouped into a single file.
 */
export function importPostmanCollection(jsonString: string): ImportResult {
  const collection: PostmanCollection = JSON.parse(jsonString);

  if (!collection.info || !collection.item) {
    throw new Error('Invalid Postman collection: missing "info" or "item" fields');
  }

  const collectionName = collection.info.name || 'Imported';
  const files: ConvertedFile[] = [];
  const topLevelRequests: PostmanItem[] = [];

  for (const item of collection.item) {
    if (item.item && item.item.length > 0) {
      collectFiles(item, '', files, collection.auth);
    } else if (item.request) {
      topLevelRequests.push(item);
    }
  }

  if (topLevelRequests.length > 0) {
    const content = convertItemsToHttp(topLevelRequests, collection.auth);
    files.push({
      relativePath: `${sanitizeFilename(collectionName)}.http`,
      content,
    });
  }

  const collectionVars = collection.variable ?? [];
  const discoveredVariables = extractVariableRefs(files, collectionVars);

  return {
    files,
    collectionName,
    variables: collectionVars,
    discoveredVariables,
  };
}

// ─── Internal ──────────────────────────────────────────────────────────────

function collectFiles(
  folder: PostmanItem,
  parentPath: string,
  files: ConvertedFile[],
  collectionAuth?: PostmanAuth,
): void {
  const folderPath = parentPath
    ? `${parentPath}/${sanitizeFilename(folder.name)}`
    : sanitizeFilename(folder.name);

  const requests: PostmanItem[] = [];
  const subfolders: PostmanItem[] = [];

  for (const child of folder.item ?? []) {
    if (child.item && child.item.length > 0) {
      subfolders.push(child);
    } else if (child.request) {
      requests.push(child);
    }
  }

  if (requests.length > 0) {
    const content = convertItemsToHttp(requests, collectionAuth);
    files.push({
      relativePath: `${folderPath}.http`,
      content,
    });
  }

  for (const sub of subfolders) {
    collectFiles(sub, folderPath, files, collectionAuth);
  }
}

function convertItemsToHttp(
  items: PostmanItem[],
  collectionAuth?: PostmanAuth,
): string {
  const requests = items
    .filter(item => item.request)
    .map(item => convertRequest(item, collectionAuth));

  return serializeHttpFile(requests, []);
}

function convertRequest(
  item: PostmanItem,
  collectionAuth?: PostmanAuth,
): HttpRequest {
  const req = item.request!;
  const method = normalizeMethod(req.method);
  const url = buildUrl(req.url);
  const headers = buildHeaders(req.header, req.body, req.auth ?? collectionAuth);
  const body = buildBody(req.body);

  return {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || `${method} ${url}`,
    varName: null,
    method,
    url,
    headers,
    body,
    directives: [],
  };
}

function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  return VALID_METHODS.has(upper) ? upper as HttpMethod : 'GET';
}

function buildUrl(url: PostmanUrl | string | undefined): string {
  if (!url) return 'https://';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;

  let result = '';
  if (url.protocol) result += `${url.protocol}://`;
  if (url.host) result += url.host.join('.');
  if (url.port) result += `:${url.port}`;
  if (url.path) result += `/${url.path.join('/')}`;

  const enabledParams = (url.query ?? []).filter(q => !q.disabled);
  if (enabledParams.length > 0) {
    result += '?' + enabledParams.map(q => `${q.key}=${q.value}`).join('&');
  }

  return result || 'https://';
}

function buildHeaders(
  headers?: PostmanHeader[],
  body?: PostmanBody,
  auth?: PostmanAuth,
): HttpHeader[] {
  const result: HttpHeader[] = [];

  if (auth) {
    const authHeader = resolveAuth(auth);
    if (authHeader) {
      result.push(authHeader);
    }
  }

  if (headers) {
    for (const h of headers) {
      result.push({
        key: h.key,
        value: h.value,
        enabled: !h.disabled,
      });
    }
  }

  if (body) {
    const hasContentType = result.some(
      h => h.key.toLowerCase() === 'content-type' && h.enabled,
    );
    if (!hasContentType) {
      const contentType = inferContentType(body);
      if (contentType) {
        result.push({ key: 'Content-Type', value: contentType, enabled: true });
      }
    }
  }

  return result;
}

function resolveAuth(auth: PostmanAuth): HttpHeader | null {
  switch (auth.type) {
    case 'bearer': {
      const token = auth.bearer?.find(b => b.key === 'token')?.value;
      if (token) {
        return { key: 'Authorization', value: `Bearer ${token}`, enabled: true };
      }
      return null;
    }
    case 'basic': {
      const username = auth.basic?.find(b => b.key === 'username')?.value ?? '';
      const password = auth.basic?.find(b => b.key === 'password')?.value ?? '';
      if (username.includes('{{') || password.includes('{{')) {
        return { key: 'Authorization', value: `Basic {{$base64 ${username}:${password}}}`, enabled: true };
      }
      const encoded = btoa(new TextEncoder().encode(`${username}:${password}`).reduce((s, b) => s + String.fromCharCode(b), ''));
      return { key: 'Authorization', value: `Basic ${encoded}`, enabled: true };
    }
    case 'apikey': {
      const key = auth.apikey?.find(a => a.key === 'key')?.value;
      const value = auth.apikey?.find(a => a.key === 'value')?.value;
      const addTo = auth.apikey?.find(a => a.key === 'in')?.value;
      if (key && value && addTo !== 'query') {
        return { key, value, enabled: true };
      }
      return null;
    }
    default:
      return null;
  }
}

function inferContentType(body: PostmanBody): string | null {
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language;
      if (lang === 'json') return 'application/json';
      if (lang === 'xml') return 'application/xml';
      if (lang === 'html') return 'text/html';
      if (lang === 'javascript') return 'application/javascript';
      if (body.raw?.trim().startsWith('{') || body.raw?.trim().startsWith('[')) {
        return 'application/json';
      }
      return null;
    }
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    case 'graphql':
      return 'application/json';
    default:
      return null;
  }
}

function buildBody(body?: PostmanBody): string {
  if (!body) return '';

  switch (body.mode) {
    case 'raw':
      return body.raw ?? '';

    case 'urlencoded': {
      const pairs = (body.urlencoded ?? [])
        .filter(p => !p.disabled)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`);
      return pairs.join('&');
    }

    case 'graphql': {
      const gql: Record<string, unknown> = {};
      if (body.graphql?.query) gql.query = body.graphql.query;
      if (body.graphql?.variables) {
        try {
          gql.variables = JSON.parse(body.graphql.variables);
        } catch {
          gql.variables = body.graphql.variables;
        }
      }
      return JSON.stringify(gql, null, 2);
    }

    case 'formdata': {
      const parts = (body.formdata ?? [])
        .filter(p => !p.disabled && p.type !== 'file')
        .map(p => `${p.key}=${p.value}`);
      return parts.join('\n');
    }

    default:
      return '';
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unnamed';
}
