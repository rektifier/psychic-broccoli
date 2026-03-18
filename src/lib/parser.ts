import type {
  HttpRequest, HttpMethod, HttpHeader, Variable,
  EnvironmentFile, EnvironmentVariables, ProviderVariable,
  NamedRequestResult,
  TreeNode, FileNode, FolderNode,
} from './types';

// ─── Constants ──────────────────────────────────────────────────────────────

const METHODS: HttpMethod[] = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
];

const METHOD_PATTERN = METHODS.join('|');

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/** Request line: METHOD URL [HTTP/version] */
const REQUEST_LINE_RE = new RegExp(
  `^(${METHOD_PATTERN})\\s+(.+?)(?:\\s+HTTP\\/[\\d.]+)?\\s*$`
);

/** Header: Key: Value */
const HEADER_RE = /^([A-Za-z0-9\-_]+)\s*:\s*(.+)$/;

/** File-level variable: @name = value */
const VARIABLE_RE = /^@(\w+)\s*=\s*(.+)$/;

/** Request separator: ### [optional name] */
const SEPARATOR_RE = /^###\s*(.*)?$/;

/** Comment line: # ... or // ... */
const COMMENT_RE = /^(#(?!##)|\/\/)/;

/** Request variable name: # @name foo  or  // @name foo */
const NAME_DIRECTIVE_RE = /^(?:#|\/\/)\s*@name\s+(\S+)\s*$/;

/** Dynamic variable: {{$something ...}} */
const DYNAMIC_VAR_RE = /\{\{\$(\w+)(?:\s+(.+?))?\}\}/g;

/** Request variable ref: {{reqName.response.body.$.path}} etc. */
const REQUEST_VAR_RE = /\{\{(\w+)\.(request|response)\.(body|headers)\.(.+?)\}\}/g;

/** Standard variable ref: {{name}} (but not dynamic or request vars) */
const SIMPLE_VAR_RE = /\{\{([^${}][^{}]*?)\}\}/g;

// ─── ID Generator ───────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `req_${Date.now()}_${++idCounter}`;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

export interface ParseResult {
  requests: HttpRequest[];
  /** File-level @variable declarations */
  variables: Variable[];
}

/**
 * Parse a .http file string into requests and variables.
 *
 * Supports the full Visual Studio / VS Code REST Client syntax:
 *   - ### separators with optional names
 *   - # and // comments
 *   - # @name / // @name request variable naming
 *   - @variable = value declarations (can reference earlier variables)
 *   - {{variable}} substitution
 *   - Request line: METHOD URL [HTTP/version]
 *   - Headers (no blank line between request line and headers)
 *   - Body after blank line
 *   - TRACE and CONNECT methods
 */
export function parseHttpFile(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const variables: Variable[] = [];
  const requests: HttpRequest[] = [];

  let currentName = '';
  let currentVarName: string | null = null;
  let currentMethod: HttpMethod | null = null;
  let currentUrl = '';
  let currentHeaders: HttpHeader[] = [];
  let currentBody: string[] = [];
  let inBody = false;
  let hasRequest = false;

  function flushRequest() {
    if (currentMethod && currentUrl) {
      requests.push({
        id: nextId(),
        name: currentName || `${currentMethod} ${currentUrl}`,
        varName: currentVarName,
        method: currentMethod,
        url: currentUrl,
        headers: currentHeaders,
        body: currentBody.join('\n').trim(),
      });
    }
    currentName = '';
    currentVarName = null;
    currentMethod = null;
    currentUrl = '';
    currentHeaders = [];
    currentBody = [];
    inBody = false;
    hasRequest = false;
  }

  for (const line of lines) {
    // ── Separator: ### [name] ──
    const sepMatch = line.match(SEPARATOR_RE);
    if (sepMatch) {
      flushRequest();
      currentName = sepMatch[1]?.trim() || '';
      continue;
    }

    // ── Request variable name directive: # @name foo ──
    const nameMatch = line.match(NAME_DIRECTIVE_RE);
    if (nameMatch) {
      // If we're not yet in a request, this names the NEXT request.
      // If we already have a request, flush it first.
      if (hasRequest) {
        flushRequest();
      }
      currentVarName = nameMatch[1];
      if (!currentName) {
        currentName = nameMatch[1]; // Use varName as display name fallback
      }
      continue;
    }

    // ── Comment lines (# or //) — skip ──
    if (COMMENT_RE.test(line)) {
      continue;
    }

    // ── Variable declaration: @name = value ──
    const varMatch = line.match(VARIABLE_RE);
    if (varMatch && !hasRequest) {
      let value = varMatch[2].trim();
      // Variables can reference earlier variables: @host={{hostname}}:{{port}}
      value = resolveVariableReferences(value, variables);
      variables.push({ key: varMatch[1], value });
      continue;
    }

    // ── Request line: METHOD URL [HTTP/version] ──
    const reqMatch = line.match(REQUEST_LINE_RE);
    if (reqMatch && !hasRequest) {
      currentMethod = reqMatch[1] as HttpMethod;
      currentUrl = reqMatch[2].trim();
      hasRequest = true;
      continue;
    }

    // ── Inside a request ──
    if (hasRequest) {
      // Blank line → transition to body
      if (line.trim() === '' && !inBody) {
        inBody = true;
        continue;
      }

      if (inBody) {
        currentBody.push(line);
      } else {
        // Header: Key: Value
        const headerMatch = line.match(HEADER_RE);
        if (headerMatch) {
          currentHeaders.push({
            key: headerMatch[1],
            value: headerMatch[2].trim(),
            enabled: true,
          });
        }
      }
    }
  }

  // Flush the last request
  flushRequest();

  return { requests, variables };
}

/**
 * Resolve {{var}} references within a variable definition using
 * already-defined variables. This supports:
 *   @hostname=localhost
 *   @port=44320
 *   @host={{hostname}}:{{port}}
 */
function resolveVariableReferences(value: string, definedVars: Variable[]): string {
  return value.replace(SIMPLE_VAR_RE, (match, name) => {
    const found = definedVars.find(v => v.key === name);
    return found ? found.value : match;
  });
}

// ─── Serializer ─────────────────────────────────────────────────────────────

/**
 * Serialize requests back to .http file format.
 */
export function serializeHttpFile(requests: HttpRequest[], variables: Variable[] = []): string {
  const parts: string[] = [];

  // Write variables at the top
  for (const v of variables) {
    parts.push(`@${v.key} = ${v.value}`);
  }
  if (variables.length > 0) {
    parts.push('');
  }

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];

    if (i > 0) {
      parts.push('');
    }

    // Separator with name
    parts.push(`### ${req.name}`);

    // If this request has a variable name, emit the @name directive
    if (req.varName) {
      parts.push(`# @name ${req.varName}`);
    }

    // Request line
    parts.push(`${req.method} ${req.url}`);

    // Headers
    for (const h of req.headers) {
      if (h.enabled) {
        parts.push(`${h.key}: ${h.value}`);
      }
    }

    // Body
    if (req.body.trim()) {
      parts.push('');
      parts.push(req.body);
    }
  }

  parts.push(''); // trailing newline
  return parts.join('\n');
}

