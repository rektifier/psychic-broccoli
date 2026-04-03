<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tab, FlowTab } from '../lib/stores';
  import type { RequestLocation } from '../lib/types';

  export let tabs: Tab[] = [];
  export let activeLocation: RequestLocation | null = null;
  export let isPreview: boolean = false;
  export let previewLabel: string = '';

  // Flow tabs
  export let flowTabs: FlowTab[] = [];
  export let activeFlowPath: string | null = null;

  const dispatch = createEventDispatcher<{
    activate: RequestLocation;
    close: RequestLocation;
    activateFlowTab: string;
    closeFlowTab: string;
  }>();

  function isActive(tab: Tab): boolean {
    if (!activeLocation || activeFlowPath) return false;
    return tab.location.filePath === activeLocation.filePath
      && tab.location.requestIndex === activeLocation.requestIndex;
  }
</script>

{#if tabs.length > 0 || flowTabs.length > 0}
  <div class="tab-bar">
    {#each flowTabs as ft}
      <div
        class="tab flow-tab"
        class:active={activeFlowPath === ft.flowPath}
        on:click={() => dispatch('activateFlowTab', ft.flowPath)}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch('activateFlowTab', ft.flowPath); } }}
        role="tab"
        tabindex="0"
      >
        <svg class="flow-tab-icon" width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.15"/>
          <path d="M6 4.5h4M11.5 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span class="tab-label">{ft.label}</span>
        <button
          class="tab-close"
          on:click|stopPropagation={() => dispatch('closeFlowTab', ft.flowPath)}
          title="Close tab"
        >&times;</button>
      </div>
    {/each}
    {#each tabs as tab}
      <div
        class="tab"
        class:active={isActive(tab) && !isPreview}
        on:click={() => dispatch('activate', tab.location)}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch('activate', tab.location); } }}
        role="tab"
        tabindex="0"
      >
        <span class="tab-label">{tab.label}</span>
        <button
          class="tab-close"
          on:click|stopPropagation={() => dispatch('close', tab.location)}
          title="Close tab"
        >&times;</button>
      </div>
    {/each}
    {#if isPreview && previewLabel}
      <div class="tab active preview" role="tab">
        <span class="tab-label">{previewLabel}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--color-bg-sidebar);
    border-bottom: 1px solid var(--color-divider);
    overflow-x: auto;
    flex-shrink: 0;
    min-height: 32px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: 0 var(--space-3);
    border: none;
    border-right: 1px solid var(--color-divider);
    background: transparent;
    color: var(--slate-350);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
    max-width: 180px;
    min-width: 0;
    transition: all var(--duration-fast);
    position: relative;
  }
  .tab:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-secondary);
  }
  .tab.active {
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-primary);
  }
  .tab.flow-tab.active::after {
    background: var(--color-accent-flow);
  }
  .flow-tab-icon {
    flex-shrink: 0;
    color: var(--color-accent-flow);
    opacity: 0.7;
  }
  .tab.flow-tab.active .flow-tab-icon {
    opacity: 1;
  }
  .tab.preview {
    font-style: italic;
    font-weight: var(--weight-regular);
  }
  .tab.preview .tab-label {
    opacity: 0.7;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--zinc-300);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .tab-close:hover {
    background: var(--color-border);
    color: var(--color-text);
  }
</style>
