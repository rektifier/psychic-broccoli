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

import { migrateFlowsDirectory } from './flowIO';
import { readDir, rename } from '@tauri-apps/plugin-fs';

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