// ─── Variable Substitution ──────────────────────────────────────────────────

export interface SubstitutionContext {
  /** File-level @variable declarations */
  fileVariables: Variable[];
  /** Resolved variables from the active environment (already merged with $shared and .user) */
  environmentVariables: Record<string, string>;
  /** Results from previously executed named requests */
  namedResults: Record<string, NamedRequestResult>;
  /** .env file variables (for $dotenv) */
  dotenvVariables?: Record<string, string>;
}

/**
 * Substitute all {{variable}} placeholders in a string.
 *
 * Resolution order (highest priority first):
 *   1. File-level @variables (defined in the .http file)
 *   2. Environment variables (from http-client.env.json.user > env.json > $shared)
 *   3. Dynamic variables ($randomInt, $datetime, $timestamp, etc.)
 *   4. Request variable references ({{name.response.body.$.path}})
 */
export function substituteAll(input: string, ctx: SubstitutionContext): string {
  let result = input;

  // 1. Dynamic variables: {{$randomInt}}, {{$datetime}}, {{$timestamp}}, etc.
  result = result.replace(DYNAMIC_VAR_RE, (_match, funcName: string, args: string | undefined) => {
    return resolveDynamicVariable(funcName, args?.trim());
  });

  // 2. Request variable references: {{login.response.body.$.token}}
  result = result.replace(REQUEST_VAR_RE, (_match, reqName, reqOrRes, bodyOrHeaders, path) => {
    return resolveRequestVariable(reqName, reqOrRes, bodyOrHeaders, path, ctx.namedResults);
  });

  // 3. Simple variables: {{name}} — resolved with file vars taking precedence over env vars.
  //    Loop to handle chained references where a file variable's value contains
  //    {{...}} placeholders that resolve from environment variables (e.g.
  //    @baseUrl = {{baseUrl}} where baseUrl is defined in the environment).
  //    Max 10 passes to guard against circular references.
  for (let pass = 0; pass < 10; pass++) {
    const previous = result;
    result = result.replace(SIMPLE_VAR_RE, (_match, name: string) => {
      if (name.startsWith('$processEnv ')) {
        return `[env:${name.slice(12).trim()}]`;
      }
      if (name.startsWith('$dotenv ')) {
        const dotenvKey = name.slice(8).trim();
        return ctx.dotenvVariables?.[dotenvKey] ?? `{{${name}}}`;
      }

      const fileVar = ctx.fileVariables.find(v => v.key === name);
      // Skip self-referencing file vars (e.g. @baseUrl = {{baseUrl}}) so
      // the lookup falls through to environment variables
      if (fileVar && fileVar.value !== `{{${name}}}`) return fileVar.value;

      if (name in ctx.environmentVariables) {
        return ctx.environmentVariables[name];
      }

      return `{{${name}}}`;
    });
    if (result === previous) break;
  }

  return result;
}

