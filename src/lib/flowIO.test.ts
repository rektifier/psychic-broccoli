import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  basename: vi.fn(async (p: string) => p.split('/').pop() ?? p),
}));

import { migrateFlowsDirectory, redactFlowRunRecord } from './flowIO';
import { readDir, rename } from '@tauri-apps/plugin-fs';
import type { FlowRunRecord } from './types';

const mockedReadDir = vi.mocked(readDir);
const mockedRename = vi.mocked(rename);

// ─── migrateFlowsDirectory ───────────────────────────────────────────────────

describe('migrateFlowsDirectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedRename.mockResolvedValue(undefined);
  });

  it('returns false when flows/ does not exist', async () => {
    mockedReadDir.mockRejectedValue(new Error('not found'));
    const migrated = await migrateFlowsDirectory('/workspace');
    expect(migrated).toBe(false);
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('renames flows/ to .flows/ and returns true when only flows/ exists', async () => {
    mockedReadDir
      .mockResolvedValueOnce([]) // flows/ exists
      .mockRejectedValueOnce(new Error('not found')); // .flows/ does not
    const migrated = await migrateFlowsDirectory('/workspace');
    expect(migrated).toBe(true);
    expect(mockedRename).toHaveBeenCalledWith('/workspace/flows', '/workspace/.flows');
  });

  it('returns false and skips rename when both flows/ and .flows/ exist', async () => {
    mockedReadDir.mockResolvedValue([]);
    const migrated = await migrateFlowsDirectory('/workspace');
    expect(migrated).toBe(false);
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('returns false when only .flows/ exists (already migrated)', async () => {
    mockedReadDir
      .mockRejectedValueOnce(new Error('not found')) // flows/ missing
      .mockResolvedValueOnce([]); // .flows/ exists (not reached, but explicit)
    const migrated = await migrateFlowsDirectory('/workspace');
    expect(migrated).toBe(false);
    expect(mockedRename).not.toHaveBeenCalled();
  });
});

// ─── redactFlowRunRecord ─────────────────────────────────────────────────────

function makeRecord(overrides: Partial<FlowRunRecord> = {}): FlowRunRecord {
  return {
    id: 'run-1',
    flowName: 'Login flow',
    flowFilePath: '.flows/login.pb-flow.json',
    environment: 'dev',
    startedAt: '2026-06-12T10:00:00.000Z',
    completedAt: '2026-06-12T10:00:01.000Z',
    status: 'completed',
    stepResults: [
      {
        stepId: 's1',
        status: 'passed',
        response: {
          status: 200,
          statusText: 'OK',
          headers: { 'set-cookie': 'session=abc123secret', 'content-type': 'application/json' },
          body: '{"ok":true}',
          time: 12,
          size: 11,
        },
        sentRequest: {
          method: 'GET',
          url: 'https://api.example.com/me?token=supersecretvalue',
          headers: { Authorization: 'Bearer supersecretvalue', Accept: 'application/json' },
          body: '',
        },
        assertionResults: [],
        durationMs: 12,
        error: null,
      },
    ],
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    variables: {
      setVars: { token: 'supersecretvalue' },
      globalVars: {},
      namedResults: {},
    },
    ...overrides,
  };
}

describe('redactFlowRunRecord', () => {
  it('redacts sensitive request and response headers by name', () => {
    const safe = redactFlowRunRecord(makeRecord(), []);
    const step = safe.stepResults[0];
    expect(step.sentRequest!.headers.Authorization).toBe('***');
    expect(step.sentRequest!.headers.Accept).toBe('application/json');
    expect(step.response!.headers['set-cookie']).toBe('***');
    expect(step.response!.headers['content-type']).toBe('application/json');
  });

  it('scrubs configured secret values wherever they appear', () => {
    const safe = redactFlowRunRecord(makeRecord(), ['supersecretvalue']);
    const step = safe.stepResults[0];
    // URL query secret is scrubbed even though it is not a header.
    expect(step.sentRequest!.url).toBe('https://api.example.com/me?token=***');
    // Captured set-var value is scrubbed.
    expect(safe.variables!.setVars.token).toBe('***');
  });

  it('does not mutate the original record', () => {
    const record = makeRecord();
    redactFlowRunRecord(record, ['supersecretvalue']);
    expect(record.stepResults[0].sentRequest!.headers.Authorization).toBe(
      'Bearer supersecretvalue',
    );
    expect(record.variables!.setVars.token).toBe('supersecretvalue');
  });

  it('ignores trivially short secret values to avoid mangling text', () => {
    const safe = redactFlowRunRecord(
      makeRecord({
        stepResults: [
          {
            ...makeRecord().stepResults[0],
            sentRequest: {
              method: 'GET',
              url: 'https://api.example.com/ok',
              headers: {},
              body: 'ok',
            },
          },
        ],
      }),
      ['ok'],
    );
    expect(safe.stepResults[0].sentRequest!.body).toBe('ok');
  });
});
