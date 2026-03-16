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
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 420px;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    animation: slide-in 0.2s ease-out;
  }

  .toast-error {
    background: #FEF2F2;
    border: 1px solid #FECACA;
    color: #991B1B;
  }

  .toast-warning {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    color: #92400E;
  }

  .toast-info {
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    color: #1E40AF;
  }

  .toast-message {
    flex: 1;
    word-break: break-word;
  }

  .toast-dismiss {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
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