/**
 * Simple backward-compatible substitution using only file variables.
 * Used when no environment is configured.
 */
export function substituteVariables(input: string, variables: Variable[]): string {
  return substituteAll(input, {
    fileVariables: variables,
    environmentVariables: {},
    namedResults: {},
  });
}

// ─── Dynamic Variables ──────────────────────────────────────────────────────

/**
 * Resolve built-in dynamic variables.
 *
 * Supported:
 *   $randomInt [min max]        → random integer (default 0–1000)
 *   $timestamp [offset]         → Unix epoch seconds in UTC
 *   $datetime [format] [offset] → UTC datetime string
 *   $localDatetime [format] [offset] → local datetime string
 *   $processEnv NAME           → OS environment variable (placeholder in browser)
 *   $dotenv NAME               → .env file variable (placeholder)
 */
function resolveDynamicVariable(funcName: string, args?: string): string {
  switch (funcName) {
    case 'randomInt': {
      let min = 0, max = 1000;
      if (args) {
        const parts = args.split(/\s+/);
        if (parts.length >= 2) {
          min = parseInt(parts[0], 10) || 0;
          max = parseInt(parts[1], 10) || 1000;
        }
      }
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }

    case 'timestamp': {
      const date = applyOffset(new Date(), args);
      return String(Math.floor(date.getTime() / 1000));
    }

    case 'datetime': {
      return formatDatetime(new Date(), args, false);
    }

    case 'localDatetime': {
      return formatDatetime(new Date(), args, true);
    }

    case 'processEnv': {
      // In a Tauri app you'd use Tauri's env API.
      // Browser fallback: return a placeholder.
      return args ? `[env:${args}]` : '';
    }

    case 'dotenv': {
      // Handled at the substituteAll level; if it reaches here, it's unresolved.
      return args ? `[dotenv:${args}]` : '';
    }

    default:
      return `{{$${funcName}${args ? ' ' + args : ''}}}`;
  }
}

/**
 * Format a Date according to the .http spec datetime format rules.
 *
 * Formats: "rfc1123", "iso8601", or a custom strftime-like format in quotes.
 * Optional offset: number + unit (e.g. "1 d", "-3 h", "2 M").
 */
