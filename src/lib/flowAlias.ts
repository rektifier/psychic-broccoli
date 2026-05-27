/**
 * Auto-alias management for flow steps.
 *
 * Every step owns an alias (`step.varName`) under which its response is stored
 * during flow execution (see flowRunner.ts). Aliases fall into two categories:
 *
 * - Auto (`aliasLocked === false`): name follows position - "Step1", "Step2", ...
 *   Regenerated whenever the steps array mutates (add, remove, reorder).
 * - Locked (`aliasLocked === true`): user-typed name. Never auto-modified.
 *
 * When auto aliases are renamed, any `{{oldName.response...}}` references in
 * sibling steps' template strings are rewritten so the flow stays consistent.
 */

import type { FlowStep, FlowStepOverrides, HttpHeader, PbDirective } from './types';

const AUTO_PREFIX = 'Step';

/** Generate the nth auto alias (1-indexed). */
export function autoAliasFor(index: number): string {
  return `${AUTO_PREFIX}${index + 1}`;
}

/** Walk steps and assign auto aliases to every unlocked step.
 *  Returns the new steps array plus a map of {oldName: newName} for every
 *  alias that actually changed (used to cascade references). */
export function normalizeFlowAliases(
  steps: FlowStep[],
): { steps: FlowStep[]; renames: Record<string, string> } {
  // Names claimed by locked steps are reserved and cannot be reused by auto aliases.
  const reserved = new Set<string>();
  for (const s of steps) {
    if (s.aliasLocked && s.varName) reserved.add(s.varName);
  }

  const renames: Record<string, string> = {};
  const used = new Set<string>(reserved);

  const next = steps.map((s, i) => {
    if (s.aliasLocked) return s;
    // Pick Step{N} by position, or the next free Step{K} if reserved.
    let candidate = autoAliasFor(i);
    let bumpIndex = i;
    while (used.has(candidate)) {
      bumpIndex++;
      candidate = autoAliasFor(bumpIndex);
    }
    used.add(candidate);
    if (s.varName !== candidate) {
      if (s.varName) renames[s.varName] = candidate;
      return { ...s, varName: candidate };
    }
    return s;
  });

  return { steps: next, renames };
}

/** Rewrite `{{oldName.xxx}}` occurrences to `{{newName.xxx}}` in a string.
 *  Uses a sentinel two-pass substitution so simultaneous swaps
 *  (e.g. Step2 <-> Step3) don't collide. */
export function applyRenamesToString(
  text: string,
  renames: Record<string, string>,
): string {
  if (!text) return text;
  const entries = Object.entries(renames);
  if (entries.length === 0) return text;

  // Pass 1: replace each old name with a unique sentinel.
  let out = text;
  const sentinels: { sentinel: string; newName: string }[] = [];
  entries.forEach(([oldName, newName], i) => {
    const sentinel = `__FLOW_ALIAS_RENAME_${i}__`;
    sentinels.push({ sentinel, newName });
    // Match `{{  oldName` followed by `.`, `}`, whitespace, or `|` (pipe for future filters).
    // Escapes `.` and other regex-special chars if any ever leak into names.
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(\\{\\{\\s*)${escaped}(?=[.}\\s|])`, 'g');
    out = out.replace(re, `$1${sentinel}`);
  });

  // Pass 2: sentinel -> final new name.
  for (const { sentinel, newName } of sentinels) {
    out = out.split(sentinel).join(newName);
  }
  return out;
}

/** Apply the `renames` map to every template-bearing field in an overrides object. */
function rewriteOverrides(
  overrides: FlowStepOverrides | undefined,
  renames: Record<string, string>,
): FlowStepOverrides | undefined {
  if (!overrides) return overrides;
  const next: FlowStepOverrides = { ...overrides };
  if (next.url !== undefined) next.url = applyRenamesToString(next.url, renames);
  if (next.body !== undefined) next.body = applyRenamesToString(next.body, renames);
  if (next.beforeSend !== undefined) next.beforeSend = applyRenamesToString(next.beforeSend, renames);
  if (next.afterReceive !== undefined) next.afterReceive = applyRenamesToString(next.afterReceive, renames);
  if (next.headers) {
    next.headers = next.headers.map((h: HttpHeader) => ({
      ...h,
      key: applyRenamesToString(h.key, renames),
      value: applyRenamesToString(h.value, renames),
    }));
  }
  if (next.directives) {
    next.directives = next.directives.map((d: PbDirective) => ({
      ...d,
      expr: applyRenamesToString(d.expr, renames),
    }));
  }
  return next;
}

/** Cascade a rename map through every step's override text fields. */
export function rewriteAliasReferences(
  steps: FlowStep[],
  renames: Record<string, string>,
): FlowStep[] {
  if (Object.keys(renames).length === 0) return steps;
  return steps.map(s => ({ ...s, overrides: rewriteOverrides(s.overrides, renames) }));
}

/** One-shot: normalize auto aliases and cascade any resulting renames into references. */
export function applyAliasSync(steps: FlowStep[]): FlowStep[] {
  const { steps: normalized, renames } = normalizeFlowAliases(steps);
  return rewriteAliasReferences(normalized, renames);
}
