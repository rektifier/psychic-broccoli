import { invoke } from '@tauri-apps/api/core';
import { substituteAll, executePbDirectives, getAllFileNodes } from './parser';
import type { SubstitutionContext } from './parser';
import type {
  FlowDefinition, FlowStep, FlowStepResult, FlowStepStatus,
  FlowRunRecord, FlowRunStatus,
  HttpRequest, HttpResponse, TreeNode, FileNode, Variable,
  NamedRequestResult, PbAssertionResult,
} from './types';

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface FlowRunnerCallbacks {
  onStepStart(stepId: string): void;
  onStepComplete(stepId: string, result: FlowStepResult): void;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runFlow(
  flow: FlowDefinition,
  rootPath: string,
  tree: TreeNode[],
  environmentVariables: Record<string, string>,
  dotenvVariables: Record<string, string>,
  activeEnvironment: string | null,
  callbacks: FlowRunnerCallbacks,
  abortSignal?: AbortSignal,
): Promise<FlowRunRecord> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const stepResults: FlowStepResult[] = [];

  // Isolated variable state for this flow run
  const localNamedResults: Record<string, NamedRequestResult> = {};
  const localEnvOverrides: Record<string, string> = {};
  const localGlobals: Record<string, string> = {};

  const allFiles = getAllFileNodes(tree);

  let status: FlowRunStatus = 'running';

  for (const step of flow.steps) {
    // Check abort
    if (abortSignal?.aborted) {
      stepResults.push(makeSkippedResult(step.id));
      status = 'aborted';
      continue;
    }

    callbacks.onStepStart(step.id);

    // Resolve the file and request
    const file = resolveFile(allFiles, step, rootPath);
    if (!file) {
      const result = makeErrorResult(step.id, `File not found: ${step.filePath}`);
      stepResults.push(result);
      callbacks.onStepComplete(step.id, result);
      if (!step.continueOnFailure) {
        markRemainingSkipped(flow.steps, stepResults, step.id);
        status = 'completed';
        break;
      }
      continue;
    }

    const baseRequest = resolveRequest(file, step);
    if (!baseRequest) {
      const result = makeErrorResult(step.id, `Request not found at index ${step.requestIndex} in ${step.filePath}`);
      stepResults.push(result);
      callbacks.onStepComplete(step.id, result);
      if (!step.continueOnFailure) {
        markRemainingSkipped(flow.steps, stepResults, step.id);
        status = 'completed';
        break;
      }
      continue;
    }

    // Apply per-step overrides (without modifying the original request)
    const request = step.overrides ? {
      ...baseRequest,
      ...(step.overrides.url !== undefined ? { url: step.overrides.url } : {}),
      ...(step.overrides.headers !== undefined ? { headers: step.overrides.headers } : {}),
      ...(step.overrides.body !== undefined ? { body: step.overrides.body } : {}),
      ...(step.overrides.directives !== undefined ? { directives: step.overrides.directives } : {}),
    } : baseRequest;

    // Build substitution context with flow-local state
    const ctx: SubstitutionContext = {
      fileVariables: file.variables,
      environmentVariables: { ...environmentVariables, ...localEnvOverrides, ...localGlobals },
      namedResults: localNamedResults,
      dotenvVariables,
    };

    const stepResult = await executeStep(step.id, request, ctx, localNamedResults, localEnvOverrides, localGlobals);
    stepResults.push(stepResult);
    callbacks.onStepComplete(step.id, stepResult);

    // On failure, decide whether to continue or stop
    if (stepResult.status === 'failed' && !step.continueOnFailure) {
      markRemainingSkipped(flow.steps, stepResults, step.id);
      status = 'completed';
      break;
    }
  }

  if (status === 'running') status = 'completed';

  const summary = computeSummary(stepResults);

  return {
    id: runId,
    flowName: flow.name,
    flowFilePath: '', // Caller fills this in
    environment: activeEnvironment,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    stepResults,
    summary,
  };
}

// ─── Step Execution ──────────────────────────────────────────────────────────

