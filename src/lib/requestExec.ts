import { invoke } from '@tauri-apps/api/core';
import {
  substituteAll,
  executePbDirectives,
  parseScriptText,
  applyRequestMutations,
} from './parser';
import type { SubstitutionContext } from './parser';
import type { HttpRequest, HttpResponse, PbAssertionResult, NamedRequestResult } from './types';

// ─── Shared request execution pipeline ───────────────────────────────────────
// Single implementation of the substitute -> beforeSend -> http_request ->
// afterReceive sequence used by the manual send (App.svelte), the MCP bridge's
// silent execution (App.svelte), and the flow runner (flowRunner.ts). The
// executor is pure with respect to stores: every side effect (variables set by
// pb directives, the named result for chaining) is returned to the caller,
// which decides how to commit it.

/** The fully-resolved request that was actually sent over the wire. */
export interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Raw payload returned by the Rust `http_request` command. */
export interface HttpInvokeResult {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  /** "utf8" for text bodies; "base64" when the raw bytes were not valid UTF-8. */
  body_encoding?: 'utf8' | 'base64';
  /** Byte length of the raw response body. */
  size?: number;
}

/** Variables produced by pb directives during one phase of execution. */
export interface PbVarEffects {
  /** File-scoped variables from `pb.set` (flow-local overrides in a flow run). */
  setVars: Record<string, string>;
  /** Workspace-global variables from `pb.global`. */
  globalVars: Record<string, string>;
}

export interface ExecutedRequest {
  sentRequest: SentRequest;
  response: HttpResponse;
  assertionResults: PbAssertionResult[];
  /** Variables set by beforeSend scripts. */
  beforeSend: PbVarEffects;
  /** Variables set by request directives and afterReceive scripts. */
  afterReceive: PbVarEffects;
  /** Named result for request chaining when an alias was provided. */
  namedResult: { name: string; result: NamedRequestResult } | null;
}

export interface ExecuteOptions {
  /** Alias under which the result is exposed for chaining. Flow steps pass the
   *  step alias; the manual send passes the request's `# @name`. The alias entry
   *  is visible to this request's own directives but committing it to shared
   *  state is the caller's job (via `namedResult`). */
  alias?: string | null;
  /** Called with the fully-resolved request and beforeSend variable effects just
   *  before the network call, so callers can surface or commit them early. */
  onBeforeInvoke?(sent: SentRequest, beforeSend: PbVarEffects): void;
}

/** Methods that must not carry a request body. */
const BODYLESS_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function mergeVars(
  ctx: SubstitutionContext,
  ...overrides: Record<string, string>[]
): Record<string, string> {
  const merged: Record<string, string> = Object.assign(
    { ...ctx.environmentVariables },
    ...overrides,
  );
  for (const v of ctx.fileVariables) merged[v.key] = v.value;
  return merged;
}

/**
 * Execute a single HTTP request end to end: variable substitution, beforeSend
 * scripts (with request mutations), the actual network call via the Rust
 * proxy, and pb directives + afterReceive scripts against the response.
 *
 * Only directives with `enabled !== false` run - a directive the user toggled
 * off in the UI never executes, in any execution path.
 *
 * Throws on network-level failure (the `http_request` invoke rejecting);
 * callers translate that into their own error shape.
 */
export async function executeHttpRequest(
  request: HttpRequest,
  ctx: SubstitutionContext,
  options: ExecuteOptions = {},
): Promise<ExecutedRequest> {
  const startTime = performance.now();

  let url = substituteAll(request.url, ctx);
  let body = substituteAll(request.body, ctx);
  let headers: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled) {
      headers[substituteAll(h.key, ctx)] = substituteAll(h.value, ctx);
    }
  }

  // Directives can chain against existing named results; the alias entry for
  // this request is added after the response arrives. Work on a copy so the
  // caller's map is never mutated.
  const namedResults: Record<string, NamedRequestResult> = { ...ctx.namedResults };

  // ── beforeSend scripts ──
  const beforeSend: PbVarEffects = { setVars: {}, globalVars: {} };
  const beforeSendDirectives = parseScriptText(request.beforeSend ?? '');
  if (beforeSendDirectives.length > 0) {
    const dummyResponse: HttpResponse = {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      time: 0,
      size: 0,
    };
    const bsResult = executePbDirectives(
      beforeSendDirectives,
      dummyResponse,
      { url, method: request.method, headers, body },
      mergeVars(ctx),
      namedResults,
    );

    const mutated = applyRequestMutations(
      { url, method: request.method, headers, body },
      bsResult.requestMutations,
    );
    url = mutated.url;
    headers = mutated.headers;
    body = mutated.body;

    Object.assign(beforeSend.setVars, bsResult.setVars);
    Object.assign(beforeSend.globalVars, bsResult.globalVars);
  }

  const sentRequest: SentRequest = { method: request.method, url, headers, body };
  options.onBeforeInvoke?.(sentRequest, beforeSend);

  const res: HttpInvokeResult = await invoke('http_request', {
    payload: {
      method: request.method,
      url,
      headers,
      body: BODYLESS_METHODS.includes(request.method) ? null : body || null,
    },
  });

  const elapsed = performance.now() - startTime;
  const response: HttpResponse = {
    status: res.status,
    statusText: res.status_text,
    headers: res.headers,
    body: res.body,
    bodyEncoding: res.body_encoding ?? 'utf8',
    time: Math.round(elapsed),
    size: res.size ?? new TextEncoder().encode(res.body).length,
  };

  // Store the alias entry before running directives so a request's own
  // directives can reference its response by name.
  let namedResult: ExecutedRequest['namedResult'] = null;
  if (options.alias) {
    namedResult = { name: options.alias, result: { request: sentRequest, response } };
    namedResults[options.alias] = namedResult.result;
  }

  // ── pb directives + afterReceive scripts ──
  const afterReceive: PbVarEffects = { setVars: {}, globalVars: {} };
  let assertionResults: PbAssertionResult[] = [];
  const allDirectives = [
    ...(request.directives || []).filter((d) => d.enabled !== false),
    ...parseScriptText(request.afterReceive ?? ''),
  ];
  if (allDirectives.length > 0) {
    const pbResult = executePbDirectives(
      allDirectives,
      response,
      sentRequest,
      mergeVars(ctx, beforeSend.setVars, beforeSend.globalVars),
      namedResults,
    );
    assertionResults = pbResult.assertionResults;
    Object.assign(afterReceive.setVars, pbResult.setVars);
    Object.assign(afterReceive.globalVars, pbResult.globalVars);
  }

  return { sentRequest, response, assertionResults, beforeSend, afterReceive, namedResult };
}