function formatDatetime(base: Date, args: string | undefined, local: boolean): string {
  let format = 'iso8601';
  let offsetStr: string | undefined;

  if (args) {
    const parts = args.split(/\s+/);
    // Determine if first token is a format specifier
    if (parts[0] === 'rfc1123' || parts[0] === 'iso8601') {
      format = parts[0];
      offsetStr = parts.slice(1).join(' ');
    } else if (parts[0]?.startsWith('"') || parts[0]?.startsWith("'")) {
      // Custom format in quotes: "dd-MM-yyyy"
      const quoted = args.match(/["'](.+?)["']/);
      if (quoted) {
        format = quoted[1];
        const afterQuote = args.slice(args.indexOf(quoted[0]) + quoted[0].length).trim();
        offsetStr = afterQuote || undefined;
      }
    } else {
      // Might be just an offset with no format
      offsetStr = args;
    }
  }

  const date = applyOffset(base, offsetStr);

  switch (format) {
    case 'rfc1123':
      return date.toUTCString();
    case 'iso8601':
      return local ? date.toISOString().replace('Z', getTimezoneOffset(date)) : date.toISOString();
    default:
      return applyCustomFormat(date, format, local);
  }
}

/** Apply an offset like "1 d", "-3 h", "2 M" to a date. */
function applyOffset(date: Date, offsetStr: string | undefined): Date {
  if (!offsetStr?.trim()) return date;

  const match = offsetStr.trim().match(/^(-?\d+)\s*([a-zA-Z]+)$/);
  if (!match) return date;

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const result = new Date(date);

  switch (unit) {
    case 'ms': result.setMilliseconds(result.getMilliseconds() + amount); break;
    case 's':  result.setSeconds(result.getSeconds() + amount); break;
    case 'm':  result.setMinutes(result.getMinutes() + amount); break;
    case 'h':  result.setHours(result.getHours() + amount); break;
    case 'd':  result.setDate(result.getDate() + amount); break;
    case 'w':  result.setDate(result.getDate() + amount * 7); break;
    case 'M':  result.setMonth(result.getMonth() + amount); break;
    case 'y':  result.setFullYear(result.getFullYear() + amount); break;
  }

  return result;
}

/** Simple custom date format (dd, MM, yyyy, HH, mm, ss). */
function applyCustomFormat(date: Date, format: string, local: boolean): string {
  const d = local ? {
    dd: String(date.getDate()).padStart(2, '0'),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    yyyy: String(date.getFullYear()),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  } : {
    dd: String(date.getUTCDate()).padStart(2, '0'),
    MM: String(date.getUTCMonth() + 1).padStart(2, '0'),
    yyyy: String(date.getUTCFullYear()),
    HH: String(date.getUTCHours()).padStart(2, '0'),
    mm: String(date.getUTCMinutes()).padStart(2, '0'),
    ss: String(date.getUTCSeconds()).padStart(2, '0'),
  };

  return format
    .replace('yyyy', d.yyyy)
    .replace('MM', d.MM)
    .replace('dd', d.dd)
    .replace('HH', d.HH)
    .replace('mm', d.mm)
    .replace('ss', d.ss);
}

function getTimezoneOffset(date: Date): string {
  const offset = date.getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

// ─── Request Variable Resolution ────────────────────────────────────────────

/**
 * Resolve a request variable reference like:
 *   {{login.response.body.$.token}}
 *   {{login.response.headers.Location}}
 *   {{login.response.body.*}}
 */
function resolveRequestVariable(
  reqName: string,
  reqOrRes: 'request' | 'response',
  bodyOrHeaders: 'body' | 'headers',
  path: string,
  namedResults: Record<string, NamedRequestResult>,
): string {
  const result = namedResults[reqName];
  if (!result) {
    return `{{${reqName}.${reqOrRes}.${bodyOrHeaders}.${path}}}`;
  }

  const source = result[reqOrRes];

  if (bodyOrHeaders === 'headers') {
    // Case-insensitive header lookup
    const headerName = path.toLowerCase();
    if (reqOrRes === 'response') {
      const entry = Object.entries(source.headers).find(
        ([k]) => k.toLowerCase() === headerName
      );
      return entry ? entry[1] as string : '';
    }
    return '';
  }

  // Body
  const bodyStr = typeof source.body === 'string' ? source.body : '';

  if (path === '*') {
    return bodyStr;
  }

  // JSONPath: $.token, $.data.items[0].id, etc.
  if (path.startsWith('$.')) {
    try {
      const parsed = JSON.parse(bodyStr);
      const jsonPath = path.slice(2); // remove "$."
      const value = getByPath(parsed, jsonPath);
      return value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value)) : '';
    } catch {
      return '';
    }
  }

  // XPath for XML (placeholder — would need an XML parser)
  if (path.startsWith('/')) {
    return `[xpath:${path}]`;
  }

  return '';
}

/** Simple dot-path accessor for JSON: "token", "data.items", etc. */
function getByPath(obj: any, path: string): any {
  const segments = path.split('.');
  let current = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    // Handle array indexing: items[0]
    const arrayMatch = seg.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2], 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[seg];
    }
  }
  return current;
}

// ─── Environment File Handling ──────────────────────────────────────────────

/**
 * Parse an http-client.env.json file contents.
 */
export function parseEnvironmentFile(jsonString: string): EnvironmentFile | null {
  try {
    return JSON.parse(jsonString) as EnvironmentFile;
  } catch {
    return null;
  }
}

/**
 * Get the list of selectable environment names from an env file.
 * Excludes the special "$shared" environment.
 */
export function getEnvironmentNames(envFile: EnvironmentFile | null): string[] {
  if (!envFile) return [];
  return Object.keys(envFile).filter(k => k !== '$shared');
}

/**
 * Resolve variables for a given environment name.
 *
 * Resolution order (highest priority first):
 *   1. .user file env-specific variables
 *   2. env file env-specific variables
 *   3. .user file $shared variables
 *   4. env file $shared variables
 *
 * Note: file-level @variables override ALL of the above,
 * but that's handled in substituteAll(), not here.
 */
