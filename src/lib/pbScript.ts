// Pb script engine: parse, evaluate and execute # @pb.* comment directives
// (pb.assert / pb.set / pb.global) and beforeSend / afterReceive script
// sections. Extracted from parser.ts.

import type { PbDirective, PbAssertionResult, HttpResponse, NamedRequestResult } from './types';
import {
  DYNAMIC_VAR_RE,
  REQUEST_VAR_RE,
  SIMPLE_VAR_RE,
  resolveDynamicVariable,
  resolveRequestVariable,
  getByPath,
  isUnsafeKey,
} from './substitution';

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/** Pb directive: # @pb.set("key", expr) or # @pb.global("key", expr) or # @pb.assert(expr, "label") */
export const PB_DIRECTIVE_RE = /^(?:#|\/\/)\s*@pb\.(\w+)\((.+)\)\s*$/;

/** Pb script section markers: # @pb.beforeSend or # @pb.afterReceive */
export const PB_SECTION_RE = /^(?:#|\/\/)\s*@pb\.(beforeSend|afterReceive)\s*$/;

/** Bare pb directive: pb.set(...), pb.global(...), pb.assert(...) */
export const BARE_PB_RE = /^pb\.(\w+)\((.+)\)\s*$/;

// ─── Pb Directive Parsing ────────────────────────────────────────────────────

/**
 * Parse a raw directive call like `set("key", pb.response.body.$.token)` into
 * a typed PbDirective. Returns null if the syntax is unrecognized.
 */
export function parsePbDirective(action: string, argsRaw: string): PbDirective | null {
  const args = argsRaw.trim();

  if (action === 'set' || action === 'global') {
    // Quoted key: pb.set("key", expr)
    const m = args.match(/^(["'])(.+?)\1\s*,\s*(.+)$/);
    if (m) return { type: action, key: m[2], expr: m[3].trim() };
    // Unquoted key: pb.set(pb.request.body.$.country, "NO")
    const u = args.match(/^([\w.$-]+)\s*,\s*(.+)$/);
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
/**
 * Find the first index of `op` in `str` that lies outside of any single- or
 * double-quoted string literal. Returns -1 if `op` only appears inside quotes
 * (or not at all). Used so logical/comparison operators inside string literals
 * (e.g. `body.$.msg == "a==b"`) are not mistaken for real operators.
 */
function indexOfOutsideQuotes(str: string, op: string): number {
  let quote: string | null = null;
  for (let i = 0; i <= str.length - op.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (str.startsWith(op, i)) return i;
  }
  return -1;
}

export function evaluatePbExpression(expr: string, ctx: PbEvalContext): unknown {
  // Resolve {{variable}} references inline before evaluation
  let trimmed = expr.trim();
  // Dynamic variables: {{$randomInt}}, {{$datetime}}, {{$timestamp}}, etc.
  trimmed = trimmed.replace(
    DYNAMIC_VAR_RE,
    (_match, funcName: string, args: string | undefined) => {
      return resolveDynamicVariable(funcName, args?.trim());
    },
  );
  // Named request refs: {{name.response.body.$.path}}, {{name.response.headers.X}}
  trimmed = trimmed.replace(REQUEST_VAR_RE, (_match, reqName, reqOrRes, bodyOrHeaders, path) => {
    return resolveRequestVariable(reqName, reqOrRes, bodyOrHeaders, path, ctx.namedResults);
  });
  // Simple variables: {{varName}}
  trimmed = trimmed.replace(SIMPLE_VAR_RE, (_, name) => {
    return ctx.variables[name] ?? `{{${name}}}`;
  });

  // ── Logical operators (||, &&) ──
  // Split logical operators before comparisons so that precedence is correct:
  // `||` binds loosest (split first), then `&&`, then comparison operators.
  // Operator scanning is quote-aware so operators inside string literals are ignored.
  const orIdx = indexOfOutsideQuotes(trimmed, '||');
  if (orIdx !== -1) {
    return (
      evaluatePbExpression(trimmed.slice(0, orIdx), ctx) ||
      evaluatePbExpression(trimmed.slice(orIdx + 2), ctx)
    );
  }
  const andIdx = indexOfOutsideQuotes(trimmed, '&&');
  if (andIdx !== -1) {
    return (
      evaluatePbExpression(trimmed.slice(0, andIdx), ctx) &&
      evaluatePbExpression(trimmed.slice(andIdx + 2), ctx)
    );
  }

  // ── Comparison operators ──
  const compOps = [
    '==',
    '!=',
    '>=',
    '<=',
    '>',
    '<',
    ' contains ',
    ' startsWith ',
    ' endsWith ',
  ] as const;
  for (const op of compOps) {
    const idx = indexOfOutsideQuotes(trimmed, op);
    if (idx !== -1) {
      const left = evaluatePbExpression(trimmed.slice(0, idx), ctx);
      const right = evaluatePbExpression(trimmed.slice(idx + op.length), ctx);
      const leftStr = String(left);
      const rightStr = String(right);
      switch (op.trim()) {
        case '==':
          return left == right || leftStr === rightStr;
        case '!=':
          return left != right && leftStr !== rightStr;
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
        case 'contains':
          return leftStr.includes(rightStr);
        case 'startsWith':
          return leftStr.startsWith(rightStr);
        case 'endsWith':
          return leftStr.endsWith(rightStr);
      }
    }
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
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
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
        ([k]) => k.toLowerCase() === hdrName.toLowerCase(),
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
    const entry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === hdrName);
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
    if ((trimmed.startsWith('#') || trimmed.startsWith('//')) && !trimmed.match(PB_DIRECTIVE_RE))
      continue;
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

/**
 * Serialize directives into the one-per-line editor text format used by the
 * flow step override panel: `expr | label` for asserts, `pb.set(...)` /
 * `pb.global(...)` calls for the rest. Inverse of the panel's line parser.
 */
export function directivesToText(directives: PbDirective[]): string {
  return directives
    .map((d) => {
      if (d.type === 'assert') return d.label ? `${d.expr} | ${d.label}` : d.expr;
      if (d.type === 'set') return `pb.set("${d.key}", ${d.expr})`;
      if (d.type === 'global') return `pb.global("${d.key}", ${d.expr})`;
      return '';
    })
    .join('\n');
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
    assertionResults: [],
    setVars: {},
    globalVars: {},
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
        label = label.replace(
          DYNAMIC_VAR_RE,
          (_match, funcName: string, args: string | undefined) => {
            return resolveDynamicVariable(funcName, args?.trim());
          },
        );
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
      const existingKey = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
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
      const parsed = body ? JSON.parse(body) : {};
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
  // Reject prototype-polluting segments: a malicious .http directive could
  // target __proto__/constructor/prototype to write onto Object.prototype.
  if (segments.some(isUnsafeKey)) return;
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
