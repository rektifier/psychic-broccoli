<script lang="ts">
  import type { KeyVaultConfig } from '../lib/types';
  import HelpTip from './HelpTip.svelte';

  interface Props {
    /** Stored Key Vault config for the environment being edited, if any. */
    kvConfig: KeyVaultConfig | null;
    /** Whether the loaded KV cache belongs to this environment. */
    connected: boolean;
    onSave?: (config: KeyVaultConfig) => void;
    onRemove?: () => void;
  }

  let { kvConfig, connected, onSave, onRemove }: Props = $props();

  // Form state: recomputed from the stored config when it changes externally
  // (writable $derived: user input and the cancel button assign to these
  // directly until the next recompute). The parent re-creates this component
  // per environment tab ({#key editingEnv}), which resets the form on tab
  // switches.
  let vaultUrl = $derived(kvConfig?.vaultUrl ?? '');
  let secretName = $derived(kvConfig?.secretName ?? '');
  let showSetup = $derived(kvConfig !== null);

  function save() {
    const url = vaultUrl.trim();
    const name = secretName.trim();
    if (!url || !name) return;
    onSave?.({ provider: 'AzureKeyVault', vaultUrl: url, secretName: name });
  }

  function remove() {
    showSetup = false;
    vaultUrl = '';
    secretName = '';
    onRemove?.();
  }
</script>

{#if showSetup || kvConfig}
  <div class="kv-setup">
    <div class="kv-setup-header">
      <span class="kv-setup-title">Azure Key Vault</span>
      <HelpTip
        label="Azure Key Vault"
        text="Requires Azure CLI (az login) or Azure Developer CLI (azd auth login). The vault URL should point to an existing Key Vault instance that your account has Secret read permissions on."
      />
      {#if connected}
        <span class="kv-connected-badge">connected</span>
      {:else if kvConfig}
        <span class="kv-configured-badge">configured</span>
      {/if}
    </div>
    <div class="kv-setup-fields">
      <label class="kv-field">
        <span class="kv-field-label">Vault URL</span>
        <input
          class="kv-field-input"
          bind:value={vaultUrl}
          placeholder="https://my-vault.vault.azure.net"
          spellcheck="false"
        />
      </label>
      <label class="kv-field">
        <span class="kv-field-label">Secret name</span>
        <input
          class="kv-field-input"
          bind:value={secretName}
          placeholder="my-secret"
          spellcheck="false"
        />
      </label>
    </div>
    <div class="kv-setup-actions">
      <button
        class="btn-kv-connect"
        onclick={save}
        disabled={!vaultUrl.trim() || !secretName.trim()}
        >{kvConfig ? 'Save & refresh' : 'Connect'}</button
      >
      {#if kvConfig}
        <button class="btn-kv-disconnect" onclick={remove}>Disconnect</button>
      {:else}
        <button
          class="btn-kv-cancel"
          onclick={() => {
            showSetup = false;
            vaultUrl = '';
            secretName = '';
          }}>Cancel</button
        >
      {/if}
    </div>
  </div>
{:else}
  <button class="btn-kv-add" onclick={() => (showSetup = true)}>
    + Connect to Azure Key Vault
  </button>
{/if}

<style>
  .btn-kv-add {
    padding: var(--space-2) var(--space-3\.5);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
    align-self: flex-start;
    margin-bottom: var(--space-4);
  }
  .btn-kv-add:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .kv-setup {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
    background: color-mix(in srgb, var(--color-primary) 3%, transparent);
  }
  .kv-setup-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .kv-setup-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text-secondary);
    letter-spacing: 0.3px;
  }
  .kv-connected-badge {
    font-size: var(--text-xs);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    padding: 1px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .kv-configured-badge {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    background: color-mix(in srgb, var(--color-text-faint) 8%, transparent);
    padding: 1px var(--space-2);
    border-radius: var(--radius-xl);
  }
  .kv-setup-fields {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .kv-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kv-field-label {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .kv-field-input {
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-md);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .kv-field-input:focus {
    border-color: var(--color-primary);
  }
  .kv-field-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .kv-setup-actions {
    display: flex;
    gap: var(--space-2);
  }
  .btn-kv-connect {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-default);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-connect:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
  .btn-kv-connect:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-kv-disconnect {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-error);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-disconnect:hover {
    border-color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
  }
  .btn-kv-cancel {
    padding: 5px var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-kv-cancel:hover {
    border-color: var(--color-text-faint);
    color: var(--color-text);
  }
</style>
