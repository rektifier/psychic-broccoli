// ─── MCP Bridge ──────────────────────────────────────────────────────────────
// The embedded MCP server (Rust) reaches live app state through Tauri events:
// it emits `mcp:request` with { id, kind, params }; we do the work for `kind`
// and emit `mcp:response` with { id, ok, data?, error? }, matched by `id`.
// New MCP tools that need frontend state add a `kind` branch here.
//
// Everything in this module is store-driven via `get()` and UI-free: silent
// executions must never touch UI stores (`currentResponse`, `currentSentRequest`,
// `pbAssertionResults`, tabs, `namedResults`, `pbGlobals`, `pbFileOverrides`,
// `flowRunState`, `flowRunHistory`).

import { get } from 'svelte/store';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import {
  workspace,
  activeEnvironment,
  resolvedEnvVars,
  envFile,
  userEnvFile,
  pbGlobals,
  pbFileOverrides,
  namedResults,
  dotenvVariables,
  currentResponse,
  pbAssertionResults,
} from './stores';
import { resolveEnvironmentVariables } from './envFiles';
import type { SubstitutionContext } from './substitution';
import { getAllFileNodes } from './tree';
import { executeHttpRequest } from './requestExec';
import { runFlow } from './flowRunner';
import { parseFlowFile } from './flowIO';

export interface BridgeRequest {
  id: string;
  kind: string;
  params: unknown;
}

function respondBridge(
  id: string,
  payload: { ok: true; data: unknown } | { ok: false; error: string },
) {
  emit('mcp:response', { id, ...payload }).catch(() => {});
}

/** Gather every request across all .http files in the open workspace. */
export function collectWorkspaceRequests() {
  const ws = get(workspace);
  if (!ws.rootPath) return [];
  return getAllFileNodes(ws.tree).flatMap((file) => {
    const filePath = file.path.substring(ws.rootPath!.length + 1).replaceAll('\\', '/');
    return file.requests.map((req, requestIndex) => ({
      filePath,
      requestIndex,
      name: req.name,
      method: req.method,
      url: req.url,
    }));
  });
}

export interface ExecuteRequestParams {
  filePath: string;
  requestIndex: number;
  environment?: string | null;
}

/**
 * Run a single request for the MCP `execute_request` tool and return the
 * structured result. This is the silent twin of `sendRequest`: it must never
 * touch UI stores (`currentResponse`, `currentSentRequest`, `pbAssertionResults`,
 * tabs, `namedResults`, `pbGlobals`, `pbFileOverrides`). All runtime state from
 * pb directives is kept in locals and discarded after the call.
 */
export async function executeRequestSilently(params: ExecuteRequestParams) {
  const ws = get(workspace);
  if (!ws.rootPath) throw new Error('No workspace folder is open');

  const normalized = params.filePath.replaceAll('\\', '/');
  const file = getAllFileNodes(ws.tree).find(
    (f) => f.path.substring(ws.rootPath!.length + 1).replaceAll('\\', '/') === normalized,
  );
  if (!file) throw new Error(`File not found in workspace: ${params.filePath}`);

  const request = file.requests[params.requestIndex];
  if (!request) {
    throw new Error(`No request at index ${params.requestIndex} in ${params.filePath}`);
  }

  // Resolve environment variables for the requested environment, falling back to
  // the active one. For the active environment, reuse the fully-resolved store so
  // Key Vault secrets, globals, and pb.set overrides are included exactly as the
  // UI sees them; for any other environment, resolve it fresh from the env files.
  const active = get(activeEnvironment);
  const effectiveEnv = params.environment ?? active;
  let environmentVariables: Record<string, string>;
  if (effectiveEnv && effectiveEnv === active) {
    environmentVariables = { ...get(resolvedEnvVars) };
  } else if (effectiveEnv) {
    environmentVariables = {
      ...resolveEnvironmentVariables(effectiveEnv, get(envFile), get(userEnvFile)),
      ...get(pbGlobals),
      ...(get(pbFileOverrides)[file.path] ?? {}),
    };
  } else {
    environmentVariables = { ...get(pbGlobals) };
  }

  const ctx: SubstitutionContext = {
    fileVariables: file.variables,
    environmentVariables,
    // Read-only copy: chaining can resolve existing named results, but the
    // silent run must not mutate the shared store.
    namedResults: { ...get(namedResults) },
    dotenvVariables: get(dotenvVariables),
  };

  // All pb effects (set/global vars, named result) stay in the returned
  // locals and are discarded - a silent run never reaches the stores.
  const result = await executeHttpRequest(request, ctx, { alias: request.varName });

  return {
    status: result.response.status,
    statusText: result.response.statusText,
    headers: result.response.headers,
    body: result.response.body,
    time: result.response.time,
    assertions: result.assertionResults.map((a) => ({ label: a.label, passed: a.passed })),
  };
}

export interface ExecuteFlowParams {
  flowFilePath: string;
  environment?: string | null;
}

