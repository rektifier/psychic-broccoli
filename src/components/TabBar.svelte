<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tab } from '../lib/stores';
  import type { RequestLocation } from '../lib/types';

  export let tabs: Tab[] = [];
  export let activeLocation: RequestLocation | null = null;
  export let isPreview: boolean = false;
  export let previewLabel: string = '';

  const dispatch = createEventDispatcher<{
    activate: RequestLocation;
    close: RequestLocation;
  }>();

  function isActive(tab: Tab): boolean {
    if (!activeLocation) return false;
    return tab.location.filePath === activeLocation.filePath
      && tab.location.requestIndex === activeLocation.requestIndex;
  }

  function isPreviewTab(tab: Tab): boolean {
    return false; // Pinned tabs are never previews
  }
</script>

{#if tabs.length > 0}
  <div class="tab-bar">
    {#each tabs as tab}
      <div
        class="tab"
        class:active={isActive(tab) && !isPreview}
        on:click={() => dispatch('activate', tab.location)}
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
    background: #F0F0F4;
    border-bottom: 1px solid #DCDCE2;
    overflow-x: auto;
    flex-shrink: 0;
    min-height: 32px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border: none;
    border-right: 1px solid #DCDCE2;
    background: transparent;
    color: #888;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    max-width: 180px;
    min-width: 0;
    transition: all 0.1s;
    position: relative;
  }
  .tab:hover {
    background: #E8E8EC;
    color: #555;
  }
  .tab.active {
    background: #FFFFFF;
    color: #333340;
    font-weight: 600;
  }
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: #D4900A;
  }
  .tab.preview {
    font-style: italic;
    font-weight: 400;
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
    border-radius: 3px;
    background: transparent;
    color: #AAA;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .tab-close:hover {
    background: #D4D4D8;
    color: #333;
  }
</style>
