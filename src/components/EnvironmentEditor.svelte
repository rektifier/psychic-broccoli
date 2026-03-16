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
    padding: 20px 24px;
    overflow: auto;
  }

  /* Header */
  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .env-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #999;
    flex-shrink: 0;
  }
  .env-dot.active-dot {
    background: #3D8B45;
  }
  .env-name {
    font-size: 18px;
    font-weight: 600;
    color: #1A1A2E;
    background: none;
    border: none;
    border-bottom: 1px dashed transparent;
    padding: 0;
    font-family: inherit;
    cursor: text;
    transition: border-color 0.15s;
  }
  .env-name:hover {
    border-bottom-color: #D4900A;
  }
  .env-name-static {
    font-size: 18px;
    font-weight: 600;
    color: #1A1A2E;
    font-style: italic;
  }
  .rename-input {
    font-size: 18px;
    font-weight: 600;
    color: #1A1A2E;
    background: #FFFFFF;
    border: 1px solid #3D8B45;
    border-radius: 6px;
    padding: 2px 8px;
    outline: none;
    font-family: inherit;
    width: 200px;
  }
  .var-count {
    font-size: 12px;
    color: #888;
    background: #E4E4EA;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .active-badge {
    font-size: 10px;
    color: #3D8B45;
    background: #3D8B4515;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .header-actions {
    display: flex;
    gap: 6px;
  }

  .btn-done {
    padding: 5px 16px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-done:hover {
    border-color: #999;
    color: #333;
  }

  /* Env tabs */
  .env-tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid #DCDCE2;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .env-tab {
    padding: 7px 14px;
    border: none;
    background: transparent;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .env-tab:hover { color: #555; }
  .env-tab.active {
    color: #3D8B45;
    border-bottom-color: #3D8B45;
  }
  .env-tab.shared-tab {
    font-style: italic;
    color: #888;
  }
  .env-tab.shared-tab.active {
    color: #9A7520;
    border-bottom-color: #9A7520;
  }

  /* Column headers */
  .col-headers {
    display: flex;
    gap: 8px;
    padding: 0 0 8px;
    border-bottom: 1px solid #DCDCE2;
    margin-bottom: 8px;
  }
  .col-headers span {
    font-size: 10px;
    color: #999;
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
    gap: 6px;
    flex: 1;
  }
  .var-row {
    display: flex;
    align-items: center;
    gap: 8px;
    transition: opacity 0.15s;
  }
  .var-row.disabled {
    opacity: 0.4;
  }
  .var-check {
    accent-color: #D4900A;
    flex-shrink: 0;
    cursor: pointer;
    width: 14px;
    height: 14px;
  }
  .var-key {
    flex: 1;
    max-width: 220px;
    padding: 8px 10px;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    background: #FFFFFF;
    color: #9A7520;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .var-key:focus { border-color: #B0B0BA; }
  .var-key::placeholder { color: #BBB; }

  .var-value {
    flex: 2;
    padding: 8px 10px;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .var-value:focus { border-color: #B0B0BA; }
  .var-value::placeholder { color: #BBB; }

  .btn-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #AAA;
    font-size: 16px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-remove:hover {
    background: #CC445518;
    color: #CC4455;
  }

  .btn-add-var {
    padding: 8px 14px;
    border: 1px dashed #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    align-self: flex-start;
    margin-top: 4px;
  }
  .btn-add-var:hover {
    border-color: #3D8B45;
    color: #3D8B45;
  }

  /* Footer */
  .editor-footer {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #DCDCE2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  .footer-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .btn-delete-env {
    padding: 5px 12px;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    background: transparent;
    color: #AAA;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-delete-env:hover {
    border-color: #CC4455;
    color: #CC4455;
  }
  .confirm-text {
    font-size: 12px;
    color: #CC4455;
    font-weight: 500;
  }
  .btn-confirm-delete {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: #CC4455;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-confirm-delete:hover {
    background: #B33344;
  }
  .btn-cancel-delete {
    padding: 4px 10px;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    background: transparent;
    color: #777;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-cancel-delete:hover {
    border-color: #999;
    color: #333;
  }
</style>
