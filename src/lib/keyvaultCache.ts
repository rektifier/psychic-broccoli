// ─── Key Vault cache ─────────────────────────────────────────────────────────
// Fetching and per-environment caching of Azure Key Vault secrets. The cache
// persists across environment switches within a workspace and is cleared when
// a new folder opens. Fetch results land in the keyVaultState store; stale
// responses are dropped via a fetch sequence counter.

import { get } from 'svelte/store';
import {
  activeEnvironment,
  envFile,
  userEnvFile,
  keyVaultState,
  varSourcePrefs,
  addToast,
} from './stores';
import { extractKeyVaultConfig, fetchKeyVaultSecrets, kvCacheKey } from './keyvault';
import type { KeyVaultState } from './types';

let lastKvEnv: string | null = null;
let kvFetchSeq = 0;
/** Per-environment KV cache - persists across env switches, cleared on folder change. */
let kvCache: Record<string, KeyVaultState> = {};
const idleKv: KeyVaultState = { status: 'idle', variables: {}, error: null, cacheKey: null };

export async function refreshKeyVaultSecrets(forEnv?: string) {
  const env = forEnv ?? get(activeEnvironment);
  if (!env) {
    keyVaultState.set(idleKv);
    return;
  }

  const config = extractKeyVaultConfig(env, get(envFile), get(userEnvFile));
  if (!config) {
    // No KV config for this env - restore idle but keep cache for other envs
    keyVaultState.set(idleKv);
    return;
  }

  const newCacheKey = kvCacheKey(env, config);

  // Check per-env cache first
  const cached = kvCache[newCacheKey];
  if (cached && cached.status === 'loaded') {
    keyVaultState.set(cached);
    return;
  }

  // Only clear conflict preferences when switching environments
  if (lastKvEnv !== env) {
    varSourcePrefs.set({});
  }
  lastKvEnv = env;

  const seq = ++kvFetchSeq;
  keyVaultState.set({ status: 'loading', variables: {}, error: null, cacheKey: newCacheKey });

  try {
    const vars = await fetchKeyVaultSecrets(config);
    if (kvFetchSeq === seq) {
      const state: KeyVaultState = {
        status: 'loaded',
        variables: vars,
        error: null,
        cacheKey: newCacheKey,
      };
      kvCache[newCacheKey] = state;
      keyVaultState.set(state);
    }
  } catch (err: unknown) {
    if (kvFetchSeq === seq) {
      const msg = err instanceof Error ? err.message : String(err);
      const state: KeyVaultState = {
        status: 'error',
        variables: {},
        error: msg,
        cacheKey: newCacheKey,
      };
      keyVaultState.set(state);
      addToast(`Key Vault error: ${msg}`, 'error');
    }
  }
}

/** Clear the whole cache (a new workspace folder was opened). */
export function resetKeyVaultCache() {
  kvCache = {};
}

/** Invalidate one environment's cache entries and fetch fresh secrets for it. */
export function refreshKeyVaultForEnv(env: string) {
  for (const key of Object.keys(kvCache)) {
    if (key.startsWith(env + '::')) delete kvCache[key];
  }
  keyVaultState.update((s) => ({ ...s, cacheKey: null }));
  void refreshKeyVaultSecrets(env);
}
