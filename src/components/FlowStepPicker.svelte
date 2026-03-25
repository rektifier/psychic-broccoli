<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TreeNode, FileNode, FlowStep } from '../lib/types';
  import { getAllFileNodes } from '../lib/parser';

  export let tree: TreeNode[] = [];
  export let rootPath: string;

  const dispatch = createEventDispatcher<{
    pick: FlowStep;
    close: void;
  }>();

  $: files = getAllFileNodes(tree);

  let filter = '';

  $: filteredFiles = filter.trim()
    ? files.filter(f =>
        f.name.toLowerCase().includes(filter.toLowerCase()) ||
        f.requests.some(r =>
          r.url.toLowerCase().includes(filter.toLowerCase()) ||
          r.name.toLowerCase().includes(filter.toLowerCase()) ||
          r.method.toLowerCase().includes(filter.toLowerCase())
        )
      )
    : files;

  function pickRequest(file: FileNode, requestIndex: number) {
    const req = file.requests[requestIndex];
    // Compute relative path from workspace root
    const relativePath = file.path.substring(rootPath.length + 1).replaceAll('\\', '/');
    const step: FlowStep = {
      id: crypto.randomUUID(),
      filePath: relativePath,
      requestIndex,
      varName: req.varName,
      label: `${req.method} ${req.url}`,
      continueOnFailure: false,
    };
    dispatch('pick', step);
  }

  const MC: Record<string, string> = {
    GET: '#2B7FC5', POST: '#3D8B45', PUT: '#9A7520', PATCH: '#A06828',
    DELETE: '#CC4455', HEAD: '#8040A8', OPTIONS: '#1A8898',
    TRACE: '#666677', CONNECT: '#CC4455',
  };

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) dispatch('close');
  }

  let filterInputEl: HTMLInputElement;
  $: if (filterInputEl) filterInputEl.focus();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-backdrop" on:click={handleBackdropClick} on:keydown={(e) => { if (e.key === 'Escape') dispatch('close'); }}>
  <div class="picker-panel">
    <div class="picker-header">
      <span class="picker-title">Add step</span>
      <button class="picker-close" on:click={() => dispatch('close')}>&times;</button>
    </div>
    <div class="picker-filter">
      <input
        bind:this={filterInputEl}
        bind:value={filter}
        class="picker-filter-input"
        placeholder="Filter by file, URL, or method..."
        spellcheck="false"
        on:keydown={(e) => { if (e.key === 'Escape') dispatch('close'); }}
      />
    </div>
    <div class="picker-list">
      {#each filteredFiles as file}
        <div class="picker-file">
          <div class="picker-file-header">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#2B7FC518" stroke="#2B7FC5" stroke-width="1.2"/>
              <path d="M9 2v4h4" stroke="#2B7FC5" stroke-width="1.2"/>
            </svg>
            <span class="picker-file-name">{file.name.replace(/\.(http|rest)$/, '')}</span>
          </div>
          {#each file.requests as req, i}
            <button class="picker-request" on:click={() => pickRequest(file, i)}>
              <span class="picker-method" style="color: {MC[req.method] || '#888'}">{req.method.slice(0, 3)}</span>
              <span class="picker-url">{req.url || req.name}</span>
              {#if req.varName}
                <span class="picker-varname">{req.varName}</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="picker-empty">No matching requests</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .picker-panel {
    width: 460px;
    max-height: 70vh;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #EDEDF0;
  }
  .picker-title {
    font-size: 14px;
    font-weight: 700;
    color: #1A1A2E;
  }
  .picker-close {
    width: 24px; height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .picker-close:hover {
    background: #F0F0F4;
    color: #333;
  }
  .picker-filter {
    padding: 8px 16px;
    border-bottom: 1px solid #EDEDF0;
  }
  .picker-filter-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FAFAFA;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }
  .picker-filter-input:focus {
    border-color: #8040A8;
  }
  .picker-filter-input::placeholder {
    color: #BBB;
  }
  .picker-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .picker-file {
    padding: 0 8px;
  }
  .picker-file + .picker-file {
    margin-top: 4px;
  }
  .picker-file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    color: #888;
    font-size: 11px;
    font-weight: 500;
  }
  .picker-file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-request {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px 6px 26px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #555;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .picker-request:hover {
    background: #E8E0F0;
    color: #1A1A2E;
  }
  .picker-method {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    min-width: 28px;
    flex-shrink: 0;
  }
  .picker-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-varname {
    font-size: 9px;
    font-weight: 600;
    color: #2B7FC5;
    background: #2B7FC512;
    padding: 1px 6px;
    border-radius: 100px;
    border: 0.5px solid #2B7FC530;
    flex-shrink: 0;
  }
  .picker-empty {
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: #999;
  }
</style>
