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

  // File management props
  export let editingFilePath: string | null = null;

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
  let filterText = '';
  let filterInputEl: HTMLInputElement;
  function filterTree(nodes: TNode[], query: string): TNode[] {
    const q = query.toLowerCase();
    const result: TNode[] = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        const fileMatch = node.name.toLowerCase().includes(q);
        const reqMatch = node.requests.some(r =>
          r.name.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.method.toLowerCase().includes(q) ||
          (r.varName && r.varName.toLowerCase().includes(q))
        );
        if (fileMatch || reqMatch) result.push(node);
      } else {
        const filteredChildren = filterTree(node.children, query);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren, expanded: true });
        }
      }
    }
    return result;
  }

  $: usedNames = getAllFileNodes(tree)
    .flatMap(f => f.requests)
    .map(r => r.varName)
    .filter((n): n is string => !!n);

  $: displayTree = filterText.trim() ? filterTree(tree, filterText.trim()) : tree;

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
        class="btn-edit-env"
        class:disabled={!hasWorkspace}
        on:click={() => { if (hasWorkspace) dispatch('editEnv'); }}
        title={hasWorkspace ? 'Edit environment variables' : 'Open a folder first'}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M6.9 1.7a1.1 1.1 0 012.2 0l.15.9a.7.7 0 00.46.5l.22.08a.7.7 0 00.67-.07l.76-.52a1.1 1.1 0 011.55 1.56l-.52.75a.7.7 0 00-.07.68l.08.22a.7.7 0 00.5.45l.9.16a1.1 1.1 0 010 2.2l-.9.15a.7.7 0 00-.5.46l-.08.22a.7.7 0 00.07.67l.52.76a1.1 1.1 0 01-1.56 1.55l-.75-.52a.7.7 0 00-.68-.07l-.22.08a.7.7 0 00-.45.5l-.16.9a1.1 1.1 0 01-2.2 0l-.15-.9a.7.7 0 00-.46-.5l-.22-.08a.7.7 0 00-.67.07l-.76.52a1.1 1.1 0 01-1.55-1.56l.52-.75a.7.7 0 00.07-.68l-.08-.22a.7.7 0 00-.5-.45l-.9-.16a1.1 1.1 0 010-2.2l.9-.15a.7.7 0 00.5-.46l.08-.22a.7.7 0 00-.07-.67l-.52-.76A1.1 1.1 0 014.4 2.56l.75.52a.7.7 0 00.68.07l.22-.08a.7.7 0 00.45-.5l.16-.9z" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
      <button
        class="btn-var-inspector"
        class:disabled={!hasWorkspace}
        on:click={() => { if (hasWorkspace) dispatch('openVarInspector'); }}
        title={hasWorkspace ? 'Variable inspector' : 'Open a folder first'}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <text x="1" y="12" font-size="11" font-weight="700" fill="currentColor" font-family="system-ui">x</text>
          <path d="M9 3h5M9 8h5M9 13h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

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
    <div class="filter-wrap">
      <svg class="filter-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input
        bind:this={filterInputEl}
        bind:value={filterText}
        class="filter-input"
        placeholder="Filter..."
        spellcheck="false"
        on:keydown={(e) => { if (e.key === 'Escape') { filterText = ''; filterInputEl.blur(); } }}
      />
      {#if filterText}
        <button class="filter-clear" on:click={() => { filterText = ''; }} title="Clear filter">&times;</button>
      {/if}
    </div>
    <button
      class="btn-display-mode"
      class:active={sortByUrl}
      class:disabled={!hasWorkspace}
      on:click={() => { if (hasWorkspace) sortByUrl = !sortByUrl; }}
      title={!hasWorkspace ? 'Open a folder first' : sortByUrl ? 'Show original order' : 'Sort by URL'}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <text x="0" y="7" font-size="6" font-weight="700" fill="currentColor" font-family="system-ui">A</text>
        <text x="0" y="14" font-size="6" font-weight="700" fill="currentColor" font-family="system-ui">Z</text>
        <path d="M10 3v10M8 11l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button
      class="btn-display-mode"
      class:disabled={!hasWorkspace}
      on:click={() => { if (hasWorkspace) displayMode = displayMode === 'name' ? 'url' : 'name'; }}
      title={!hasWorkspace ? 'Open a folder first' : displayMode === 'name' ? 'Show URL paths' : 'Show request names'}
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
    <button
      class="btn-display-mode"
      class:disabled={!hasWorkspace}
      on:click={() => { if (hasWorkspace) dispatch('createFile', null); }}
      title={!hasWorkspace ? 'Open a folder first' : 'New .http file'}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  <div class="tree-scroll">
    {#if tree.length === 0}
      <div class="empty-tree">
        <span class="empty-icon">📂</span>
        <span class="empty-text">Open a folder to browse .http files</span>
        <button class="btn-open" on:click={() => dispatch('openFolder')}>Open Folder</button>
        <button class="btn-getting-started" on:click={() => dispatch('openGettingStarted')}>Getting Started</button>
      </div>
    {:else if displayTree.length === 0}
      <div class="empty-filter">
        <span class="empty-filter-text">No matching requests</span>
      </div>
    {:else}
      {#each displayTree as node}
        <TreeNode
          {node}
          {selected}
          depth={0}
          {displayMode}
          {sortByUrl}
          {usedNames}
          forceExpand={!!filterText.trim()}
          {editingFilePath}
          siblingNames={tree.filter(n => n.type === 'file').map(n => n.name)}
          on:toggleFolder
          on:select
          on:pinRequest
          on:addRequest
          on:deleteRequest
          on:deleteFile
          on:nameRequest
          on:renameFile
          on:duplicateFile
          on:createFile
          on:cancelRename
        />
      {/each}
    {/if}
  </div>
  <div class="sidebar-footer">
    <button class="btn-help" on:click={() => dispatch('openSettings')} title="Settings">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" stroke-width="1.3"/>
        <path d="M13.5 6.5h-1.2a4.5 4.5 0 00-.7-1.7l.8-.8-1.4-1.4-.8.8a4.5 4.5 0 00-1.7-.7V1.5h-2v1.2a4.5 4.5 0 00-1.7.7l-.8-.8L2.6 4l.8.8a4.5 4.5 0 00-.7 1.7H1.5v2h1.2c.1.6.4 1.2.7 1.7l-.8.8 1.4 1.4.8-.8c.5.3 1.1.6 1.7.7v1.2h2v-1.2c.6-.1 1.2-.4 1.7-.7l.8.8 1.4-1.4-.8-.8c.3-.5.6-1.1.7-1.7h1.2v-2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
      <span>Settings</span>
    </button>
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
    padding: var(--space-2\.5) var(--space-3);
    flex-shrink: 0;
  }
  .root-section {
    padding-bottom: 0;
  }
  .env-section {
    padding-top: var(--space-2);
    border-bottom: 1px solid var(--color-divider);
  }

  .root-row {
    display: flex;
    gap: var(--space-1\.5);
    align-items: center;
  }
  .root-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-1\.5) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition: all var(--duration-normal);
    text-align: left;
  }
  .root-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
  .root-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--weight-semibold); }

  .btn-import {
    width: 30px; height: 30px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--slate-350);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-normal);
    padding: 0;
  }
  .btn-import:hover {
    border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }
  .btn-import.disabled,
  .btn-edit-env.disabled,
  .btn-var-inspector.disabled,
  .btn-display-mode.disabled {
    opacity: 0.35;
    cursor: default;
  }
  .btn-import.disabled:hover,
  .btn-edit-env.disabled:hover,
  .btn-var-inspector.disabled:hover,
  .btn-display-mode.disabled:hover {
    border-color: var(--color-border); color: var(--slate-350); background: transparent;
  }

  /* Environment */
  .env-row {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
  }
  .env-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-success);
    flex-shrink: 0;
  }
  .env-select {
    flex: 1;
    padding: 5px var(--space-6) 5px var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-success);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    outline: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-2) center;
    transition: border-color var(--duration-normal);
  }
  .env-select:hover { border-color: var(--color-success); }
  .env-select option { background: var(--color-bg-surface); color: var(--color-text); }

  .btn-edit-env {
    width: 26px; height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-normal);
    padding: 0;
  }
  .btn-edit-env:hover { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }

  .btn-var-inspector {
    width: 26px; height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-normal);
    padding: 0;
  }
  .btn-var-inspector:hover { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }

  /* Test Flows */
  .flow-section {
    padding: 0;
    border-bottom: 1px solid var(--color-divider);
  }
  .flow-header {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-1\.5);
    width: 100%;
    padding: 7px var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background var(--duration-fast);
  }
  .flow-header:hover {
    background: var(--color-bg-sidebar);
  }
  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--color-text-faint);
    transition: transform var(--duration-normal);
    transform: rotate(0deg);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .flow-icon {
    color: var(--color-accent-flow);
    flex-shrink: 0;
  }
  .flow-label {
    flex: 1;
    min-width: 0;
  }
  .flow-count {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    font-weight: var(--weight-regular);
    flex-shrink: 0;
  }
  .btn-new-flow {
    width: 20px; height: 20px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-lg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast);
  }
  .btn-new-flow:hover {
    background: color-mix(in srgb, var(--color-accent-flow) 9%, transparent);
    color: var(--color-accent-flow);
  }
  .new-flow-form {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) var(--space-1\.5) 32px;
  }
  .new-flow-input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-sm);
    outline: none;
    min-width: 0;
  }
  .new-flow-input:focus {
    border-color: var(--color-accent-flow);
  }
  .btn-confirm-flow {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent-flow) 9%, transparent);
    color: var(--color-accent-flow);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    flex-shrink: 0;
  }
  .flow-item {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-1\.5);
    width: 100%;
    padding: 5px var(--space-3) 5px 32px;
    border: none;
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast);
    position: relative;
  }
  .flow-item:hover {
    background: var(--color-bg-muted);
    color: var(--color-text);
  }
  .flow-item.active {
    background: var(--color-accent-flow-bg);
    color: var(--color-text-heading);
  }
  .flow-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: var(--color-accent-flow);
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
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
    padding: 0;
  }
  .flow-item:hover .btn-dup-flow {
    visibility: visible;
  }
  .btn-dup-flow:hover {
    background: color-mix(in srgb, var(--color-accent-flow) 9%, transparent);
    color: var(--color-accent-flow);
  }
  .btn-del-flow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px; height: 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-lg);
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
  }
  .flow-item:hover .btn-del-flow {
    visibility: visible;
  }
  .btn-del-flow:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }
  .flow-confirm-delete {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .flow-del-yes {
    padding: 1px 5px;
    border: none;
    border-radius: var(--radius-xs);
    background: var(--color-error);
    color: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }
  .flow-del-no {
    padding: 1px 5px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .flow-empty {
    display: block;
    padding: var(--space-1) var(--space-3) var(--space-2) 32px;
    font-size: var(--text-sm);
    color: var(--zinc-300);
  }

  /* Tree */
  .tree-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) 0;
    flex-shrink: 0;
  }
  .filter-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
  }
  .filter-icon {
    position: absolute;
    left: 7px;
    color: var(--color-text-faint);
    pointer-events: none;
  }
  .filter-input {
    width: 100%;
    padding: var(--space-1) 22px var(--space-1) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .filter-input:focus {
    border-color: var(--color-primary);
  }
  .filter-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .filter-clear {
    position: absolute;
    right: 2px;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-lg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .filter-clear:hover {
    color: var(--slate-450);
    background: var(--color-bg-sidebar);
  }
  .empty-filter {
    display: flex;
    justify-content: center;
    padding: var(--space-5);
  }
  .empty-filter-text {
    font-size: var(--text-sm);
    color: var(--zinc-300);
  }
  .btn-display-mode {
    width: 24px; height: 24px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all var(--duration-normal);
  }
  .btn-display-mode:hover {
    border-color: var(--color-border);
    color: var(--slate-450);
    background: var(--color-bg-sidebar);
  }
  .btn-display-mode.active {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }
  .tree-scroll { flex: 1; overflow-y: auto; padding: var(--space-1) 0; }

  .empty-tree {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: var(--space-2\.5); padding: var(--space-10) var(--space-5); text-align: center;
  }
  .empty-icon { font-size: 28px; opacity: 0.4; }
  .empty-text { font-size: var(--text-base); color: var(--slate-350); line-height: 1.5; }
  .btn-open {
    padding: var(--space-1\.5) var(--space-4); border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent); border-radius: var(--radius-default);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent); color: var(--color-primary); font-family: inherit;
    font-size: var(--text-base); font-weight: var(--weight-semibold); cursor: pointer; margin-top: var(--space-1);
  }
  .btn-open:hover { background: color-mix(in srgb, var(--color-primary) 12%, transparent); border-color: var(--color-primary); }
  .btn-getting-started {
    padding: var(--space-1) var(--space-3); border: none; border-radius: var(--radius-default);
    background: transparent; color: var(--slate-350); font-family: inherit;
    font-size: var(--text-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
  }
  .btn-getting-started:hover { color: var(--color-primary); }

  /* Sidebar footer */
  .sidebar-footer {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--gray-100);
  }
  .btn-help {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: 5px var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--zinc-300);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-help:hover {
    background: var(--color-bg-sidebar);
    color: var(--slate-450);
  }
</style>
