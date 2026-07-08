<script lang="ts">
  import { tick } from 'svelte';
  import Self from './TreeNode.svelte';
  import type { TreeNode as TNode, RequestLocation } from '../lib/types';
  import { METHOD_COLORS } from '../lib/theme';

  interface Props {
    node: TNode;
    selected?: RequestLocation | null;
    depth?: number;
    displayMode?: 'name' | 'url';
    sortByUrl?: boolean;
    usedNames?: string[];
    forceExpand?: boolean;
    /** When set and matches this node's path, auto-enter inline rename mode */
    editingFilePath?: string | null;
    /** When set and matches this folder's path, auto-enter inline folder rename mode */
    editingFolderPath?: string | null;
    /** Sibling file names in the same folder (for collision detection) */
    siblingNames?: string[];
    /** Sibling folder/file names in the same folder (for folder rename collision detection) */
    siblingFolderNames?: string[];
    onToggleFolder?: (folderPath: string) => void;
    onSelect?: (location: RequestLocation) => void;
    onPinRequest?: (detail: { filePath: string; requestIndex: number; label: string }) => void;
    onAddRequest?: (filePath: string) => void;
    onDeleteRequest?: (detail: { filePath: string; requestIndex: number }) => void;
    onDeleteFile?: (filePath: string) => void;
    onDeleteFolder?: (folderPath: string) => void;
    onNameRequest?: (detail: { filePath: string; requestIndex: number; varName: string }) => void;
    onRenameFile?: (detail: { oldPath: string; newName: string }) => void;
    onRenameFolder?: (detail: { oldPath: string; newName: string }) => void;
    onDuplicateFile?: (filePath: string) => void;
    onCreateFile?: (parentPath: string) => void;
    onCreateFolder?: (parentPath: string) => void;
    onCancelRename?: () => void;
  }

  let {
    node,
    selected = null,
    depth = 0,
    displayMode = 'name',
    sortByUrl = false,
    usedNames = [],
    forceExpand = false,
    editingFilePath = null,
    editingFolderPath = null,
    siblingNames = [],
    siblingFolderNames = [],
    onToggleFolder,
    onSelect,
    onPinRequest,
    onAddRequest,
    onDeleteRequest,
    onDeleteFile,
    onDeleteFolder,
    onNameRequest,
    onRenameFile,
    onRenameFolder,
    onDuplicateFile,
    onCreateFile,
    onCreateFolder,
    onCancelRename,
  }: Props = $props();

  const INVALID_FS_CHARS = /[/\\:*?"<>|]/;

  let fileExpanded = $state(false);
  let namingIndex = $state(-1);

  /** Compute unique URL suffixes for requests in a file node */
  function computeUrlSuffixes(requests: { url: string }[]): string[] {
    if (requests.length === 0) return [];
    if (requests.length === 1) return [requests[0].url];
    const split = requests.map((r) => r.url.split('/'));
    const minLen = Math.min(...split.map((s) => s.length));
    let common = 0;
    for (let i = 0; i < minLen; i++) {
      if (split.every((s) => s[i] === split[0][i])) common = i + 1;
      else break;
    }
    if (common === 0) return requests.map((r) => r.url);
    return split.map((s) => {
      const unique = s.slice(common);
      return '/' + unique.join('/');
    });
  }

  const urlSuffixes = $derived(node.type === 'file' ? computeUrlSuffixes(node.requests) : []);
  const sortedIndices = $derived(
    node.type === 'file'
      ? sortByUrl
        ? [...Array(node.requests.length).keys()].sort((a, b) =>
            node.requests[a].url.localeCompare(node.requests[b].url),
          )
        : [...Array(node.requests.length).keys()]
      : [],
  );
  let namingValue = $state('');
  let confirmDeleteIndex = $state(-1);
  let showFileMenu = $state(false);
  let fileMenuPos = $state({ x: 0, y: 0 });
  let confirmDeleteFile = $state(false);
  let confirmDeleteFolder = $state(false);

  // Inline file rename state
  let renamingFile = $state(false);
  let renamingValue = $state('');
  let renameInputEl: HTMLInputElement | null = $state(null);
  let cancelledRename = false;

  // Folder context menu state
  let showFolderMenu = $state(false);
  let folderMenuPos = $state({ x: 0, y: 0 });

  // Inline folder rename state
  let renamingFolder = $state(false);
  let renamingFolderValue = $state('');
  let folderRenameInputEl: HTMLInputElement | null = $state(null);
  let cancelledFolderRename = false;

  // Auto-enter rename mode when editingFilePath matches this node
  $effect(() => {
    if (node.type === 'file' && editingFilePath === node.path && !renamingFile) {
      enterFileRename();
    }
  });

  // Auto-enter folder rename mode when editingFolderPath matches this folder
  $effect(() => {
    if (node.type === 'folder' && editingFolderPath === node.path && !renamingFolder) {
      enterFolderRename();
    }
  });

  function enterFileRename() {
    cancelledRename = false;
    renamingFile = true;
    renamingValue = node.type === 'file' ? node.name.replace(/\.(http|rest)$/, '') : '';
    tick().then(() => {
      renameInputEl?.focus();
      renameInputEl?.select();
    });
  }

  const fileRenameError = $derived.by(() => {
    if (!renamingFile) return '';
    const v = renamingValue.trim();
    if (!v) return 'Name required';
    if (INVALID_FS_CHARS.test(v)) return 'Invalid character';
    const fullName = v + '.http';
    if (node.type === 'file' && fullName !== node.name && siblingNames.includes(fullName))
      return 'Name in use';
    return '';
  });

  function confirmFileRename() {
    if (!renamingFile) return;
    if (cancelledRename) {
      cancelledRename = false;
      return;
    }
    if (fileRenameError) return;
    const newName = renamingValue.trim();
    renamingFile = false;
    renamingValue = '';
    if (node.type === 'file') {
      const currentStem = node.name.replace(/\.(http|rest)$/, '');
      if (newName !== currentStem) {
        onRenameFile?.({ oldPath: node.path, newName: newName + '.http' });
      }
    }
    onCancelRename?.();
  }

  function cancelFileRename() {
    cancelledRename = true;
    renamingFile = false;
    renamingValue = '';
    onCancelRename?.();
  }

  function enterFolderRename() {
    cancelledFolderRename = false;
    renamingFolder = true;
    renamingFolderValue = node.type === 'folder' ? node.name : '';
    tick().then(() => {
      folderRenameInputEl?.focus();
      folderRenameInputEl?.select();
    });
  }

  const folderRenameError = $derived.by(() => {
    if (!renamingFolder) return '';
    const v = renamingFolderValue.trim();
    if (!v) return 'Name required';
    if (INVALID_FS_CHARS.test(v)) return 'Invalid character';
    if (node.type === 'folder' && v !== node.name && siblingFolderNames.includes(v))
      return 'Name in use';
    return '';
  });

  function confirmFolderRename() {
    if (!renamingFolder) return;
    if (cancelledFolderRename) {
      cancelledFolderRename = false;
      return;
    }
    if (folderRenameError) return;
    const newName = renamingFolderValue.trim();
    renamingFolder = false;
    renamingFolderValue = '';
    if (node.type === 'folder' && newName !== node.name) {
      onRenameFolder?.({ oldPath: node.path, newName });
    }
    onCancelRename?.();
  }

  function cancelFolderRename() {
    cancelledFolderRename = true;
    renamingFolder = false;
    renamingFolderValue = '';
    onCancelRename?.();
  }

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

  function handleFolderContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showFolderMenu = true;
    confirmDeleteFolder = false;
    folderMenuPos = { x: e.clientX, y: e.clientY };

    const dismiss = () => {
      showFolderMenu = false;
      confirmDeleteFolder = false;
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
    };
    setTimeout(() => {
      window.addEventListener('click', dismiss);
      window.addEventListener('contextmenu', dismiss);
    });
  }

  const isDuplicate = $derived.by(() => {
    const v = namingValue.trim();
    if (!v || namingIndex < 0) return false;
    const currentVarName = node.type === 'file' ? node.requests[namingIndex]?.varName : null;
    if (v === currentVarName) return false;
    return usedNames.includes(v);
  });

  function isSel(fp: string, ri: number): boolean {
    return selected?.filePath === fp && selected?.requestIndex === ri;
  }

  function startNaming(index: number, currentName: string | null) {
    namingIndex = index;
    namingValue = currentName || '';
  }

  function confirmNaming(filePath: string) {
    if (isDuplicate) return;
    onNameRequest?.({ filePath, requestIndex: namingIndex, varName: namingValue.trim() });
    namingIndex = -1;
    namingValue = '';
  }

  // Keep file expanded when it contains the selection
  $effect(() => {
    if (node.type === 'file' && selected?.filePath === node.path) {
      fileExpanded = true;
    }
  });

  /** Compute sibling file names for child nodes in a folder */
  function childSiblingNames(children: TNode[]): string[] {
    return children.filter((c) => c.type === 'file').map((c) => c.name);
  }
