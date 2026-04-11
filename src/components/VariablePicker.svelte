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

  $: searchQueryLower = searchQuery.trim().toLowerCase();

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
  $: filteredEnv = searchQueryLower
    ? envEntries.filter(([k, v]) =>
        k.toLowerCase().includes(searchQueryLower) ||
        v.toLowerCase().includes(searchQueryLower)
      )
    : envEntries;
  $: filteredFile = searchQueryLower
    ? fileOnly.filter(v =>
        v.key.toLowerCase().includes(searchQueryLower) ||
        v.value.toLowerCase().includes(searchQueryLower)
      )
    : fileOnly;
  const dynamicVars = [
    { key: '$randomInt', value: 'random number', insert: '{{$randomInt 1 100}}' },
    { key: '$timestamp', value: 'unix epoch', insert: '{{$timestamp}}' },
    { key: '$datetime', value: 'ISO 8601 date', insert: '{{$datetime iso8601}}' },
  ];
  $: filteredDynamic = searchQueryLower
    ? dynamicVars.filter(d =>
        d.key.toLowerCase().includes(searchQueryLower) ||
        d.value.toLowerCase().includes(searchQueryLower)
      )
    : dynamicVars;

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
    bodyFields: searchQueryLower
      ? group.bodyFields.filter(f =>
          f.path.toLowerCase().includes(searchQueryLower) ||
          f.value.toLowerCase().includes(searchQueryLower)
        )
      : group.bodyFields,
    headerFields: searchQueryLower
      ? group.headerFields.filter(f =>
          f.path.toLowerCase().includes(searchQueryLower) ||
          f.value.toLowerCase().includes(searchQueryLower)
        )
      : group.headerFields,
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
  /* Modal base from shared.css; only overrides here */
  .modal {
    width: 420px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-header {
    flex-shrink: 0;
  }
  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    padding: 0;
  }

  .search-bar {
    padding: var(--space-2\.5) var(--space-4) 0 var(--space-4);
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    padding: 7px var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
    box-sizing: border-box;
  }
  .search-input:focus { border-color: var(--color-primary); }
  .search-input::placeholder { color: var(--color-text-placeholder); }

  .sections {
    flex: 1;
    overflow-y: auto;
    padding-top: var(--space-1\.5);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--color-text-faint);
    background: var(--color-bg-sidebar);
    border-top: 1px solid var(--color-divider);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group-label {
    flex: 1;
  }
  .group-count {
    font-size: var(--text-2xs);
    color: var(--color-text-placeholder);
    background: var(--color-bg-muted);
    padding: 0 5px;
    border-radius: var(--radius-default);
    letter-spacing: 0;
    text-transform: none;
  }

  .status-badge {
    font-size: var(--text-2xs);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-sm);
    text-transform: none;
    letter-spacing: 0;
  }
  .status-badge.success { background: color-mix(in srgb, var(--color-success) 9%, transparent); color: var(--color-success); }
  .status-badge.error { background: color-mix(in srgb, var(--color-error) 9%, transparent); color: var(--color-error); }

  .picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 7px var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast);
  }
  .picker-row:hover { background: var(--color-bg-subtle); }
  .picker-row.inserted { background: #E8F5E9; }

  .row-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-warning);
    font-weight: var(--weight-semibold);
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-value {
    color: var(--color-text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .row-action {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-placeholder);
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0;
    transition: opacity var(--duration-fast);
  }
  .picker-row:hover .row-action { opacity: 1; }
  .picker-row.inserted .row-action {
    opacity: 1;
    color: var(--color-success);
  }

  .empty-hint {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-5);
    text-align: center;
    gap: var(--space-1\.5);
  }
  .empty-title {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--slate-350);
    margin: 0;
  }
  .empty-hint {
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
    line-height: 1.5;
  }
</style>
