import { describe, it, expect } from 'vitest';
import { buildVarList, defaultActiveSource, envHasKv } from './envVarModel';
import type { EnvironmentFile, KeyVaultState } from './types';

const idleKv: KeyVaultState = { status: 'idle', variables: {}, error: null, cacheKey: null };

function loadedKv(variables: Record<string, string>): KeyVaultState {
  return { status: 'loaded', variables, error: null, cacheKey: 'dev::https://vault.test' };
}

const kvConfig = {
  provider: 'AzureKeyVault',
  vaultUrl: 'https://vault.test',
  secretName: 'secrets',
} as const;

describe('defaultActiveSource', () => {
  it('prefers keyvault over everything', () => {
    expect(
      defaultActiveSource([
        { source: 'local', value: 'a' },
        { source: 'user-local', value: 'b' },
        { source: 'keyvault', value: 'c' },
      ]),
    ).toBe('keyvault');
  });

  it('prefers user-local over local', () => {
    expect(
      defaultActiveSource([
        { source: 'local', value: 'a' },
        { source: 'user-local', value: 'b' },
      ]),
    ).toBe('user-local');
  });

  it('falls back to local', () => {
    expect(defaultActiveSource([{ source: 'local', value: 'a' }])).toBe('local');
  });
});

describe('envHasKv', () => {
  it('detects a $keyvault config on the environment itself', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { $keyvault: kvConfig } };
    expect(envHasKv(ef, 'dev')).toBe(true);
  });

  it('detects a $keyvault config inherited from $shared', () => {
    const ef: EnvironmentFile = { $shared: { $keyvault: kvConfig }, dev: {} };
    expect(envHasKv(ef, 'dev')).toBe(true);
  });

  it('returns false when neither the env nor $shared has a config', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: {} };
    expect(envHasKv(ef, 'dev')).toBe(false);
  });
});

describe('buildVarList', () => {
  it('groups values from base, user, and Key Vault under one key', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { $keyvault: kvConfig, token: 'base' } };
    const uef: EnvironmentFile = { dev: { token: 'user' } };
    const list = buildVarList(ef, uef, 'dev', loadedKv({ token: 'kv' }));

    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('token');
    expect(list[0].sources).toEqual([
      { source: 'local', value: 'base' },
      { source: 'user-local', value: 'user' },
      { source: 'keyvault', value: 'kv' },
    ]);
    expect(list[0].activeSource).toBe('keyvault');
  });

  it('marks user-local active when there is no Key Vault value', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { token: 'base' } };
    const uef: EnvironmentFile = { dev: { token: 'user' } };
    const list = buildVarList(ef, uef, 'dev', idleKv);
    expect(list[0].activeSource).toBe('user-local');
  });

  it('excludes the $keyvault config entry from the variable list', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { $keyvault: kvConfig, a: '1' } };
    const list = buildVarList(ef, null, 'dev', idleKv);
    expect(list.map((v) => v.key)).toEqual(['a']);
  });

  it('ignores Key Vault variables when the environment has no $keyvault config', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { a: '1' } };
    const list = buildVarList(ef, null, 'dev', loadedKv({ secret: 'kv' }));
    expect(list.map((v) => v.key)).toEqual(['a']);
  });

  it('ignores Key Vault variables when the fetch has not loaded', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { $keyvault: kvConfig, a: '1' } };
    const list = buildVarList(ef, null, 'dev', {
      status: 'loading',
      variables: { secret: 'kv' },
      error: null,
      cacheKey: null,
    });
    expect(list.map((v) => v.key)).toEqual(['a']);
  });

  it('serializes non-string base values and skips non-string user values', () => {
    const ef = { $shared: {}, dev: { obj: { provider: 'AzureKeyVault' } } } as EnvironmentFile;
    const uef = { dev: { obj: { provider: 'AzureKeyVault' } } } as EnvironmentFile;
    const list = buildVarList(ef, uef, 'dev', idleKv);
    expect(list).toHaveLength(1);
    expect(list[0].sources).toEqual([{ source: 'local', value: '{"provider":"AzureKeyVault"}' }]);
  });

  it('preserves insertion order of keys', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { b: '1', a: '2' } };
    const uef: EnvironmentFile = { dev: { c: '3' } };
    const list = buildVarList(ef, uef, 'dev', idleKv);
    expect(list.map((v) => v.key)).toEqual(['b', 'a', 'c']);
  });

  it('returns an empty list for an unknown environment', () => {
    const ef: EnvironmentFile = { $shared: {}, dev: { a: '1' } };
    expect(buildVarList(ef, null, 'prod', idleKv)).toEqual([]);
  });
});