export function resolveEnvironmentVariables(
  envName: string,
  envFile: EnvironmentFile | null,
  userEnvFile: EnvironmentFile | null,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  // 4. env file $shared (lowest priority)
  mergeEnvVars(resolved, envFile?.['$shared']);

  // 3. .user file $shared
  mergeEnvVars(resolved, userEnvFile?.['$shared']);

  // 2. env file env-specific
  mergeEnvVars(resolved, envFile?.[envName]);

  // 1. .user file env-specific (highest priority)
  mergeEnvVars(resolved, userEnvFile?.[envName]);

  return resolved;
}

/**
 * Merge environment variables into a target map.
 * Skips provider-based variables (Azure Key Vault, DPAPI, etc.)
 * since those require platform-specific APIs to resolve.
 */
function mergeEnvVars(
  target: Record<string, string>,
  source: EnvironmentVariables | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      target[key] = value;
    } else if (typeof value === 'object' && value !== null && 'provider' in value) {
      // Provider-based variable — mark as placeholder
      // In a full Tauri app, you'd resolve these via the appropriate API.
      target[key] = `[${value.provider}:${(value as any).secretName || key}]`;
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new empty request.
 */
export function createEmptyRequest(name?: string): HttpRequest {
  return {
    id: nextId(),
    name: name || 'New Request',
    varName: null,
    method: 'GET',
    url: 'https://',
    headers: [],
    body: '',
  };
}

// ─── Workspace Tree Builder ─────────────────────────────────────────────────

/**
 * An entry discovered on disk: a file path + its raw content.
 * The path is relative to the workspace root.
 */
export interface DiscoveredFile {
  /** Absolute path */
  absolutePath: string;
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
  /** Raw file contents */
  content: string;
}

/**
 * Create a FileNode from a parsed .http file.
 */
export function createFileNode(absolutePath: string, fileName: string, content: string): FileNode {
  const { requests, variables } = parseHttpFile(content);
  const reqs = requests.length > 0 ? requests : [createEmptyRequest()];
  const savedContent = serializeHttpFile(reqs, variables);
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables,
    dirty: false,
    savedContent,
  };
}

/**
 * Build a workspace tree from a flat list of discovered .http files.
 *
 * Input:  [ { relativePath: "Customers/auth.http", ... }, ... ]
 * Output: FolderNode("Customers") → FileNode("auth.http") → requests
 */
export function buildWorkspaceTree(files: DiscoveredFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Sort files so folder structure is stable
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    const parts = file.relativePath.split('/');
    const fileName = parts.pop()!;

    // Walk/create folder path
    let currentLevel = root;
    let currentPath = '';

    for (const folderName of parts) {
      currentPath += (currentPath ? '/' : '') + folderName;

      let folder = currentLevel.find(
        (n): n is FolderNode => n.type === 'folder' && n.name === folderName
      );

      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: currentPath,
          children: [],
          expanded: false, // Default to collapsed
        };
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }

    // Create file node at the correct level
    const fileNode = createFileNode(file.absolutePath, fileName, file.content);
    currentLevel.push(fileNode);
  }

  return root;
}

/**
 * Collect all FileNodes from a tree (flat list).
 */
export function getAllFileNodes(nodes: TreeNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    if (node.type === 'folder') result.push(...getAllFileNodes(node.children));
  }
  return result;
}

/**
 * Create a new empty .http file node for adding to the tree.
 */
export function createEmptyFileNode(absolutePath: string, fileName: string): FileNode {
  const reqs = [createEmptyRequest('New Request')];
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables: [],
    dirty: true,
    savedContent: '',
  };
}

// ─── Import Helpers ─────────────────────────────────────────────────────────

/**
 * Scan generated .http file content for {{variableName}} references.
 * Returns a deduplicated, sorted list of variables. Known variables
 * (from the source collection) carry their original values; unknown
 * ones get an empty value so the user can fill them in.
 */
export function extractVariableRefs(
  files: { content: string }[],
  knownVars: Variable[],
): Variable[] {
  const knownMap = new Map(knownVars.map(v => [v.key, v.value]));
  const found = new Set<string>();
  const re = /\{\{([^${}][^{}]*?)\}\}/g;

  for (const file of files) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content)) !== null) {
      const name = match[1].trim();
      // Skip dynamic vars and request variable refs (contain dots)
      if (!name.includes('.')) {
        found.add(name);
      }
    }
  }

  return Array.from(found).sort().map(name => ({
    key: name,
    value: knownMap.get(name) ?? '',
  }));
}
