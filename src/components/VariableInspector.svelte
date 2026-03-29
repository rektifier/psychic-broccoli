<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable, NamedRequestResult } from '../lib/types';

  export let visible: boolean = false;
  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
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
  let runtimeExpanded = true;

  let searchQuery = '';
  let copiedKey: string | null = null;
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  $: if (visible) { searchQuery = ''; copiedKey = null; }

  $: envEntries = Object.entries(envVariables).filter(([k]) =>
    !(k in pbOverrides) && !(k in pbGlobals)
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
  $: filteredOverrides = overrideEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredGlobals = globalEntries.filter(([k, v]) => matchesSearch(k, v));
  $: filteredNamed = namedEntries.filter(([name, result]) =>
    matchesSearch(name, `${result.request.method} ${result.response.status}`)
  );
  $: filteredRuntimeCount = filteredOverrides.length + filteredGlobals.length + filteredNamed.length;

  $: totalCount = fileVariables.length + envEntries.length + runtimeCount;
  $: filteredTotal = filteredFileVars.length + filteredEnvEntries.length + filteredRuntimeCount;

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
                        <button class="row" class:copied={copiedKey === key} on:click={() => copyRef(key)}>
                          <span class="tag env">env</span>
                          <span class="key" title={key}>{key}</span>
                          <span class="sep">=</span>
                          <span class="val" title={value}>{truncate(value, 60)}</span>
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
    width: 520px;
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
    align-items: center;
    justify-content: space-between;
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

  /* Section groups */
  .group {
    border-bottom: 1px solid #F0F0F4;
  }
  .group:last-child { border-bottom: none; }

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    color: #333340;
    transition: background 0.1s;
  }
  .group-header:hover { background: #FAFAFA; }

  .chevron {
    display: flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; flex-shrink: 0;
    color: #999; transition: transform 0.15s;
  }
  .chevron.open { transform: rotate(90deg); }

  .group-label {
    font-weight: 600;
  }
  .badge {
    font-size: 10px;
    color: #999;
    background: #F0F0F4;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .env-name {
    font-size: 10px;
    font-weight: 600;
    color: #3D8B45;
    background: #3D8B4510;
    padding: 1px 7px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .group-body {
    padding: 0 16px 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .empty {
    font-size: 11px;
    color: #BBB;
    margin: 0;
    padding: 2px 0;
  }

  /* Variable rows (clickable buttons) */
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: inherit;
    transition: background 0.1s;
    position: relative;
  }
  .row:hover { background: #F5F5FA; }
  .row.copied { background: #E8F5E9; }

  .tag {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 40px;
    text-align: center;
  }
  .tag.file     { color: #2B7FC5; background: #2B7FC510; }
  .tag.env      { color: #3D8B45; background: #3D8B4510; }
  .tag.set      { color: #D4900A; background: #D4900A10; }
  .tag.global   { color: #8040A8; background: #8040A810; }
  .tag.response { color: #1A8898; background: #1A889810; }

  .key {
    color: #8040A8;
    font-weight: 600;
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    color: #CCC;
    font-size: 11px;
    flex-shrink: 0;
  }
  .val {
    color: #555;
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: #F8F8FA;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid #F0F0F4;
  }

  .row-action {
    margin-left: auto;
    font-size: 9px;
    font-weight: 600;
    color: #BBB;
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .row:hover .row-action { opacity: 1; }
  .row.copied .row-action {
    opacity: 1;
    color: #3D8B45;
  }

  /* Subgroups */
  .subgroup {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .subgroup + .subgroup {
    margin-top: 10px;
  }
  .subgroup-label {
    font-size: 10px;
    font-weight: 600;
    color: #888;
    padding: 2px 8px 4px;
  }
  .scope-hint {
    font-weight: 400;
    color: #BBB;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #DCDCE2;
    flex-shrink: 0;
  }
  .btn-clear-runtime {
    padding: 6px 14px;
    border: 1px solid #CC445530;
    border-radius: 6px;
    background: #CC445508;
    color: #CC4455;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-clear-runtime:hover {
    border-color: #CC4455;
    background: #CC445515;
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    gap: 6px;
  }
  .empty-state svg { color: #D4D4D8; margin-bottom: 4px; }
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
    margin: 0;
  }
  .empty-hint code {
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    background: #F0F0F4;
    padding: 1px 5px;
    border-radius: 3px;
    color: #9A7520;
  }
</style>
