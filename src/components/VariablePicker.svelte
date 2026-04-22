<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable, NamedRequestResult } from '../lib/types';
  import PickerRow from './PickerRow.svelte';

  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
  export let namedResults: Record<string, NamedRequestResult> = {};
  export let visible: boolean = false;
  /** When non-null, scopes the response section to these aliases (from the active test flow).
   *  Aliases without a captured result still appear with placeholder body/header rows. */
  export let flowAliases: { name: string; stepNumber: number }[] | null = null;
  /** Flow display name; used as the header of the flow-scope variables section. */
  export let flowName: string = '';
  /** Variables set via `pb.set` / `pb.global` during the flow's most recent run.
   *  Rendered as a collapsible section at the top of the flow-scoped picker. */
  export let flowSetVars: Record<string, string> = {};

  let expandedAliases: Record<string, boolean> = {};
  let flowVarsExpanded = false;
  $: if (visible) { expandedAliases = {}; flowVarsExpanded = false; }
  function toggleAlias(name: string) {
    expandedAliases = { ...expandedAliases, [name]: !expandedAliases[name] };
  }

  const dispatch = createEventDispatcher();

  let searchQuery = '';
  let insertedKey: string | null = null;
  let insertedTimeout: ReturnType<typeof setTimeout> | null = null;

  $: if (visible) { searchQuery = ''; insertedKey = null; }

  $: searchQueryLower = searchQuery.trim().toLowerCase();

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

  $: responseGroupMap = Object.fromEntries(responseGroups.map(g => [g.name, g]));

  $: hasEnvOrFile = envEntries.length > 0 || fileOnly.length > 0;

  // Flow-scoped aliases filtered by search query (match on name).
  $: filteredFlowAliases = flowAliases
    ? (searchQueryLower
        ? flowAliases.filter(a => a.name.toLowerCase().includes(searchQueryLower))
        : flowAliases)
    : [];

  // Flow-scope variables (pb.set / pb.global captured last run), filtered by search.
  $: flowSetEntries = Object.entries(flowSetVars);
  $: filteredFlowSet = searchQueryLower
    ? flowSetEntries.filter(([k, v]) =>
        k.toLowerCase().includes(searchQueryLower) ||
        v.toLowerCase().includes(searchQueryLower))
    : flowSetEntries;

  $: totalVisible = filteredEnv.length + filteredFile.length + filteredDynamic.length
    + (flowAliases
        ? filteredFlowAliases.length + filteredFlowSet.length
        : filteredResponseGroups.reduce((s, g) => s + g.bodyFields.length + g.headerFields.length, 0));

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
            <!-- Flow-scoped sections (rendered first in flow picker) -->
            {#if flowAliases !== null}
              <!-- Flow-scope variables: pb.set / pb.global captured on the most recent run. -->
              {#if filteredFlowSet.length > 0}
                <button
                  class="group-header group-header-button"
                  class:open={flowVarsExpanded}
                  on:click={() => (flowVarsExpanded = !flowVarsExpanded)}
                  aria-expanded={flowVarsExpanded}
                  title="Variables set by this flow via pb.set or pb.global on its last run"
                >
                  <span class="chevron" aria-hidden="true">{flowVarsExpanded ? '▾' : '▸'}</span>
                  <span class="group-label">{flowName || 'Flow variables'}</span>
                  <span class="group-count">{filteredFlowSet.length}</span>
                </button>
                {#if flowVarsExpanded}
                  {#each filteredFlowSet as [key, value]}
                    {@const rowKey = `flowvar.${key}`}
                    <PickerRow nested label={key} {value} inserted={insertedKey === rowKey} on:click={() => doInsert(rowKey, `{{${key}}}`)} />
                  {/each}
                {/if}
              {/if}

              {#each filteredFlowAliases as alias}
                {@const group = responseGroupMap[alias.name]}
                {@const isOpen = expandedAliases[alias.name] === true}
                {@const bodyFields = group ? (searchQueryLower
                  ? group.bodyFields.filter(f => f.path.toLowerCase().includes(searchQueryLower) || f.value.toLowerCase().includes(searchQueryLower))
                  : group.bodyFields) : []}
                {@const headerFields = group ? (searchQueryLower
                  ? group.headerFields.filter(f => f.path.toLowerCase().includes(searchQueryLower) || f.value.toLowerCase().includes(searchQueryLower))
                  : group.headerFields) : []}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <button
                  class="group-header group-header-button"
                  class:open={isOpen}
                  on:click={() => toggleAlias(alias.name)}
                  aria-expanded={isOpen}
                >
                  <span class="chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <span class="step-pill">{alias.stepNumber}</span>
                  <span class="group-label">{alias.name} - Response</span>
                  {#if group}
                    <span class="status-badge" class:success={group.status < 400} class:error={group.status >= 400}>{group.status}</span>
                  {:else}
                    <span class="status-badge pending">not run</span>
                  {/if}
                </button>
                {#if isOpen}
                  <div class="sub-header">Body</div>
                  {#if group && bodyFields.length > 0}
                    {#each bodyFields.slice(0, 12) as field}
                      {@const rowKey = `${alias.name}.body.${field.path}`}
                      <PickerRow nested label={field.path} value={field.value} inserted={insertedKey === rowKey} on:click={() => insertResponseBody(alias.name, field.path)} />
                    {/each}
                    {#if bodyFields.length > 12}
                      <div class="empty-hint">{bodyFields.length - 12} more fields...</div>
                    {/if}
                  {:else}
                    {@const bodyKey = `${alias.name}.body.pending`}
                    <PickerRow nested label="$" value={group ? 'no matches' : 'fill in JSONPath after $'} inserted={insertedKey === bodyKey} on:click={() => doInsert(bodyKey, `{{${alias.name}.response.body.$.}}`)} />
                  {/if}

                  <div class="sub-header">Headers</div>
                  {#if group && headerFields.length > 0}
                    {#each headerFields as field}
                      {@const rowKey = `${alias.name}.hdr.${field.path}`}
                      <PickerRow nested label={field.path} value={field.value} inserted={insertedKey === rowKey} on:click={() => insertResponseHeader(alias.name, field.path)} />
                    {/each}
                  {:else}
                    {@const hdrKey = `${alias.name}.hdr.pending`}
                    <PickerRow nested label="headers" value={group ? 'no matches' : 'fill in header name'} inserted={insertedKey === hdrKey} on:click={() => doInsert(hdrKey, `{{${alias.name}.response.headers.}}`)} />
                  {/if}
                {/if}
              {/each}

              {#if filteredFlowAliases.length === 0 && !searchQuery}
                <div class="group-header">
                  <span class="group-label">From earlier steps in this flow</span>
                </div>
                <div class="empty-hint">No preceding steps have a response alias. Add <code>{'#'} @name alias</code> to a request above this step.</div>
              {/if}
            {/if}

            <!-- Environment variables -->
            {#if filteredEnv.length > 0}
              <div class="group-header">
                <span class="group-label">Environment</span>
                <span class="group-count">{filteredEnv.length}</span>
              </div>
              {#each filteredEnv as [key, value]}
                <PickerRow label={key} {value} inserted={insertedKey === key} on:click={() => insertEnvVar(key)} />
              {/each}
            {/if}

            <!-- File variables (not in env) -->
            {#if filteredFile.length > 0}
              <div class="group-header">
                <span class="group-label">File Variables</span>
                <span class="group-count">{filteredFile.length}</span>
              </div>
              {#each filteredFile as v}
                <PickerRow label={v.key} value={v.value} inserted={insertedKey === v.key} on:click={() => insertEnvVar(v.key)} />
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
                <PickerRow label={d.key} value={d.value} inserted={insertedKey === d.key} on:click={() => doInsert(d.key, d.insert)} />
              {/each}
            {/if}

            <!-- Response groups - non-flow picker (unchanged) -->
            {#if flowAliases === null}
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
                    <PickerRow label={field.path} value={field.value} inserted={insertedKey === rowKey} on:click={() => insertResponseBody(group.name, field.path)} />
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
                    <PickerRow label={field.path} value={field.value} inserted={insertedKey === rowKey} on:click={() => insertResponseHeader(group.name, field.path)} />
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
  .status-badge.pending { background: color-mix(in srgb, var(--color-text-muted) 12%, transparent); color: var(--color-text-muted); }

  .group-header-button {
    border: none;
    border-top: 1px solid var(--color-divider);
    background: var(--color-bg-sidebar);
    font: inherit;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--color-text-faint);
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
  }
  .chevron {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    width: 12px;
    display: inline-flex;
    justify-content: center;
  }
  .step-pill {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    color: var(--color-accent-flow);
    background: color-mix(in srgb, var(--color-accent-flow) 10%, transparent);
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .sub-header {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: var(--space-1\.5) var(--space-2) var(--space-1\.5) var(--space-6);
    background: color-mix(in srgb, var(--color-text-muted) 6%, transparent);
    border-top: 1px solid var(--color-divider);
    border-bottom: 1px solid var(--color-divider);
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
