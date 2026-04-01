<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import TreeNode from './TreeNode.svelte';
  import type { TreeNode as TNode, RequestLocation, FlowDefinition } from '../lib/types';
  import { getAllFileNodes } from '../lib/parser';

  export let tree: TNode[] = [];
  export let selected: RequestLocation | null = null;
  export let rootName: string = 'Workspace';
  export let hasWorkspace: boolean = false;

  // Environment props
  export let environments: string[] = [];
  export let activeEnv: string | null = null;

  // Flow props
  export let flows: Record<string, FlowDefinition> = {};
  export let activeFlowPath: string | null = null;

  const dispatch = createEventDispatcher();

  let displayMode: 'name' | 'url' = 'name';
  let flowsExpanded = false;
  let showNewFlow = false;
  let newFlowName = '';
  let newFlowInputEl: HTMLInputElement;
  let confirmDeleteFlow: string | null = null;
  let sortByUrl = false;
  let showAddEnv = false;
  let newEnvName = '';
  let inputEl: HTMLInputElement;

  function addEnvironment() {
    const name = newEnvName.trim();
    if (!name) return;
    dispatch('addEnv', name);
    newEnvName = '';
    showAddEnv = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addEnvironment();
    if (e.key === 'Escape') showAddEnv = false;
  }

  $: usedNames = getAllFileNodes(tree)
    .flatMap(f => f.requests)
    .map(r => r.varName)
    .filter((n): n is string => !!n);

  $: if (showAddEnv && inputEl) inputEl.focus();
  $: if (showNewFlow && newFlowInputEl) newFlowInputEl.focus();

  $: flowEntries = Object.entries(flows).sort(([, a], [, b]) => a.name.localeCompare(b.name));

  function addFlow() {
    const name = newFlowName.trim();
    if (!name) return;
    dispatch('createFlow', name);
    newFlowName = '';
    showNewFlow = false;
  }

  function handleFlowKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addFlow();
    if (e.key === 'Escape') showNewFlow = false;
  }
</script>

