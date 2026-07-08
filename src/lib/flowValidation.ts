// Flow step validation and URL preview resolution: maps flow steps back to
// workspace files, detects broken references, and resolves {{variable}}
// placeholders in step URLs. Extracted from FlowEditor.svelte so it can be
// unit tested.

import type { FileNode, FlowStep } from './types';
import { substituteAll } from './substitution';

/** Extract the URL portion from a step label like "POST /api/login". */
export function urlFromLabel(label: string): string {
  const m = label.match(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(.*)/);
  return m ? m[1] : label;
}

/** Find the FileNode matching a step's workspace-relative filePath. */
export function findFileForStep(
  step: FlowStep,
  allFiles: FileNode[],
  rootPath: string,
): FileNode | undefined {
  const normalized = step.filePath.replaceAll('\\', '/');
  return allFiles.find((f) => {
    const rel = f.path.substring(rootPath.length + 1).replaceAll('\\', '/');
    return rel === normalized;
  });
}

/** Check if a step's target file and request still exist in the workspace. */
export function isStepBroken(step: FlowStep, allFiles: FileNode[], rootPath: string): boolean {
  const file = findFileForStep(step, allFiles, rootPath);
  if (!file) return true;
  if (step.requestIndex >= 0 && step.requestIndex < file.requests.length) return false;
  if (step.varName && file.requests.some((r) => r.varName === step.varName)) return false;
  return true;
}

/**
 * Resolve a preview URL for every step. Returns '' for steps whose URL has no
 * {{variable}} placeholders or whose placeholders cannot be resolved.
 *
 * `scopeVars` holds variables captured from the flow's most recent run
 * (pb.set / pb.global) so URLs referencing them resolve in the preview.
 */
export function resolveStepUrls(
  steps: FlowStep[],
  allFiles: FileNode[],
  rootPath: string,
  env: Record<string, string>,
  dotenv: Record<string, string>,
  scopeVars: Record<string, string>,
): string[] {
  return steps.map((step) => {
    const file = findFileForStep(step, allFiles, rootPath);
    const req =
      file && step.requestIndex >= 0 && step.requestIndex < (file.requests?.length ?? 0)
        ? file.requests[step.requestIndex]
        : null;
    // Prefer the step's override URL (what the user is actively editing) over the base.
    const rawUrl = step.overrides?.url ?? (req ? req.url : urlFromLabel(step.label));
    if (!rawUrl || !rawUrl.includes('{{')) return '';
    // Merge env with flow-scope vars (pb.set / pb.global captured on last run) so
    // URLs that reference them (e.g. {{sessionId}}) resolve in the preview.
    const nonEmptyEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) if (v) nonEmptyEnv[k] = v;
    for (const [k, v] of Object.entries(scopeVars))
      if (v != null && v !== '') nonEmptyEnv[k] = String(v);
    const resolved = substituteAll(rawUrl, {
      fileVariables: [],
      environmentVariables: nonEmptyEnv,
      namedResults: {},
      dotenvVariables: dotenv,
    });
    return resolved !== rawUrl ? resolved : '';
  });
}
