<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TreeNode as TNode, RequestLocation } from '../lib/types';

  export let node: TNode;
  export let selected: RequestLocation | null = null;
  export let depth: number = 0;

  const dispatch = createEventDispatcher();

  const MC: Record<string, string> = {
    GET:'#2B7FC5', POST:'#3D8B45', PUT:'#9A7520', PATCH:'#A06828',
    DELETE:'#CC4455', HEAD:'#8040A8', OPTIONS:'#1A8898',
    TRACE:'#666677', CONNECT:'#CC4455',
  };

  let fileExpanded = false;
  let namingIndex: number = -1;
  let namingValue: string = '';
  let confirmDeleteIndex: number = -1;

  function isSel(fp: string, ri: number): boolean {
    return selected?.filePath === fp && selected?.requestIndex === ri;
  }

  function startNaming(index: number, currentName: string | null) {
    namingIndex = index;
    namingValue = currentName || '';
  }

  function confirmNaming(filePath: string) {
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
          on:toggleFolder
          on:select
          on:pinRequest
          on:addRequest
          on:deleteRequest
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

  {#if fileExpanded}
    <div class="children">
      {#each node.requests as req, i}
        {#if namingIndex === i}
          <div class="tree-row naming-row" style="padding-left: {28 + depth * 16}px">
            <span class="naming-label">@name</span>
            <input
              class="naming-input"
              bind:value={namingValue}
              on:keydown={(e) => { if (e.key === 'Enter') confirmNaming(node.path); if (e.key === 'Escape') { namingIndex = -1; } }}
              on:blur={() => confirmNaming(node.path)}
              placeholder="responseAlias"
              spellcheck="false"
              autofocus
            />
          </div>
        {:else}
          <div
            class="tree-row request-row"
            class:active={isSel(node.path, i)}
            style="padding-left: {28 + depth * 16}px"
            on:click={() => dispatch('select', { filePath: node.path, requestIndex: i })}
            on:dblclick={() => dispatch('pinRequest', { filePath: node.path, requestIndex: i, label: req.name })}
            on:contextmenu|preventDefault={(e) => startNaming(i, req.varName)}
            role="button"
            tabindex="0"
          >
            <span class="method-badge" style="color: {MC[req.method] || '#888'}">
              {req.method.slice(0, 3)}
            </span>
            <span class="req-name">{req.name}</span>
            {#if req.varName}
              <span class="varname-tag">{req.varName}</span>
            {/if}
            {#if node.requests.length > 1}
              {#if confirmDeleteIndex === i}
                <div class="confirm-delete-popup" on:click|stopPropagation>
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
    gap: 6px;
    width: 100%;
    padding: 5px 12px;
    border: none;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    position: relative;
    white-space: nowrap;
  }
  .tree-row:hover {
    background: #E4E4EA;
    color: #333;
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
    /* no extra indent - handled by padding-left on rows */
  }

  /* Folder */
  .folder-row {
    color: #444;
    font-weight: 500;
  }
  .folder-row:hover {
    color: #1A1A2E;
  }
  .folder-icon {
    opacity: 0.8;
  }

  /* File */
  .file-row {
    color: #555;
  }
  .file-row:hover .btn-add-req {
    opacity: 1;
  }
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #D4900A;
    flex-shrink: 0;
  }
  .req-count {
    font-size: 10px;
    color: #999;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .btn-add-req {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999;
    font-size: 14px;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: all 0.1s;
  }
  .btn-add-req:hover {
    background: #D4900A18;
    color: #D4900A;
  }

  /* Request */
  .request-row {
    color: #555;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .request-row.active {
    background: #DDE4F0;
    color: #1A1A2E;
  }
  .request-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: #D4900A;
    border-radius: 0 2px 2px 0;
  }

  .method-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    min-width: 28px;
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
    border-radius: 4px;
    background: transparent;
    color: #999;
    font-size: 14px;
    cursor: pointer;
    flex-shrink: 0;
    visibility: hidden;
  }
  .request-row:hover .btn-del-req {
    visibility: visible;
  }
  .btn-del-req:hover {
    background: #CC445518;
    color: #CC4455;
  }

  .confirm-delete-popup {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .confirm-delete-text {
    font-size: 10px;
    color: #CC4455;
    font-weight: 500;
    white-space: nowrap;
  }
  .confirm-delete-yes {
    padding: 1px 6px;
    border: none;
    border-radius: 4px;
    background: #CC4455;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .confirm-delete-yes:hover {
    background: #B33344;
  }
  .confirm-delete-no {
    padding: 1px 6px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: transparent;
    color: #777;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .confirm-delete-no:hover {
    border-color: #999;
    color: #333;
  }

  .varname-tag {
    font-size: 9px;
    font-weight: 600;
    color: #2B7FC5;
    background: #2B7FC512;
    padding: 1px 6px;
    border-radius: 100px;
    border: 0.5px solid #2B7FC530;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .naming-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .naming-label {
    font-size: 9px;
    font-weight: 600;
    color: #2B7FC5;
    flex-shrink: 0;
  }
  .naming-input {
    flex: 1;
    padding: 3px 8px;
    border: 1px solid #2B7FC5;
    border-radius: 4px;
    background: #FFFFFF;
    color: #2B7FC5;
    font-family: inherit;
    font-size: 11px;
    outline: none;
    min-width: 0;
  }
  .naming-input::placeholder {
    color: #BBB;
  }
</style>
