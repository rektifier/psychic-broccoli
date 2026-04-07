<script lang="ts">
  import { createEventDispatcher, tick, onMount } from 'svelte';
  import type { EnvironmentFile, EnvironmentVariables, KeyVaultConfig, KeyVaultState, VarSource } from '../lib/types';
  import { isKeyVaultConfig } from '../lib/keyvault';
  import HelpTip from './HelpTip.svelte';

  export let envFile: EnvironmentFile;
  export let userEnvFile: EnvironmentFile | null = null;
  export let activeEnv: string;
  export let kvState: KeyVaultState;

  const dispatch = createEventDispatcher();

  let showSecrets = false;
  let showKvSetup = false;
  let kvVaultUrl = '';
  let kvSecretName = '';

  function masked(val: string | undefined): string {
    if (!val) return '';
    return '*'.repeat(Math.min(val.length, 12));
  }

  // Local editing state - independent from sidebar's active env
  let editingEnv = activeEnv;

  // ─── Unified grouped variable model ────────────────────────────────────────

  interface VarSourceEntry {
    source: VarSource;
    value: string;
  }

  interface EnvVar {
    key: string;
    enabled: boolean;
    /** Which source is currently active (displayed in the main row). */
    activeSource: VarSource;
    /** All sources where this variable is defined, ordered: local, user-local, keyvault. */
    sources: VarSourceEntry[];
  }

  /** Convenience: get the active value for a grouped variable. */
  function activeValue(v: EnvVar): string {
    return v.sources.find(s => s.source === v.activeSource)?.value ?? '';
  }

  /** Source display label. */
  function sourceLabel(s: VarSource): string {
    switch (s) {
      case 'local': return editingEnv === '$shared' ? 'SHARED' : 'ENV';
      case 'user-local': return 'USER';
      case 'keyvault': return 'KV';
    }
  }

  /** Default priority: KV > user-local > local. */
  function defaultActiveSource(sources: VarSourceEntry[]): VarSource {
    const sourceSet = new Set(sources.map(s => s.source));
    if (sourceSet.has('keyvault')) return 'keyvault';
    if (sourceSet.has('user-local')) return 'user-local';
    return 'local';
  }

  /** Check if an environment has KV access (directly or via $shared). */
  function envHasKv(ef: EnvironmentFile, env: string): boolean {
    return isKeyVaultConfig(ef?.[env]?.$keyvault) || isKeyVaultConfig(ef?.['$shared']?.$keyvault);
  }

  function buildVarList(ef: EnvironmentFile, uef: EnvironmentFile | null, env: string, kv: KeyVaultState): EnvVar[] {
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

  function envFileFingerprint(ef: EnvironmentFile, uef: EnvironmentFile | null, env: string): string {
    const envData = ef?.[env];
    const userData = uef?.[env];
    return (envData ? JSON.stringify(envData) : '') + '|' + (userData ? JSON.stringify(userData) : '');
  }

  // Local editable array - rebuilt when switching environments, KV status changes, or envFile changes externally
  let envVars: EnvVar[] = buildVarList(envFile, userEnvFile, editingEnv, kvState);
  let lastEditingEnv = editingEnv;
  let lastKvStatus = kvState.status;
  let lastEnvFingerprint = envFileFingerprint(envFile, userEnvFile, editingEnv);
  $: {
    const currentFingerprint = envFileFingerprint(envFile, userEnvFile, editingEnv);
    if (
      editingEnv !== lastEditingEnv ||
      kvState.status !== lastKvStatus ||
      currentFingerprint !== lastEnvFingerprint
    ) {
      envVars = buildVarList(envFile, userEnvFile, editingEnv, kvState);
      lastEditingEnv = editingEnv;
      lastKvStatus = kvState.status;
      lastEnvFingerprint = currentFingerprint;
    }
  }

  $: groupedCount = envVars.filter(v => v.sources.length > 1).length;

  // Environments list: $shared first, then the rest (including user-file-only envs)
  $: envNames = [...new Set([
    ...Object.keys(envFile || {}).filter(k => k !== '$shared'),
    ...Object.keys(userEnvFile || {}).filter(k => k !== '$shared'),
  ])];
  $: userOnlyEnvs = new Set(
    Object.keys(userEnvFile || {}).filter(k => k !== '$shared' && !(envFile || {})[k])
  );
  $: hasShared = envFile?.['$shared'] !== undefined || userEnvFile?.['$shared'] !== undefined;
  $: allTabs = hasShared ? ['$shared', ...envNames] : envNames;

  // Track which variable keys have their source group expanded
  let expandedGroups = new Set<string>();

  function toggleGroupExpand(key: string) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
    }
    expandedGroups = expandedGroups; // trigger reactivity
  }

  /** Switch the active source for a grouped variable. */
  function setActiveSource(index: number, newSource: VarSource) {
    const v = envVars[index];
    if (v.activeSource === newSource) return;
    envVars = envVars.map((item, i) => i === index ? { ...item, activeSource: newSource } : item);
    dispatch('sourcePref', { key: v.key, source: newSource });
  }

  // Editing state
  let renaming = false;
  let renameValue = '';
  let confirmingDelete = false;
  let showAddEnv = false;
  let newEnvName = '';
  let addEnvInputEl: HTMLInputElement;

  function addEnvironment() {
    const name = newEnvName.trim();
    if (!name || envFile[name]) return;
    const updated = { ...envFile, [name]: {} };
    dispatch('update', updated);
    dispatch('changeEnv', name);
    editingEnv = name;
    newEnvName = '';
    showAddEnv = false;
  }

  function startRename() {
    renameValue = editingEnv;
    renaming = true;
  }

  function confirmRename() {
    const newName = renameValue.trim();
    if (!newName || newName === editingEnv || envFile[newName]) {
      renaming = false;
      return;
    }
    const updated = { ...envFile };
    updated[newName] = updated[editingEnv];
    delete updated[editingEnv];
    dispatch('update', updated);
    if (editingEnv === activeEnv) {
      dispatch('changeEnv', newName);
    }
    editingEnv = newName;
    renaming = false;
  }

  function deleteEnvironment() {
    if (envNames.length <= 1) return;
    const updated = { ...envFile };
    delete updated[editingEnv];
    dispatch('update', updated);
    const remaining = Object.keys(updated).filter(k => k !== '$shared');
    if (editingEnv === activeEnv) {
      dispatch('changeEnv', remaining[0] || null);
    }
    editingEnv = remaining[0] || '';
  }

  function updateLocalValue(index: number, field: 'key' | 'value', newVal: string) {
    envVars = envVars.map((v, i) => {
      if (i !== index) return v;
      if (field === 'key') return { ...v, key: newVal };
      // Update value in the 'local' source entry
      return {
        ...v,
        sources: v.sources.map(s => s.source === 'local' ? { ...s, value: newVal } : s),
      };
    });
    saveVars();
  }

  function toggleVariable(index: number) {
    envVars = envVars.map((v, i) => i === index ? { ...v, enabled: !v.enabled } : v);
    saveVars();
  }

  function removeVariable(index: number) {
    envVars = envVars.filter((_, i) => i !== index);
    saveVars();
  }

  function addVariable() {
    envVars = [...envVars, {
      key: '',
      enabled: true,
      activeSource: 'local',
      sources: [{ source: 'local', value: '' }],
    }];
  }

  onMount(async () => {
    if (envVars.length === 0) {
      addVariable();
      await tick();
      const input = document.querySelector('.env-editor .var-key') as HTMLInputElement | null;
      input?.focus();
    }
  });

  function saveVars() {
    const updated = { ...envFile };
    const envData: EnvironmentVariables = {} as EnvironmentVariables;
    // Preserve $keyvault config if it exists
    const existing = envFile[editingEnv];
    if (existing?.$keyvault) {
      envData.$keyvault = existing.$keyvault;
    }
    for (const v of envVars) {
      const localEntry = v.sources.find(s => s.source === 'local');
      if (localEntry && v.key.trim()) {
        envData[v.key.trim()] = localEntry.value;
      }
    }
    updated[editingEnv] = envData;
    dispatch('update', updated);
  }

  // ─── Key Vault config ───

  $: kvConfig = envFile?.[editingEnv]?.$keyvault ?? null;
  $: kvConnected = kvConfig && kvState.status === 'loaded' && kvState.cacheKey?.startsWith(editingEnv + '::');

  // Sync local inputs when switching envs or when config changes externally
  let lastKvConfigEnv = editingEnv;
  $: {
    if (editingEnv !== lastKvConfigEnv) {
      const cfg = envFile?.[editingEnv]?.$keyvault;
      kvVaultUrl = cfg?.vaultUrl ?? '';
      kvSecretName = cfg?.secretName ?? '';
      showKvSetup = !!cfg;
      lastKvConfigEnv = editingEnv;
    }
  }

  // Also sync when kvConfig appears externally (e.g. file reload)
  $: if (kvConfig) {
    kvVaultUrl = kvConfig.vaultUrl;
    kvSecretName = kvConfig.secretName;
    showKvSetup = true;
  }

  function saveKvConfig() {
    const url = kvVaultUrl.trim();
    const name = kvSecretName.trim();
    if (!url || !name) return;

    const config: KeyVaultConfig = {
      provider: 'AzureKeyVault',
      vaultUrl: url,
      secretName: name,
    };
    const updated = { ...envFile };
    updated[editingEnv] = { ...updated[editingEnv], $keyvault: config };
    dispatch('update', updated);
    dispatch('refreshKv', editingEnv);
  }

  function removeKvConfig() {
    const updated = { ...envFile };
    const env = { ...updated[editingEnv] };
    delete env.$keyvault;
    updated[editingEnv] = env;
    showKvSetup = false;
    kvVaultUrl = '';
    kvSecretName = '';
    dispatch('update', updated);
  }

  function close() {
    dispatch('close');
  }
