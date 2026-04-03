<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { THEMES, type ThemeId } from '../lib/theme';

  export let visible = false;
  export let currentTheme: ThemeId = 'default';

  const dispatch = createEventDispatcher();

  function selectTheme(id: ThemeId) {
    dispatch('changeTheme', id);
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" on:click|self={() => dispatch('close')} on:keydown={() => {}}>
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Settings</span>
        <button class="btn-close" on:click={() => dispatch('close')}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="section">
          <label class="section-label">Theme</label>
          <div class="theme-options">
            {#each THEMES as theme}
              <button
                class="theme-option"
                class:active={currentTheme === theme.id}
                on:click={() => selectTheme(theme.id)}
              >
                <span class="theme-name">{theme.label}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: var(--z-modal);
    background: var(--overlay-bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-modal);
    width: 360px;
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-divider);
  }
  .modal-title {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--color-text-heading);
  }
  .btn-close {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-xl);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--duration-normal), color var(--duration-normal);
  }
  .btn-close:hover {
    background: var(--color-bg-muted);
    color: var(--color-text);
  }
  .modal-body {
    padding: var(--space-4);
  }
  .section-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--space-2);
  }
  .theme-options {
    display: flex;
    gap: var(--space-2);
  }
  .theme-option {
    flex: 1;
    padding: var(--space-2\.5) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--duration-normal);
    text-align: center;
  }
  .theme-option:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-text-faint);
  }
  .theme-option.active {
    border-color: var(--color-primary);
    background: var(--color-primary-subtle);
    color: var(--color-primary);
    font-weight: var(--weight-semibold);
  }
</style>