/**
 * Run a whole flow for the MCP `execute_flow` tool and return the structured
 * run record. This is the silent twin of `handleRunFlow`: it loads and runs the
 * flow but must never touch UI stores (`flowRunState`, `flowRunHistory`,
 * `lastFlowRunRecords`, tabs) and must not persist a results file. `runFlow`
 * keeps all run state in isolated locals, which are discarded after mapping.
 */
export async function executeFlowSilently(params: ExecuteFlowParams) {
  const ws = get(workspace);
  if (!ws.rootPath) throw new Error('No workspace folder is open');

  const relPath = params.flowFilePath.replaceAll('\\', '/');
  if (!relPath.endsWith('.pb-flow.json')) {
    throw new Error(`Not a flow file (expected .pb-flow.json): ${params.flowFilePath}`);
  }
  const absolutePath = await join(ws.rootPath, relPath);

  let content: string;
  try {
    content = await readTextFile(absolutePath);
  } catch {
    throw new Error(`Flow file not found: ${params.flowFilePath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`Flow file is not valid JSON: ${params.flowFilePath}`);
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { steps?: unknown }).steps)
  ) {
    throw new Error(`Not a valid flow file: ${params.flowFilePath}`);
  }
  const flow = parseFlowFile(content);

  // Resolve environment variables for the requested environment, falling back to
  // the active one. Mirror executeRequestSilently: reuse the resolved store for
  // the active env (so Key Vault secrets, globals, and pb.set overrides are
  // included as the UI sees them); resolve any other env fresh from the files.
  const active = get(activeEnvironment);
  const effectiveEnv = params.environment ?? active;
  let environmentVariables: Record<string, string>;
  if (effectiveEnv && effectiveEnv === active) {
    environmentVariables = { ...get(resolvedEnvVars) };
  } else if (effectiveEnv) {
    environmentVariables = {
      ...resolveEnvironmentVariables(effectiveEnv, get(envFile), get(userEnvFile)),
      ...get(pbGlobals),
    };
  } else {
    environmentVariables = { ...get(pbGlobals) };
  }

  // No-op callbacks: a silent run reports nothing to the UI. runFlow returns a
  // fully isolated record; we never write it to stores or to disk.
  const record = await runFlow(
    flow,
    ws.rootPath,
    ws.tree,
    environmentVariables,
    get(dotenvVariables),
    effectiveEnv,
    { onStepStart() {}, onStepComplete() {} },
  );

  // Map the internal record onto the tool's output shape. The flow runner stores
  // both network errors and assertion/HTTP failures as `failed`; split them back
  // out so a network-level failure (non-null `error`) surfaces as `error`.
  const stepById = new Map(flow.steps.map((s) => [s.id, s]));
  const steps = record.stepResults.map((r) => {
    const status: 'passed' | 'failed' | 'skipped' | 'error' =
      r.status === 'failed' && r.error != null
        ? 'error'
        : r.status === 'passed'
          ? 'passed'
          : r.status === 'skipped'
            ? 'skipped'
            : 'failed';
    return {
      id: r.stepId,
      label: stepById.get(r.stepId)?.label ?? '',
      status,
      durationMs: r.durationMs,
      assertions: r.assertionResults.map((a) => ({ label: a.label, passed: a.passed })),
      error: r.error,
    };
  });

  const overall: 'passed' | 'failed' | 'error' = steps.some((s) => s.status === 'error')
    ? 'error'
    : steps.some((s) => s.status === 'failed')
      ? 'failed'
      : 'passed';

  return { status: overall, summary: record.summary, steps };
}

/**
 * Snapshot the user's most recent manual request result for the MCP
 * `get_last_result` tool. Reads the live UI stores without mutating them and
 * returns the `execute_request` shape, or `null` if no request has run yet.
 */
export function snapshotLastResult() {
  const response = get(currentResponse);
  if (!response) return null;
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
    time: response.time,
    assertions: get(pbAssertionResults).map((a) => ({ label: a.label, passed: a.passed })),
  };
}

export async function handleBridgeRequest(req: BridgeRequest) {
  try {
    switch (req.kind) {
      case 'list_requests':
        respondBridge(req.id, { ok: true, data: collectWorkspaceRequests() });
        break;
      case 'execute_request':
        respondBridge(req.id, {
          ok: true,
          data: await executeRequestSilently(req.params as ExecuteRequestParams),
        });
        break;
      case 'execute_flow':
        respondBridge(req.id, {
          ok: true,
          data: await executeFlowSilently(req.params as ExecuteFlowParams),
        });
        break;
      case 'get_last_result':
        respondBridge(req.id, { ok: true, data: snapshotLastResult() });
        break;
      default:
        respondBridge(req.id, { ok: false, error: `Unknown MCP bridge request: ${req.kind}` });
    }
  } catch (e) {
    respondBridge(req.id, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Subscribe to `mcp:request` events from the embedded MCP server. Returns a
 * promise resolving to the unlisten function; the caller (App.svelte) must
 * call it on teardown.
 */
export function startMcpBridge(): Promise<UnlistenFn> {
  return listen<BridgeRequest>('mcp:request', (event) => {
    void handleBridgeRequest(event.payload);
  });
}
