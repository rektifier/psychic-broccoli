import { describe, it, expect } from 'vitest';
import type { FlowStep } from './types';
import { applyAliasSync, applyRenamesToString, normalizeFlowAliases } from './flowAlias';

function step(partial: Partial<FlowStep>): FlowStep {
  return {
    id: partial.id ?? crypto.randomUUID(),
    filePath: 'x.http',
    requestIndex: 0,
    varName: partial.varName ?? null,
    aliasLocked: partial.aliasLocked ?? false,
    label: partial.label ?? 'GET /',
    continueOnFailure: false,
    overrides: partial.overrides,
  };
}

describe('normalizeFlowAliases', () => {
  it('assigns Step1, Step2, ... to unlocked steps', () => {
    const { steps } = normalizeFlowAliases([step({}), step({}), step({})]);
    expect(steps.map(s => s.varName)).toEqual(['Step1', 'Step2', 'Step3']);
  });

  it('preserves locked aliases', () => {
    const { steps } = normalizeFlowAliases([
      step({ varName: 'login', aliasLocked: true }),
      step({}),
      step({}),
    ]);
    expect(steps.map(s => s.varName)).toEqual(['login', 'Step2', 'Step3']);
  });

  it('skips numbers reserved by locked aliases', () => {
    // A locked step named "Step2" forces the unlocked step at index 1 to skip to Step3.
    const { steps } = normalizeFlowAliases([
      step({}),
      step({}),
      step({ varName: 'Step2', aliasLocked: true }),
    ]);
    expect(steps.map(s => s.varName)).toEqual(['Step1', 'Step3', 'Step2']);
  });

  it('reports renames for auto aliases that shifted', () => {
    const before = [
      step({ id: 'a', varName: 'Step1' }),
      step({ id: 'b', varName: 'Step2' }),
    ];
    // Move 'b' to position 0.
    const { renames } = normalizeFlowAliases([before[1], before[0]]);
    expect(renames).toEqual({ Step2: 'Step1', Step1: 'Step2' });
  });
});

describe('applyRenamesToString', () => {
  it('rewrites {{old.xxx}} to {{new.xxx}}', () => {
    const out = applyRenamesToString('token={{Step1.response.body.$.id}}', { Step1: 'Step2' });
    expect(out).toBe('token={{Step2.response.body.$.id}}');
  });

  it('handles simultaneous swaps without collision', () => {
    const out = applyRenamesToString('{{Step1.x}}|{{Step2.y}}', { Step1: 'Step2', Step2: 'Step1' });
    expect(out).toBe('{{Step2.x}}|{{Step1.y}}');
  });

  it('does not rewrite prefix-matching names (Step10 when renaming Step1)', () => {
    const out = applyRenamesToString('{{Step10.x}} and {{Step1.y}}', { Step1: 'Step2' });
    expect(out).toBe('{{Step10.x}} and {{Step2.y}}');
  });

  it('leaves unrelated text alone', () => {
    expect(applyRenamesToString('', { a: 'b' })).toBe('');
    expect(applyRenamesToString('plain text', { a: 'b' })).toBe('plain text');
  });
});

describe('applyAliasSync integration', () => {
  it('renames locked references after reorder', () => {
    const s1 = step({ id: 'a', varName: 'Step1' });
    const s2 = step({
      id: 'b',
      varName: 'Step2',
      overrides: { url: '/x?tok={{Step1.response.body.$.token}}' },
    });
    // Reorder: swap.
    const result = applyAliasSync([s2, s1]);
    expect(result.map(s => s.varName)).toEqual(['Step1', 'Step2']);
    // The step that was b (now at index 0 = Step1) still holds the old URL referring to the former Step1
    // which is now Step2. Cascade should rewrite it.
    expect(result[0].overrides?.url).toBe('/x?tok={{Step2.response.body.$.token}}');
  });

  it('cascades renames into headers, scripts, and directive exprs', () => {
    const s1 = step({ id: 'a', varName: 'Step1' });
    const s2 = step({
      id: 'b',
      varName: 'Step2',
      overrides: {
        headers: [{ key: 'X-Tok-{{Step1.response.body.$.k}}', value: 'Bearer {{Step1.response.body.$.token}}', enabled: true }],
        beforeSend: 'const x = "{{Step1.response.body.$.id}}";',
        afterReceive: 'log("{{Step1.response.headers.X-Trace}}");',
        directives: [
          { type: 'assert', expr: 'pb.response.body.$.ref == "{{Step1.response.body.$.id}}"', label: 'ref matches' },
          { type: 'set', key: 'tok', expr: '{{Step1.response.body.$.token}}' },
        ],
      },
    });
    const result = applyAliasSync([s2, s1]);
    const moved = result[0].overrides!;
    expect(moved.headers?.[0].key).toBe('X-Tok-{{Step2.response.body.$.k}}');
    expect(moved.headers?.[0].value).toBe('Bearer {{Step2.response.body.$.token}}');
    expect(moved.beforeSend).toBe('const x = "{{Step2.response.body.$.id}}";');
    expect(moved.afterReceive).toBe('log("{{Step2.response.headers.X-Trace}}");');
    const assertDir = moved.directives?.[0];
    if (assertDir?.type === 'assert') {
      expect(assertDir.expr).toBe('pb.response.body.$.ref == "{{Step2.response.body.$.id}}"');
      expect(assertDir.label).toBe('ref matches');
    }
    const setDir = moved.directives?.[1];
    if (setDir?.type === 'set') {
      expect(setDir.expr).toBe('{{Step2.response.body.$.token}}');
    }
  });

  it('preserves user-locked aliases through reorder', () => {
    const s1 = step({ id: 'a', varName: 'login', aliasLocked: true });
    const s2 = step({ id: 'b', varName: 'Step2', aliasLocked: false });
    const result = applyAliasSync([s2, s1]);
    // Locked alias moves with the step and keeps its name; unlocked becomes Step1.
    expect(result[0].varName).toBe('Step1');
    expect(result[1].varName).toBe('login');
    expect(result[1].aliasLocked).toBe(true);
  });
});
