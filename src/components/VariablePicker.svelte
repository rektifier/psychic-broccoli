<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable, NamedRequestResult } from '../lib/types';

  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
  export let namedResults: Record<string, NamedRequestResult> = {};
  export let visible: boolean = false;

  const dispatch = createEventDispatcher();

  let searchQuery = '';
  let insertedKey: string | null = null;
  let insertedTimeout: ReturnType<typeof setTimeout> | null = null;

  $: if (visible) { searchQuery = ''; insertedKey = null; }

  function matchesSearch(key: string, value: string): boolean {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return key.toLowerCase().includes(q) || value.toLowerCase().includes(q);
  }

  function truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  // Flatten JSON object into dot-path entries
  function flattenJson(obj: any, prefix: string = '$', maxDepth: number = 4): { path: string; value: string }[] {
    const entries: { path: string; value: string }[] = [];
    if (maxDepth <= 0 || obj == null) return entries;

    if (typeof obj !== 'object') {
      entries.push({ path: prefix, value: String(obj) });
      return entries;
    }

    if (Array.isArray(obj)) {
      obj.slice(0, 3).forEach((item, i) => {
        entries.push(...flattenJson(item, `${prefix}[${i}]`, maxDepth - 1));
      });
      if (obj.length > 3) {
        entries.push({ path: `${prefix}[...]`, value: `${obj.length} items` });
      }
      return entries;
    }

    for (const [key, value] of Object.entries(obj)) {
      const path = `${prefix}.${key}`;
      if (typeof value === 'object' && value !== null) {
        entries.push(...flattenJson(value, path, maxDepth - 1));
      } else {
        entries.push({ path, value: String(value ?? 'null') });
      }
    }
    return entries;
  }

  // Env entries (excluding file vars that overlap)
  $: envEntries = Object.entries(envVariables);
  $: fileOnly = fileVariables.filter(v => !(v.key in envVariables));

  // Filtered lists
  $: filteredEnv = envEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredFile = fileOnly.filter(v => matchesSearch(v.key, v.value));
  $: filteredDynamic = [
    { key: '$randomInt', value: 'random number', insert: '{{$randomInt 1 100}}' },
    { key: '$timestamp', value: 'unix epoch', insert: '{{$timestamp}}' },
    { key: '$datetime', value: 'ISO 8601 date', insert: '{{$datetime iso8601}}' },
  ].filter(d => matchesSearch(d.key, d.value));

  // Build response field options for each named result
  $: responseGroups = Object.entries(namedResults).map(([name, result]) => {
    let bodyFields: { path: string; value: string }[] = [];
    try {
      const parsed = JSON.parse(result.response.body);
      bodyFields = flattenJson(parsed);
    } catch {
      bodyFields = [{ path: '*', value: result.response.body.slice(0, 50) }];
    }

    const headerFields = Object.entries(result.response.headers).map(([k, v]) => ({
      path: k,
      value: String(v),
    }));

    return { name, status: result.response.status, bodyFields, headerFields };
  });

  $: filteredResponseGroups = responseGroups.map(group => ({
    ...group,
    bodyFields: group.bodyFields.filter(f => matchesSearch(f.path, f.value)),
    headerFields: group.headerFields.filter(f => matchesSearch(f.path, f.value)),
  })).filter(g => g.bodyFields.length > 0 || g.headerFields.length > 0);

  $: hasEnvOrFile = envEntries.length > 0 || fileOnly.length > 0;
  $: totalVisible = filteredEnv.length + filteredFile.length + filteredDynamic.length
    + filteredResponseGroups.reduce((s, g) => s + g.bodyFields.length + g.headerFields.length, 0);

  function doInsert(key: string, value: string) {
    insertedKey = key;
    if (insertedTimeout) clearTimeout(insertedTimeout);
    insertedTimeout = setTimeout(() => {
      dispatch('insert', value);
      insertedKey = null;
    }, 150);
  }

  function insertEnvVar(key: string) {
    doInsert(key, `{{${key}}}`);
  }

  function insertResponseBody(reqName: string, path: string) {
    doInsert(`${reqName}.body.${path}`, `{{${reqName}.response.body.${path}}}`);
  }

  function insertResponseHeader(reqName: string, headerName: string) {
    doInsert(`${reqName}.hdr.${headerName}`, `{{${reqName}.response.headers.${headerName}}}`);
  }

  function close() {
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={visible ? handleKeydown : undefined} />

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" on:click|self={close} role="dialog" tabindex="-1">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Insert variable</span>
        <button class="btn-close" on:click={close}>&times;</button>
      </div>

      <div class="modal-body">
        <div class="search-bar">
          <input
            class="search-input"
            bind:value={searchQuery}
            placeholder="Filter variables..."
          />
        </div>

        <div class="sections">
          {#if totalVisible === 0 && searchQuery}
            <div class="empty-state">
              <p class="empty-title">No matching variables</p>
              <p class="empty-hint">Try a different search term.</p>
            </div>
          {:else}
            <!-- Environment variables -->
            {#if filteredEnv.length > 0}
              <div class="group-header">
                <span class="group-label">Environment</span>
                <span class="group-count">{filteredEnv.length}</span>
              </div>
              {#each filteredEnv as [key, value]}
                <button class="picker-row" class:inserted={insertedKey === key} on:click={() => insertEnvVar(key)}>
                  <span class="row-key">{key}</span>
                  <span class="row-value">{truncate(value, 30)}</span>
                  <span class="row-action">{insertedKey === key ? 'Inserted' : 'Insert'}</span>
                </button>
              {/each}
            {/if}

            <!-- File variables (not in env) -->
            {#if filteredFile.length > 0}
              <div class="group-header">
                <span class="group-label">File Variables</span>
                <span class="group-count">{filteredFile.length}</span>
              </div>
              {#each filteredFile as v}
                <button class="picker-row" class:inserted={insertedKey === v.key} on:click={() => insertEnvVar(v.key)}>
                  <span class="row-key">{v.key}</span>
                  <span class="row-value">{truncate(v.value, 30)}</span>
                  <span class="row-action">{insertedKey === v.key ? 'Inserted' : 'Insert'}</span>
                </button>
              {/each}
            {/if}

            {#if !hasEnvOrFile && !searchQuery}
              <div class="group-header">
                <span class="group-label">Environment</span>
              </div>
              <div class="empty-hint">No environment or file variables defined.</div>
            {/if}

            <!-- Dynamic variables -->
            {#if filteredDynamic.length > 0}
              <div class="group-header">
                <span class="group-label">Dynamic</span>
                <span class="group-count">{filteredDynamic.length}</span>
              </div>
              {#each filteredDynamic as d}
                <button class="picker-row" class:inserted={insertedKey === d.key} on:click={() => doInsert(d.key, d.insert)}>
                  <span class="row-key">{d.key}</span>
                  <span class="row-value">{d.value}</span>
                  <span class="row-action">{insertedKey === d.key ? 'Inserted' : 'Insert'}</span>
                </button>
              {/each}
            {/if}

            <!-- Response groups -->
            {#each filteredResponseGroups as group}
              {#if group.bodyFields.length > 0}
                <div class="group-header">
                  <span class="group-label">Response body - {group.name}</span>
                  <span class="status-badge" class:success={group.status < 400} class:error={group.status >= 400}>
                    {group.status}
                  </span>
                  <span class="group-count">{group.bodyFields.length}</span>
                </div>
                {#each group.bodyFields.slice(0, 12) as field}
                  {@const rowKey = `${group.name}.body.${field.path}`}
                  <button class="picker-row" class:inserted={insertedKey === rowKey} on:click={() => insertResponseBody(group.name, field.path)}>
                    <span class="row-key">{field.path}</span>
                    <span class="row-value">{truncate(field.value, 30)}</span>
                    <span class="row-action">{insertedKey === rowKey ? 'Inserted' : 'Insert'}</span>
                  </button>
                {/each}
                {#if group.bodyFields.length > 12}
                  <div class="empty-hint">{group.bodyFields.length - 12} more fields...</div>
                {/if}
              {/if}

              {#if group.headerFields.length > 0}
                <div class="group-header">
                  <span class="group-label">Response headers - {group.name}</span>
                  <span class="group-count">{group.headerFields.length}</span>
                </div>
                {#each group.headerFields as field}
                  {@const rowKey = `${group.name}.hdr.${field.path}`}
                  <button class="picker-row" class:inserted={insertedKey === rowKey} on:click={() => insertResponseHeader(group.name, field.path)}>
                    <span class="row-key">{field.path}</span>
                    <span class="row-value">{truncate(field.value, 30)}</span>
                    <span class="row-action">{insertedKey === rowKey ? 'Inserted' : 'Insert'}</span>
                  </button>
                {/each}
              {/if}
            {/each}

            {#if responseGroups.length === 0 && !searchQuery}
              <div class="group-header">
                <span class="group-label">Response references</span>
              </div>
              <div class="empty-hint">Send a request with a response alias first (right-click a request to set one).</div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 100;
    background: rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    width: 420px;
    max-width: 90vw;
    max-height: 80vh;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #DCDCE2;
    flex-shrink: 0;
  }
  .modal-title {
    font-size: 13px;
    font-weight: 600;
    color: #1A1A2E;
  }
  .btn-close {
    width: 24px; height: 24px;
    border: none; border-radius: 4px;
    background: transparent; color: #999;
    font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-close:hover { background: #E4E4EA; color: #444; }

  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .search-bar {
    padding: 10px 16px 0 16px;
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }
  .search-input:focus { border-color: #D4900A; }
  .search-input::placeholder { color: #BBB; }

  .sections {
    flex: 1;
    overflow-y: auto;
    padding-top: 6px;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #999;
    background: #F0F0F4;
    border-top: 1px solid #DCDCE2;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group-label {
    flex: 1;
  }
  .group-count {
    font-size: 9px;
    color: #BBB;
    background: #E4E4EA;
    padding: 0 5px;
    border-radius: 6px;
    letter-spacing: 0;
    text-transform: none;
  }

  .status-badge {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: none;
    letter-spacing: 0;
  }
  .status-badge.success { background: #3D8B4518; color: #3D8B45; }
  .status-badge.error { background: #CC445518; color: #CC4455; }

  .picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 16px;
    border: none;
    background: transparent;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .picker-row:hover { background: #F5F5FA; }
  .picker-row.inserted { background: #E8F5E9; }

  .row-key {
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: #9A7520;
    font-weight: 600;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-value {
    color: #999;
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .row-action {
    font-size: 9px;
    font-weight: 600;
    color: #BBB;
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .picker-row:hover .row-action { opacity: 1; }
  .picker-row.inserted .row-action {
    opacity: 1;
    color: #3D8B45;
  }

  .empty-hint {
    padding: 8px 16px;
    font-size: 11px;
    color: #BBB;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    gap: 6px;
  }
  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: #888;
    margin: 0;
  }
  .empty-hint {
    font-size: 11px;
    color: #BBB;
    line-height: 1.5;
  }
</style>
