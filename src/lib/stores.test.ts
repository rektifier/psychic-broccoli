import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  workspace,
  selectedLocation,
  tabs,
  activeTabKey,
  currentResponse,
  currentSentRequest,
  envFile,
  userEnvFile,
  activeEnvironment,
  varSourcePrefs,
  keyVaultState,
  pbGlobals,
  pbFileOverrides,
  resolvedEnvVars,
  baseEnvVarsWithSource,
  pinTab,
  activateTab,
  closeTab,
  renameFileInTree,
} from './stores';
import { substituteAll } from './substitution';
import type { FileNode, HttpRequest, KeyVaultState } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRequest(name: string): HttpRequest {
  return {
    id: `req-${name}`,
    name,
    varName: null,
    method: 'GET',
    url: 'https://example.test/' + name,
    headers: [],
    body: '',
    directives: [],
  };
}

function makeFile(path: string, name: string, requestCount = 1): FileNode {
  const requests = Array.from({ length: requestCount }, (_, i) => makeRequest(`${name}-${i}`));
  return {
    type: 'file',
    name,
    path,
    requests,
    variables: [],
    dirty: false,
    savedContent: '',
  };
}

const idleKv: KeyVaultState = { status: 'idle', variables: {}, error: null, cacheKey: null };

function resetStores() {
  workspace.set({ rootPath: null, rootName: 'No folder open', tree: [] });
  selectedLocation.set(null);
  tabs.set([]);
  activeTabKey.set(null);
  currentResponse.set(null);
  currentSentRequest.set(null);
  envFile.set(null);
  userEnvFile.set(null);
  activeEnvironment.set(null);
  varSourcePrefs.set({});
  keyVaultState.set(idleKv);
  pbGlobals.set({});
  pbFileOverrides.set({});
}

beforeEach(resetStores);

// ─── resolvedEnvVars: priority chain ────────────────────────────────────────

describe('resolvedEnvVars priority chain', () => {
  it('resolves $shared as the lowest layer', () => {
    envFile.set({ $shared: { baseUrl: 'https://shared.test' }, dev: {} });
    activeEnvironment.set('dev');
    expect(get(resolvedEnvVars).baseUrl).toBe('https://shared.test');
  });

  it('lets .user $shared override $shared', () => {
    envFile.set({ $shared: { baseUrl: 'https://shared.test' }, dev: {} });
    userEnvFile.set({ $shared: { baseUrl: 'https://user-shared.test' } });
    activeEnvironment.set('dev');
    expect(get(resolvedEnvVars).baseUrl).toBe('https://user-shared.test');
  });

  it('lets env-specific override .user $shared', () => {
    envFile.set({
      $shared: { baseUrl: 'https://shared.test' },
      dev: { baseUrl: 'https://dev.test' },
    });
    userEnvFile.set({ $shared: { baseUrl: 'https://user-shared.test' } });
    activeEnvironment.set('dev');
    expect(get(resolvedEnvVars).baseUrl).toBe('https://dev.test');
  });

  it('lets .user env-specific override env-specific', () => {
    envFile.set({
      $shared: { baseUrl: 'https://shared.test' },
      dev: { baseUrl: 'https://dev.test' },
    });
    userEnvFile.set({
      $shared: { baseUrl: 'https://user-shared.test' },
      dev: { baseUrl: 'https://user-dev.test' },
    });
    activeEnvironment.set('dev');
    expect(get(resolvedEnvVars).baseUrl).toBe('https://user-dev.test');
  });

  it('lets file-level @variables override all environment layers (via substituteAll)', () => {
    envFile.set({ $shared: {}, dev: { baseUrl: 'https://dev.test' } });
    userEnvFile.set({ dev: { baseUrl: 'https://user-dev.test' } });
    activeEnvironment.set('dev');

    const result = substituteAll('{{baseUrl}}/api', {
      fileVariables: [{ key: 'baseUrl', value: 'https://file.test' }],
      environmentVariables: get(resolvedEnvVars),
      namedResults: {},
    });
    expect(result).toBe('https://file.test/api');
  });

  it('returns an empty map when no environment is active', () => {
    envFile.set({ $shared: { baseUrl: 'https://shared.test' }, dev: {} });
    activeEnvironment.set(null);
    expect(get(resolvedEnvVars)).toEqual({});
  });

  it('merges pb globals and file overrides on top of environment variables', () => {
    envFile.set({ $shared: {}, dev: { token: 'env-token', baseUrl: 'https://dev.test' } });
    activeEnvironment.set('dev');
    pbGlobals.set({ token: 'global-token' });
    pbFileOverrides.set({ '/ws/a.http': { token: 'file-token' } });
    selectedLocation.set({ filePath: '/ws/a.http', requestIndex: 0 });

    // File-scoped pb.set overrides win over pb.global, which wins over env
    expect(get(resolvedEnvVars).token).toBe('file-token');
    expect(get(resolvedEnvVars).baseUrl).toBe('https://dev.test');
  });
});

