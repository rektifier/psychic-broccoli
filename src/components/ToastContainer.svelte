<script lang="ts">
  import { toasts, dismissToast } from '../lib/stores';
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <div class="toast toast-{toast.type}" role="alert">
        <span class="toast-message">{toast.message}</span>
        <button class="toast-dismiss" on:click={() => dismissToast(toast.id)}>x</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 420px;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2\.5) var(--space-3\.5);
    border-radius: var(--radius-default);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    box-shadow: var(--shadow-toast);
    animation: slide-in var(--duration-slow) ease-out;
  }

  .toast-error {
    background: var(--toast-error-bg);
    border: 1px solid var(--toast-error-border);
    color: var(--toast-error-text);
  }

  .toast-warning {
    background: var(--toast-warning-bg);
    border: 1px solid var(--toast-warning-border);
    color: var(--toast-warning-text);
  }

  .toast-info {
    background: var(--toast-info-bg);
    border: 1px solid var(--toast-info-border);
    color: var(--toast-info-text);
  }

  .toast-message {
    flex: 1;
    word-break: break-word;
  }

  .toast-dismiss {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--text-md);
    line-height: 1;
    opacity: 0.5;
    padding: 0 2px;
    color: inherit;
  }
  .toast-dismiss:hover {
    opacity: 1;
  }

  @keyframes slide-in {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
