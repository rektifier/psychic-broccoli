<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TreeNode as TNode, RequestLocation } from '../lib/types';
  import { METHOD_COLORS } from '../lib/theme';

  export let node: TNode;
  export let selected: RequestLocation | null = null;
  export let depth: number = 0;
  export let displayMode: 'name' | 'url' = 'name';
  export let sortByUrl: boolean = false;
  export let usedNames: string[] = [];
  export let forceExpand: boolean = false;

  const dispatch = createEventDispatcher();


  let fileExpanded = false;
  let namingIndex: number = -1;

  /** Compute unique URL suffixes for requests in a file node */
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

  $: urlSuffixes = node.type === 'file' ? computeUrlSuffixes(node.requests) : [];
  $: sortedIndices = node.type === 'file'
    ? (sortByUrl
        ? [...Array(node.requests.length).keys()].sort((a, b) =>
            node.requests[a].url.localeCompare(node.requests[b].url))
        : [...Array(node.requests.length).keys()])
    : [];
  let namingValue: string = '';
  let confirmDeleteIndex: number = -1;
  let showFileMenu = false;
  let fileMenuPos = { x: 0, y: 0 };
  let confirmDeleteFile = false;

  function handleFileContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showFileMenu = true;
    confirmDeleteFile = false;
    fileMenuPos = { x: e.clientX, y: e.clientY };

    const dismiss = () => {
      showFileMenu = false;
      confirmDeleteFile = false;
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
    };
    // Defer so the current event doesn't immediately dismiss
    setTimeout(() => {
      window.addEventListener('click', dismiss);
      window.addEventListener('contextmenu', dismiss);
    });
  }

  $: isDuplicate = (() => {
    const v = namingValue.trim();
    if (!v || namingIndex < 0) return false;
    const currentVarName = node.type === 'file' ? node.requests[namingIndex]?.varName : null;
    if (v === currentVarName) return false;
    return usedNames.includes(v);
  })();

  function isSel(fp: string, ri: number): boolean {
    return selected?.filePath === fp && selected?.requestIndex === ri;
  }

  function startNaming(index: number, currentName: string | null) {
    namingIndex = index;
    namingValue = currentName || '';
  }

  function confirmNaming(filePath: string) {
    if (isDuplicate) return;
    dispatch('nameRequest', { filePath, requestIndex: namingIndex, varName: namingValue.trim() });
    namingIndex = -1;
    namingValue = '';
  }

  function handleContextMenu(e: MouseEvent, filePath: string, index: number, currentName: string | null) {
    e.preventDefault();
    startNaming(index, currentName);
  }

  // Keep file expanded when it contains the selection
  $: if (node.type === 'file' && selected?.filePath === node.path) {
    fileExpanded = true;
  }

  function forward(event: CustomEvent) {
    // Re-dispatch events from children up to parent
    dispatch(event.type, event.detail);
  }
</script>