</script>

{#if node.type === 'folder'}
  <!-- Folder -->
  {#if renamingFolder}
    <div class="tree-row folder-row folder-rename-row" style="padding-left: {12 + depth * 16}px">
      <span class="chevron">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 1.5l4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <svg class="icon folder-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 12V4.5a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"
          fill="#B0883020"
          stroke="#B08830"
          stroke-width="1.2"
        />
      </svg>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={folderRenameInputEl}
        class={['file-rename-input', { 'naming-error': !!folderRenameError }]}
        bind:value={renamingFolderValue}
        onkeydown={(e) => {
          if (e.key === 'Enter') confirmFolderRename();
          if (e.key === 'Escape') cancelFolderRename();
        }}
        onblur={confirmFolderRename}
        spellcheck="false"
        autofocus
      />
      {#if folderRenameError}
        <span class="naming-duplicate-hint">{folderRenameError}</span>
      {/if}
    </div>
  {:else}
    <button
      class="tree-row folder-row"
      style="padding-left: {12 + depth * 16}px"
      onclick={() => onToggleFolder?.(node.path)}
      oncontextmenu={handleFolderContextMenu}
    >
      <span class={['chevron', { open: node.expanded }]}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 1.5l4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <svg class="icon folder-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 12V4.5a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"
          fill="#B0883020"
          stroke="#B08830"
          stroke-width="1.2"
        />
      </svg>
      <span class="node-name">{node.name}</span>
    </button>
  {/if}

  {#if showFolderMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="file-context-menu folder-context-menu"
      style="left: {folderMenuPos.x}px; top: {folderMenuPos.y}px"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if confirmDeleteFolder}
        <span class="confirm-delete-text">Has items, delete anyway?</span>
        <button
          class="confirm-delete-yes"
          onclick={(e) => {
            e.stopPropagation();
            onDeleteFolder?.(node.path);
            showFolderMenu = false;
            confirmDeleteFolder = false;
          }}>Yes</button
        >
        <button
          class="confirm-delete-no"
          onclick={(e) => {
            e.stopPropagation();
            showFolderMenu = false;
            confirmDeleteFolder = false;
          }}>No</button
        >
      {:else}
        <button
          class="file-context-item"
          onclick={(e) => {
            e.stopPropagation();
            onCreateFile?.(node.path);
            showFolderMenu = false;
          }}>New .http file</button
        >
        <button
          class="file-context-item"
          onclick={(e) => {
            e.stopPropagation();
            onCreateFolder?.(node.path);
            showFolderMenu = false;
          }}>New subfolder</button
        >
        <div class="context-menu-divider"></div>
        <button
          class="file-context-item"
          onclick={(e) => {
            e.stopPropagation();
            showFolderMenu = false;
            enterFolderRename();
          }}>Rename</button
        >
        <button
          class="file-context-item file-context-delete"
          onclick={(e) => {
            e.stopPropagation();
            if (node.type === 'folder' && node.children.length === 0) {
              onDeleteFolder?.(node.path);
              showFolderMenu = false;
            } else {
              confirmDeleteFolder = true;
            }
          }}>Delete folder</button
        >
      {/if}
    </div>
  {/if}

  {#if node.expanded}
    <div class="children">
      {#each node.children as child}
        <Self
          node={child}
          {selected}
          depth={depth + 1}
          {displayMode}
          {sortByUrl}
          {usedNames}
          {forceExpand}
          {editingFilePath}
          {editingFolderPath}
          siblingNames={childSiblingNames(node.children)}
          siblingFolderNames={node.children.map((c) => c.name)}
          {onToggleFolder}
          {onSelect}
          {onPinRequest}
          {onAddRequest}
          {onDeleteRequest}
          {onDeleteFile}
          {onDeleteFolder}
          {onNameRequest}
          {onRenameFile}
          {onRenameFolder}
          {onDuplicateFile}
          {onCreateFile}
          {onCreateFolder}
          {onCancelRename}
        />
      {/each}
    </div>
  {/if}
{:else if node.type === 'file'}
  <!-- .http File -->
  {#if renamingFile}
    <div class="tree-row file-row file-rename-row" style="padding-left: {12 + depth * 16}px">
      <span class="chevron"
        ><svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 1.5l4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg></span
      >
      <svg class="icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
          fill="#2B7FC518"
          stroke="#2B7FC5"
          stroke-width="1.2"
        />
        <path d="M9 2v4h4" stroke="#2B7FC5" stroke-width="1.2" />
      </svg>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={renameInputEl}
        class={['file-rename-input', { 'naming-error': !!fileRenameError }]}
        bind:value={renamingValue}
        onkeydown={(e) => {
          if (e.key === 'Enter') confirmFileRename();
          if (e.key === 'Escape') cancelFileRename();
        }}
        onblur={confirmFileRename}
        spellcheck="false"
        autofocus
      />
      <span class="file-rename-ext">.http</span>
      {#if fileRenameError}
        <span class="naming-duplicate-hint">{fileRenameError}</span>
      {/if}
    </div>
  {:else}
    <div
      class={['tree-row', 'file-row', { dirty: node.dirty }]}
      style="padding-left: {12 + depth * 16}px"
      onclick={() => (fileExpanded = !fileExpanded)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileExpanded = !fileExpanded;
        }
      }}
      oncontextmenu={handleFileContextMenu}
      role="button"
      tabindex="0"
    >
      <span class={['chevron', { open: fileExpanded }]}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 1.5l4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <svg class="icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
          fill="#2B7FC518"
          stroke="#2B7FC5"
          stroke-width="1.2"
        />
        <path d="M9 2v4h4" stroke="#2B7FC5" stroke-width="1.2" />
      </svg>
      <span class="node-name">{node.name.replace(/\.(http|rest)$/, '')}</span>
      {#if node.dirty}
        <span class="dirty-dot"></span>
      {/if}
      <button
        class="btn-add-req"
        onclick={(e) => {
          e.stopPropagation();
          onAddRequest?.(node.path);
        }}
        title="Add request">+</button
      >
      <span class="req-count">{node.requests.length}</span>
    </div>
  {/if}

  {#if showFileMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="file-context-menu"
      style="left: {fileMenuPos.x}px; top: {fileMenuPos.y}px"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if confirmDeleteFile}
        <span class="confirm-delete-text">Delete file?</span>
        <button
          class="confirm-delete-yes"
          onclick={(e) => {
            e.stopPropagation();
            onDeleteFile?.(node.path);
            showFileMenu = false;
            confirmDeleteFile = false;
          }}>Yes</button
        >
        <button
          class="confirm-delete-no"
          onclick={(e) => {
            e.stopPropagation();
            showFileMenu = false;
            confirmDeleteFile = false;
          }}>No</button
        >
      {:else}
        <button
          class="file-context-item"
          onclick={(e) => {
            e.stopPropagation();
            showFileMenu = false;
            enterFileRename();
          }}>Rename</button
        >
        <button
          class="file-context-item"
          onclick={(e) => {
            e.stopPropagation();
            onDuplicateFile?.(node.path);
            showFileMenu = false;
          }}>Duplicate</button
        >
        <div class="context-menu-divider"></div>
        <button
          class="file-context-item file-context-delete"
          onclick={(e) => {
            e.stopPropagation();
            confirmDeleteFile = true;
          }}>Delete file</button
        >
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
              class={['naming-input', { 'naming-error': isDuplicate }]}
              bind:value={namingValue}
              onkeydown={(e) => {
                if (e.key === 'Enter') confirmNaming(node.path);
                if (e.key === 'Escape') {
                  namingIndex = -1;
                }
              }}
              onblur={() => confirmNaming(node.path)}
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
            class={['tree-row', 'request-row', { active: isSel(node.path, i) }]}
            style="padding-left: {28 + depth * 16}px"
            onclick={() => onSelect?.({ filePath: node.path, requestIndex: i })}
            ondblclick={() =>
              onPinRequest?.({ filePath: node.path, requestIndex: i, label: req.name })}
            oncontextmenu={(e) => {
              e.preventDefault();
              startNaming(i, req.varName);
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.({ filePath: node.path, requestIndex: i });
              }
            }}
            role="button"
            tabindex="0"
          >
            <span class="method-badge" style="color: {METHOD_COLORS[req.method] || '#888'}">
              {req.method.slice(0, 3)}
            </span>
            <span class="req-name" title={displayMode === 'url' ? req.name : req.url}
              >{displayMode === 'url' ? urlSuffixes[i] : req.name}</span
            >
            {#if req.varName}
              <span class="varname-tag">{req.varName}</span>
            {/if}
            {#if node.requests.length > 1}
              {#if confirmDeleteIndex === i}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="confirm-delete-popup"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => e.stopPropagation()}
                  role="alert"
                >
                  <span class="confirm-delete-text">Delete?</span>
                  <button
                    class="confirm-delete-yes"
                    onclick={(e) => {
                      e.stopPropagation();
                      onDeleteRequest?.({ filePath: node.path, requestIndex: i });
                      confirmDeleteIndex = -1;
                    }}>Yes</button
                  >
                  <button
                    class="confirm-delete-no"
                    onclick={(e) => {
                      e.stopPropagation();
                      confirmDeleteIndex = -1;
                    }}>No</button
                  >
                </div>
              {:else}
                <button
                  class="btn-del-req"
                  onclick={(e) => {
                    e.stopPropagation();
                    confirmDeleteIndex = i;
                  }}
                  title="Delete request">×</button
                >
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
    transition:
      background var(--duration-fast),
      color var(--duration-fast);
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
    background: #dde4f0;
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
    background: #b33344;
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
    flex-direction: column;
    gap: var(--space-0\.5);
    padding: var(--space-1) var(--space-1\.5);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 100;
    white-space: nowrap;
    min-width: 140px;
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
  .context-menu-divider {
    height: 1px;
    background: var(--color-divider);
    margin: var(--space-0\.5) 0;
  }

  /* Folder / file inline rename */
  .file-rename-row,
  .folder-rename-row {
    cursor: default;
  }
  .file-rename-input {
    flex: 1;
    padding: 2px var(--space-1\.5);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
    min-width: 0;
  }
  .file-rename-input.naming-error {
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .file-rename-ext {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    flex-shrink: 0;
  }
</style>
