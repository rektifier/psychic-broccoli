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

  .var-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: var(--space-3\.5);
    max-height: 120px;
    overflow-y: auto;
  }
  .var-tag {
    font-size: var(--text-sm);
    font-family: 'Consolas', 'Courier New', monospace;
    background: var(--color-bg-sidebar);
    border: 1px solid #E0E0E4;
    border-radius: var(--radius-sm);
    padding: 2px 7px;
    color: var(--color-warning);
  }
  .var-tag.has-value {
    background: #E8F5E9;
    border-color: #C8E6C9;
    color: #2E7D32;
  }

  .target-section {
    border-top: 1px solid var(--color-bg-sidebar);
    padding-top: var(--space-3);
  }
  .target-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--color-primary);
    margin-bottom: var(--space-2);
  }

  .radio-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px 0;
    cursor: pointer;
  }
  .radio-row input[type="radio"] {
    accent-color: var(--color-primary);
  }
  .radio-label {
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--slate-350);
    margin-bottom: var(--space-2);
  }
  .hint code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: var(--text-sm);
    background: var(--color-bg-sidebar);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    color: var(--color-warning);
  }

  .env-name-input {
    width: 100%;
    padding: 7px var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
    margin-top: var(--space-1\.5);
  }
  .env-name-input:focus { border-color: var(--color-primary); }

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
  .btn-skip:hover { border-color: var(--color-text-faint); color: var(--color-text); }
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
  .btn-confirm:hover { background: var(--color-primary-active); }
</style>
