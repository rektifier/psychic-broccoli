<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { invoke } from '@tauri-apps/api/core';
  import { THEMES, type ThemeId } from '../lib/theme';

  interface Props {
    visible?: boolean;
    currentTheme?: ThemeId;
    onchangeTheme?: (id: ThemeId) => void;
    onclose?: () => void;
  }

  let { visible = false, currentTheme = 'default', onchangeTheme, onclose }: Props = $props();

  interface McpSettings {
    enabled: boolean;
    port: number;
    token: string;
  }

  let appVersion = $state('');

  let mcpEnabled = $state(false);
  let mcpPort = $state(3742);
  let mcpToken = $state('');
  let mcpRunning = $state(false);
  let mcpBusy = $state(false);
  let mcpError = $state('');
  let copyLabel = $state('Copy MCP config');

  onMount(async () => {
    try { appVersion = await getVersion(); } catch {}
    await loadMcp();
  });

  async function loadMcp() {
    try {
      const settings = await invoke<McpSettings>('mcp_get_settings');
      mcpEnabled = settings.enabled;
      mcpPort = settings.port;
      mcpToken = settings.token;
      mcpRunning = await invoke<boolean>('mcp_is_running');
    } catch (e) {
      mcpError = String(e);
    }
  }

  async function toggleMcp() {
    if (mcpBusy) return;
    mcpBusy = true;
    mcpError = '';
    const next = !mcpEnabled;
    try {
      await invoke('mcp_set_enabled', { enabled: next });
      mcpEnabled = next;
      mcpRunning = await invoke<boolean>('mcp_is_running');
    } catch (e) {
      mcpError = String(e);
      await loadMcp();
    } finally {
      mcpBusy = false;
    }
  }

  async function changePort(value: number) {
    mcpError = '';
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      mcpError = 'Port must be between 1 and 65535';
      return;
    }
    try {
      await invoke('mcp_set_port', { port: value });
      mcpPort = value;
    } catch (e) {
      mcpError = String(e);
      await loadMcp();
    }
  }

  async function copyConfig() {
    const config = {
      mcpServers: {
        'psychic-broccoli': {
          type: 'sse',
          url: `http://localhost:${mcpPort}/sse`,
          headers: { Authorization: `Bearer ${mcpToken}` },
        },
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      copyLabel = 'Copied!';
      setTimeout(() => { copyLabel = 'Copy MCP config'; }, 1500);
    } catch {
      mcpError = 'Could not copy to clipboard';
    }
  }

  function selectTheme(id: ThemeId) {
    onchangeTheme?.(id);
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay"
    onclick={(e) => { if (e.target === e.currentTarget) onclose?.(); }}
    onkeydown={() => {}}
  >
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Settings</span>
        <button class="btn-close" onclick={() => onclose?.()}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="section">
          <span class="section-label">Theme</span>
          <div class="theme-options">
            {#each THEMES as theme}
              <button
                class={{ 'theme-option': true, active: currentTheme === theme.id }}
                onclick={() => selectTheme(theme.id)}
              >
                <span class="theme-name">{theme.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="section">
          <span class="section-label">MCP Server</span>
          <p class="section-desc">
            Expose this workspace to MCP clients such as Claude Code over a
            local-only endpoint (127.0.0.1).
          </p>

          <label class="mcp-row toggle-row" for="mcp-enabled">
            <span class="field-label">Enable server</span>
            <input
              id="mcp-enabled"
              type="checkbox"
              checked={mcpEnabled}
              disabled={mcpBusy}
              onchange={toggleMcp}
            />
          </label>

          <div class="mcp-row">
            <label class="field-label" for="mcp-port">Port</label>
            <input
              id="mcp-port"
              class="port-input"
              type="number"
              min="1"
              max="65535"
              value={mcpPort}
              disabled={mcpRunning}
              onchange={(e) => changePort(parseInt(e.currentTarget.value, 10))}
            />
            <span class={{ status: true, running: mcpRunning }}>
              {mcpRunning ? 'Running' : 'Stopped'}
            </span>
          </div>

          <button class="copy-btn" onclick={copyConfig} disabled={!mcpToken}>
            {copyLabel}
          </button>

          {#if mcpError}
            <p class="mcp-error">{mcpError}</p>
          {/if}
        </div>

        {#if appVersion}
          <div class="version-info">v{appVersion}</div>
        {/if}
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
  .section {
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .section:last-child {
    margin-bottom: 0;
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
  .section-desc {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-faint);
    line-height: 1.4;
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
  .mcp-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .toggle-row {
    justify-content: space-between;
    cursor: pointer;
  }
  .field-label {
    font-size: var(--text-base);
    color: var(--color-text);
  }
  .port-input {
    width: 90px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
  }
  .port-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .status {
    font-size: var(--text-sm);
    color: var(--color-text-faint);
  }
  .status.running {
    color: var(--color-primary);
    font-weight: var(--weight-semibold);
  }
  .copy-btn {
    margin-top: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .copy-btn:hover:not(:disabled) {
    background: var(--color-bg-hover);
    border-color: var(--color-text-faint);
  }
  .copy-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mcp-error {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--color-method-delete);
  }
  .version-info {
    margin-top: var(--space-4);
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-faint);
    opacity: 0.6;
  }
</style>
