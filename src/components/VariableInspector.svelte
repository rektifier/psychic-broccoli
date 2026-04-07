<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable, NamedRequestResult, ResolvedVarWithCascade, VarSourceLayer } from '../lib/types';

  export let visible: boolean = false;
  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
  export let envVarSources: Record<string, ResolvedVarWithCascade> = {};
  export let kvVariables: Record<string, string> = {};
  export let pbOverrides: Record<string, string> = {};
  export let pbGlobals: Record<string, string> = {};
  export let namedResults: Record<string, NamedRequestResult> = {};
  export let activeEnv: string | null = null;
  export let activeFileName: string = '';

  const dispatch = createEventDispatcher<{
    close: void;
    clearRuntime: void;
  }>();

  let fileExpanded = true;
  let envExpanded = true;
  let kvExpanded = true;
  let runtimeExpanded = true;

  let searchQuery = '';
  let showKvSecrets = false;
  let copiedKey: string | null = null;
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  let expandedCascadeKey: string | null = null;

  function sourceTagLabel(source: VarSourceLayer): string {
    switch (source) {
      case 'shared': return '$shared';
      case 'user-shared': return '$shared.user';
      case 'env': return 'env';
      case 'user-env': return 'env.user';
    }
  }

  function sourceTagClass(source: VarSourceLayer): string {
    switch (source) {
      case 'shared': return 'source-shared';
      case 'user-shared': return 'source-user';
      case 'env': return 'source-env';
      case 'user-env': return 'source-user';
    }
  }

  function toggleCascade(key: string) {
    expandedCascadeKey = expandedCascadeKey === key ? null : key;
  }

  $: if (visible) { searchQuery = ''; copiedKey = null; showKvSecrets = false; expandedCascadeKey = null; }

  $: kvKeys = new Set(Object.keys(kvVariables));
  $: envEntries = Object.entries(envVariables).filter(([k]) =>
    !(k in pbOverrides) && !(k in pbGlobals) && !kvKeys.has(k)
  );
  $: kvEntries = Object.entries(envVariables).filter(([k]) =>
    !(k in pbOverrides) && !(k in pbGlobals) && kvKeys.has(k)
  );
  $: overrideEntries = Object.entries(pbOverrides).filter(([k]) => !(k in pbGlobals));
  $: globalEntries = Object.entries(pbGlobals);
  $: namedEntries = Object.entries(namedResults).filter(([k]) => !k.startsWith('__pb_'));

  $: runtimeCount = overrideEntries.length + globalEntries.length + namedEntries.length;
  $: hasRuntime = runtimeCount > 0;

  function matchesSearch(key: string, value: string): boolean {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return key.toLowerCase().includes(q) || value.toLowerCase().includes(q);
  }

  $: filteredFileVars = fileVariables.filter(v => matchesSearch(v.key, v.value));
  $: filteredEnvEntries = envEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredKvEntries = kvEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredOverrides = overrideEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredGlobals = globalEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredNamed = namedEntries.filter(([name, result]) =>
    matchesSearch(name, `${result.request.method} ${result.response.status}`)
  );
  $: filteredRuntimeCount = filteredOverrides.length + filteredGlobals.length + filteredNamed.length;

  $: totalCount = fileVariables.length + envEntries.length + kvEntries.length + runtimeCount;
  $: filteredTotal = filteredFileVars.length + filteredEnvEntries.length + filteredKvEntries.length + filteredRuntimeCount;

  function masked(val: string): string {
    return '*'.repeat(Math.min(val.length, 12));
  }

  function truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  async function copyRef(key: string) {
    try {
      await navigator.clipboard.writeText(`{{${key}}}`);
      copiedKey = key;
      if (copiedTimeout) clearTimeout(copiedTimeout);
      copiedTimeout = setTimeout(() => { copiedKey = null; }, 1500);
    } catch {
      // Silent fail in sandboxed environments
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
  }

  function badgeText(filtered: number, total: number): string {
    if (!searchQuery || filtered === total) return `${total}`;
    return `${filtered}/${total}`;
  }
</script>

<svelte:window on:keydown={visible ? handleKeydown : undefined} />

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" on:click|self={() => dispatch('close')} role="dialog" tabindex="-1">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Variables</span>
        <button class="btn-close" on:click={() => dispatch('close')}>&times;</button>
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
          {#if totalCount === 0}
            <div class="empty-state">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M10 6C8.5 6 7.5 7 7.5 8.5v15c0 1.5 1 2.5 2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M22 6c1.5 0 2.5 1 2.5 2.5v15c0 1.5-1 2.5-2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M13 13h6M13 17h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <p class="empty-title">No variables in scope</p>
              <p class="empty-hint">
                Define file variables with <code>@name = value</code> or add an
                <code>http-client.env.json</code> to your workspace.
              </p>
            </div>
          {:else if filteredTotal === 0}
            <div class="empty-state">
              <p class="empty-title">No matching variables</p>
              <p class="empty-hint">Try a different search term.</p>
            </div>
          {:else}
            <!-- File Variables -->
            {#if fileVariables.length > 0}
              <section class="group">
                <button class="group-header" on:click={() => fileExpanded = !fileExpanded}>
                  <span class="chevron" class:open={fileExpanded}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <span class="group-label">File Variables</span>
                  <span class="badge">{badgeText(filteredFileVars.length, fileVariables.length)}</span>
                </button>
                {#if fileExpanded}
                  <div class="group-body">
                    {#if filteredFileVars.length === 0}
                      <p class="empty">No matches in file variables.</p>
                    {:else}
                      {#each filteredFileVars as v}
                        <button class="row" class:copied={copiedKey === v.key} on:click={() => copyRef(v.key)}>
                          <span class="tag file">file</span>
                          <span class="key" title={v.key}>{v.key}</span>
                          <span class="sep">=</span>
                          <span class="val" title={v.value}>{truncate(v.value, 60)}</span>
                          <span class="row-action">{copiedKey === v.key ? 'Copied' : 'Copy ref'}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </section>
            {/if}

            <!-- Environment Variables -->
            {#if envEntries.length > 0}
              <section class="group">
                <button class="group-header" on:click={() => envExpanded = !envExpanded}>
                  <span class="chevron" class:open={envExpanded}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <span class="group-label">Environment</span>
                  {#if activeEnv}
                    <span class="env-name">{activeEnv}</span>
                  {/if}
                  <span class="badge">{badgeText(filteredEnvEntries.length, envEntries.length)}</span>
                </button>
                {#if envExpanded}
                  <div class="group-body">
                    {#if filteredEnvEntries.length === 0}
                      <p class="empty">No matches in environment variables.</p>
                    {:else}
                      {#each filteredEnvEntries as [key, value]}
                        {@const srcInfo = envVarSources[key]}
                        {@const hasCascade = srcInfo && srcInfo.cascade.length > 1}
                        <div class="env-row-wrapper">
                          <button class="row" class:copied={copiedKey === key} on:click={() => copyRef(key)}>
                            {#if srcInfo}
                              <span class="tag {sourceTagClass(srcInfo.source)}">{sourceTagLabel(srcInfo.source)}</span>
                            {:else}
                              <span class="tag env">env</span>
                            {/if}
                            <span class="key" title={key}>{key}</span>
                            <span class="sep">=</span>
                            <span class="val" title={value}>{truncate(value, 60)}</span>
                            {#if hasCascade}
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span
                                class="cascade-toggle"
                                role="button"
                                tabindex="0"
                                title="Defined in {srcInfo.cascade.length} layers"
                                on:click|stopPropagation={() => toggleCascade(key)}
                              >{srcInfo.cascade.length} layers</span>
                            {/if}
                            <span class="row-action">{copiedKey === key ? 'Copied' : 'Copy ref'}</span>
                          </button>
                          {#if hasCascade && expandedCascadeKey === key}
                            <div class="cascade-detail">
                              {#each srcInfo.cascade as layer, i}
                                {@const isWinner = i === srcInfo.cascade.length - 1}
                                <div class="cascade-layer" class:winner={isWinner} class:loser={!isWinner}>
                                  <span class="tag tag-sm {sourceTagClass(layer.source)}">{sourceTagLabel(layer.source)}</span>
                                  <span class="cascade-value" class:strikethrough={!isWinner}>{truncate(layer.value, 50)}</span>
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </section>
            {/if}

            <!-- Key Vault Variables -->
            {#if kvEntries.length > 0}
              <section class="group">
                <button class="group-header" on:click={() => kvExpanded = !kvExpanded}>
                  <span class="chevron" class:open={kvExpanded}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <span class="group-label">Key Vault</span>
                  <span class="badge">{badgeText(filteredKvEntries.length, kvEntries.length)}</span>
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span
                    class="kv-reveal-toggle"
                    role="button"
                    tabindex="0"
                    on:click|stopPropagation={() => showKvSecrets = !showKvSecrets}
                  >{showKvSecrets ? '[Hide]' : '[Show]'}</span>
                </button>
                {#if kvExpanded}
                  <div class="group-body">
                    {#if filteredKvEntries.length === 0}
                      <p class="empty">No matches in Key Vault variables.</p>
                    {:else}
                      {#each filteredKvEntries as [key, value]}
                        <button class="row" class:copied={copiedKey === key} on:click={() => copyRef(key)}>
                          <span class="tag kv">kv</span>
                          <span class="key" title={key}>{key}</span>
                          <span class="sep">=</span>
                          <span class="val" title={showKvSecrets ? value : masked(value)}>{showKvSecrets ? truncate(value, 60) : masked(value)}</span>
                          <span class="row-action">{copiedKey === key ? 'Copied' : 'Copy ref'}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </section>
            {/if}

            <!-- Runtime Variables -->
            {#if runtimeCount > 0}
              <section class="group">
                <button class="group-header" on:click={() => runtimeExpanded = !runtimeExpanded}>
                  <span class="chevron" class:open={runtimeExpanded}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <span class="group-label">Runtime</span>
                  <span class="badge">{badgeText(filteredRuntimeCount, runtimeCount)}</span>
                </button>
                {#if runtimeExpanded}
                  <div class="group-body">
                    {#if filteredRuntimeCount === 0}
                      <p class="empty">No matches in runtime variables.</p>
                    {:else}
                      {#if filteredOverrides.length > 0}
                        <div class="subgroup">
                          <span class="subgroup-label">File scope <span class="scope-hint">- {activeFileName}</span></span>
                          {#each filteredOverrides as [key, value]}
                            <button class="row" class:copied={copiedKey === key} on:click={() => copyRef(key)}>
                              <span class="tag set">set</span>
                              <span class="key" title={key}>{key}</span>
                              <span class="sep">=</span>
                              <span class="val" title={value}>{truncate(value, 60)}</span>
                              <span class="row-action">{copiedKey === key ? 'Copied' : 'Copy ref'}</span>
                            </button>
                          {/each}
                        </div>
                      {/if}
                      {#if filteredGlobals.length > 0}
                        <div class="subgroup">
                          <span class="subgroup-label">Workspace scope</span>
                          {#each filteredGlobals as [key, value]}
                            <button class="row" class:copied={copiedKey === key} on:click={() => copyRef(key)}>
                              <span class="tag global">global</span>
                              <span class="key" title={key}>{key}</span>
                              <span class="sep">=</span>
                              <span class="val" title={value}>{truncate(value, 60)}</span>
                              <span class="row-action">{copiedKey === key ? 'Copied' : 'Copy ref'}</span>
                            </button>
                          {/each}
                        </div>
                      {/if}
                      {#if filteredNamed.length > 0}
                        <div class="subgroup">
                          <span class="subgroup-label">Named responses</span>
                          {#each filteredNamed as [name, result]}
                            <button class="row" class:copied={copiedKey === name} on:click={() => copyRef(name + '.response.body.$')}>
                              <span class="tag response">response</span>
                              <span class="key" title={name}>{name}</span>
                              <span class="sep">=</span>
                              <span class="val">{result.request.method} {result.response.status}</span>
                              <span class="row-action">{copiedKey === name ? 'Copied' : 'Copy ref'}</span>
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </section>
            {/if}
          {/if}
        </div>
      </div>

      {#if hasRuntime}
        <div class="modal-footer">
          <button class="btn-clear-runtime" on:click={() => dispatch('clearRuntime')}>Clear all runtime variables</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Modal base from shared.css; only overrides here */
  .modal {
    width: 520px;
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

  /* Section groups */
  .group {
    border-bottom: 1px solid var(--color-bg-sidebar);
  }
  .group:last-child { border-bottom: none; }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2\.5) var(--space-4);
    border: none;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    color: var(--color-text);
    transition: background var(--duration-fast);
  }
  .group-header:hover { background: var(--gray-15); }

  .chevron {
    display: flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; flex-shrink: 0;
    color: var(--color-text-faint); transition: transform var(--duration-normal);
  }
  .chevron.open { transform: rotate(90deg); }

  .group-label {
    font-weight: var(--weight-semibold);
  }
  .badge {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    background: var(--color-bg-sidebar);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-lg);
    flex-shrink: 0;
  }
  .env-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 6%, transparent);
    padding: 1px 7px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .group-body {
    padding: 0 var(--space-4) var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
    margin: 0;
    padding: 2px 0;
  }

  /* Variable rows (clickable buttons) */
  .row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: inherit;
    transition: background var(--duration-fast);
    position: relative;
  }
  .row:hover { background: var(--color-bg-subtle); }
  .row.copied { background: #E8F5E9; }

  .tag {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 40px;
    text-align: center;
  }
  .tag.file     { color: var(--color-info); background: color-mix(in srgb, var(--color-info) 6%, transparent); }
  .tag.env      { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 6%, transparent); }
  .tag.kv       { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 6%, transparent); }

  .kv-reveal-toggle {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    cursor: pointer;
  }
  .kv-reveal-toggle:hover { color: var(--color-primary); }
  .tag.source-shared { color: var(--teal-600); background: color-mix(in srgb, var(--teal-600) 6%, transparent); }
  .tag.source-env    { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 6%, transparent); }
  .tag.source-user   { color: var(--purple-600); background: color-mix(in srgb, var(--purple-600) 6%, transparent); }

  .tag.set      { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
  .tag.global   { color: var(--color-accent-flow); background: color-mix(in srgb, var(--color-accent-flow) 6%, transparent); }
  .tag.response { color: var(--teal-600); background: color-mix(in srgb, var(--teal-600) 6%, transparent); }

  .tag-sm {
    font-size: 9px;
    padding: 0 4px;
    min-width: 32px;
  }

  .env-row-wrapper {
    display: flex;
    flex-direction: column;
  }

  .cascade-toggle {
    font-size: var(--text-2xs);
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    background: var(--color-bg-sidebar);
  }
  .cascade-toggle:hover { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }

  .cascade-detail {
    margin-left: 48px;
    padding: var(--space-1) 0 var(--space-1\.5);
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-left: 2px solid var(--color-border);
    padding-left: var(--space-2\.5);
  }

  .cascade-layer {
    display: flex;
    align-items: baseline;
    gap: var(--space-1\.5);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .cascade-layer.winner { color: var(--color-text); }
  .cascade-layer.loser { opacity: 0.55; }

  .cascade-value {
    color: var(--color-text-secondary);
    word-break: break-all;
  }
  .cascade-value.strikethrough { text-decoration: line-through; }

  .key {
    color: var(--color-accent-flow);
    font-weight: var(--weight-semibold);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    color: var(--zinc-100);
    font-size: var(--text-sm);
    flex-shrink: 0;
  }
  .val {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--color-bg);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-bg-sidebar);
  }

  .row-action {
    margin-left: auto;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-placeholder);
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0;
    transition: opacity var(--duration-fast);
  }
  .row:hover .row-action { opacity: 1; }
  .row.copied .row-action {
    opacity: 1;
    color: var(--color-success);
  }

  /* Subgroups */
  .subgroup {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .subgroup + .subgroup {
    margin-top: var(--space-2\.5);
  }
  .subgroup-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--slate-350);
    padding: 2px var(--space-2) var(--space-1);
  }
  .scope-hint {
    font-weight: var(--weight-regular);
    color: var(--color-text-placeholder);
  }

  /* Footer */
  .modal-footer {
    flex-shrink: 0;
  }
  .btn-clear-runtime {
    padding: var(--space-1\.5) var(--space-3\.5);
    border: 1px solid color-mix(in srgb, var(--color-error) 19%, transparent);
    border-radius: var(--radius-default);
    background: color-mix(in srgb, var(--color-error) 3%, transparent);
    color: var(--color-error);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-clear-runtime:hover {
    border-color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-5);
    text-align: center;
    gap: var(--space-1\.5);
  }
  .empty-state svg { color: var(--color-border); margin-bottom: var(--space-1); }
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
    margin: 0;
  }
  .empty-hint code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--color-bg-sidebar);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    color: var(--color-warning);
  }
</style>
