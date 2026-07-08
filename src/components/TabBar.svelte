<script lang="ts">
  import type { Tab, FlowTab } from '../lib/stores';
  import type { RequestLocation } from '../lib/types';

  interface Props {
    tabs?: Tab[];
    activeLocation?: RequestLocation | null;
    isPreview?: boolean;
    previewLabel?: string;
    // Flow tabs
    flowTabs?: FlowTab[];
    activeFlowPath?: string | null;
    onActivate?: (location: RequestLocation) => void;
    onClose?: (location: RequestLocation) => void;
    onActivateFlowTab?: (flowPath: string) => void;
    onCloseFlowTab?: (flowPath: string) => void;
  }

  let {
    tabs = [],
    activeLocation = null,
    isPreview = false,
    previewLabel = '',
    flowTabs = [],
    activeFlowPath = null,
    onActivate,
    onClose,
    onActivateFlowTab,
    onCloseFlowTab,
  }: Props = $props();

  function isActive(tab: Tab): boolean {
    if (!activeLocation || activeFlowPath) return false;
    return (
      tab.location.filePath === activeLocation.filePath &&
      tab.location.requestIndex === activeLocation.requestIndex
    );
  }
</script>

{#if tabs.length > 0 || flowTabs.length > 0}
  <div class="tab-bar">
    {#each flowTabs as ft}
      <div
        class={['tab', 'flow-tab', { active: activeFlowPath === ft.flowPath }]}
        onclick={() => onActivateFlowTab?.(ft.flowPath)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivateFlowTab?.(ft.flowPath);
          }
        }}
        role="tab"
        tabindex="0"
      >
        <svg class="flow-tab-icon" width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z"
            stroke="currentColor"
            stroke-width="1.5"
            fill="currentColor"
            fill-opacity="0.15"
          />
          <path
            d="M6 4.5h4M11.5 6v4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <span class="tab-label">{ft.label}</span>
        <button
          class="tab-close"
          onclick={(e) => {
            e.stopPropagation();
            onCloseFlowTab?.(ft.flowPath);
          }}
          title="Close tab">&times;</button
        >
      </div>
    {/each}
    {#each tabs as tab}
      <div
        class={['tab', { active: isActive(tab) && !isPreview }]}
        onclick={() => onActivate?.(tab.location)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate?.(tab.location);
          }
        }}
        role="tab"
        tabindex="0"
      >
        <span class="tab-label">{tab.label}</span>
        <button
          class="tab-close"
          onclick={(e) => {
            e.stopPropagation();
            onClose?.(tab.location);
          }}
          title="Close tab">&times;</button
        >
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
