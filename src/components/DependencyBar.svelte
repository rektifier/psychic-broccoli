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

  function extractDeps(text: string): string[] {
    const names = new Set<string>();
    let match;
    const re = new RegExp(DEP_RE.source, 'g');
    while ((match = re.exec(text)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function getStatus(name: string): { sent: boolean; status?: number; statusText?: string } {
    const result = namedResults[name];
    if (!result) return { sent: false };
    return { sent: true, status: result.response.status, statusText: result.response.statusText };
  }

  function runAll() {
    dispatch('runAll', dependencies);
  }
</script>

{#if dependencies.length > 0}
  <div class="dep-bar">
    <span class="dep-label">Depends on</span>
    {#each dependencies as dep}
      {@const info = getStatus(dep)}
      <span class="dep-pill" class:sent={info.sent} class:unsent={!info.sent}>
        <span class="dep-dot"></span>
        <span class="dep-name">{dep}</span>
        {#if info.sent}
          <span class="dep-status">{info.status}</span>
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
    gap: 8px;
    padding: 6px 10px;
    background: #F0F0F4;
    border-radius: 6px;
    flex-wrap: wrap;
  }

  .dep-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #999;
    flex-shrink: 0;
  }

  .dep-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 100px;
    font-size: 11px;
  }
  .dep-pill.sent {
    background: #3D8B4515;
  }
  .dep-pill.unsent {
    background: #9A752015;
  }

  .dep-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .sent .dep-dot { background: #3D8B45; }
  .unsent .dep-dot { background: #9A7520; }

  .dep-name {
    font-weight: 500;
  }
  .sent .dep-name { color: #3D8B45; }
  .unsent .dep-name { color: #9A7520; }

  .dep-status {
    opacity: 0.6;
  }
  .sent .dep-status { color: #3D8B45; }
  .unsent .dep-status { color: #9A7520; }

  .btn-run-all {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #777;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-run-all:hover {
    border-color: #D4900A;
    color: #D4900A;
  }
</style>
