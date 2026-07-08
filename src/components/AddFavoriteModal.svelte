<script lang="ts">
  interface Props {
    /** Whether the modal is visible */
    visible?: boolean;
    /** Absolute path of the folder being favorited (shown as a hint) */
    folderPath?: string;
    /** Default name to prefill (the folder basename) */
    defaultName?: string;
    onConfirm?: (name: string) => void;
    onCancel?: () => void;
  }

  let { visible = false, folderPath = '', defaultName = '', onConfirm, onCancel }: Props = $props();

  let name = $state('');
  let inputEl: HTMLInputElement | null = $state(null);

  // Reset and focus when the modal opens.
  $effect(() => {
    if (visible) {
      name = defaultName;
      queueMicrotask(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  function confirm() {
    // Empty/whitespace name falls back to the folder basename.
    const trimmed = name.trim() || defaultName;
    onConfirm?.(trimmed);
  }

  function cancel() {
    onCancel?.();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="overlay"
    onclick={(e) => {
      if (e.target === e.currentTarget) cancel();
    }}
    role="dialog"
    tabindex="-1"
  >
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Name this favorite</span>
        <button class="btn-close" onclick={cancel}>&times;</button>
      </div>

      <div class="modal-body">
        <p class="description">
          Choose a name for this favorite. It is shown instead of the folder name.
        </p>
        <input
          class="name-input"
          bind:this={inputEl}
          bind:value={name}
          placeholder="Favorite name..."
          onkeydown={(e) => {
            if (e.key === 'Enter') confirm();
            else if (e.key === 'Escape') cancel();
          }}
        />
        {#if folderPath}
          <p class="path-hint" title={folderPath}>{folderPath}</p>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-skip" onclick={cancel}>Cancel</button>
        <button class="btn-confirm" onclick={confirm}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Modal base from shared.css; only overrides here */
  .modal {
    width: 420px;
  }

  .description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin-bottom: var(--space-2\.5);
  }

  .name-input {
    width: 100%;
    padding: 7px var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
  }
  .name-input:focus {
    border-color: var(--color-primary);
  }

  .path-hint {
    font-size: var(--text-sm);
    color: var(--slate-350);
    margin-top: var(--space-1\.5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-skip {
    padding: var(--space-1\.5) var(--space-3\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-skip:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }
  .btn-confirm {
    padding: var(--space-1\.5) var(--space-3\.5);
    border: none;
    border-radius: var(--radius-default);
    background: var(--color-primary);
    color: var(--color-primary-fg);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: background var(--duration-normal);
  }
  .btn-confirm:hover {
    background: var(--color-primary-active);
  }
</style>
