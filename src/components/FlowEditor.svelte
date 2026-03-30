<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import FlowStepPicker from './FlowStepPicker.svelte';
  import FlowResults from './FlowResults.svelte';
  import type { FlowDefinition, FlowStep, FlowStepResult, FlowRunRecord, FlowRunStatus, FileNode, TreeNode as TNode, HttpHeader, FlowStepOverrides, PbDirective } from '../lib/types';
  import { getAllFileNodes, substituteAll } from '../lib/parser';
  import { resolvedEnvVars, namedResults, dotenvVariables } from '../lib/stores';

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
    clearHistory: void;
  }>();

  $: isRunning = runState?.status === 'running';
  $: allFiles = getAllFileNodes(tree);

  /** Find the FileNode matching a step's filePath. */
  function findFileForStep(step: FlowStep): FileNode | undefined {
    const normalized = step.filePath.replaceAll('\\', '/');
    return allFiles.find(f => {
      const rel = f.path.substring(rootPath.length + 1).replaceAll('\\', '/');
      return rel === normalized;
    });
  }

  /** Check if a step's target file and request still exist in the workspace. */
  function isStepBroken(step: FlowStep): boolean {
    const file = findFileForStep(step);
    if (!file) return true;
    if (step.requestIndex >= 0 && step.requestIndex < file.requests.length) return false;
    if (step.varName && file.requests.some(r => r.varName === step.varName)) return false;
    return true;
  }

  $: brokenCount = flow.steps.filter(isStepBroken).length;
  $: hasAnyBroken = brokenCount > 0;

  function getStepStatus(stepId: string): FlowStepResult | undefined {
    return runState?.stepResults.find(r => r.stepId === stepId);
  }

  let editingName = false;
  let nameInputEl: HTMLInputElement;
  let showPicker = false;

  // Drag-and-drop reordering
  let draggingIndex: number = -1;
  /** Insertion slot: 0 = before first, 1 = after first / before second, etc. */
  let insertSlot: number = -1;
  /** Cached card positions from drag start - prevents layout-feedback flicker */
  let cachedRects: { top: number; height: number }[] = [];
  const HYSTERESIS = 8; // px deadzone before switching slots

  function onDragStart(e: DragEvent, index: number) {
    draggingIndex = index;
    // Snapshot card positions before any visual changes
    const card = e.currentTarget as HTMLElement;
    const list = card.closest('.steps-list');
    if (list) {
      const cards = list.querySelectorAll('.step-card');
      cachedRects = Array.from(cards).map(c => {
        const r = c.getBoundingClientRect();
        return { top: r.top, height: r.height };
      });
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function onListDragOver(e: DragEvent) {
    if (draggingIndex === -1 || cachedRects.length === 0) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    // Find which insertion slot the cursor is closest to using cached rects
    let newSlot = cachedRects.length; // default: after last

    for (let i = 0; i < cachedRects.length; i++) {
      const midY = cachedRects[i].top + cachedRects[i].height / 2;
      if (e.clientY < midY) {
        newSlot = i;
        break;
      }
    }

    // Don't show indicator right above or below the dragged item (no-op drop)
    if (newSlot === draggingIndex || newSlot === draggingIndex + 1) {
      insertSlot = -1;
      return;
    }

    // Hysteresis: if we already have a slot, require cursor to move past deadzone
    if (insertSlot !== -1 && newSlot !== insertSlot) {
      const boundaryIdx = newSlot < cachedRects.length ? newSlot : cachedRects.length - 1;
      const mid = cachedRects[boundaryIdx].top + cachedRects[boundaryIdx].height / 2;
      if (Math.abs(e.clientY - mid) < HYSTERESIS) return;
    }

    insertSlot = newSlot;
  }

  function onListDrop(e: DragEvent) {
    e.preventDefault();
    if (draggingIndex === -1 || insertSlot === -1) {
      draggingIndex = -1;
      insertSlot = -1;
      cachedRects = [];
      return;
    }

    const steps = [...flow.steps];
    const [moved] = steps.splice(draggingIndex, 1);
    // Adjust target index after removal
    const target = insertSlot > draggingIndex ? insertSlot - 1 : insertSlot;
    steps.splice(target, 0, moved);
    flow = { ...flow, steps };
    save();
    draggingIndex = -1;
    insertSlot = -1;
    cachedRects = [];
  }

  function onDragEnd() {
    draggingIndex = -1;
    insertSlot = -1;
    cachedRects = [];
  }

  function onListDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
      insertSlot = -1;
  }

  function moveStep(from: number, to: number) {
    if (from === to || to < 0 || to >= flow.steps.length) return;
    const steps = [...flow.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    flow = { ...flow, steps };
    save();
  }

  function onStepKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      moveStep(index, index - 1);
      // Re-focus the moved card's handle after Svelte re-renders
      requestAnimationFrame(() => {
        const list = (e.target as HTMLElement).closest('.steps-list');
        const handles = list?.querySelectorAll<HTMLElement>('.drag-handle');
        handles?.[index - 1]?.focus();
      });
    } else if (e.key === 'ArrowDown' && index < flow.steps.length - 1) {
      e.preventDefault();
      moveStep(index, index + 1);
      requestAnimationFrame(() => {
        const list = (e.target as HTMLElement).closest('.steps-list');
        const handles = list?.querySelectorAll<HTMLElement>('.drag-handle');
        handles?.[index + 1]?.focus();
      });
    }
  }

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

  /** Resolve a raw URL using current environment/variables. Returns '' if no change. */
  function resolveStepUrl(rawUrl: string, file: FileNode | undefined): string {
    if (!rawUrl || !rawUrl.includes('{{')) return '';
    const resolved = substituteAll(rawUrl, {
      fileVariables: file?.variables ?? [],
      environmentVariables: $resolvedEnvVars,
      namedResults: $namedResults,
      dotenvVariables: $dotenvVariables,
    });
    return resolved !== rawUrl ? resolved : '';
  }

  /** Compute URL suffixes for requests in a file, stripping common prefix segments. */
  function computeFileSuffixes(requests: { url: string }[]): string[] {
    if (requests.length === 0) return [];
    if (requests.length === 1) return [requests[0].url];
    const split = requests.map(r => r.url.split('/'));
    const minLen = Math.min(...split.map(s => s.length));
    let common = 0;
    for (let i = 0; i < minLen; i++) {
      if (split.every(s => s[i] === split[0][i])) common = i + 1;
      else break;
    }
    if (common === 0) return requests.map(r => r.url);
    return split.map(s => '/' + s.slice(common).join('/'));
  }

  // ─── Override editing ───────────────────────────────────────────────────────

  let expandedStepId: string | null = null;
  /** Tracks which sections are collapsed, keyed as "stepId:section" */
  let collapsedKeys: Record<string, boolean> = {};

  function toggleSection(stepId: string, section: string) {
    const key = `${stepId}:${section}`;
    collapsedKeys = { ...collapsedKeys, [key]: !collapsedKeys[key] };
  }

  function toggleOverridePanel(stepId: string) {
    expandedStepId = expandedStepId === stepId ? null : stepId;
  }

  function hasOverrides(step: FlowStep): boolean {
    if (!step.overrides) return false;
    const o = step.overrides;
    return o.url !== undefined || o.headers !== undefined || o.body !== undefined || o.directives !== undefined;
  }

  function updateStepOverride(index: number, field: keyof FlowStepOverrides, value: any) {
    const steps = [...flow.steps];
    const step = { ...steps[index] };
    const overrides = { ...(step.overrides || {}) };

    if (value === undefined || value === '') {
      delete (overrides as any)[field];
    } else {
      (overrides as any)[field] = value;
    }

    step.overrides = Object.keys(overrides).length > 0 ? overrides : undefined;
    steps[index] = step;
    flow = { ...flow, steps };
    save();
  }

  function addOverrideHeader(index: number, baseHeaders: HttpHeader[]) {
    const current = flow.steps[index].overrides?.headers ?? baseHeaders.map(h => ({ ...h }));
    updateStepOverride(index, 'headers', [...current, { key: '', value: '', enabled: true }]);
  }

  function removeOverrideHeader(stepIndex: number, headerIndex: number, baseHeaders: HttpHeader[]) {
    const current = flow.steps[stepIndex].overrides?.headers ?? baseHeaders.map(h => ({ ...h }));
    const updated = current.filter((_, i) => i !== headerIndex);
    updateStepOverride(stepIndex, 'headers', updated.length > 0 ? updated : undefined);
  }

  function updateOverrideHeader(stepIndex: number, headerIndex: number, field: keyof HttpHeader, value: any, baseHeaders: HttpHeader[]) {
    const current = (flow.steps[stepIndex].overrides?.headers ?? baseHeaders.map(h => ({ ...h }))).map(h => ({ ...h }));
    current[headerIndex] = { ...current[headerIndex], [field]: value };
    updateStepOverride(stepIndex, 'headers', current);
  }

  function addOverrideDirective(stepIndex: number, baseDirectives: PbDirective[]) {
    const current = flow.steps[stepIndex].overrides?.directives ?? baseDirectives.map(d => ({ ...d }));
    updateStepOverride(stepIndex, 'directives', [...current, { type: 'assert' as const, expr: '', label: '' }]);
  }

  function removeOverrideDirective(stepIndex: number, dirIndex: number, baseDirectives: PbDirective[]) {
    const current = flow.steps[stepIndex].overrides?.directives ?? baseDirectives.map(d => ({ ...d }));
    const updated = current.filter((_, i) => i !== dirIndex);
    updateStepOverride(stepIndex, 'directives', updated.length > 0 ? updated : undefined);
  }

  function updateOverrideDirective(stepIndex: number, dirIndex: number, field: string, value: any, baseDirectives: PbDirective[]) {
    const current = (flow.steps[stepIndex].overrides?.directives ?? baseDirectives.map(d => ({ ...d }))).map(d => ({ ...d }));
    (current[dirIndex] as any)[field] = value;
    updateStepOverride(stepIndex, 'directives', current);
  }

  function resetOverrides(index: number) {
    const steps = [...flow.steps];
    steps[index] = { ...steps[index], overrides: undefined };
    flow = { ...flow, steps };
    save();
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
          <button class="btn-run-flow" on:click={() => dispatch('run')} disabled={hasAnyBroken} title={hasAnyBroken ? 'Fix broken step references before running' : ''}>Run flow</button>
        {/if}
      {/if}
    </div>

    {#if hasAnyBroken}
      <div class="broken-warning">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="#D4900A" stroke-width="1.3" fill="#D4900A10"/>
          <path d="M8 6v3M8 11v.5" stroke="#D4900A" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>{brokenCount} step{brokenCount === 1 ? '' : 's'} reference requests that no longer exist. Remove or re-add them.</span>
      </div>
    {/if}

    {#if flow.steps.length === 0}
      <div class="steps-empty">
        <span class="steps-empty-text">No steps yet.</span>
        <button class="steps-empty-btn" on:click={() => showPicker = true}>Add a request</button>
      </div>
    {:else}
      <div
        class="steps-list"
        role="list"
        on:dragover={onListDragOver}
        on:drop={onListDrop}
        on:dragleave={onListDragLeave}
      >
        {#each flow.steps as step, i}
          {#if insertSlot === i}
            <div class="drop-indicator"></div>
          {/if}
          {@const sr = getStepStatus(step.id)}
          {@const broken = isStepBroken(step)}
          {@const file = findFileForStep(step)}
          {@const suffixes = file ? computeFileSuffixes(file.requests) : null}
          {@const displayUrl = (suffixes && step.requestIndex >= 0 && step.requestIndex < suffixes.length) ? suffixes[step.requestIndex] : getUrl(step.label)}
          {@const req = file && step.requestIndex >= 0 && step.requestIndex < (file.requests?.length ?? 0) ? file.requests[step.requestIndex] : null}
          {@const rawUrl = req ? req.url : getUrl(step.label)}
          {@const requestName = req?.name ?? ''}
          {@const resolvedUrl = resolveStepUrl(rawUrl, file)}
          {@const baseHeaders = req?.headers ?? []}
          {@const baseDirectives = req?.directives ?? []}
          <div
            class="step-card"
            class:step-passed={sr?.status === 'passed'}
            class:step-failed={sr?.status === 'failed'}
            class:step-running={sr?.status === 'running'}
            class:step-skipped={sr?.status === 'skipped'}
            class:step-broken={broken}
            class:dragging={draggingIndex === i}
            draggable="true"
            on:dragstart={(e) => onDragStart(e, i)}
            on:dragover|preventDefault
            on:dragend={onDragEnd}
            role="listitem"
          >
            <div class="step-card-row">
              <span
                class="drag-handle"
                title="Drag to reorder"
                role="button"
                tabindex="0"
                aria-label="Reorder step {i + 1}, use arrow keys"
                on:keydown={(e) => onStepKeydown(e, i)}
              >
                <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                  <circle cx="3" cy="2.5" r="1.2" fill="currentColor"/>
                  <circle cx="7" cy="2.5" r="1.2" fill="currentColor"/>
                  <circle cx="3" cy="7" r="1.2" fill="currentColor"/>
                  <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
                  <circle cx="3" cy="11.5" r="1.2" fill="currentColor"/>
                  <circle cx="7" cy="11.5" r="1.2" fill="currentColor"/>
                </svg>
              </span>
              <span class="step-number">{i + 1}</span>
              <div class="step-content">
                <div class="step-top-row">
                  <span class="step-file" title={step.filePath}>{step.filePath.replace(/\.[^.]+$/, '').split('/').pop()}</span>
                  {#if broken}
                    <span class="step-broken-badge">missing</span>
                  {/if}
                </div>
                {#if requestName}
                  <span class="step-request-name">{requestName}</span>
                {/if}
                <div class="step-url-row">
                  {#if getMethod(step.label)}
                    <span class="step-method" style="color: {MC[getMethod(step.label)] || '#888'}">{getMethod(step.label).slice(0, 3)}</span>
                  {/if}
                  <span class="step-label" title={getUrl(step.label)}>{displayUrl}</span>
                </div>
                {#if resolvedUrl}
                  <div class="step-resolved-url">
                    <span class="resolved-arrow">&rarr;</span>
                    <span class="resolved-value">{resolvedUrl}</span>
                  </div>
                {/if}
              </div>
              <div class="step-actions">
                <button
                  class="btn-override-toggle"
                  class:active={hasOverrides(step)}
                  class:expanded={expandedStepId === step.id}
                  on:click={() => toggleOverridePanel(step.id)}
                  title={hasOverrides(step) ? 'Edit overrides (has customizations)' : 'Customize request for this step'}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                    <path d="M9.5 3.5l3 3" stroke="currentColor" stroke-width="1.4"/>
                  </svg>
                </button>
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
            </div>

            {#if expandedStepId === step.id}
              <div class="override-panel">
                <div class="override-section">
                  <div class="override-row">
                    <span class="override-label">URL</span>
                    <input
                      class="override-input"
                      type="text"
                      value={step.overrides?.url ?? ''}
                      placeholder={req?.url ?? getUrl(step.label)}
                      on:input={(e) => updateStepOverride(i, 'url', e.currentTarget.value || undefined)}
                      spellcheck="false"
                    />
                  </div>
                </div>

                <div class="override-section">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="override-section-header collapsible" on:click={() => toggleSection(step.id, 'headers')} on:keydown={(e) => { if (e.key === 'Enter') toggleSection(step.id, 'headers'); }}>
                    <span class="override-collapse-icon" class:open={!collapsedKeys[`${step.id}:headers`]}>&#9656;</span>
                    <span class="override-label">Headers</span>
                    <span class="override-count">{(step.overrides?.headers ?? baseHeaders).length}</span>
                    {#if !collapsedKeys[`${step.id}:headers`]}
                      <button class="override-add-btn" on:click|stopPropagation={() => addOverrideHeader(i, baseHeaders)}>+ Add</button>
                    {/if}
                  </div>
                  {#if !collapsedKeys[`${step.id}:headers`]}
                    {#each (step.overrides?.headers ?? baseHeaders) as h, hi}
                      <div class="override-header-row">
                        <input
                          type="checkbox"
                          checked={h.enabled}
                          on:change={() => updateOverrideHeader(i, hi, 'enabled', !h.enabled, baseHeaders)}
                          class="override-header-check"
                        />
                        <input
                          class="override-header-key"
                          type="text"
                          value={h.key}
                          placeholder="Header name"
                          on:input={(e) => updateOverrideHeader(i, hi, 'key', e.currentTarget.value, baseHeaders)}
                          spellcheck="false"
                        />
                        <input
                          class="override-header-value"
                          type="text"
                          value={h.value}
                          placeholder="Value"
                          on:input={(e) => updateOverrideHeader(i, hi, 'value', e.currentTarget.value, baseHeaders)}
                          spellcheck="false"
                        />
                        <button class="override-header-remove" on:click={() => removeOverrideHeader(i, hi, baseHeaders)}>&times;</button>
                      </div>
                    {/each}
                  {/if}
                </div>

                <div class="override-section">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="override-section-header collapsible" on:click={() => toggleSection(step.id, 'body')} on:keydown={(e) => { if (e.key === 'Enter') toggleSection(step.id, 'body'); }}>
                    <span class="override-collapse-icon" class:open={!collapsedKeys[`${step.id}:body`]}>&#9656;</span>
                    <span class="override-label">Body</span>
                  </div>
                  {#if !collapsedKeys[`${step.id}:body`]}
                    <textarea
                      class="override-body"
                      value={step.overrides?.body ?? ''}
                      placeholder={req?.body || 'No body'}
                      on:input={(e) => updateStepOverride(i, 'body', e.currentTarget.value || undefined)}
                      spellcheck="false"
                      rows="4"
                    ></textarea>
                  {/if}
                </div>

                <div class="override-section">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="override-section-header collapsible" on:click={() => toggleSection(step.id, 'assertions')} on:keydown={(e) => { if (e.key === 'Enter') toggleSection(step.id, 'assertions'); }}>
                    <span class="override-collapse-icon" class:open={!collapsedKeys[`${step.id}:assertions`]}>&#9656;</span>
                    <span class="override-label">Assertions</span>
                    <span class="override-count">{(step.overrides?.directives ?? baseDirectives).length}</span>
                    {#if !collapsedKeys[`${step.id}:assertions`]}
                      <button class="override-add-btn" on:click|stopPropagation={() => addOverrideDirective(i, baseDirectives)}>+ Add</button>
                    {/if}
                  </div>
                  {#if !collapsedKeys[`${step.id}:assertions`]}
                    {#each (step.overrides?.directives ?? baseDirectives) as d, di}
                      <div class="override-directive-row" class:disabled={d.enabled === false}>
                        <input
                          type="checkbox"
                          checked={d.enabled !== false}
                          on:change={() => updateOverrideDirective(i, di, 'enabled', d.enabled === false ? undefined : false, baseDirectives)}
                          class="override-header-check"
                        />
                        {#if d.type === 'assert'}
                          <input
                            class="override-directive-expr"
                            type="text"
                            value={d.expr}
                            placeholder="pb.response.status == 200"
                            on:input={(e) => updateOverrideDirective(i, di, 'expr', e.currentTarget.value, baseDirectives)}
                            spellcheck="false"
                          />
                          <input
                            class="override-directive-label"
                            type="text"
                            value={d.label}
                            placeholder="Label"
                            on:input={(e) => updateOverrideDirective(i, di, 'label', e.currentTarget.value, baseDirectives)}
                            spellcheck="false"
                          />
                        {:else}
                          <input
                            class="override-directive-key"
                            type="text"
                            value={d.key}
                            placeholder="Variable name"
                            on:input={(e) => updateOverrideDirective(i, di, 'key', e.currentTarget.value, baseDirectives)}
                            spellcheck="false"
                          />
                          <input
                            class="override-directive-expr"
                            type="text"
                            value={d.expr}
                            placeholder="pb.response.body.$.token"
                            on:input={(e) => updateOverrideDirective(i, di, 'expr', e.currentTarget.value, baseDirectives)}
                            spellcheck="false"
                          />
                        {/if}
                        <button class="override-header-remove" on:click={() => removeOverrideDirective(i, di, baseDirectives)}>&times;</button>
                      </div>
                    {/each}
                  {/if}
                </div>

                {#if hasOverrides(step)}
                  <div class="override-footer">
                    <button class="override-reset-btn" on:click={() => resetOverrides(i)}>Reset all overrides</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        {#if insertSlot === flow.steps.length}
          <div class="drop-indicator"></div>
        {/if}
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
        on:clearHistory={() => dispatch('clearHistory')}
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
    gap: 6px;
  }
  .step-card {
    display: flex;
    flex-direction: column;
    background: #FAFAFA;
    border: 1px solid #E4E4EA;
    border-radius: 8px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .step-card:hover {
    border-color: #D4D4D8;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .step-card-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
    color: #CCC;
    cursor: grab;
    margin-top: 4px;
    transition: color 0.15s;
  }
  .step-card:hover .drag-handle {
    color: #AAA;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .drag-handle:focus-visible {
    outline: 2px solid #8040A8;
    outline-offset: 2px;
    border-radius: 3px;
    color: #888;
  }
  .step-card.dragging {
    opacity: 0.35;
  }
  .drop-indicator {
    height: 0;
    overflow: visible;
    position: relative;
    z-index: 1;
    pointer-events: none;
  }
  .drop-indicator::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -1.5px;
    height: 3px;
    background: #8040A8;
    border-radius: 2px;
  }
  .step-number {
    font-size: 11px;
    font-weight: 700;
    color: #8040A8;
    background: #8040A80D;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .step-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .step-top-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 1px;
  }
  .step-file {
    font-size: 10.5px;
    color: #AAA;
    letter-spacing: 0.2px;
    text-transform: uppercase;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-request-name {
    font-size: 13px;
    font-weight: 600;
    color: #2A2A32;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .step-url-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .step-method {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    min-width: 30px;
    flex-shrink: 0;
  }
  .step-label {
    font-size: 12px;
    color: #777;
    font-weight: 400;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-resolved-url {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    padding-left: 36px;
  }
  .step-resolved-url .resolved-arrow {
    font-size: 11px;
    color: #BBB;
    flex-shrink: 0;
  }
  .step-resolved-url .resolved-value {
    font-size: 11px;
    color: #3D8B45;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
  .step-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-top: 3px;
  }
  .btn-continue-toggle {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
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
    width: 22px; height: 22px;
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

  /* Broken references */
  .broken-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #D4900A08;
    border: 1px solid #D4900A30;
    border-radius: 6px;
    font-size: 11px;
    color: #9A7520;
  }
  .step-card.step-broken {
    border-color: #D4900A50;
    background: #D4900A06;
  }
  .step-card.step-broken .step-label {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .step-broken-badge {
    font-size: 9px;
    font-weight: 600;
    color: #D4900A;
    background: #D4900A15;
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .btn-run-flow:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  /* Override toggle button */
  .btn-override-toggle {
    width: 24px; height: 24px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: transparent;
    color: #BBB;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-override-toggle:hover {
    border-color: #8040A860;
    color: #8040A8;
    background: #8040A808;
  }
  .btn-override-toggle.active {
    border-color: #8040A850;
    background: #8040A80D;
    color: #8040A8;
  }
  .btn-override-toggle.expanded {
    border-color: #8040A8;
    background: #8040A815;
    color: #8040A8;
  }

  /* Override panel */
  .override-panel {
    border-top: 1px solid #E4E4EA;
    padding: 12px 14px 12px 48px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .override-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .override-section-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .override-section-header.collapsible {
    cursor: pointer;
    user-select: none;
    padding: 2px 0;
  }
  .override-section-header.collapsible:hover .override-label {
    color: #666;
  }
  .override-collapse-icon {
    font-size: 10px;
    color: #AAA;
    transition: transform 0.15s;
    display: inline-block;
    width: 10px;
    flex-shrink: 0;
  }
  .override-collapse-icon.open {
    transform: rotate(90deg);
  }
  .override-count {
    font-size: 10px;
    color: #AAA;
    margin-right: auto;
  }
  .override-section-header .override-add-btn {
    margin-left: auto;
  }
  .override-label {
    font-size: 10.5px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .override-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .override-row .override-label {
    min-width: 50px;
    flex-shrink: 0;
  }
  .override-input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 5px;
    background: #FFF;
    font-family: inherit;
    font-size: 12px;
    color: #2A2A32;
    outline: none;
  }
  .override-input:focus {
    border-color: #8040A8;
  }
  .override-input::placeholder {
    color: #CCC;
  }
  .override-add-btn {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: transparent;
    color: #999;
    cursor: pointer;
    transition: all 0.15s;
  }
  .override-add-btn:hover {
    border-color: #8040A860;
    color: #8040A8;
  }
  .override-header-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .override-header-check {
    flex-shrink: 0;
    accent-color: #8040A8;
  }
  .override-header-key {
    flex: 0 0 35%;
    padding: 4px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: #FFF;
    font-family: inherit;
    font-size: 11.5px;
    color: #2A2A32;
    outline: none;
  }
  .override-header-key:focus {
    border-color: #8040A8;
  }
  .override-header-value {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: #FFF;
    font-family: inherit;
    font-size: 11.5px;
    color: #2A2A32;
    outline: none;
  }
  .override-header-value:focus {
    border-color: #8040A8;
  }
  .override-header-key::placeholder,
  .override-header-value::placeholder {
    color: #CCC;
  }
  .override-header-remove {
    width: 20px; height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #CCC;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .override-header-remove:hover {
    background: #CC445518;
    color: #CC4455;
  }
  .override-body {
    padding: 6px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 5px;
    background: #FFF;
    font-family: inherit;
    font-size: 11.5px;
    color: #2A2A32;
    outline: none;
    resize: vertical;
    min-height: 60px;
  }
  .override-body:focus {
    border-color: #8040A8;
  }
  .override-body::placeholder {
    color: #CCC;
  }
  .override-footer {
    display: flex;
    justify-content: flex-end;
  }
  .override-directive-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .override-directive-row.disabled input[type="text"] {
    opacity: 0.4;
  }
  .override-directive-expr {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: #FFF;
    font-family: inherit;
    font-size: 11.5px;
    color: #2A2A32;
    outline: none;
  }
  .override-directive-expr:focus {
    border-color: #8040A8;
  }
  .override-directive-label,
  .override-directive-key {
    flex: 0 0 25%;
    padding: 4px 8px;
    border: 1px solid #DCDCE2;
    border-radius: 4px;
    background: #FFF;
    font-family: inherit;
    font-size: 11.5px;
    color: #2A2A32;
    outline: none;
  }
  .override-directive-label:focus,
  .override-directive-key:focus {
    border-color: #8040A8;
  }
  .override-directive-expr::placeholder,
  .override-directive-label::placeholder,
  .override-directive-key::placeholder {
    color: #CCC;
  }
  .override-reset-btn {
    font-size: 10.5px;
    font-weight: 600;
    padding: 3px 10px;
    border: 1px solid #CC445530;
    border-radius: 4px;
    background: transparent;
    color: #CC4455;
    cursor: pointer;
    transition: all 0.15s;
  }
  .override-reset-btn:hover {
    border-color: #CC4455;
    background: #CC445510;
  }
</style>
