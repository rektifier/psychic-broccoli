<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable } from '../lib/types';

  /** Discovered {{variable}} references to add to the environment */
  export let variables: Variable[] = [];
  /** Names of existing environments found in env files */
  export let existingEnvironments: string[] = [];
  /** Whether environment files already exist in the workspace */
  export let hasEnvFile: boolean = false;
  /** Whether the modal is visible */
  export let visible: boolean = false;

  const dispatch = createEventDispatcher<{
    confirm: { target: string };
    skip: void;
  }>();

  let selectedTarget = '';
  let newEnvName = 'development';

  // Reset state when modal opens
  $: if (visible) {
    if (!hasEnvFile) {
      selectedTarget = '__new__';
      newEnvName = 'development';
    } else {
      selectedTarget = existingEnvironments[0] ?? '__new__';
      newEnvName = '';
    }
  }

  function confirm() {
    const target = selectedTarget === '__new__' ? newEnvName.trim() : selectedTarget;
    if (!target) return;
    dispatch('confirm', { target });
  }

  function skip() {
    dispatch('skip');
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" on:click|self={skip} role="dialog" tabindex="-1">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Import variables to environment</span>
        <button class="btn-close" on:click={skip}>&times;</button>
      </div>

      <div class="modal-body">
        <p class="description">
          Found <strong>{variables.length}</strong> variable{variables.length !== 1 ? 's' : ''}
          referenced across the imported requests.
          Choose where to add them.
        </p>

        <div class="var-list">
          {#each variables as v}
            <span class="var-tag" class:has-value={!!v.value}>&#123;&#123;{v.key}&#125;&#125;</span>
          {/each}
        </div>

        <div class="target-section">
          {#if hasEnvFile && existingEnvironments.length > 0}
            <span class="target-label">Add to environment</span>
            {#each existingEnvironments as env}
              <label class="radio-row">
                <input type="radio" bind:group={selectedTarget} value={env} />
                <span class="radio-label">{env}</span>
              </label>
            {/each}
            <label class="radio-row">
              <input type="radio" bind:group={selectedTarget} value="__new__" />
              <span class="radio-label">Create new environment</span>
            </label>
          {:else}
            <span class="target-label">No environment file found</span>
            <p class="hint">A new <code>http-client.env.json</code> will be created.</p>
            <input type="hidden" bind:value={selectedTarget} />
          {/if}

          {#if selectedTarget === '__new__'}
            <input
              class="env-name-input"
              bind:value={newEnvName}
              placeholder="Environment name..."
              on:keydown={(e) => { if (e.key === 'Enter') confirm(); }}
            />
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-skip" on:click={skip}>Skip</button>
        <button class="btn-confirm" on:click={confirm}>Add variables</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 100;
    background: rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    width: 420px;
    max-height: 80vh;
    overflow-y: auto;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #DCDCE2;
  }
  .modal-title {
    font-size: 13px;
    font-weight: 600;
    color: #1A1A2E;
  }
  .btn-close {
    width: 24px; height: 24px;
    border: none; border-radius: 4px;
    background: transparent; color: #999;
    font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-close:hover { background: #E4E4EA; color: #444; }

  .modal-body {
    padding: 14px 16px;
  }

  .description {
    font-size: 12px;
    color: #555;
    line-height: 1.5;
    margin-bottom: 10px;
  }

  .var-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 14px;
    max-height: 120px;
    overflow-y: auto;
  }
  .var-tag {
    font-size: 11px;
    font-family: 'Consolas', 'Courier New', monospace;
    background: #F0F0F4;
    border: 1px solid #E0E0E4;
    border-radius: 4px;
    padding: 2px 7px;
    color: #9A7520;
  }
  .var-tag.has-value {
    background: #E8F5E9;
    border-color: #C8E6C9;
    color: #2E7D32;
  }

  .target-section {
    border-top: 1px solid #F0F0F4;
    padding-top: 12px;
  }
  .target-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #D4900A;
    margin-bottom: 8px;
  }

  .radio-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    cursor: pointer;
  }
  .radio-row input[type="radio"] {
    accent-color: #D4900A;
  }
  .radio-label {
    font-size: 12px;
    color: #333340;
  }

  .hint {
    font-size: 11px;
    color: #888;
    margin-bottom: 8px;
  }
  .hint code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px;
    background: #F0F0F4;
    padding: 1px 5px;
    border-radius: 3px;
    color: #9A7520;
  }

  .env-name-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    margin-top: 6px;
  }
  .env-name-input:focus { border-color: #D4900A; }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #DCDCE2;
  }
  .btn-skip {
    padding: 6px 14px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-skip:hover { border-color: #999; color: #333; }
  .btn-confirm {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: #D4900A;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-confirm:hover { background: #C07D08; }
</style>