<aside class="tree-sidebar">
  <!-- Root folder button -->
  <div class="section root-section">
    <div class="root-row">
      <button class="root-btn" on:click={() => dispatch('openFolder')} title="Open folder">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 13V3a1 1 0 011-1h4l2 2h4a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span class="root-name">{rootName}</span>
      </button>
      <button
        class="btn-import"
        class:disabled={!hasWorkspace}
        on:click={() => { if (hasWorkspace) dispatch('importCollection'); }}
        title={hasWorkspace ? 'Import collection' : 'Open a folder before importing'}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v8M5 7l3 3 3-3M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Environment selector -->
  <div class="section env-section">
    <div class="env-row">
      <span class="env-dot"></span>
      <select
        class="env-select"
        value={activeEnv ?? ''}
        on:change={(e) => dispatch('changeEnv', e.currentTarget.value || null)}
      >
        {#each environments as env}
          <option value={env}>{env}</option>
        {/each}
      </select>
      <button
        class="btn-add-env"
        on:click={() => { showAddEnv = !showAddEnv; }}
        title="Add environment"
      >+</button>
      <button
        class="btn-edit-env"
        on:click={() => dispatch('editEnv')}
        title="Edit environment variables"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M6.9 1.7a1.1 1.1 0 012.2 0l.15.9a.7.7 0 00.46.5l.22.08a.7.7 0 00.67-.07l.76-.52a1.1 1.1 0 011.55 1.56l-.52.75a.7.7 0 00-.07.68l.08.22a.7.7 0 00.5.45l.9.16a1.1 1.1 0 010 2.2l-.9.15a.7.7 0 00-.5.46l-.08.22a.7.7 0 00.07.67l.52.76a1.1 1.1 0 01-1.56 1.55l-.75-.52a.7.7 0 00-.68-.07l-.22.08a.7.7 0 00-.45.5l-.16.9a1.1 1.1 0 01-2.2 0l-.15-.9a.7.7 0 00-.46-.5l-.22-.08a.7.7 0 00-.67.07l-.76.52a1.1 1.1 0 01-1.55-1.56l.52-.75a.7.7 0 00.07-.68l-.08-.22a.7.7 0 00-.5-.45l-.9-.16a1.1 1.1 0 010-2.2l.9-.15a.7.7 0 00.5-.46l.08-.22a.7.7 0 00-.07-.67l-.52-.76A1.1 1.1 0 014.4 2.56l.75.52a.7.7 0 00.68.07l.22-.08a.7.7 0 00.45-.5l.16-.9z" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
      <button
        class="btn-edit-env"
        on:click={() => dispatch('openVarInspector')}
        title="Variable inspector"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <text x="1" y="12" font-size="11" font-weight="700" fill="currentColor" font-family="system-ui">x</text>
          <path d="M9 3h5M9 8h5M9 13h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    {#if showAddEnv}
      <div class="add-env-form">
        <input
          bind:this={inputEl}
          bind:value={newEnvName}
          on:keydown={handleKeydown}
          placeholder="Environment name..."
          class="add-env-input"
        />
        <button class="btn-confirm-env" on:click={addEnvironment}>Add</button>
      </div>
    {/if}
  </div>

  <!-- Test Flows -->
  {#if tree.length > 0}
    <div class="section flow-section">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flow-header" on:click={(e) => { if ((e.target as HTMLElement).closest('.btn-new-flow')) return; flowsExpanded = !flowsExpanded; }} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flowsExpanded = !flowsExpanded; } }}>
        <span class="chevron" class:open={flowsExpanded}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <svg class="flow-icon" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.1"/>
          <path d="M6 4.5h4M11.5 6v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span class="flow-label">Test Flows</span>
        <span class="flow-count">{flowEntries.length}</span>
        <button
          class="btn-new-flow"
          on:click|stopPropagation={() => { showNewFlow = !showNewFlow; flowsExpanded = true; }}
          title="New test flow"
        >+</button>
      </div>

      {#if flowsExpanded}
        {#if showNewFlow}
          <div class="new-flow-form">
            <input
              bind:this={newFlowInputEl}
              bind:value={newFlowName}
              on:keydown={handleFlowKeydown}
              placeholder="Flow name..."
              class="new-flow-input"
            />
            <button class="btn-confirm-flow" on:click={addFlow}>Add</button>
          </div>
        {/if}

        {#each flowEntries as [path, flow]}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flow-item"
            class:active={activeFlowPath === path}
            on:click={() => dispatch('openFlow', path)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch('openFlow', path); } }}
            role="button"
            tabindex="0"
            title={flow.description || flow.name}
          >
            <span class="flow-item-name">{flow.name}</span>
            {#if confirmDeleteFlow === path}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="flow-confirm-delete" on:click|stopPropagation on:keydown|stopPropagation>
                <button class="flow-del-yes" on:click|stopPropagation={() => { dispatch('deleteFlow', path); confirmDeleteFlow = null; }}>Del</button>
                <button class="flow-del-no" on:click|stopPropagation={() => confirmDeleteFlow = null}>No</button>
              </span>
            {:else}
              <button
                class="btn-dup-flow"
                on:click|stopPropagation={() => dispatch('duplicateFlow', path)}
                title="Duplicate flow"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                  <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3"/>
                </svg>
              </button>
              <button
                class="btn-del-flow"
                on:click|stopPropagation={() => confirmDeleteFlow = path}
                title="Delete flow"
              >&times;</button>
            {/if}
          </div>
        {/each}

        {#if flowEntries.length === 0 && !showNewFlow}
          <span class="flow-empty">No flows yet</span>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Tree -->
  <div class="tree-toolbar">
    <button
      class="btn-display-mode"
      class:active={sortByUrl}
      on:click={() => sortByUrl = !sortByUrl}
      title={sortByUrl ? 'Show original order' : 'Sort by URL'}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <text x="0" y="7" font-size="6" font-weight="700" fill="currentColor" font-family="system-ui">A</text>
        <text x="0" y="14" font-size="6" font-weight="700" fill="currentColor" font-family="system-ui">Z</text>
        <path d="M10 3v10M8 11l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button
      class="btn-display-mode"
      on:click={() => displayMode = displayMode === 'name' ? 'url' : 'name'}
      title={displayMode === 'name' ? 'Show URL paths' : 'Show request names'}
    >
      {#if displayMode === 'name'}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      {:else}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M5 3l6 0M3 7h10M7 11h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M1.5 3h1M1.5 7h1M1.5 11h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      {/if}
    </button>
  </div>
  <div class="tree-scroll">
    {#if tree.length === 0}
      <div class="empty-tree">
        <span class="empty-icon">📂</span>
        <span class="empty-text">Open a folder to browse .http files</span>
        <button class="btn-open" on:click={() => dispatch('openFolder')}>Open Folder</button>
      </div>
    {:else}
      {#each tree as node}
        <TreeNode
          {node}
          {selected}
          depth={0}
          {displayMode}
          {sortByUrl}
          {usedNames}
          on:toggleFolder
          on:select
          on:pinRequest
          on:addRequest
          on:deleteRequest
          on:nameRequest
        />
      {/each}
    {/if}
  </div>
  <div class="sidebar-footer">
    <button class="btn-help" on:click={() => dispatch('openHelp')} title="Help and keyboard shortcuts">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/>
        <path d="M6.5 6.2a1.5 1.5 0 012.8.8c0 1-1.3 1.2-1.3 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="8" cy="11.5" r="0.6" fill="currentColor"/>
      </svg>
      <span>Help</span>
    </button>
  </div>
</aside>

<style>
  .tree-sidebar {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .section {
    padding: 10px 12px;
    flex-shrink: 0;
  }
  .root-section {
    padding-bottom: 0;
  }
  .env-section {
    padding-top: 8px;
    border-bottom: 1px solid #DCDCE2;
  }

  .root-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .root-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }
  .root-btn:hover { border-color: #D4900A; color: #D4900A; }
  .root-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }

  .btn-import {
    width: 30px; height: 30px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #888;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
  }
  .btn-import:hover {
    border-color: #D4900A; color: #D4900A; background: #D4900A10;
  }
  .btn-import.disabled {
    opacity: 0.35;
    cursor: default;
  }
  .btn-import.disabled:hover {
    border-color: #D4D4D8; color: #888; background: transparent;
  }

  /* Environment */
  .env-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .env-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #3D8B45;
    flex-shrink: 0;
  }
  .env-select {
    flex: 1;
    padding: 5px 24px 5px 8px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #3D8B45;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    transition: border-color 0.15s;
  }
  .env-select:hover { border-color: #3D8B45; }
  .env-select option { background: #FFFFFF; color: #333340; }

  .btn-add-env {
    width: 26px; height: 26px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #888;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-add-env:hover { border-color: #3D8B45; color: #3D8B45; background: #3D8B4510; }

  .btn-edit-env {
    width: 26px; height: 26px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #999;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
  }
  .btn-edit-env:hover { border-color: #D4900A; color: #D4900A; background: #D4900A10; }

  .add-env-form {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .add-env-input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 11px;
    outline: none;
  }
  .add-env-input:focus { border-color: #3D8B45; }
  .btn-confirm-env {
    padding: 5px 10px;
    border: none;
    border-radius: 6px;
    background: #3D8B4518;
    color: #3D8B45;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  /* Test Flows */
  .flow-section {
    padding: 0;
    border-bottom: 1px solid #DCDCE2;
  }
  .flow-header {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: transparent;
    color: #555;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background 0.1s;
  }
  .flow-header:hover {
    background: #F0F0F4;
  }
  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: #999;
    transition: transform 0.15s;
    transform: rotate(0deg);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .flow-icon {
    color: #8040A8;
    flex-shrink: 0;
  }
  .flow-label {
    flex: 1;
    min-width: 0;
  }
  .flow-count {
    font-size: 10px;
    color: #999;
    font-weight: 400;
    flex-shrink: 0;
  }
  .btn-new-flow {
    width: 20px; height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .btn-new-flow:hover {
    background: #8040A818;
    color: #8040A8;
  }
  .new-flow-form {
    display: flex;
    gap: 4px;
    padding: 4px 12px 6px 32px;
  }
  .new-flow-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #D4D4D8;
    border-radius: 4px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 11px;
    outline: none;
    min-width: 0;
  }
  .new-flow-input:focus {
    border-color: #8040A8;
  }
  .btn-confirm-flow {
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    background: #8040A818;
    color: #8040A8;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .flow-item {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 12px 5px 32px;
    border: none;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    position: relative;
  }
  .flow-item:hover {
    background: #E4E4EA;
    color: #333;
  }
  .flow-item.active {
    background: #E8E0F0;
    color: #1A1A2E;
  }
  .flow-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: #8040A8;
    border-radius: 0 2px 2px 0;
  }
  .flow-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .btn-dup-flow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px; height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
    padding: 0;
  }
  .flow-item:hover .btn-dup-flow {
    visibility: visible;
  }
  .btn-dup-flow:hover {
    background: #8040A818;
    color: #8040A8;
  }
  .btn-del-flow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px; height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999;
    font-size: 14px;
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
  }
  .flow-item:hover .btn-del-flow {
    visibility: visible;
  }
  .btn-del-flow:hover {
    background: #CC445518;
    color: #CC4455;
  }
  .flow-confirm-delete {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .flow-del-yes {
    padding: 1px 5px;
    border: none;
    border-radius: 3px;
    background: #CC4455;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .flow-del-no {
    padding: 1px 5px;
    border: 1px solid #DCDCE2;
    border-radius: 3px;
    background: transparent;
    color: #777;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .flow-empty {
    display: block;
    padding: 4px 12px 8px 32px;
    font-size: 11px;
    color: #AAA;
  }

  /* Tree */
  .tree-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 12px 0;
    flex-shrink: 0;
  }
  .btn-display-mode {
    width: 24px; height: 24px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #999;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s;
  }
  .btn-display-mode:hover {
    border-color: #D4D4D8;
    color: #666;
    background: #F0F0F4;
  }
  .btn-display-mode.active {
    border-color: #D4900A;
    color: #D4900A;
    background: #D4900A10;
  }
  .tree-scroll { flex: 1; overflow-y: auto; padding: 4px 0; }

  .empty-tree {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; padding: 40px 20px; text-align: center;
  }
  .empty-icon { font-size: 28px; opacity: 0.4; }
  .empty-text { font-size: 12px; color: #888; line-height: 1.5; }
  .btn-open {
    padding: 6px 16px; border: 1px solid #D4900A40; border-radius: 6px;
    background: #D4900A10; color: #D4900A; font-family: inherit;
    font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 4px;
  }
  .btn-open:hover { background: #D4900A20; border-color: #D4900A; }

  /* Sidebar footer */
  .sidebar-footer {
    flex-shrink: 0;
    padding: 8px 12px;
    border-top: 1px solid #EDEDF0;
  }
  .btn-help {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #AAA;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-help:hover {
    background: #F0F0F4;
    color: #666;
  }
</style>