{#if node.type === 'folder'}
  <!-- ── Folder ── -->
  <button
    class="tree-row folder-row"
    style="padding-left: {12 + depth * 16}px"
    on:click={() => dispatch('toggleFolder', node.path)}
  >
    <span class="chevron" class:open={node.expanded}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <svg class="icon folder-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 12V4.5a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"
        fill="#B0883020" stroke="#B08830" stroke-width="1.2"/>
    </svg>
    <span class="node-name">{node.name}</span>
  </button>

  {#if node.expanded}
    <div class="children">
      {#each node.children as child}
        <svelte:self
          node={child}
          {selected}
          depth={depth + 1}
          {displayMode}
          {sortByUrl}
          {usedNames}
          {forceExpand}
          on:toggleFolder
          on:select
          on:pinRequest
          on:addRequest
          on:deleteRequest
          on:deleteFile
          on:nameRequest
        />
      {/each}
    </div>
  {/if}

{:else if node.type === 'file'}
  <!-- ── .http File ── -->
  <div
    class="tree-row file-row"
    class:dirty={node.dirty}
    style="padding-left: {12 + depth * 16}px"
    on:click={() => fileExpanded = !fileExpanded}
    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileExpanded = !fileExpanded; } }}
    on:contextmenu={handleFileContextMenu}
    role="button"
    tabindex="0"
  >
    <span class="chevron" class:open={fileExpanded}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <svg class="icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#2B7FC518" stroke="#2B7FC5" stroke-width="1.2"/>
      <path d="M9 2v4h4" stroke="#2B7FC5" stroke-width="1.2"/>
    </svg>
    <span class="node-name">{node.name.replace(/\.(http|rest)$/, '')}</span>
    {#if node.dirty}
      <span class="dirty-dot"></span>
    {/if}
    <button
      class="btn-add-req"
      on:click|stopPropagation={() => dispatch('addRequest', node.path)}
      title="Add request"
    >+</button>
    <span class="req-count">{node.requests.length}</span>
  </div>

  {#if showFileMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="file-context-menu" style="left: {fileMenuPos.x}px; top: {fileMenuPos.y}px" on:click|stopPropagation on:keydown|stopPropagation>
      {#if confirmDeleteFile}
        <span class="confirm-delete-text">Delete file?</span>
        <button class="confirm-delete-yes" on:click|stopPropagation={() => { dispatch('deleteFile', node.path); showFileMenu = false; confirmDeleteFile = false; }}>Yes</button>
        <button class="confirm-delete-no" on:click|stopPropagation={() => { showFileMenu = false; confirmDeleteFile = false; }}>No</button>
      {:else}
        <button class="file-context-item file-context-delete" on:click|stopPropagation={() => confirmDeleteFile = true}>Delete file</button>
      {/if}
    </div>
  {/if}

  {#if fileExpanded || forceExpand}
    <div class="children">
      {#each sortedIndices as i}
        {@const req = node.requests[i]}
        {#if namingIndex === i}
          <div class="tree-row naming-row" style="padding-left: {28 + depth * 16}px">
            <span class="naming-label">@name</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="naming-input"
              class:naming-error={isDuplicate}
              bind:value={namingValue}
              on:keydown={(e) => { if (e.key === 'Enter') confirmNaming(node.path); if (e.key === 'Escape') { namingIndex = -1; } }}
              on:blur={() => confirmNaming(node.path)}
              placeholder="responseAlias"
              spellcheck="false"
              autofocus
            />
            {#if isDuplicate}
              <span class="naming-duplicate-hint">Name in use</span>
            {/if}
          </div>
        {:else}
          <div
            class="tree-row request-row"
            class:active={isSel(node.path, i)}
            style="padding-left: {28 + depth * 16}px"
            on:click={() => dispatch('select', { filePath: node.path, requestIndex: i })}
            on:dblclick={() => dispatch('pinRequest', { filePath: node.path, requestIndex: i, label: req.name })}
            on:contextmenu|preventDefault={(e) => startNaming(i, req.varName)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch('select', { filePath: node.path, requestIndex: i }); } }}
            role="button"
            tabindex="0"
          >
            <span class="method-badge" style="color: {METHOD_COLORS[req.method] || '#888'}">
              {req.method.slice(0, 3)}
            </span>
            <span class="req-name" title={displayMode === 'url' ? req.name : req.url}>{displayMode === 'url' ? urlSuffixes[i] : req.name}</span>
            {#if req.varName}
              <span class="varname-tag">{req.varName}</span>
            {/if}
            {#if node.requests.length > 1}
              {#if confirmDeleteIndex === i}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div class="confirm-delete-popup" on:click|stopPropagation on:keydown|stopPropagation role="alert">
                  <span class="confirm-delete-text">Delete?</span>
                  <button class="confirm-delete-yes" on:click|stopPropagation={() => { dispatch('deleteRequest', { filePath: node.path, requestIndex: i }); confirmDeleteIndex = -1; }}>Yes</button>
                  <button class="confirm-delete-no" on:click|stopPropagation={() => confirmDeleteIndex = -1}>No</button>
                </div>
              {:else}
                <button
                  class="btn-del-req"
                  on:click|stopPropagation={() => confirmDeleteIndex = i}
                  title="Delete request"
                >×</button>
              {/if}
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}

<style>
  .tree-row {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    width: 100%;
    padding: 5px var(--space-3);
    border: none;
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
    position: relative;
    white-space: nowrap;
  }
  .tree-row:hover {
    background: var(--color-bg-muted);
    color: var(--color-text);
  }

  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-3\.5);
    height: var(--space-3\.5);
    flex-shrink: 0;
    color: var(--color-text-faint);
    transition: transform var(--duration-normal);
    transform: rotate(0deg);
  }
  .chevron.open {
    transform: rotate(90deg);
  }

  .icon {
    flex-shrink: 0;
  }

  .node-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .children {
    display: contents;
  }

  /* Folder */
  .folder-row {
    color: var(--slate-250);
    font-weight: var(--weight-medium);
  }
  .folder-row:hover {
    color: var(--color-text-heading);
  }
  .folder-icon {
    opacity: 0.8;
  }

  /* File */
  .file-row {
    color: var(--color-text-secondary);
  }
  .file-row:hover .btn-add-req {
    opacity: 1;
  }
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
    flex-shrink: 0;
  }
  .req-count {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    padding: 0 var(--space-1);
    flex-shrink: 0;
  }
  .btn-add-req {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-lg);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: all var(--duration-fast);
  }
  .btn-add-req:hover {
    background: color-mix(in srgb, var(--color-primary) 9%, transparent);
    color: var(--color-primary);
  }

  /* Request */
  .request-row {
    color: var(--color-text-secondary);
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .request-row.active {
    background: #DDE4F0;
    color: var(--color-text-heading);
  }
  .request-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: var(--color-primary);
    border-radius: 0 2px 2px 0;
  }

  .method-badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.5px;
    min-width: var(--space-7);
    flex-shrink: 0;
  }

  .req-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .btn-del-req {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-lg);
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
  }
  .request-row:hover .btn-del-req {
    visibility: visible;
  }
  .btn-del-req:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }

  .confirm-delete-popup {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    margin-left: auto;
  }
  .confirm-delete-text {
    font-size: var(--text-xs);
    color: var(--color-error);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
  .confirm-delete-yes {
    padding: 1px var(--space-1\.5);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-error);
    color: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }
  .confirm-delete-yes:hover {
    background: #B33344;
  }
  .confirm-delete-no {
    padding: 1px var(--space-1\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .confirm-delete-no:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }

  .varname-tag {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-info);
    background: color-mix(in srgb, var(--color-info) 7%, transparent);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-full);
    border: 0.5px solid color-mix(in srgb, var(--color-info) 19%, transparent);
    flex-shrink: 0;
    line-height: var(--leading-relaxed);
  }

  .naming-row {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .naming-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-info);
    flex-shrink: 0;
  }
  .naming-input {
    flex: 1;
    padding: 3px var(--space-2);
    border: 1px solid var(--color-info);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-info);
    font-family: inherit;
    font-size: var(--text-sm);
    outline: none;
    min-width: 0;
  }
  .naming-input.naming-error {
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .naming-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .naming-duplicate-hint {
    font-size: var(--text-2xs);
    color: var(--color-error);
    font-weight: var(--weight-medium);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* File context menu */
  .file-context-menu {
    position: fixed;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1\.5);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 100;
    white-space: nowrap;
  }
  .file-context-item {
    display: block;
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .file-context-item:hover {
    background: var(--color-bg-muted);
  }
  .file-context-delete {
    color: var(--color-error);
  }
  .file-context-delete:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
  }
</style>