</script>

<div class="env-editor">
  <!-- Header -->
  <div class="editor-header">
    <div class="header-left">
      <span class="env-dot" class:active-dot={editingEnv === activeEnv}></span>
      {#if renaming}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename-input"
          bind:value={renameValue}
          on:keydown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') { renaming = false; } }}
          on:blur={confirmRename}
          autofocus
        />
      {:else if editingEnv === '$shared'}
        <span class="env-name-static">{editingEnv}</span>
      {:else}
        <button class="env-name" on:click={startRename} title="Click to rename">{editingEnv}</button>
      {/if}
      <span class="var-count">{envVars.length} variable{envVars.length !== 1 ? 's' : ''}</span>
      {#if editingEnv === activeEnv}
        <span class="active-badge">active</span>
      {/if}
    </div>
    <div class="header-actions">
      {#if kvConfig && (kvState.status === 'loaded' || kvState.status === 'error')}
        <button
          class="btn-toggle-secrets"
          on:click={() => showSecrets = !showSecrets}
          title={showSecrets ? 'Hide secret values' : 'Show secret values'}
        >{showSecrets ? '[Hide secrets]' : '[Show secrets]'}</button>
      {/if}
      <button class="btn-done" on:click={close}>Close</button>
    </div>
  </div>

  <!-- Env tabs -->
  <div class="env-tabs">
    {#each allTabs as env}
      <button
        class="env-tab"
        class:active={env === editingEnv}
        class:shared-tab={env === '$shared'}
        class:user-only-tab={userOnlyEnvs.has(env)}
        on:click={() => { editingEnv = env; confirmingDelete = false; }}
        title={userOnlyEnvs.has(env) ? 'Defined only in .user file' : ''}
      >{env}{env === activeEnv ? ' \u2713' : ''}{userOnlyEnvs.has(env) ? ' \u00B7' : ''}</button>
    {/each}
    {#if showAddEnv}
      <div class="add-env-inline">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:this={addEnvInputEl}
          bind:value={newEnvName}
          on:keydown={(e) => { if (e.key === 'Enter') addEnvironment(); if (e.key === 'Escape') { showAddEnv = false; newEnvName = ''; } }}
          on:blur={() => { if (!newEnvName.trim()) { showAddEnv = false; } }}
          placeholder="Name..."
          class="add-env-inline-input"
          autofocus
        />
        <button class="btn-confirm-add-env" on:click={addEnvironment}>Add</button>
      </div>
    {:else}
      <button class="btn-add-env-tab" on:click={() => { showAddEnv = true; }} title="Add environment">+ Add environment</button>
    {/if}
  </div>

  <!-- Column headers -->
  <div class="col-headers">
    <span class="col-check"></span>
    <span class="col-key">Variable</span>
    <span class="col-value">Value</span>
    <span class="col-del"></span>
  </div>

  {#if kvState.status === 'loading'}
    <div class="kv-status kv-loading">Loading Key Vault secrets...</div>
  {:else if kvState.status === 'error'}
    <div class="kv-status kv-error">
      Key Vault error: {kvState.error}
      <button class="btn-kv-retry" on:click={() => dispatch('refreshKv', editingEnv)}>Retry</button>
    </div>
  {/if}

  {#if groupedCount > 0}
    <div class="grouped-banner">
      {groupedCount} variable{groupedCount !== 1 ? 's' : ''} defined in multiple sources. Highest-priority source is active by default.
    </div>
  {/if}

  <!-- Variable rows -->
  <div class="var-rows">
    {#each envVars as v, i}
      {@const isGrouped = v.sources.length > 1}
      {@const isExpanded = expandedGroups.has(v.key)}
      {@const isKvActive = v.activeSource === 'keyvault'}
      {@const isLocalActive = v.activeSource === 'local'}
      {@const hasLocal = v.sources.some(s => s.source === 'local')}
      <div class="var-row-wrapper">
        <!-- Main row: shows the active source's value -->
        <div class="var-row" class:disabled={!v.enabled} class:grouped-row={isGrouped}>
          <input
            type="checkbox"
            class="var-check"
            checked={v.enabled}
            on:change={() => toggleVariable(i)}
          />

          <input
            class="var-key"
            value={v.key}
            on:input={(e) => updateLocalValue(i, 'key', e.currentTarget.value)}
            placeholder="variableName"
            spellcheck="false"
            disabled={!hasLocal}
          />

          <div class="var-value-cell">
            <div class="var-value-row">
              <input
                class="var-value"
                value={isKvActive ? (showSecrets ? activeValue(v) : masked(activeValue(v))) : activeValue(v)}
                on:input={(e) => { if (isLocalActive && hasLocal) updateLocalValue(i, 'value', e.currentTarget.value); }}
                placeholder="value"
                spellcheck="false"
                disabled={!isLocalActive}
              />
              <span class="source-badge source-badge-{v.activeSource}">{sourceLabel(v.activeSource)}</span>
              {#if isGrouped}
                <button
                  class="btn-group-chevron"
                  class:open={isExpanded}
                  on:click={() => toggleGroupExpand(v.key)}
                  title="{v.sources.length} sources"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              {/if}
            </div>
          </div>

          {#if hasLocal && !isGrouped}
            <button class="btn-remove" on:click={() => removeVariable(i)}>x</button>
          {:else}
            <div class="btn-remove-placeholder"></div>
          {/if}
        </div>

        <!-- Expanded group: shows all other (inactive) sources -->
        {#if isGrouped && isExpanded}
          <div class="group-detail">
            {#each v.sources as entry}
              {#if entry.source !== v.activeSource}
                <div class="group-detail-row">
                  <input
                    type="checkbox"
                    class="var-check"
                    checked={false}
                    on:change={() => setActiveSource(i, entry.source)}
                    title="Switch to {sourceLabel(entry.source)} value"
                  />
                  <span class="source-tag source-tag-{entry.source}">{sourceLabel(entry.source)}</span>
                  <input
                    class="var-value group-inactive-value"
                    value={entry.source === 'keyvault' ? (showSecrets ? entry.value : masked(entry.value)) : entry.value}
                    on:input={(e) => {
                      if (entry.source === 'local') {
                        envVars = envVars.map((item, idx) => {
                          if (idx !== i) return item;
                          return { ...item, sources: item.sources.map(s => s.source === 'local' ? { ...s, value: e.currentTarget.value } : s) };
                        });
                        saveVars();
                      }
                    }}
                    spellcheck="false"
                    disabled={entry.source !== 'local'}
                  />
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    <button class="btn-add-var" on:click={addVariable}>
      + Add variable
    </button>
  </div>

  <!-- Key Vault config -->
  {#if showKvSetup || kvConfig}
    <div class="kv-setup">
      <div class="kv-setup-header">
        <span class="kv-setup-title">Azure Key Vault</span>
        <HelpTip
          label="Azure Key Vault"
          text="Requires Azure CLI (az login) or Azure Developer CLI (azd auth login). The vault URL should point to an existing Key Vault instance that your account has Secret read permissions on."
        />
        {#if kvConnected}
          <span class="kv-connected-badge">connected</span>
        {:else if kvConfig}
          <span class="kv-configured-badge">configured</span>
        {/if}
      </div>
      <div class="kv-setup-fields">
        <label class="kv-field">
          <span class="kv-field-label">Vault URL</span>
          <input
            class="kv-field-input"
            bind:value={kvVaultUrl}
            placeholder="https://my-vault.vault.azure.net"
            spellcheck="false"
          />
        </label>
        <label class="kv-field">
          <span class="kv-field-label">Secret name</span>
          <input
            class="kv-field-input"
            bind:value={kvSecretName}
            placeholder="my-secret"
            spellcheck="false"
          />
        </label>
      </div>
      <div class="kv-setup-actions">
        <button
          class="btn-kv-connect"
          on:click={saveKvConfig}
          disabled={!kvVaultUrl.trim() || !kvSecretName.trim()}
        >{kvConfig ? 'Save & refresh' : 'Connect'}</button>
        {#if kvConfig}
          <button class="btn-kv-disconnect" on:click={removeKvConfig}>Disconnect</button>
        {:else}
          <button class="btn-kv-cancel" on:click={() => { showKvSetup = false; kvVaultUrl = ''; kvSecretName = ''; }}>Cancel</button>
        {/if}
      </div>
    </div>
  {:else}
    <button class="btn-kv-add" on:click={() => showKvSetup = true}>
      + Connect to Azure Key Vault
    </button>
  {/if}

  <!-- Footer -->
  <div class="editor-footer">
    <div class="footer-left">
      {#if envNames.length > 1 && editingEnv !== '$shared'}
        {#if confirmingDelete}
          <span class="confirm-text">Delete "{editingEnv}"?</span>
          <button class="btn-confirm-delete" on:click={() => { deleteEnvironment(); confirmingDelete = false; }}>Yes, delete</button>
          <button class="btn-cancel-delete" on:click={() => confirmingDelete = false}>Cancel</button>
        {:else}
          <button class="btn-delete-env" on:click={() => confirmingDelete = true}>Delete environment</button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .env-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-5) var(--space-6);
    overflow: auto;
  }

  /* Header */
  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-2\.5);
  }
  .env-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-text-faint);
    flex-shrink: 0;
  }
  .env-dot.active-dot {
    background: var(--color-success);
  }
  .env-name {
    font-size: 18px;
    font-weight: var(--weight-semibold);
    color: var(--color-text-heading);
    background: none;
    border: none;
    border-bottom: 1px dashed transparent;
    padding: 0;
    font-family: inherit;
    cursor: text;
    transition: border-color var(--duration-normal);
  }
  .env-name:hover {
    border-bottom-color: var(--color-primary);
  }
  .env-name-static {
    font-size: 18px;
    font-weight: var(--weight-semibold);
    color: var(--color-text-heading);
    font-style: italic;
  }
  .rename-input {
    font-size: 18px;
    font-weight: var(--weight-semibold);
    color: var(--color-text-heading);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-success);
    border-radius: var(--radius-default);
    padding: 2px var(--space-2);
    outline: none;
    font-family: inherit;
    width: 200px;
  }
  .var-count {
    font-size: var(--text-base);
    color: var(--slate-350);
    background: var(--color-bg-muted);
    padding: 2px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .active-badge {
    font-size: var(--text-xs);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    padding: 2px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .header-actions {
    display: flex;
    gap: var(--space-1\.5);
  }

  .btn-done {
    padding: 5px var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-done:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }

  /* Env tabs */
  .env-tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--color-divider);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }
  .env-tab {
    padding: 7px var(--space-3\.5);
    border: none;
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all var(--duration-normal);
    white-space: nowrap;
  }
  .env-tab:hover { color: var(--color-text-secondary); }
  .env-tab.active {
    color: var(--color-success);
    border-bottom-color: var(--color-success);
  }
  .env-tab.shared-tab {
    font-style: italic;
    color: var(--slate-350);
  }
  .env-tab.shared-tab.active {
    color: var(--color-warning);
    border-bottom-color: var(--color-warning);
  }

  /* Add environment (inline in tabs) */
  .btn-add-env-tab {
    padding: 7px var(--space-3\.5);
    border: 1px dashed var(--color-border);
    border-bottom: 2px solid transparent;
    border-radius: var(--radius-default) var(--radius-default) 0 0;
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    margin-bottom: -1px;
    transition: all var(--duration-normal);
    white-space: nowrap;
  }
  .btn-add-env-tab:hover {
    color: var(--color-success);
    border-color: var(--color-success);
    border-bottom-color: transparent;
    background: color-mix(in srgb, var(--color-success) 4%, transparent);
  }
  .add-env-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: -1px;
    padding: 2px 0;
  }
  .add-env-inline-input {
    width: 120px;
    padding: 4px var(--space-2);
    border: 1px solid var(--color-success);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-sm);
    outline: none;
  }
  .btn-confirm-add-env {
    padding: 4px var(--space-2\.5);
    border: 1px solid var(--color-success);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-success);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-confirm-add-env:hover {
    background: color-mix(in srgb, var(--color-success) 10%, transparent);
  }

  /* Key Vault setup */
  .btn-kv-add {
    padding: var(--space-2) var(--space-3\.5);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
    align-self: flex-start;
    margin-bottom: var(--space-4);
  }
  .btn-kv-add:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .kv-setup {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
    background: color-mix(in srgb, var(--color-primary) 3%, transparent);
  }
  .kv-setup-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .kv-setup-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text-secondary);
    letter-spacing: 0.3px;
  }
  .kv-connected-badge {
    font-size: var(--text-xs);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    padding: 1px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .kv-configured-badge {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    background: color-mix(in srgb, var(--color-text-faint) 8%, transparent);
    padding: 1px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .kv-setup-fields {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .kv-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kv-field-label {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .kv-field-input {
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-md);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .kv-field-input:focus {
    border-color: var(--color-primary);
  }
  .kv-field-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .kv-setup-actions {
    display: flex;
    gap: var(--space-2);
  }
  .btn-kv-connect {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-default);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-connect:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
  .btn-kv-connect:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-kv-disconnect {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-error);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-disconnect:hover {
    border-color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
  }
  .btn-kv-cancel {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-cancel:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }

  /* Column headers */
  .col-headers {
    display: flex;
    gap: var(--space-2);
    padding: 0 0 var(--space-2);
    border-bottom: 1px solid var(--color-divider);
    margin-bottom: var(--space-2);
  }
  .col-headers span {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .col-check { width: 18px; flex-shrink: 0; }
  .col-key { flex: 1; max-width: 220px; }
  .col-value { flex: 2; }
  .col-del { width: 28px; flex-shrink: 0; }

  /* Key Vault status */
  .kv-status {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-default);
    font-size: var(--text-sm);
    margin-bottom: var(--space-3);
  }
  .kv-loading {
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-primary);
  }
  .kv-error {
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
    color: var(--color-error);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .btn-kv-retry {
    padding: 2px var(--space-2);
    border: 1px solid var(--color-error);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-error);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .btn-kv-retry:hover {
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
  }

  /* (Conflict banner replaced by unified grouped-banner) */

  /* Variable rows */
  .var-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1\.5);
    flex: 1;
  }
  .var-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    transition: opacity var(--duration-normal);
  }
  .var-row.disabled {
    opacity: 0.4;
  }
  .var-check {
    accent-color: var(--color-primary);
    flex-shrink: 0;
    cursor: pointer;
    width: var(--space-3\.5);
    height: var(--space-3\.5);
  }
  .var-key {
    flex: 1;
    max-width: 220px;
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-warning);
    font-family: inherit;
    font-size: var(--text-md);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .var-key:focus { border-color: #B0B0BA; }
  .var-key::placeholder { color: var(--color-text-placeholder); }

  .var-value {
    flex: 1;
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-md);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .var-value:focus { border-color: #B0B0BA; }
  .var-value::placeholder { color: var(--color-text-placeholder); }

  /* Grouped variable system */
  .var-row-wrapper {
    display: flex;
    flex-direction: column;
  }
  .var-row.grouped-row {
    border-left: 3px solid var(--color-primary);
    padding-left: var(--space-1\.5);
    margin-left: -3px;
  }

  /* Source badges (main row) */
  .source-badge {
    padding: 1px 5px;
    border-radius: var(--radius-default);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.5px;
    flex-shrink: 0;
    cursor: default;
  }
  .source-badge-local {
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    color: var(--color-success);
  }
  .source-badge-user-local {
    background: color-mix(in srgb, var(--purple-600) 12%, transparent);
    color: var(--purple-600);
  }
  .source-badge-keyvault {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }

  /* Source tags (expanded detail rows) */
  .source-tag {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
    min-width: 36px;
    text-align: center;
  }
  .source-tag-local {
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
  }
  .source-tag-user-local {
    color: var(--purple-600);
    background: color-mix(in srgb, var(--purple-600) 8%, transparent);
  }
  .source-tag-keyvault {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .btn-group-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform var(--duration-normal), color var(--duration-fast);
  }
  .btn-group-chevron:hover { color: var(--color-primary); }
  .btn-group-chevron.open { transform: rotate(90deg); }

  .group-detail {
    margin-left: 22px;
    padding: var(--space-1) 0 var(--space-1\.5) var(--space-2\.5);
    border-left: 2px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .group-detail-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .group-inactive-value {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .group-inactive-value:focus {
    text-decoration: none;
    opacity: 1;
  }

  .grouped-banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-default);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    color: var(--color-info);
    font-size: var(--text-sm);
    margin-bottom: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-primary) 15%, transparent);
  }

  .env-tab.user-only-tab {
    font-style: italic;
    color: var(--purple-600);
  }
  .env-tab.user-only-tab.active {
    color: var(--purple-600);
    border-bottom-color: var(--purple-600);
  }

  /* (KV badge and KV row styling replaced by unified source-badge system) */

  /* Value cell layout for badge + subline */
  .var-value-cell {
    flex: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .var-value-row {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
  }
  .var-value-cell .var-value {
    flex: 1;
  }

  /* KV subline showing vault value */

  /* Refresh KV button */

  /* Placeholder for removed delete button on KV rows */
  .btn-remove-placeholder {
    width: 28px;
    flex-shrink: 0;
  }

  .btn-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--zinc-300);
    font-size: var(--text-xl);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-remove:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }

  .btn-add-var {
    padding: var(--space-2) var(--space-3\.5);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition: all var(--duration-normal);
    align-self: flex-start;
    margin-top: var(--space-1);
  }
  .btn-add-var:hover {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  /* Footer */
  .editor-footer {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
  }
  .footer-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .btn-delete-env {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--zinc-300);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-delete-env:hover {
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .confirm-text {
    font-size: var(--text-base);
    color: var(--color-error);
    font-weight: var(--weight-medium);
  }
  .btn-confirm-delete {
    padding: var(--space-1) var(--space-2\.5);
    border: none;
    border-radius: var(--radius-default);
    background: var(--color-error);
    color: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: background var(--duration-normal);
  }
  .btn-confirm-delete:hover {
    background: #B33344;
  }
  .btn-cancel-delete {
    padding: var(--space-1) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-cancel-delete:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }

  .btn-toggle-secrets {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-toggle-secrets:hover {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }
</style>
