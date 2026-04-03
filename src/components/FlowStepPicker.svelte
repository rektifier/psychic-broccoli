<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TreeNode, FileNode, FlowStep } from '../lib/types';
  import { getAllFileNodes } from '../lib/parser';
  import { METHOD_COLORS } from '../lib/theme';

  export let tree: TreeNode[] = [];
  export let rootPath: string;

  const dispatch = createEventDispatcher<{
    pick: FlowStep;
    close: void;
  }>();

  $: files = getAllFileNodes(tree);

  let filter = '';
  let displayMode: 'name' | 'url' = 'name';

  $: suffixMap = new Map(files.map(f => [f.path, computeUrlSuffixes(f.requests)]));

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


  /** Compute unique URL suffixes for requests in a file, stripping common prefix segments. */
  function computeUrlSuffixes(requests: { url: string }[]): string[] {
    if (requests.length === 0) return [];
    if (requests.length === 1) return [requests[0].url];
    const split = requests.map(r => r.url.split('/'));
    const minLen = Math.min(...split.map(s => s.length));
    let common = 0;
    for (let i = 0; i < minLen; i++) {
      if (split.every(s => s[i] === split[0][i])) common = i + 1;
      else break;
    }
    if (common === 0) return requests.map(r => r.url);
    return split.map(s => {
      const unique = s.slice(common);
      return '/' + unique.join('/');
    });
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) dispatch('close');
  }

  let expandedFiles: Set<string> = new Set();

  function toggleFile(path: string) {
    if (expandedFiles.has(path)) {
      expandedFiles.delete(path);
    } else {
      expandedFiles.add(path);
    }
    expandedFiles = expandedFiles;
  }

  let filterInputEl: HTMLInputElement;
  $: if (filterInputEl) filterInputEl.focus();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-backdrop" on:click={handleBackdropClick} on:keydown={(e) => { if (e.key === 'Escape') dispatch('close'); }}>
  <div class="picker-panel">
    <div class="picker-header">
      <span class="picker-title">Add step</span>
      <button
        class="picker-display-toggle"
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
        {@const expanded = expandedFiles.has(file.path)}
        <div class="picker-file">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-file-header" on:click={() => toggleFile(file.path)} on:keydown={(e) => { if (e.key === 'Enter') toggleFile(file.path); }}>
            <span class="picker-chevron" class:open={expanded}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <svg class="picker-file-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" fill="currentColor" fill-opacity="0.09" stroke="currentColor" stroke-width="1.2"/>
              <path d="M9 2v4h4" stroke="currentColor" stroke-width="1.2"/>
            </svg>
            <span class="picker-file-name">{file.name.replace(/\.(http|rest)$/, '')}</span>
          </div>
          {#if expanded}
            {#each file.requests as req, i (req.id)}
              <button class="picker-request" on:click={() => pickRequest(file, i)} title={displayMode === 'name' ? req.url : req.name}>
                <span class="picker-method" style="color: {METHOD_COLORS[req.method] || '#888'}">{req.method.slice(0, 3)}</span>
                <span class="picker-url">{displayMode === 'url' ? (suffixMap.get(file.path)?.[i] ?? req.url) : req.name}</span>
                {#if req.varName}
                  <span class="picker-varname">{req.varName}</span>
                {/if}
              </button>
            {/each}
          {/if}
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
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-divider);
  }
  .picker-title {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    color: var(--color-text-heading);
  }
  .picker-display-toggle {
    width: 28px; height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin-left: auto;
    transition: all var(--duration-normal);
  }
  .picker-display-toggle:hover {
    border-color: var(--color-border);
    color: var(--color-text-secondary);
    background: var(--color-bg-sidebar);
  }
  .picker-close {
    width: 24px; height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .picker-close:hover {
    background: var(--color-bg-sidebar);
    color: var(--color-text);
  }
  .picker-filter {
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-divider);
  }
  .picker-filter-input {
    width: 100%;
    padding: 7px var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .picker-filter-input:focus {
    border-color: var(--color-accent-flow);
  }
  .picker-filter-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .picker-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0;
  }
  .picker-file {
    padding: 0 var(--space-2);
  }
  .picker-file + .picker-file {
    margin-top: var(--space-1);
  }
  .picker-file-header {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: 5px var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background var(--duration-fast);
  }
  .picker-file-header:hover {
    background: var(--color-bg-sidebar);
  }
  .picker-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-3\.5);
    height: var(--space-3\.5);
    flex-shrink: 0;
    color: var(--color-text-placeholder);
    transition: transform var(--duration-normal);
  }
  .picker-chevron.open {
    transform: rotate(90deg);
  }
  .picker-file-icon {
    color: var(--color-info);
    flex-shrink: 0;
  }
  .picker-file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-request {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1\.5) var(--space-2) var(--space-1\.5) 26px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast);
  }
  .picker-request:hover {
    background: var(--color-accent-flow-bg);
    color: var(--color-text-heading);
  }
  .picker-method {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.5px;
    min-width: var(--space-7);
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
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-info);
    background: color-mix(in srgb, var(--color-info) 7%, transparent);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-full);
    border: 0.5px solid color-mix(in srgb, var(--color-info) 19%, transparent);
    flex-shrink: 0;
  }
  .picker-empty {
    padding: var(--space-5);
    text-align: center;
    font-size: var(--text-base);
    color: var(--color-text-faint);
  }
</style>
