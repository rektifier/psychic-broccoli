<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import FlowStepPicker from './FlowStepPicker.svelte';
  import FlowResults from './FlowResults.svelte';
  import type { FlowDefinition, FlowStep, FlowStepResult, FlowRunRecord, FlowRunStatus, TreeNode as TNode } from '../lib/types';

  export let flow: FlowDefinition;
  export let flowPath: string;
  export let tree: TNode[] = [];
  export let rootPath: string = '';
  export let runState: { status: FlowRunStatus; stepResults: FlowStepResult[] } | null = null;
  export let lastRunRecord: FlowRunRecord | null = null;
  export let runHistory: FlowRunRecord[] = [];

  const dispatch = createEventDispatcher<{
    save: { flowPath: string; flow: FlowDefinition };
    run: void;
    abort: void;
  }>();

  $: isRunning = runState?.status === 'running';

  function getStepStatus(stepId: string): FlowStepResult | undefined {
    return runState?.stepResults.find(r => r.stepId === stepId);
  }

  let editingName = false;
  let nameInputEl: HTMLInputElement;
  let showPicker = false;

  const MC: Record<string, string> = {
    GET: '#2B7FC5', POST: '#3D8B45', PUT: '#9A7520', PATCH: '#A06828',
    DELETE: '#CC4455', HEAD: '#8040A8', OPTIONS: '#1A8898',
    TRACE: '#666677', CONNECT: '#CC4455',
  };

  function startEditName() {
    editingName = true;
    setTimeout(() => nameInputEl?.focus(), 0);
  }

  function commitName() {
    editingName = false;
    flow = { ...flow, name: flow.name.trim() || 'Untitled Flow' };
    save();
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitName();
    if (e.key === 'Escape') { editingName = false; }
  }

  function save() {
    dispatch('save', { flowPath, flow });
  }

  function addStep(e: CustomEvent<FlowStep>) {
    flow = { ...flow, steps: [...flow.steps, e.detail] };
    save();
  }

  function removeStep(index: number) {
    flow = { ...flow, steps: flow.steps.filter((_, i) => i !== index) };
    save();
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= flow.steps.length) return;
    const steps = [...flow.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    flow = { ...flow, steps };
    save();
  }

  function toggleContinueOnFailure(index: number) {
    const steps = [...flow.steps];
    steps[index] = { ...steps[index], continueOnFailure: !steps[index].continueOnFailure };
    flow = { ...flow, steps };
    save();
  }

  /** Extract method from label like "POST /api/login" */
  function getMethod(label: string): string {
    const m = label.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\b/);
    return m ? m[1] : '';
  }

  function getUrl(label: string): string {
    const m = label.match(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(.*)/);
    return m ? m[1] : label;
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
      on:blur={save}
      placeholder="Add a description..."
      rows="2"
    ></textarea>
  </div>

  <!-- Steps -->
  <div class="flow-steps-section">
    <div class="steps-header">
      <span class="steps-title">Steps</span>
      <span class="steps-count">{flow.steps.length}</span>
      <button class="btn-add-step" on:click={() => showPicker = true}>+ Add step</button>
      {#if flow.steps.length > 0}
        {#if isRunning}
          <button class="btn-run-flow stopping" on:click={() => dispatch('abort')}>Stop</button>
        {:else}
          <button class="btn-run-flow" on:click={() => dispatch('run')}>Run flow</button>
        {/if}
      {/if}
    </div>

    {#if flow.steps.length === 0}
      <div class="steps-empty">
        <span class="steps-empty-text">No steps yet.</span>
        <button class="steps-empty-btn" on:click={() => showPicker = true}>Add a request</button>
      </div>
    {:else}
      <div class="steps-list">
        {#each flow.steps as step, i}
          {@const sr = getStepStatus(step.id)}
          <div class="step-card" class:step-passed={sr?.status === 'passed'} class:step-failed={sr?.status === 'failed'} class:step-running={sr?.status === 'running'} class:step-skipped={sr?.status === 'skipped'}>
            <div class="step-reorder">
              <button
                class="btn-move"
                disabled={i === 0}
                on:click={() => moveStep(i, -1)}
                title="Move up"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 6.5l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                class="btn-move"
                disabled={i === flow.steps.length - 1}
                on:click={() => moveStep(i, 1)}
                title="Move down"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <span class="step-number">{i + 1}</span>
            {#if getMethod(step.label)}
              <span class="step-method" style="color: {MC[getMethod(step.label)] || '#888'}">{getMethod(step.label).slice(0, 3)}</span>
            {/if}
            <span class="step-label" title={step.label}>{getUrl(step.label)}</span>
            <span class="step-file" title={step.filePath}>{step.filePath}</span>
            <button
              class="btn-continue-toggle"
              class:active={step.continueOnFailure}
              on:click={() => toggleContinueOnFailure(i)}
              title={step.continueOnFailure ? 'Continues on failure (click to stop on failure)' : 'Stops on failure (click to continue on failure)'}
            >
              {step.continueOnFailure ? 'skip' : 'stop'}
            </button>
            {#if sr}
              <span class="step-status-info">
                {#if sr.status === 'running'}
                  <span class="step-status-icon running">...</span>
                {:else if sr.status === 'passed'}
                  <span class="step-status-icon passed">&#10003;</span>
                {:else if sr.status === 'failed'}
                  <span class="step-status-icon failed">&#10005;</span>
                {:else if sr.status === 'skipped'}
                  <span class="step-status-icon skipped">-</span>
                {/if}
                {#if sr.response}
                  <span class="step-http-status" class:ok={sr.response.status < 400} class:err={sr.response.status >= 400}>{sr.response.status}</span>
                {/if}
                {#if sr.durationMs > 0}
                  <span class="step-duration">{sr.durationMs}ms</span>
                {/if}
              </span>
            {/if}
            <button class="btn-remove-step" on:click={() => removeStep(i)} title="Remove step">&times;</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Results -->
  {#if runState || lastRunRecord}
    <div class="flow-results-section">
      <span class="results-section-title">Results</span>
      <FlowResults
        runRecord={lastRunRecord}
        history={runHistory}
        flowFilePath={flowPath}
      />
    </div>
  {/if}
</div>

{#if showPicker}
  <FlowStepPicker
    {tree}
    {rootPath}
    on:pick={(e) => { addStep(e); showPicker = false; }}
    on:close={() => showPicker = false}
  />
{/if}

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
    border: none;
    border-bottom: 1px dashed transparent;
    background: transparent;
    font-family: inherit;
    padding: 0;
    text-align: left;
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
  .btn-add-step {
    margin-left: auto;
    padding: 4px 12px;
    border: 1px solid #8040A830;
    border-radius: 5px;
    background: #8040A810;
    color: #8040A8;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-add-step:hover {
    border-color: #8040A8;
    background: #8040A820;
  }
  .steps-empty {
    padding: 24px;
    border: 1px dashed #DCDCE2;
    border-radius: 8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .steps-empty-text {
    font-size: 12px;
    color: #999;
  }
  .steps-empty-btn {
    padding: 6px 16px;
    border: 1px solid #8040A840;
    border-radius: 6px;
    background: #8040A810;
    color: #8040A8;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .steps-empty-btn:hover {
    background: #8040A820;
    border-color: #8040A8;
  }
  .steps-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .step-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #FAFAFA;
    border: 1px solid #E4E4EA;
    border-radius: 6px;
    transition: border-color 0.15s;
  }
  .step-card:hover {
    border-color: #D4D4D8;
  }
  .step-reorder {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex-shrink: 0;
  }
  .btn-move {
    width: 16px; height: 12px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: #BBB;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .btn-move:hover:not(:disabled) {
    color: #8040A8;
    background: #8040A810;
  }
  .btn-move:disabled {
    opacity: 0.3;
    cursor: default;
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
  .step-method {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    min-width: 28px;
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
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn-continue-toggle {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #DCDCE2;
    background: transparent;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-continue-toggle.active {
    border-color: #D4900A50;
    background: #D4900A10;
    color: #D4900A;
  }
  .btn-remove-step {
    width: 20px; height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #CCC;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    visibility: hidden;
    transition: all 0.1s;
  }
  .step-card:hover .btn-remove-step {
    visibility: visible;
  }
  .btn-remove-step:hover {
    background: #CC445518;
    color: #CC4455;
  }

  /* Run button */
  .btn-run-flow {
    padding: 4px 14px;
    border: 1px solid #3D8B4540;
    border-radius: 5px;
    background: #3D8B4510;
    color: #3D8B45;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-run-flow:hover {
    border-color: #3D8B45;
    background: #3D8B4520;
  }
  .btn-run-flow.stopping {
    border-color: #CC445540;
    background: #CC445510;
    color: #CC4455;
  }
  .btn-run-flow.stopping:hover {
    border-color: #CC4455;
    background: #CC445520;
  }

  /* Step status */
  .step-card.step-passed { border-color: #3D8B4540; }
  .step-card.step-failed { border-color: #CC445540; }
  .step-card.step-running { border-color: #D4900A60; }
  .step-card.step-skipped { opacity: 0.5; }

  .step-status-info {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .step-status-icon {
    font-size: 11px;
    font-weight: 700;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .step-status-icon.passed { color: #3D8B45; background: #3D8B4515; }
  .step-status-icon.failed { color: #CC4455; background: #CC445515; }
  .step-status-icon.running { color: #D4900A; background: #D4900A15; }
  .step-status-icon.skipped { color: #999; background: #F0F0F4; }
  .step-http-status {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .step-http-status.ok { color: #3D8B45; background: #3D8B4510; }
  .step-http-status.err { color: #CC4455; background: #CC445510; }
  .step-duration {
    font-size: 10px;
    color: #AAA;
  }

  /* Results section */
  .flow-results-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid #EDEDF0;
    padding-top: 20px;
  }
  .results-section-title {
    font-size: 13px;
    font-weight: 700;
    color: #333340;
  }
</style>
