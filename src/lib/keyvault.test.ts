import { describe, it, expect, vi } from 'vitest';
import { extractKeyVaultConfig, fetchKeyVaultSecrets, kvCacheKey, isKeyVaultConfig } from './keyvault';
import type { EnvironmentFile, KeyVaultConfig } from './types';

// ─── isKeyVaultConfig ─────────────────────────────────────────────────────

describe('isKeyVaultConfig', () => {
  it('returns true for valid config', () => {
    expect(isKeyVaultConfig({
      provider: 'AzureKeyVault',
      vaultUrl: 'https://v.vault.azure.net',
      secretName: 's',
    })).toBe(true);
  });

  it('returns false for wrong provider', () => {
    expect(isKeyVaultConfig({ provider: 'DPAPI', vaultUrl: 'x', secretName: 'x' })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isKeyVaultConfig(null)).toBe(false);
    expect(isKeyVaultConfig('string')).toBe(false);
    expect(isKeyVaultConfig(undefined)).toBe(false);
  });

  it('returns false when required fields are missing', () => {
    expect(isKeyVaultConfig({ provider: 'AzureKeyVault' })).toBe(false);
    expect(isKeyVaultConfig({ provider: 'AzureKeyVault', vaultUrl: 'x' })).toBe(false);
  });

  it('returns false when fields are non-string', () => {
    expect(isKeyVaultConfig({ provider: 'AzureKeyVault', vaultUrl: 123, secretName: 's' })).toBe(false);
  });
});

// ─── extractKeyVaultConfig ─────────────────────────────────────────────────

describe('extractKeyVaultConfig', () => {
  it('returns null when no $keyvault entry exists', () => {
    const envFile: EnvironmentFile = { dev: { token: 'abc' } };
    expect(extractKeyVaultConfig('dev', envFile, null)).toBeNull();
  });

  it('extracts $keyvault from env-specific section', () => {
    const envFile: EnvironmentFile = {
      dev: {
        token: 'abc',
        $keyvault: {
          provider: 'AzureKeyVault',
          vaultUrl: 'https://my-vault.vault.azure.net',
          secretName: 'dev-env',
        },
      },
    };
    const config = extractKeyVaultConfig('dev', envFile, null);
    expect(config).toEqual({
      provider: 'AzureKeyVault',
      vaultUrl: 'https://my-vault.vault.azure.net',
      secretName: 'dev-env',
    });
  });

  it('extracts $keyvault from $shared section', () => {
    const envFile: EnvironmentFile = {
      $shared: {
        $keyvault: {
          provider: 'AzureKeyVault',
          vaultUrl: 'https://shared.vault.azure.net',
          secretName: 'shared-env',
        },
      },
      dev: { token: 'abc' },
    };
    const config = extractKeyVaultConfig('dev', envFile, null);
    expect(config).toEqual({
      provider: 'AzureKeyVault',
      vaultUrl: 'https://shared.vault.azure.net',
      secretName: 'shared-env',
    });
  });

  it('user env-specific takes priority over env-specific', () => {
    const envFile: EnvironmentFile = {
      dev: {
        $keyvault: {
          provider: 'AzureKeyVault',
          vaultUrl: 'https://base.vault.azure.net',
          secretName: 'base',
        },
      },
    };
    const userEnvFile: EnvironmentFile = {
      dev: {
        $keyvault: {
          provider: 'AzureKeyVault',
          vaultUrl: 'https://user.vault.azure.net',
          secretName: 'user',
        },
      },
    };
    const config = extractKeyVaultConfig('dev', envFile, userEnvFile);
    expect(config!.vaultUrl).toBe('https://user.vault.azure.net');
    expect(config!.secretName).toBe('user');
  });

  it('skips entries with wrong provider', () => {
    const envFile = {
      dev: {
        $keyvault: {
          provider: 'DPAPI',
          vaultUrl: 'https://x.vault.azure.net',
          secretName: 'x',
        },
      },
    } as unknown as EnvironmentFile;
    expect(extractKeyVaultConfig('dev', envFile, null)).toBeNull();
  });

  it('skips entries missing required fields', () => {
    const envFile = {
      dev: {
        $keyvault: {
          provider: 'AzureKeyVault',
          // missing vaultUrl and secretName
        },
      },
    } as unknown as EnvironmentFile;
    expect(extractKeyVaultConfig('dev', envFile, null)).toBeNull();
  });

  it('returns null for non-existent environment', () => {
    const envFile: EnvironmentFile = {
      dev: {
        $keyvault: {
          provider: 'AzureKeyVault',
          vaultUrl: 'https://v.vault.azure.net',
          secretName: 's',
        },
      },
    };
    expect(extractKeyVaultConfig('staging', envFile, null)).toBeNull();
  });
});

// ─── fetchKeyVaultSecrets ──────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockedInvoke = vi.mocked(invoke);

describe('fetchKeyVaultSecrets', () => {
  const config: KeyVaultConfig = {
    provider: 'AzureKeyVault',
    vaultUrl: 'https://my-vault.vault.azure.net',
    secretName: 'test-secret',
  };

  it('parses a valid flat JSON secret', async () => {
    mockedInvoke.mockResolvedValue({
      value: '{"ApiKey":"sk-123","DbPass":"hunter2"}',
    });

    const result = await fetchKeyVaultSecrets(config);
    expect(result).toEqual({ ApiKey: 'sk-123', DbPass: 'hunter2' });
    expect(mockedInvoke).toHaveBeenCalledWith('fetch_keyvault_secret', {
      payload: { vault_url: config.vaultUrl, secret_name: config.secretName },
    });
  });

  it('throws on invalid JSON', async () => {
    mockedInvoke.mockResolvedValue({ value: 'not-json' });

    await expect(fetchKeyVaultSecrets(config)).rejects.toThrow('invalid JSON');
  });

  it('throws on array JSON', async () => {
    mockedInvoke.mockResolvedValue({ value: '["a","b"]' });

    await expect(fetchKeyVaultSecrets(config)).rejects.toThrow('must be a JSON object');
  });

  it('throws on nested objects', async () => {
    mockedInvoke.mockResolvedValue({ value: '{"key":{"nested":true}}' });

    await expect(fetchKeyVaultSecrets(config)).rejects.toThrow('non-string value');
  });

  it('propagates invoke errors', async () => {
    mockedInvoke.mockRejectedValue(new Error('Network failure'));

    await expect(fetchKeyVaultSecrets(config)).rejects.toThrow('Network failure');
  });

  it('throws a descriptive error when keyvault feature is disabled', async () => {
    mockedInvoke.mockRejectedValue('unknown command `fetch_keyvault_secret`');

    await expect(fetchKeyVaultSecrets(config)).rejects.toThrow('not available in this build');
  });
});

// ─── kvCacheKey ────────────────────────────────────────────────────────────

describe('kvCacheKey', () => {
  it('builds a deterministic cache key', () => {
    const config: KeyVaultConfig = {
      provider: 'AzureKeyVault',
      vaultUrl: 'https://v.vault.azure.net',
      secretName: 's',
    };
    expect(kvCacheKey('dev', config)).toBe('dev::https://v.vault.azure.net::s');
  });
});
