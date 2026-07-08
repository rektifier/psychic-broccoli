// Variable substitution engine: {{variable}} placeholders, dynamic variables
// ($randomInt, $datetime, ...) and request variable references
// ({{name.response.body.$.path}}). Extracted from parser.ts.

import type { Variable, NamedRequestResult } from './types';

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/** Dynamic variable: {{$something ...}} */
export const DYNAMIC_VAR_RE = /\{\{\$(\w+)(?:\s+(.+?))?\}\}/g;

/** Request variable ref: {{reqName.response.body.$.path}} etc.
 *  Name portion allows hyphens to match NAME_DIRECTIVE_RE. */
export const REQUEST_VAR_RE = /\{\{([\w-]+)\.(request|response)\.(body|headers)\.(.+?)\}\}/g;

/** Standard variable ref: {{name}} (but not dynamic or request vars) */
export const SIMPLE_VAR_RE = /\{\{([^${}][^{}]*?)\}\}/g;

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

  // 3. Simple variables: {{name}} - resolved with file vars taking precedence over env vars.
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

      const fileVar = ctx.fileVariables.find((v) => v.key === name);
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
 *   $randomInt [min max]        → random integer (default 0-1000)
 *   $timestamp [offset]         → Unix epoch seconds in UTC
 *   $datetime [format] [offset] → UTC datetime string
 *   $localDatetime [format] [offset] → local datetime string
 *   $processEnv NAME           → OS environment variable (placeholder in browser)
 *   $dotenv NAME               → .env file variable (placeholder)
 */
export function resolveDynamicVariable(funcName: string, args?: string): string {
  switch (funcName) {
    case 'randomInt': {
      let min = 0,
        max = 1000;
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
    case 'ms':
      result.setMilliseconds(result.getMilliseconds() + amount);
      break;
    case 's':
      result.setSeconds(result.getSeconds() + amount);
      break;
    case 'm':
      result.setMinutes(result.getMinutes() + amount);
      break;
    case 'h':
      result.setHours(result.getHours() + amount);
      break;
    case 'd':
      result.setDate(result.getDate() + amount);
      break;
    case 'w':
      result.setDate(result.getDate() + amount * 7);
      break;
    case 'M':
      result.setMonth(result.getMonth() + amount);
      break;
    case 'y':
      result.setFullYear(result.getFullYear() + amount);
      break;
  }

  return result;
}

/** Simple custom date format (dd, MM, yyyy, HH, mm, ss). */
function applyCustomFormat(date: Date, format: string, local: boolean): string {
  const d = local
    ? {
        dd: String(date.getDate()).padStart(2, '0'),
        MM: String(date.getMonth() + 1).padStart(2, '0'),
        yyyy: String(date.getFullYear()),
        HH: String(date.getHours()).padStart(2, '0'),
        mm: String(date.getMinutes()).padStart(2, '0'),
        ss: String(date.getSeconds()).padStart(2, '0'),
      }
    : {
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
export function resolveRequestVariable(
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
      const entry = Object.entries(source.headers).find(([k]) => k.toLowerCase() === headerName);
      return entry ? (entry[1] as string) : '';
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

  // XPath for XML (placeholder - would need an XML parser)
  if (path.startsWith('/')) {
    return `[xpath:${path}]`;
  }

  return '';
}

/** Simple dot-path accessor for JSON: "token", "data.items", etc. */
export function getByPath(obj: any, path: string): any {
  const segments = path.split('.');
  let current = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    // Handle array indexing: items[0]
    const arrayMatch = seg.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      if (isUnsafeKey(arrayMatch[1])) return undefined;
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2], 10)];
      } else {
        return undefined;
      }
    } else {
      if (isUnsafeKey(seg)) return undefined;
      current = current[seg];
    }
  }
  return current;
}

/** Keys that must never be traversed/written: would pollute Object.prototype. */
export function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
