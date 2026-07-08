// Grouped environment variable model for the environment editor: collects the
// values a key has across the base env file, the .user file, and Key Vault,
// and decides which source is active by default. Extracted from
// EnvironmentEditor.svelte so it can be unit tested.

import type { EnvironmentFile, KeyVaultState, VarSource } from './types';
import { isKeyVaultConfig } from './keyvault';

/** One value for a variable, tagged with the source it came from. */
export interface VarSourceEntry {
  source: VarSource;
  value: string;
}

/** A variable grouped across all sources that define it. */
export interface EnvVar {
  key: string;
  enabled: boolean;
  /** Which source is currently active (displayed in the main row). */
  activeSource: VarSource;
  /** All sources where this variable is defined, ordered: local, user-local, keyvault. */
  sources: VarSourceEntry[];
}

/** Default priority: KV > user-local > local. */
export function defaultActiveSource(sources: VarSourceEntry[]): VarSource {
  const sourceSet = new Set(sources.map((s) => s.source));
  if (sourceSet.has('keyvault')) return 'keyvault';
  if (sourceSet.has('user-local')) return 'user-local';
  return 'local';
}

/** Check if an environment has KV access (directly or via $shared). */
export function envHasKv(ef: EnvironmentFile, env: string): boolean {
  return isKeyVaultConfig(ef?.[env]?.$keyvault) || isKeyVaultConfig(ef?.['$shared']?.$keyvault);
}

/** Build the grouped variable list for one environment tab. */
export function buildVarList(
  ef: EnvironmentFile,
  uef: EnvironmentFile | null,
  env: string,
  kv: KeyVaultState,
): EnvVar[] {
  const hasKv = kv.status === 'loaded' && envHasKv(ef, env);
  const vars = ef?.[env];
  const userVars = uef?.[env];

  // Collect all sources per key, preserving insertion order
  const keyMap = new Map<string, VarSourceEntry[]>();

  function addEntry(key: string, source: VarSource, value: string) {
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key)!.push({ source, value });
  }

  // Base file (local)
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      if (key === '$keyvault') continue;
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      addEntry(key, 'local', val);
    }
  }

  // User file (user-local)
  if (userVars) {
    for (const [key, value] of Object.entries(userVars)) {
      if (key === '$keyvault') continue;
      if (typeof value !== 'string') continue;
      addEntry(key, 'user-local', value);
    }
  }

  // Key Vault
  if (hasKv) {
    for (const [key, value] of Object.entries(kv.variables)) {
      addEntry(key, 'keyvault', value);
    }
  }

  // Build result
  return [...keyMap.entries()].map(([key, sources]) => ({
    key,
    enabled: true,
    activeSource: defaultActiveSource(sources),
    sources,
  }));
}
