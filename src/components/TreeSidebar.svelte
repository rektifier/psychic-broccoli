<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import TreeNode from './TreeNode.svelte';
  import type { TreeNode as TNode, RequestLocation } from '../lib/types';

  export let tree: TNode[] = [];
  export let selected: RequestLocation | null = null;
  export let rootName: string = 'Workspace';

  // Environment props
  export let environments: string[] = [];
  export let activeEnv: string | null = null;

  const dispatch = createEventDispatcher();

  let showAddEnv = false;
  let showImportMenu = false;
  let newEnvName = '';
  let inputEl: HTMLInputElement;
  let importBtnEl: HTMLButtonElement;
  let importMenuEl: HTMLDivElement;

  function handleWindowClick(e: MouseEvent) {
    if (
      showImportMenu &&
      importBtnEl && !importBtnEl.contains(e.target as Node) &&
      importMenuEl && !importMenuEl.contains(e.target as Node)
    ) {
      showImportMenu = false;
    }
  }

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

  $: if (showAddEnv && inputEl) inputEl.focus();
</script>

<svelte:window on:click={handleWindowClick} />

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
      <div class="import-wrapper">
        <button
          bind:this={importBtnEl}
          class="btn-import"
          class:active={showImportMenu}
          on:click={() => { showImportMenu = !showImportMenu; }}
          title="Import collection"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8M5 7l3 3 3-3M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {#if showImportMenu}
          <div class="import-menu" bind:this={importMenuEl}>
            <button class="import-menu-item" on:click={() => { showImportMenu = false; dispatch('importPostman'); }}>
              Postman Collection
            </button>
            <button class="import-menu-item" on:click={() => { showImportMenu = false; dispatch('importInsomnia'); }}>
              Insomnia Export
            </button>
          </div>
        {/if}
      </div>
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

  <!-- Tree -->
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

  .import-wrapper {
    position: relative;
    flex-shrink: 0;
  }
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
  .btn-import:hover, .btn-import.active {
    border-color: #D4900A; color: #D4900A; background: #D4900A10;
  }

  .import-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 100;
    padding: 4px;
  }
  .import-menu-item {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .import-menu-item:hover {
    background: #F0F0F4;
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

  /* Tree */
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
</style>
