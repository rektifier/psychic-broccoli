import { invoke } from '@tauri-apps/api/core';
import type { EnvironmentFile, EnvironmentVariables, KeyVaultConfig } from './types';

/** Runtime type guard for KeyVaultConfig entries in environment variables. */
export function isKeyVaultConfig(value: unknown): value is KeyVaultConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    (value as Record<string, unknown>).provider === 'AzureKeyVault' &&
    'vaultUrl' in value &&
    typeof (value as Record<string, unknown>).vaultUrl === 'string' &&
    'secretName' in value &&
    typeof (value as Record<string, unknown>).secretName === 'string' &&
    (value as Record<string, unknown>).vaultUrl !== '' &&
    (value as Record<string, unknown>).secretName !== ''
  );
}

/**
 * Extract a $keyvault config from environment layers.
 * Priority: user env-specific > env-specific > user $shared > $shared.
 */
export function extractKeyVaultConfig(
  envName: string,
  envFile: EnvironmentFile | null,
  userEnvFile: EnvironmentFile | null,
): KeyVaultConfig | null {
  const layers: (EnvironmentVariables | undefined)[] = [
    userEnvFile?.[envName],
    envFile?.[envName],
    userEnvFile?.['$shared'],
    envFile?.['$shared'],
  ];

  for (const layer of layers) {
    const entry = layer?.['$keyvault'];
    if (isKeyVaultConfig(entry)) {
      return entry;
    }
  }

  return null;
}

/**
 * Fetch secrets from Azure Key Vault via the Rust backend.
 * Returns a flat Record<string, string> parsed from the secret's JSON value.
 */
export async function fetchKeyVaultSecrets(
  config: KeyVaultConfig,
): Promise<Record<string, string>> {
  let result: { value: string };
  try {
    result = await invoke<{ value: string }>('fetch_keyvault_secret', {
      payload: { vault_url: config.vaultUrl, secret_name: config.secretName },
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('unknown command')) {
      throw new Error(
        'Key Vault integration is not available in this build. ' +
        'Rebuild with the "keyvault" Cargo feature enabled.',
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.value);
  } catch {
    throw new Error(
      `Key Vault secret '${config.secretName}' contains invalid JSON. ` +
      'Expected a flat object like {"key": "value"}.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Key Vault secret '${config.secretName}' must be a JSON object. ` +
      'Expected a flat object like {"key": "value"}.',
    );
  }

  const record = parsed as Record<string, unknown>;
  const result_map: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new Error(
        `Key Vault secret '${config.secretName}' contains a non-string value ` +
        `for key '${key}'. Only flat string key-value pairs are supported.`,
      );
    }
    result_map[key] = value;
  }

  return result_map;
}

/** Build a cache key for deduplication. */
export function kvCacheKey(envName: string, config: KeyVaultConfig): string {
  return `${envName}::${config.vaultUrl}::${config.secretName}`;
}