// ─── resolvedEnvVars: varSourcePrefs ────────────────────────────────────────

describe('resolvedEnvVars varSourcePrefs overrides', () => {
  beforeEach(() => {
    envFile.set({
      $shared: { fromShared: 'shared-val' },
      dev: { apiKey: 'env-key' },
    });
    userEnvFile.set({
      $shared: { fromShared: 'user-shared-val' },
      dev: { apiKey: 'user-key' },
    });
    activeEnvironment.set('dev');
  });

  it('prefers the base env value when pref is "local"', () => {
    varSourcePrefs.set({ apiKey: 'local' });
    expect(get(resolvedEnvVars).apiKey).toBe('env-key');
  });

  it('falls back to base $shared when pref is "local" and env has no value', () => {
    varSourcePrefs.set({ fromShared: 'local' });
    expect(get(resolvedEnvVars).fromShared).toBe('shared-val');
  });

  it('keeps the user value when pref is "user-local"', () => {
    varSourcePrefs.set({ apiKey: 'user-local' });
    expect(get(resolvedEnvVars).apiKey).toBe('user-key');
  });

  it('uses the default user-over-base resolution when no pref is set', () => {
    expect(get(resolvedEnvVars).apiKey).toBe('user-key');
    expect(get(resolvedEnvVars).fromShared).toBe('user-shared-val');
  });

  it('remaps the winning source in baseEnvVarsWithSource for "local" prefs', () => {
    varSourcePrefs.set({ apiKey: 'local' });
    const withSource = get(baseEnvVarsWithSource);
    expect(withSource.apiKey.source).toBe('env');
    expect(withSource.apiKey.value).toBe('env-key');
  });
});

// ─── resolvedEnvVars: Key Vault conflicts ───────────────────────────────────

describe('resolvedEnvVars Key Vault conflict preference', () => {
  beforeEach(() => {
    envFile.set({ $shared: {}, dev: { secret: 'env-secret' } });
    activeEnvironment.set('dev');
  });

  function loadKv(vars: Record<string, string>, cacheKey = 'dev::https://vault.test') {
    keyVaultState.set({ status: 'loaded', variables: vars, error: null, cacheKey });
  }

  it('lets Key Vault win a conflict by default', () => {
    loadKv({ secret: 'kv-secret' });
    expect(get(resolvedEnvVars).secret).toBe('kv-secret');
  });

  it('adds non-conflicting Key Vault variables', () => {
    loadKv({ extra: 'kv-extra' });
    expect(get(resolvedEnvVars).extra).toBe('kv-extra');
    expect(get(resolvedEnvVars).secret).toBe('env-secret');
  });

  it('keeps the env value when the user prefers "local"', () => {
    loadKv({ secret: 'kv-secret' });
    varSourcePrefs.set({ secret: 'local' });
    expect(get(resolvedEnvVars).secret).toBe('env-secret');
  });

  it('uses the Key Vault value when the user explicitly prefers "keyvault"', () => {
    loadKv({ secret: 'kv-secret' });
    varSourcePrefs.set({ secret: 'keyvault' });
    expect(get(resolvedEnvVars).secret).toBe('kv-secret');
  });

  it('ignores Key Vault variables cached for a different environment', () => {
    loadKv({ secret: 'kv-secret' }, 'prod::https://vault.test');
    expect(get(resolvedEnvVars).secret).toBe('env-secret');
  });

  it('ignores Key Vault variables while still loading', () => {
    keyVaultState.set({
      status: 'loading',
      variables: { secret: 'kv-secret' },
      error: null,
      cacheKey: 'dev::https://vault.test',
    });
    expect(get(resolvedEnvVars).secret).toBe('env-secret');
  });
});

// ─── Tab lifecycle ──────────────────────────────────────────────────────────