async function executeStep(
  stepId: string,
  request: HttpRequest,
  ctx: SubstitutionContext,
  localNamedResults: Record<string, NamedRequestResult>,
  localEnvOverrides: Record<string, string>,
  localGlobals: Record<string, string>,
): Promise<FlowStepResult> {
  const startTime = performance.now();

  try {
    const url = substituteAll(request.url, ctx);
    const body = substituteAll(request.body, ctx);
    const headers: Record<string, string> = {};
    for (const h of request.headers) {
      if (h.enabled) {
        headers[substituteAll(h.key, ctx)] = substituteAll(h.value, ctx);
      }
    }

    const sentRequest = { method: request.method, url, headers, body };

    const res: { status: number; status_text: string; headers: Record<string, string>; body: string } =
      await invoke('http_request', {
        payload: {
          method: request.method,
          url,
          headers,
          body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? null : body || null,
        },
      });

    const elapsed = performance.now() - startTime;

    const response: HttpResponse = {
      status: res.status,
      statusText: res.status_text,
      headers: res.headers,
      body: res.body,
      time: Math.round(elapsed),
      size: new TextEncoder().encode(res.body).length,
    };

    // Store named result for chaining
    if (request.varName) {
      localNamedResults[request.varName] = { request: sentRequest, response };
    }

    // Execute pb directives
    let assertionResults: PbAssertionResult[] = [];
    if (request.directives && request.directives.length > 0) {
      const mergedVars: Record<string, string> = { ...ctx.environmentVariables };
      for (const v of ctx.fileVariables) mergedVars[v.key] = v.value;

      const enabledDirectives = request.directives.filter(d => d.enabled !== false);
      const pbResult = executePbDirectives(
        enabledDirectives, response, sentRequest, mergedVars, localNamedResults,
      );

      assertionResults = pbResult.assertionResults;

      // Apply set vars
      if (Object.keys(pbResult.setVars).length > 0) {
        Object.assign(localEnvOverrides, pbResult.setVars);
      }

      // Apply global vars
      if (Object.keys(pbResult.globalVars).length > 0) {
        Object.assign(localGlobals, pbResult.globalVars);
        Object.assign(localEnvOverrides, pbResult.globalVars);
      }
    }

    // Determine pass/fail
    const allAssertionsPassed = assertionResults.length === 0 || assertionResults.every(a => a.passed);
    const httpOk = response.status >= 200 && response.status < 400;
    const passed = httpOk && allAssertionsPassed;

    return {
      stepId,
      status: passed ? 'passed' : 'failed',
      response,
      sentRequest,
      assertionResults,
      durationMs: Math.round(elapsed),
      error: null,
    };
  } catch (e: any) {
    return {
      stepId,
      status: 'failed',
      response: null,
      sentRequest: null,
      assertionResults: [],
      durationMs: Math.round(performance.now() - startTime),
      error: typeof e === 'string' ? e : e.message || 'Request failed',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveFile(files: FileNode[], step: FlowStep, rootPath: string): FileNode | null {
  // Match by relative path
  const normalizedStepPath = step.filePath.replaceAll('\\', '/');
  for (const file of files) {
    const relPath = file.path.substring(rootPath.length + 1).replaceAll('\\', '/');
    if (relPath === normalizedStepPath) return file;
  }
  return null;
}

function resolveRequest(file: FileNode, step: FlowStep): HttpRequest | null {
  // Primary: by index
  if (step.requestIndex >= 0 && step.requestIndex < file.requests.length) {
    return file.requests[step.requestIndex];
  }
  // Fallback: by varName
  if (step.varName) {
    return file.requests.find(r => r.varName === step.varName) ?? null;
  }
  return null;
}

function makeSkippedResult(stepId: string): FlowStepResult {
  return {
    stepId,
    status: 'skipped',
    response: null,
    sentRequest: null,
    assertionResults: [],
    durationMs: 0,
    error: null,
  };
}

function makeErrorResult(stepId: string, error: string): FlowStepResult {
  return {
    stepId,
    status: 'failed',
    response: null,
    sentRequest: null,
    assertionResults: [],
    durationMs: 0,
    error,
  };
}

function markRemainingSkipped(steps: FlowStep[], results: FlowStepResult[], afterStepId: string): void {
  const idx = steps.findIndex(s => s.id === afterStepId);
  for (let i = idx + 1; i < steps.length; i++) {
    results.push(makeSkippedResult(steps[i].id));
  }
}

function computeSummary(results: FlowStepResult[]): FlowRunRecord['summary'] {
  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else if (r.status === 'skipped') skipped++;
  }
  return { total: results.length, passed, failed, skipped };
}
