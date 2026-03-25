<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FlowDefinition } from '../lib/types';

  export let flow: FlowDefinition;
  export let flowPath: string;

  const dispatch = createEventDispatcher<{
    save: { flowPath: string; flow: FlowDefinition };
  }>();

  let editingName = false;
  let nameInputEl: HTMLInputElement;

  function startEditName() {
    editingName = true;
    // Wait a tick for the input to render
    setTimeout(() => nameInputEl?.focus(), 0);
  }

  function commitName() {
    editingName = false;
    flow = { ...flow, name: flow.name.trim() || 'Untitled Flow' };
    dispatch('save', { flowPath, flow });
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitName();
    if (e.key === 'Escape') { editingName = false; }
  }

  function handleDescriptionChange() {
    dispatch('save', { flowPath, flow });
  }
</script>

<div class="flow-editor">
  <!-- Header -->
  <div class="flow-header">
    <div class="flow-title-row">
      <svg class="flow-icon" width="18" height="18" viewBox="0 0 16 16" fill="none">
        <path d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z" stroke="#8040A8" stroke-width="1.2" fill="#8040A8" fill-opacity="0.1"/>
        <path d="M6 4.5h4M11.5 6v4" stroke="#8040A8" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      {#if editingName}
        <input
          bind:this={nameInputEl}
          bind:value={flow.name}
          on:blur={commitName}
          on:keydown={handleNameKeydown}
          class="flow-name-input"
          spellcheck="false"
        />
      {:else}
        <button class="flow-name" on:click={startEditName} title="Click to rename">
          {flow.name}
        </button>
      {/if}
    </div>
    <textarea
      class="flow-description"
      bind:value={flow.description}
      on:blur={handleDescriptionChange}
      placeholder="Add a description..."
      rows="2"
    ></textarea>
  </div>

  <!-- Steps -->
  <div class="flow-steps-section">
    <div class="steps-header">
      <span class="steps-title">Steps</span>
      <span class="steps-count">{flow.steps.length}</span>
    </div>

    {#if flow.steps.length === 0}
      <div class="steps-empty">
        <span class="steps-empty-text">No steps yet. Add requests to build this flow.</span>
      </div>
    {:else}
      <div class="steps-list">
        {#each flow.steps as step, i}
          <div class="step-card">
            <span class="step-number">{i + 1}</span>
            <span class="step-label">{step.label || 'Untitled step'}</span>
            <span class="step-file">{step.filePath}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .flow-editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
    gap: 24px;
  }

  /* Header */
  .flow-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .flow-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .flow-icon {
    flex-shrink: 0;
  }
  .flow-name {
    font-size: 18px;
    font-weight: 700;
    color: #1A1A2E;
    margin: 0;
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: border-color 0.15s;
  }
  .flow-name:hover {
    border-color: #D4D4D8;
  }
  .flow-name-input {
    font-size: 18px;
    font-weight: 700;
    color: #1A1A2E;
    border: 1px solid #8040A8;
    border-radius: 4px;
    padding: 2px 8px;
    font-family: inherit;
    outline: none;
    flex: 1;
    min-width: 0;
  }
  .flow-description {
    padding: 8px 10px;
    border: 1px solid #E4E4EA;
    border-radius: 6px;
    background: #FAFAFA;
    color: #555;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
  }
  .flow-description:focus {
    border-color: #8040A8;
  }
  .flow-description::placeholder {
    color: #BBB;
  }

  /* Steps */
  .flow-steps-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .steps-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .steps-title {
    font-size: 13px;
    font-weight: 700;
    color: #333340;
  }
  .steps-count {
    font-size: 10px;
    color: #999;
    background: #F0F0F4;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .steps-empty {
    padding: 20px;
    border: 1px dashed #DCDCE2;
    border-radius: 8px;
    text-align: center;
  }
  .steps-empty-text {
    font-size: 12px;
    color: #999;
  }
  .steps-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .step-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: #FAFAFA;
    border: 1px solid #E4E4EA;
    border-radius: 6px;
    transition: border-color 0.15s;
  }
  .step-card:hover {
    border-color: #D4D4D8;
  }
  .step-number {
    font-size: 10px;
    font-weight: 700;
    color: #8040A8;
    background: #8040A810;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .step-label {
    font-size: 12px;
    color: #333340;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-file {
    font-size: 10px;
    color: #AAA;
    flex-shrink: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
