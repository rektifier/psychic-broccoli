<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { EnvironmentFile } from '../lib/types';

  export let envFile: EnvironmentFile;
  export let activeEnv: string;

  const dispatch = createEventDispatcher();

  // Local editing state — independent from sidebar's active env
  let editingEnv = activeEnv;

  interface EnvVar {
    key: string;
    value: string;
    enabled: boolean;
  }

  function buildVarList(ef: EnvironmentFile, env: string): EnvVar[] {
    const vars = ef?.[env];
    if (!vars) return [];
    return Object.entries(vars).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      enabled: true,
    }));
  }

  // Local editable array - only rebuilt when switching environments
  let envVars: EnvVar[] = buildVarList(envFile, editingEnv);
  let lastEditingEnv = editingEnv;
  $: if (editingEnv !== lastEditingEnv) {
    envVars = buildVarList(envFile, editingEnv);
    lastEditingEnv = editingEnv;
  }

  // Environments list: $shared first, then the rest
  $: envNames = Object.keys(envFile || {}).filter(k => k !== '$shared');
  $: allTabs = envFile?.['$shared'] !== undefined ? ['$shared', ...envNames] : envNames;

  // Editing state
  let renaming = false;
  let renameValue = '';
  let confirmingDelete = false;

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
    // If the renamed env was the active one, update the sidebar too
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
    // If the deleted env was the active one, update the sidebar too
    if (editingEnv === activeEnv) {
      dispatch('changeEnv', remaining[0] || null);
    }
    editingEnv = remaining[0] || '';
  }

  function updateVariable(index: number, field: 'key' | 'value', newVal: string) {
    envVars = envVars.map((v, i) => i === index ? { ...v, [field]: newVal } : v);
    saveVars(envVars);
  }

  function toggleVariable(index: number) {
    envVars = envVars.map((v, i) => i === index ? { ...v, enabled: !v.enabled } : v);
    saveVars(envVars);
  }

  function removeVariable(index: number) {
    envVars = envVars.filter((_, i) => i !== index);
    saveVars(envVars);
  }

  function addVariable() {
    envVars = [...envVars, { key: '', value: '', enabled: true }];
  }

  function saveVars(vars: EnvVar[]) {
    const updated = { ...envFile };
    const envData: Record<string, string> = {};
    for (const v of vars) {
      if (v.key.trim()) {
        envData[v.key.trim()] = v.value;
      }
    }
    updated[editingEnv] = envData;
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
      <button class="btn-done" on:click={close}>Done</button>
    </div>
  </div>

  <!-- Env tabs -->
  <div class="env-tabs">
    {#each allTabs as env}
      <button
        class="env-tab"
        class:active={env === editingEnv}
        class:shared-tab={env === '$shared'}
        on:click={() => { editingEnv = env; confirmingDelete = false; }}
      >{env}{env === activeEnv ? ' ✓' : ''}</button>
    {/each}
  </div>

  <!-- Column headers -->
  <div class="col-headers">
    <span class="col-check"></span>
    <span class="col-key">Variable</span>
    <span class="col-value">Value</span>
    <span class="col-del"></span>
  </div>

  <!-- Variable rows -->
  <div class="var-rows">
    {#each envVars as v, i}
      <div class="var-row" class:disabled={!v.enabled}>
        <input
          type="checkbox"
          class="var-check"
          checked={v.enabled}
          on:change={() => toggleVariable(i)}
        />
        <input
          class="var-key"
          value={v.key}
          on:input={(e) => updateVariable(i, 'key', e.currentTarget.value)}
          placeholder="variableName"
          spellcheck="false"
        />
        <input
          class="var-value"
          value={v.value}
          on:input={(e) => updateVariable(i, 'value', e.currentTarget.value)}
          placeholder="value"
          spellcheck="false"
        />
        <button class="btn-remove" on:click={() => removeVariable(i)}>×</button>
      </div>
    {/each}

    <button class="btn-add-var" on:click={addVariable}>
      + Add variable
    </button>
  </div>

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
    flex: 2;
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
</style>
