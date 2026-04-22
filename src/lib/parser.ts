import type {
  HttpRequest, HttpMethod, HttpHeader, Variable,
  EnvironmentFile, EnvironmentVariables, ProviderVariable,
  NamedRequestResult, PbDirective, PbAssertionResult,
  HttpResponse,
  TreeNode, FileNode, FolderNode,
  VarSourceLayer, ResolvedVarWithCascade,
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

/** Request variable name: # @name foo  or  // @name foo
 *  Allowed characters: letters, digits, underscore, hyphen (aligns with JetBrains HTTP Client spec). */
const NAME_DIRECTIVE_RE = /^(?:#|\/\/)\s*@name\s+([\w-]+)\s*$/;

/** Pb directive: # @pb.set("key", expr) or # @pb.global("key", expr) or # @pb.assert(expr, "label") */
const PB_DIRECTIVE_RE = /^(?:#|\/\/)\s*@pb\.(\w+)\((.+)\)\s*$/;

/** Pb script section markers: # @pb.beforeSend or # @pb.afterReceive */
const PB_SECTION_RE = /^(?:#|\/\/)\s*@pb\.(beforeSend|afterReceive)\s*$/;

/** Bare pb directive: pb.set(...), pb.global(...), pb.assert(...) */
const BARE_PB_RE = /^pb\.(\w+)\((.+)\)\s*$/;

/** Dynamic variable: {{$something ...}} */
const DYNAMIC_VAR_RE = /\{\{\$(\w+)(?:\s+(.+?))?\}\}/g;

/** Request variable ref: {{reqName.response.body.$.path}} etc.
 *  Name portion allows hyphens to match NAME_DIRECTIVE_RE. */
const REQUEST_VAR_RE = /\{\{([\w-]+)\.(request|response)\.(body|headers)\.(.+?)\}\}/g;

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
  let currentDirectives: PbDirective[] = [];
  let currentBeforeSend: string[] = [];
  let currentAfterReceive: string[] = [];
  let currentScriptSection: 'beforeSend' | 'afterReceive' | null = null;
  let inBody = false;
  let hasRequest = false;

  function flushRequest() {
    if (currentMethod && currentUrl) {
      const req: HttpRequest = {
        id: nextId(),
        name: currentName || `${currentMethod} ${currentUrl}`,
        varName: currentVarName,
        method: currentMethod,
        url: currentUrl,
        headers: currentHeaders,
        body: currentBody.join('\n').trim(),
        directives: currentDirectives,
      };
      const bs = currentBeforeSend.join('\n').trim();
      const ar = currentAfterReceive.join('\n').trim();
      if (bs) req.beforeSend = bs;
      if (ar) req.afterReceive = ar;
      requests.push(req);
    }
    currentName = '';
    currentVarName = null;
    currentMethod = null;
    currentUrl = '';
    currentHeaders = [];
    currentBody = [];
    currentDirectives = [];
    currentBeforeSend = [];
    currentAfterReceive = [];
    currentScriptSection = null;
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

    // ── Pb script section markers: # @pb.beforeSend, # @pb.afterReceive ──
    const sectionMatch = line.match(PB_SECTION_RE);
    if (sectionMatch) {
      currentScriptSection = sectionMatch[1] as 'beforeSend' | 'afterReceive';
      continue;
    }

    // ── Pb directives: # @pb.set(...), # @pb.assert(...), # @pb.global(...) ──
    const pbMatch = line.match(PB_DIRECTIVE_RE);
    if (pbMatch) {
      if (currentScriptSection) {
        // Convert comment-prefixed back to bare form for the textarea
        const bare = `pb.${pbMatch[1]}(${pbMatch[2]})`;
        if (currentScriptSection === 'beforeSend') {
          currentBeforeSend.push(bare);
        } else {
          currentAfterReceive.push(bare);
        }
      } else {
        const directive = parsePbDirective(pbMatch[1], pbMatch[2]);
        if (directive) currentDirectives.push(directive);
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

    // Pb directives
    if (req.directives && req.directives.length > 0) {
      parts.push('');
      for (const d of req.directives) {
        switch (d.type) {
          case 'set':
            parts.push(`# @pb.set("${d.key}", ${d.expr})`);
            break;
          case 'global':
            parts.push(`# @pb.global("${d.key}", ${d.expr})`);
            break;
          case 'assert':
            parts.push(`# @pb.assert(${d.expr}, "${d.label}")`);
            break;
        }
      }
    }

    // Before-send scripts
    if (req.beforeSend?.trim()) {
      if (!req.directives || req.directives.length === 0) parts.push('');
      parts.push('# @pb.beforeSend');
      for (const line of req.beforeSend.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Wrap bare pb.* lines in comment-directive syntax
        if (trimmed.match(BARE_PB_RE)) {
          parts.push(`# @${trimmed}`);
        } else {
          parts.push(trimmed);
        }
      }
    }

    // After-receive scripts
    if (req.afterReceive?.trim()) {
      if ((!req.directives || req.directives.length === 0) && !req.beforeSend?.trim()) parts.push('');
      parts.push('# @pb.afterReceive');
      for (const line of req.afterReceive.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.match(BARE_PB_RE)) {
          parts.push(`# @${trimmed}`);
        } else {
          parts.push(trimmed);
        }
      }
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
      // the lookup falls through to environment variables.
      // Also skip empty file vars when an env variable exists, so that
      // placeholder declarations like @id = don't shadow environment values.
      if (fileVar && fileVar.value !== `{{${name}}}`) {
        if (fileVar.value === '' && name in ctx.environmentVariables) {
          // Fall through to environment variable
        } else {
          return fileVar.value;
        }
      }

      if (name in ctx.environmentVariables) {
        return ctx.environmentVariables[name];
      }

      return `{{${name}}}`;
    });
    if (result === previous) break;
  }

  // 4. Second pass: resolve any dynamic / request variables introduced by
  //    simple variable expansion (e.g. @testUserId = {{$randomInt 1 10}})
  result = result.replace(DYNAMIC_VAR_RE, (_match, funcName: string, args: string | undefined) => {
    return resolveDynamicVariable(funcName, args?.trim());
  });
  result = result.replace(REQUEST_VAR_RE, (_match, reqName, reqOrRes, bodyOrHeaders, path) => {
    return resolveRequestVariable(reqName, reqOrRes, bodyOrHeaders, path, ctx.namedResults);
  });

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

// ─── Pb Directive Parsing ────────────────────────────────────────────────────

/**
 * Parse a raw directive call like `set("key", pb.response.body.$.token)` into
 * a typed PbDirective. Returns null if the syntax is unrecognized.
 */
function parsePbDirective(action: string, argsRaw: string): PbDirective | null {
  const args = argsRaw.trim();

  if (action === 'set' || action === 'global') {
    // Quoted key: pb.set("key", expr)
    const m = args.match(/^(["'])(.+?)\1\s*,\s*(.+)$/);
    if (m) return { type: action, key: m[2], expr: m[3].trim() };
    // Unquoted key: pb.set(pb.request.body.$.country, "NO")
    const u = args.match(/^([\w.$\-]+)\s*,\s*(.+)$/);
    if (u) {
      let key = u[1];
      // Normalize: strip leading "pb." so pb.request.* becomes request.*
      if (key.startsWith('pb.')) key = key.substring(3);
      return { type: action, key, expr: u[2].trim() };
    }
    return null;
  }

  if (action === 'assert') {
    // pb.assert(expr, "label")
    // Find the last quoted string as the label
    const labelMatch = args.match(/,\s*(["'])(.+?)\1\s*$/);
    if (!labelMatch) return null;
    const expr = args.slice(0, args.lastIndexOf(labelMatch[0])).trim();
    return { type: 'assert', expr, label: labelMatch[2] };
  }

  return null;
}

// ─── Pb Expression Evaluator ────────────────────────────────────────────────

interface PbEvalContext {
  response: HttpResponse;
  request: { url: string; method: string; headers: Record<string, string>; body: string };
  variables: Record<string, string>;
  namedResults: Record<string, NamedRequestResult>;
}

/**
 * Evaluate a pb expression like:
 *   pb.response.status
 *   pb.response.body.$.token
 *   pb.response.headers.Content-Type
 *   "some string"
 *   123
 *   null
 *   pb.response.status == 200
 *   pb.response.body.$.name != null
 *   pb.response.body.$.items.length > 0
 */
export function evaluatePbExpression(expr: string, ctx: PbEvalContext): unknown {
  // Resolve {{variable}} references inline before evaluation
  let trimmed = expr.trim();
  // Dynamic variables: {{$randomInt}}, {{$datetime}}, {{$timestamp}}, etc.
  trimmed = trimmed.replace(DYNAMIC_VAR_RE, (_match, funcName: string, args: string | undefined) => {
    return resolveDynamicVariable(funcName, args?.trim());
  });
  // Named request refs: {{name.response.body.$.path}}, {{name.response.headers.X}}
  trimmed = trimmed.replace(REQUEST_VAR_RE, (_match, reqName, reqOrRes, bodyOrHeaders, path) => {
    return resolveRequestVariable(reqName, reqOrRes, bodyOrHeaders, path, ctx.namedResults);
  });
  // Simple variables: {{varName}}
  trimmed = trimmed.replace(SIMPLE_VAR_RE, (_, name) => {
    return ctx.variables[name] ?? `{{${name}}}`;
  });

  // ── Comparison operators ──
  const compOps = ['==', '!=', '>=', '<=', '>', '<', ' contains ', ' startsWith ', ' endsWith '] as const;
  for (const op of compOps) {
    const idx = trimmed.indexOf(op);
    if (idx !== -1) {
      const left = evaluatePbExpression(trimmed.slice(0, idx), ctx);
      const right = evaluatePbExpression(trimmed.slice(idx + op.length), ctx);
      const leftStr = String(left);
      const rightStr = String(right);
      switch (op.trim()) {
        case '==': return left == right || leftStr === rightStr;
        case '!=': return left != right && leftStr !== rightStr;
        case '>':  return Number(left) > Number(right);
        case '<':  return Number(left) < Number(right);
        case '>=': return Number(left) >= Number(right);
        case '<=': return Number(left) <= Number(right);
        case 'contains': return leftStr.includes(rightStr);
        case 'startsWith': return leftStr.startsWith(rightStr);
        case 'endsWith': return leftStr.endsWith(rightStr);
      }
    }
  }

  // ── Logical operators (&&, ||) ──
  const andIdx = trimmed.indexOf('&&');
  if (andIdx !== -1) {
    return evaluatePbExpression(trimmed.slice(0, andIdx), ctx) &&
           evaluatePbExpression(trimmed.slice(andIdx + 2), ctx);
  }
  const orIdx = trimmed.indexOf('||');
  if (orIdx !== -1) {
    return evaluatePbExpression(trimmed.slice(0, orIdx), ctx) ||
           evaluatePbExpression(trimmed.slice(orIdx + 2), ctx);
  }

  // ── Negation ──
  if (trimmed.startsWith('!')) {
    return !evaluatePbExpression(trimmed.slice(1), ctx);
  }

  // ── Literals ──
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // ── pb.response.* access ──
  if (trimmed.startsWith('pb.response.')) {
    const path = trimmed.slice('pb.response.'.length);
    return resolvePbResponsePath(path, ctx.response);
  }

  // ── pb.request.* access ──
  if (trimmed.startsWith('pb.request.')) {
    const path = trimmed.slice('pb.request.'.length);
    if (path === 'url') return ctx.request.url;
    if (path === 'method') return ctx.request.method;
    if (path === 'body') return ctx.request.body;
    if (path.startsWith('headers.')) {
      const hdrName = path.slice('headers.'.length);
      const entry = Object.entries(ctx.request.headers).find(
        ([k]) => k.toLowerCase() === hdrName.toLowerCase()
      );
      return entry ? entry[1] : null;
    }
    return null;
  }

  // ── Variable reference: {{varName}} ──
  const varMatch = trimmed.match(/^\{\{(.+?)\}\}$/);
  if (varMatch) {
    return ctx.variables[varMatch[1]] ?? null;
  }

  // ── Fallback: treat as unresolved ──
  return trimmed;
}

/** Resolve a path like "status", "body.$.token", "headers.Content-Type" against an HttpResponse. */
function resolvePbResponsePath(path: string, response: HttpResponse): unknown {
  if (path === 'status') return response.status;
  if (path === 'statusText') return response.statusText;
  if (path === 'body') return response.body;
  if (path === 'time') return response.time;
  if (path === 'size') return response.size;

  if (path.startsWith('headers.')) {
    const hdrName = path.slice('headers.'.length).toLowerCase();
    const entry = Object.entries(response.headers).find(
      ([k]) => k.toLowerCase() === hdrName
    );
    return entry ? entry[1] : null;
  }

  if (path.startsWith('body.$.')) {
    const jsonPath = path.slice('body.$.'.length);
    try {
      const parsed = JSON.parse(response.body);
      return getByPath(parsed, jsonPath) ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Pb Script Text Parser ─────────────────────────────────────────────────

/**
 * Parse a beforeSend / afterReceive script textarea into PbDirective[].
 * Accepts both comment-prefixed (`# @pb.set(...)`) and bare (`pb.set(...)`) syntax.
 */
export function parseScriptText(text: string): PbDirective[] {
  if (!text) return [];
  const directives: PbDirective[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip pure comments that aren't directives
    if ((trimmed.startsWith('#') || trimmed.startsWith('//')) && !trimmed.match(PB_DIRECTIVE_RE)) continue;
    // Try comment-prefixed syntax first: # @pb.set(...) or // @pb.set(...)
    const cm = trimmed.match(PB_DIRECTIVE_RE);
    if (cm) {
      const d = parsePbDirective(cm[1], cm[2]);
      if (d) directives.push(d);
      continue;
    }
    // Try bare syntax: pb.set(...)
    const bm = trimmed.match(BARE_PB_RE);
    if (bm) {
      const d = parsePbDirective(bm[1], bm[2]);
      if (d) directives.push(d);
    }
  }
  return directives;
}

// ─── Pb Directive Executor ──────────────────────────────────────────────────

export interface RequestMutations {
  url?: string;
  headers: Record<string, string>;
  bodyPatches: { path: string; value: unknown }[];
  bodyFull?: string;
}

export interface PbExecutionResult {
  assertionResults: PbAssertionResult[];
  setVars: Record<string, string>;
  globalVars: Record<string, string>;
  requestMutations: RequestMutations;
}

/**
 * Execute all pb directives for a request after its response has been received.
 */
export function executePbDirectives(
  directives: PbDirective[],
  response: HttpResponse,
  request: { url: string; method: string; headers: Record<string, string>; body: string },
  variables: Record<string, string>,
  namedResults: Record<string, NamedRequestResult> = {},
): PbExecutionResult {
  const ctx: PbEvalContext = { response, request, variables, namedResults };
  const result: PbExecutionResult = {
    assertionResults: [], setVars: {}, globalVars: {},
    requestMutations: { headers: {}, bodyPatches: [] },
  };

  for (const d of directives) {
    switch (d.type) {
      case 'set': {
        const value = evaluatePbExpression(d.expr, ctx);
        const strValue = value == null ? '' : String(value);

        // Check for request.* mutation keys
        if (d.key === 'request.url') {
          result.requestMutations.url = strValue;
        } else if (d.key.startsWith('request.header.')) {
          const headerName = d.key.substring('request.header.'.length);
          result.requestMutations.headers[headerName] = strValue;
        } else if (d.key === 'request.body') {
          result.requestMutations.bodyFull = strValue;
        } else if (d.key.startsWith('request.body.$.')) {
          const path = d.key.substring('request.body.$.'.length);
          result.requestMutations.bodyPatches.push({ path, value });
        } else {
          // Regular file-level variable
          result.setVars[d.key] = strValue;
        }

        // Make immediately available to subsequent directives
        ctx.variables[d.key] = strValue;
        break;
      }
      case 'global': {
        const value = evaluatePbExpression(d.expr, ctx);
        const strValue = value == null ? '' : String(value);
        result.globalVars[d.key] = strValue;
        ctx.variables[d.key] = strValue;
        break;
      }
      case 'assert': {
        const value = evaluatePbExpression(d.expr, ctx);
        let label = d.label;
        // Resolve {{pb.response.*}} and {{pb.request.*}} in labels
        label = label.replace(/\{\{(pb\.(?:response|request)\..+?)\}\}/g, (_, expr) => {
          const resolved = evaluatePbExpression(expr, ctx);
          return resolved == null ? '' : String(resolved);
        });
        label = label.replace(DYNAMIC_VAR_RE, (_match, funcName: string, args: string | undefined) => {
          return resolveDynamicVariable(funcName, args?.trim());
        });
        label = label.replace(REQUEST_VAR_RE, (_match, reqName, reqOrRes, bodyOrHeaders, path) => {
          return resolveRequestVariable(reqName, reqOrRes, bodyOrHeaders, path, ctx.namedResults);
        });
        label = label.replace(SIMPLE_VAR_RE, (_, name) => ctx.variables[name] ?? `{{${name}}}`);
        result.assertionResults.push({ label, passed: !!value });
        break;
      }
    }
  }

  return result;
}

/**
 * Apply request mutations from beforeSend pb.set("request.*") directives
 * to the outgoing request properties.
 */
export function applyRequestMutations(
  req: { url: string; method: string; headers: Record<string, string>; body: string },
  mutations: RequestMutations,
): { url: string; method: string; headers: Record<string, string>; body: string } {
  let { url, method, headers, body } = req;

  // URL override
  if (mutations.url !== undefined) {
    url = mutations.url;
  }

  // Header overrides (case-insensitive merge)
  if (Object.keys(mutations.headers).length > 0) {
    headers = { ...headers };
    for (const [name, value] of Object.entries(mutations.headers)) {
      const existingKey = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
      if (existingKey) delete headers[existingKey];
      headers[name] = value;
    }
  }

  // Full body replacement
  if (mutations.bodyFull !== undefined) {
    body = mutations.bodyFull;
  }

  // JSON body patches (applied after full replacement if both exist)
  if (mutations.bodyPatches.length > 0) {
    try {
      let parsed = body ? JSON.parse(body) : {};
      for (const patch of mutations.bodyPatches) {
        setByPath(parsed, patch.path, patch.value);
      }
      body = JSON.stringify(parsed, null, 2);
    } catch {
      // Body isn't valid JSON - skip patches
    }
  }

  return { url, method, headers, body };
}

/**
 * Set a value in a nested object by dot-path (e.g. "data.user.name").
 * Creates intermediate objects as needed.
 */
function setByPath(obj: any, path: string, value: unknown): void {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current[seg] === undefined || current[seg] === null) {
      current[seg] = /^\d+$/.test(segments[i + 1]) ? [] : {};
    }
    current = current[seg];
  }
  current[segments[segments.length - 1]] = value;
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
 * Ensure `$shared` exists on an env file as a baseline for the variable resolution cascade.
 * Mutates and returns the passed object. No-op when `$shared` already exists.
 */
export function ensureSharedEnvironment(envFile: EnvironmentFile): EnvironmentFile {
  if (!envFile['$shared']) {
    envFile['$shared'] = {};
  }
  return envFile;
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
    if (key === '$keyvault') continue;
    if (typeof value === 'string') {
      target[key] = value;
    } else if (typeof value === 'object' && value !== null && 'provider' in value) {
      // Provider-based variable — mark as placeholder
      // In a full Tauri app, you'd resolve these via the appropriate API.
      target[key] = `[${value.provider}:${(value as any).secretName || key}]`;
    }
  }
}

/**
 * Like resolveEnvironmentVariables but tracks the source layer and full cascade
 * for each variable. Used by display components to show where values come from.
 */
export function resolveEnvironmentVariablesWithSource(
  envName: string,
  envFile: EnvironmentFile | null,
  userEnvFile: EnvironmentFile | null,
): Record<string, ResolvedVarWithCascade> {
  const result: Record<string, ResolvedVarWithCascade> = {};

  const layers: Array<{ source: VarSourceLayer; vars: EnvironmentVariables | undefined }> = [
    { source: 'shared', vars: envFile?.['$shared'] },
    { source: 'user-shared', vars: userEnvFile?.['$shared'] },
    { source: 'env', vars: envFile?.[envName] },
    { source: 'user-env', vars: userEnvFile?.[envName] },
  ];

  for (const { source, vars } of layers) {
    if (!vars) continue;
    for (const [key, raw] of Object.entries(vars)) {
      if (key === '$keyvault') continue;
      let value: string;
      if (typeof raw === 'string') {
        value = raw;
      } else if (typeof raw === 'object' && raw !== null && 'provider' in raw) {
        value = `[${raw.provider}:${(raw as any).secretName || key}]`;
      } else {
        continue;
      }

      const entry = { source, value };
      if (result[key]) {
        result[key].cascade.push(entry);
        result[key].value = value;
        result[key].source = source;
      } else {
        result[key] = { value, source, cascade: [entry] };
      }
    }
  }

  return result;
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
    directives: [],
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
