<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NamedRequestResult } from '../lib/types';

  /** The raw URL + headers + body text to scan for dependencies */
  export let requestText: string = '';
  /** Map of named request results that have been sent */
  export let namedResults: Record<string, NamedRequestResult> = {};

  const dispatch = createEventDispatcher();

  // Extract all {{name.response...}} references
  const DEP_RE = /\{\{(\w+)\.(?:request|response)\./g;

  $: dependencies = extractDeps(requestText);
  // Force re-evaluation of statuses when namedResults changes
  $: statuses = buildStatuses(dependencies, namedResults);

  function extractDeps(text: string): string[] {
    const names = new Set<string>();
    let match;
    const re = new RegExp(DEP_RE.source, 'g');
    while ((match = re.exec(text)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function buildStatuses(
    deps: string[],
    results: Record<string, NamedRequestResult>,
  ): Record<string, { sent: boolean; status?: number; statusText?: string }> {
    const map: Record<string, { sent: boolean; status?: number; statusText?: string }> = {};
    for (const name of deps) {
      const result = results[name];
      map[name] = result
        ? { sent: true, status: result.response.status, statusText: result.response.statusText }
        : { sent: false };
    }
    return map;
  }

  function runAll() {
    dispatch('runAll', dependencies);
  }
</script>

{#if dependencies.length > 0}
  <div class="dep-bar">
    <span class="dep-label">Depends on</span>
    {#each dependencies as dep}
      <span class="dep-pill" class:sent={statuses[dep]?.sent} class:unsent={!statuses[dep]?.sent}>
        <span class="dep-dot"></span>
        <span class="dep-name">{dep}</span>
        {#if statuses[dep]?.sent}
          <span class="dep-status">{statuses[dep].status}</span>
        {:else}
          <span class="dep-status">not sent</span>
        {/if}
      </span>
    {/each}
    {#if dependencies.some(d => !namedResults[d])}
      <button class="btn-run-all" on:click={runAll}>Run all</button>
    {/if}
  </div>
{/if}

<style>
  .dep-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1\.5) var(--space-2\.5);
    background: var(--color-bg-sidebar);
    border-radius: var(--radius-default);
    flex-wrap: wrap;
  }

  .dep-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .dep-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: var(--space-0\.5) var(--space-2\.5);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
  }
  .dep-pill.sent {
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
  }
  .dep-pill.unsent {
    background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  }

  .dep-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .sent .dep-dot { background: var(--color-success); }
  .unsent .dep-dot { background: var(--color-warning); }

  .dep-name {
    font-weight: var(--weight-medium);
  }
  .sent .dep-name { color: var(--color-success); }
  .unsent .dep-name { color: var(--color-warning); }

  .dep-status {
    opacity: 0.6;
  }
  .sent .dep-status { color: var(--color-success); }
  .unsent .dep-status { color: var(--color-warning); }

  .btn-run-all {
    margin-left: auto;
    padding: var(--space-0\.5) var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-run-all:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
</style>