describe('tab lifecycle', () => {
  const locA = { filePath: '/ws/a.http', requestIndex: 0 };
  const locB = { filePath: '/ws/b.http', requestIndex: 0 };
  const locC = { filePath: '/ws/c.http', requestIndex: 0 };

  function pinThree() {
    pinTab(locA, 'A');
    pinTab(locB, 'B');
    pinTab(locC, 'C');
  }

  it('pinTab does not duplicate an already pinned tab', () => {
    pinTab(locA, 'A');
    pinTab(locA, 'A');
    expect(get(tabs)).toHaveLength(1);
  });

  it('closeTab of the active middle tab activates the tab that took its index', () => {
    pinThree();
    activateTab(locB);
    closeTab(locB);
    expect(get(tabs).map((t) => t.label)).toEqual(['A', 'C']);
    expect(get(activeTabKey)).toBe('/ws/c.http::0');
    expect(get(selectedLocation)).toEqual(locC);
  });

  it('closeTab of the active last tab activates the previous tab', () => {
    pinThree();
    activateTab(locC);
    closeTab(locC);
    expect(get(activeTabKey)).toBe('/ws/b.http::0');
    expect(get(selectedLocation)).toEqual(locB);
  });

  it('closeTab of the only tab clears selection and response state', () => {
    pinTab(locA, 'A');
    closeTab(locA);
    expect(get(tabs)).toHaveLength(0);
    expect(get(activeTabKey)).toBeNull();
    expect(get(selectedLocation)).toBeNull();
    expect(get(currentResponse)).toBeNull();
    expect(get(currentSentRequest)).toBeNull();
  });

  it('closeTab of an inactive tab keeps the active tab unchanged', () => {
    pinThree();
    activateTab(locC);
    closeTab(locA);
    expect(get(activeTabKey)).toBe('/ws/c.http::0');
    expect(get(selectedLocation)).toEqual(locC);
  });

  it('closeTab of an unknown location is a no-op', () => {
    pinThree();
    activateTab(locB);
    closeTab({ filePath: '/ws/missing.http', requestIndex: 0 });
    expect(get(tabs)).toHaveLength(3);
    expect(get(activeTabKey)).toBe('/ws/b.http::0');
  });
});

// ─── renameFileInTree ───────────────────────────────────────────────────────

describe('renameFileInTree', () => {
  it('rewrites tab locations, activeTabKey, selection, and the tree node', () => {
    const file = makeFile('/ws/old.http', 'old.http', 2);
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [file] });
    pinTab({ filePath: '/ws/old.http', requestIndex: 0 }, 'req 0');
    pinTab({ filePath: '/ws/old.http', requestIndex: 1 }, 'req 1');
    activateTab({ filePath: '/ws/old.http', requestIndex: 1 });

    renameFileInTree('/ws/old.http', '/ws/new.http', 'new.http');

    expect(get(tabs).map((t) => t.location.filePath)).toEqual(['/ws/new.http', '/ws/new.http']);
    expect(get(activeTabKey)).toBe('/ws/new.http::1');
    expect(get(selectedLocation)).toEqual({ filePath: '/ws/new.http', requestIndex: 1 });

    const tree = get(workspace).tree;
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('/ws/new.http');
    expect(tree[0].name).toBe('new.http');
  });

  it('leaves tabs for other files untouched', () => {
    const fileA = makeFile('/ws/a.http', 'a.http');
    const fileB = makeFile('/ws/b.http', 'b.http');
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [fileA, fileB] });
    pinTab({ filePath: '/ws/a.http', requestIndex: 0 }, 'A');
    pinTab({ filePath: '/ws/b.http', requestIndex: 0 }, 'B');
    activateTab({ filePath: '/ws/a.http', requestIndex: 0 });

    renameFileInTree('/ws/b.http', '/ws/renamed.http', 'renamed.http');

    expect(get(tabs)[0].location.filePath).toBe('/ws/a.http');
    expect(get(tabs)[1].location.filePath).toBe('/ws/renamed.http');
    expect(get(activeTabKey)).toBe('/ws/a.http::0');
    expect(get(selectedLocation)).toEqual({ filePath: '/ws/a.http', requestIndex: 0 });
  });

  it('does not rewrite a file whose path shares a prefix with the renamed file', () => {
    const fileA = makeFile('/ws/api.http', 'api.http');
    const fileB = makeFile('/ws/api-admin.http', 'api-admin.http');
    workspace.set({ rootPath: '/ws', rootName: 'ws', tree: [fileA, fileB] });
    pinTab({ filePath: '/ws/api-admin.http', requestIndex: 0 }, 'admin');

    renameFileInTree('/ws/api.http', '/ws/core.http', 'core.http');

    expect(get(tabs)[0].location.filePath).toBe('/ws/api-admin.http');
    const tree = get(workspace).tree;
    expect(tree[0].path).toBe('/ws/core.http');
    expect(tree[1].path).toBe('/ws/api-admin.http');
  });
});
