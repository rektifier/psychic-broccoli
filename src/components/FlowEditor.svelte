<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import FlowStepPicker from './FlowStepPicker.svelte';
  import FlowResults from './FlowResults.svelte';
  import type { FlowDefinition, FlowStep, FlowStepResult, FlowRunRecord, FlowRunStatus, FileNode, TreeNode as TNode, HttpHeader, FlowStepOverrides, PbDirective } from '../lib/types';
  import { getAllFileNodes, substituteAll, parseScriptText } from '../lib/parser';
  import { baseEnvVars, namedResults, dotenvVariables } from '../lib/stores';
  import { METHOD_COLORS } from '../lib/theme';

  export let flow: FlowDefinition;
  export let flowPath: string;
  export let tree: TNode[] = [];
  export let rootPath: string = '';
  export let runState: { status: FlowRunStatus; stepResults: FlowStepResult[] } | null = null;
  export let lastRunRecord: FlowRunRecord | null = null;
  export let runHistory: FlowRunRecord[] = [];
  export let uiState: { expandedStepId: string | null; collapsedKeys: Record<string, boolean>; activeOverrideTabs: Record<string, string> } | null = null;

  const dispatch = createEventDispatcher<{
    save: { flowPath: string; flow: FlowDefinition };
    run: void;
    abort: void;
    clearHistory: void;
    uiStateChange: { expandedStepId: string | null; collapsedKeys: Record<string, boolean>; activeOverrideTabs: Record<string, string> };
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
  let handleGrabbed = false;

  function onDragStart(e: DragEvent, index: number) {
    // Only allow drag from the drag handle
    if (!handleGrabbed) {
      e.preventDefault();
      return;
    }
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
    handleGrabbed = false;
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
    // Only resolve environment variables; runtime/file-scoped variables stay as {{placeholders}}
    const nonEmptyEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries($baseEnvVars)) {
      if (v) nonEmptyEnv[k] = v;
    }
    const resolved = substituteAll(rawUrl, {
      fileVariables: [],
      environmentVariables: nonEmptyEnv,
      namedResults: {},
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

  let expandedStepId: string | null = uiState?.expandedStepId ?? null;
  /** Tracks which sections are collapsed, keyed as "stepId:section" (only used for Headers now) */
  let collapsedKeys: Record<string, boolean> = uiState?.collapsedKeys ?? {};
  /** Active tab per step in the override panel */
  let activeOverrideTabs: Record<string, string> = uiState?.activeOverrideTabs ?? {};

  // Sync local UI state when the parent passes a new uiState (e.g. switching flow tabs)
  let prevUiState = uiState;
  $: if (uiState !== prevUiState) {
    prevUiState = uiState;
    expandedStepId = uiState?.expandedStepId ?? null;
    collapsedKeys = uiState?.collapsedKeys ?? {};
    activeOverrideTabs = uiState?.activeOverrideTabs ?? {};
  }

  /** Reactive lookup: which tab is active for each step. Falls back to 'body'. */
  $: activeTabLookup = (stepId: string) => activeOverrideTabs[stepId] ?? 'body';

  function setActiveTab(stepId: string, tab: string) {
    activeOverrideTabs = { ...activeOverrideTabs, [stepId]: tab };
    emitUIState();
  }

  function emitUIState() {
    dispatch('uiStateChange', { expandedStepId, collapsedKeys, activeOverrideTabs });
  }

  function toggleSection(stepId: string, section: string) {
    const key = `${stepId}:${section}`;
    collapsedKeys = { ...collapsedKeys, [key]: !collapsedKeys[key] };
    emitUIState();
  }

  function toggleOverridePanel(stepId: string) {
    if (expandedStepId === stepId) {
      expandedStepId = null;
    } else {
      expandedStepId = stepId;
      // Start headers collapsed on first expand
      const headersKey = `${stepId}:headers`;
      if (!(headersKey in collapsedKeys)) {
        collapsedKeys = { ...collapsedKeys, [headersKey]: true };
      }
    }
    emitUIState();
  }

  function hasOverrides(step: FlowStep): boolean {
    if (!step.overrides) return false;
    const o = step.overrides;
    return o.url !== undefined || o.headers !== undefined || o.body !== undefined || o.directives !== undefined || o.beforeSend !== undefined || o.afterReceive !== undefined;
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

  function directivesToText(directives: PbDirective[]): string {
    return directives.map(d => {
      if (d.type === 'assert') return d.label ? `${d.expr} | ${d.label}` : d.expr;
      if (d.type === 'set') return `pb.set("${d.key}", ${d.expr})`;
      if (d.type === 'global') return `pb.global("${d.key}", ${d.expr})`;
      return '';
    }).join('\n');
  }

  function textToDirectives(text: string): PbDirective[] {
    if (!text.trim()) return [];
    // First try parseScriptText for pb.set/pb.global/# @pb.* syntax
    const parsed = parseScriptText(text);
    if (parsed.length > 0) return parsed;
    // Fall back to simple assert format: expr | label
    return text.split('\n').filter(l => l.trim()).map(line => {
      const pipeIndex = line.indexOf(' | ');
      if (pipeIndex >= 0) return { type: 'assert' as const, expr: line.slice(0, pipeIndex), label: line.slice(pipeIndex + 3) };
      return { type: 'assert' as const, expr: line, label: '' };
    });
  }

  function onDirectivesTextInput(stepIndex: number, text: string, baseDirectives: PbDirective[]) {
    // Parse each line independently so mixed content works
    const directives: PbDirective[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fromScript = parseScriptText(trimmed);
      if (fromScript.length > 0) {
        directives.push(...fromScript);
      } else {
        // Simple assert format: expr | label
        const pipeIndex = trimmed.indexOf(' | ');
        if (pipeIndex >= 0) directives.push({ type: 'assert' as const, expr: trimmed.slice(0, pipeIndex), label: trimmed.slice(pipeIndex + 3) });
        else directives.push({ type: 'assert' as const, expr: trimmed, label: '' });
      }
    }
    const baseText = directivesToText(baseDirectives);
    updateStepOverride(stepIndex, 'directives', text === baseText ? undefined : directives);
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
        <path d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.1"/>
        <path d="M6 4.5h4M11.5 6v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
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
          <path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity="0.06"/>
          <path d="M8 6v3M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>{brokenCount} step{brokenCount === 1 ? '' : 's'} reference requests that no longer exist. Remove or re-add them.</span>
      </div>
    {/if}

    {#if flow.steps.length === 0}
      <div class="steps-empty">
        <span class="steps-empty-text">No steps yet.</span>
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
                on:mousedown={() => handleGrabbed = true}
                on:mouseup={() => handleGrabbed = false}
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
              <button
                class="btn-override-toggle"
                class:active={hasOverrides(step)}
                class:expanded={expandedStepId === step.id}
                on:click|stopPropagation={() => toggleOverridePanel(step.id)}
                title={hasOverrides(step) ? 'Edit overrides (has customizations)' : 'Customize request for this step'}
              >
                <svg class="toggle-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
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
                    <span class="step-method" style="color: {METHOD_COLORS[getMethod(step.label)] || 'var(--color-text-muted)'}">{getMethod(step.label).slice(0, 3)}</span>
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
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="override-panel" on:mousedown|stopPropagation on:dragstart|preventDefault|stopPropagation>
                <div class="override-section">
                  <div class="override-row">
                    <span class="override-label">URL{#if step.overrides?.url !== undefined}<span class="modified-dot" title="Modified"></span>{/if}</span>
                    <input
                      class="override-input"
                      class:showing-base={step.overrides?.url === undefined && !!(req?.url ?? getUrl(step.label))}
                      type="text"
                      value={step.overrides?.url ?? req?.url ?? getUrl(step.label)}
                      placeholder="No URL"
                      on:input={(e) => {
                        const val = e.currentTarget.value;
                        const base = req?.url ?? getUrl(step.label);
                        updateStepOverride(i, 'url', val === base ? undefined : val || undefined);
                      }}
                      spellcheck="false"
                    />
                  </div>
                </div>

                <div class="override-section">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="override-section-header collapsible" on:click={() => toggleSection(step.id, 'headers')} on:keydown={(e) => { if (e.key === 'Enter') toggleSection(step.id, 'headers'); }}>
                    <span class="override-collapse-icon" class:open={!collapsedKeys[`${step.id}:headers`]}>&#9656;</span>
                    <span class="override-label">Headers{#if step.overrides?.headers !== undefined}<span class="modified-dot" title="Modified"></span>{/if}</span>
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

                <div class="override-tab-panel">
                  <div class="override-tabs">
                    <button class="override-tab" class:active={activeTabLookup(step.id) === 'body'} on:click={() => setActiveTab(step.id, 'body')}>
                      Body
                      {#if step.overrides?.body !== undefined}<span class="modified-dot" title="Modified"></span>{/if}
                    </button>
                    <button class="override-tab" class:active={activeTabLookup(step.id) === 'assertions'} on:click={() => setActiveTab(step.id, 'assertions')}>
                      Assertions
                      {#if (step.overrides?.directives ?? baseDirectives).length > 0}
                        <span class="override-tab-count">{(step.overrides?.directives ?? baseDirectives).length}</span>
                      {/if}
                      {#if step.overrides?.directives !== undefined}<span class="modified-dot" title="Modified"></span>{/if}
                    </button>
                    <button class="override-tab" class:active={activeTabLookup(step.id) === 'beforeSend'} on:click={() => setActiveTab(step.id, 'beforeSend')}>
                      Before Send
                      {#if step.overrides?.beforeSend !== undefined}<span class="modified-dot" title="Modified"></span>{/if}
                    </button>
                    <button class="override-tab" class:active={activeTabLookup(step.id) === 'afterReceive'} on:click={() => setActiveTab(step.id, 'afterReceive')}>
                      After Receive
                      {#if step.overrides?.afterReceive !== undefined}<span class="modified-dot" title="Modified"></span>{/if}
                    </button>
                  </div>
                  <div class="override-tab-content">
                    {#if activeTabLookup(step.id) === 'body'}
                      <textarea
                        class="override-body"
                        class:showing-base={step.overrides?.body === undefined && !!req?.body}
                        value={step.overrides?.body ?? req?.body ?? ''}
                        placeholder="No body"
                        on:input={(e) => {
                          const val = e.currentTarget.value;
                          updateStepOverride(i, 'body', val === (req?.body ?? '') ? undefined : val || undefined);
                        }}
                        spellcheck="false"
                        rows="8"
                      ></textarea>
                    {:else if activeTabLookup(step.id) === 'assertions'}
                      <textarea
                        class="override-body"
                        class:showing-base={step.overrides?.directives === undefined && baseDirectives.length > 0}
                        value={directivesToText(step.overrides?.directives ?? baseDirectives)}
                        placeholder={"One assertion per line:\npb.response.status == 200 | Should return 200\npb.response.body.$.name != null | Name should exist"}
                        on:input={(e) => onDirectivesTextInput(i, e.currentTarget.value, baseDirectives)}
                        spellcheck="false"
                        rows="8"
                      ></textarea>
                    {:else if activeTabLookup(step.id) === 'beforeSend'}
                      <textarea
                        class="override-body"
                        class:showing-base={step.overrides?.beforeSend === undefined && !!req?.beforeSend}
                        value={step.overrides?.beforeSend ?? req?.beforeSend ?? ''}
                        placeholder="No before-send script"
                        on:input={(e) => {
                          const val = e.currentTarget.value;
                          updateStepOverride(i, 'beforeSend', val === (req?.beforeSend ?? '') ? undefined : val || undefined);
                        }}
                        spellcheck="false"
                        rows="8"
                      ></textarea>
                    {:else if activeTabLookup(step.id) === 'afterReceive'}
                      <textarea
                        class="override-body"
                        class:showing-base={step.overrides?.afterReceive === undefined && !!req?.afterReceive}
                        value={step.overrides?.afterReceive ?? req?.afterReceive ?? ''}
                        placeholder="No after-receive script"
                        on:input={(e) => {
                          const val = e.currentTarget.value;
                          updateStepOverride(i, 'afterReceive', val === (req?.afterReceive ?? '') ? undefined : val || undefined);
                        }}
                        spellcheck="false"
                        rows="8"
                      ></textarea>
                    {/if}
                  </div>
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
    padding: var(--space-6);
    gap: var(--space-6);
  }

  /* Header */
  .flow-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .flow-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2\.5);
  }
  .flow-icon {
    flex-shrink: 0;
    color: var(--color-accent-flow);
  }
  .flow-name {
    font-size: var(--text-2xl);
    font-weight: var(--weight-bold);
    color: var(--color-text-heading);
    margin: 0;
    cursor: pointer;
    border: none;
    border-bottom: 1px dashed transparent;
    background: transparent;
    font-family: inherit;
    padding: 0;
    text-align: left;
    transition: border-color var(--duration-normal);
  }
  .flow-name:hover {
    border-color: var(--color-border);
  }
  .flow-name-input {
    font-size: var(--text-2xl);
    font-weight: var(--weight-bold);
    color: var(--color-text-heading);
    border: 1px solid var(--color-accent-flow);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    font-family: inherit;
    outline: none;
    flex: 1;
    min-width: 0;
  }
  .flow-description {
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-bg-muted);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-base);
    line-height: 1.5;
    resize: vertical;
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .flow-description:focus {
    border-color: var(--color-accent-flow);
  }
  .flow-description::placeholder {
    color: var(--color-text-placeholder);
  }

  /* Steps */
  .flow-steps-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .steps-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .steps-title {
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    color: var(--color-text);
  }
  .steps-count {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    background: var(--color-bg-sidebar);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-lg);
  }
  .btn-add-step {
    margin-left: auto;
    padding: var(--space-1) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-accent-flow) 19%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-accent-flow) 6%, transparent);
    color: var(--color-accent-flow);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-add-step:hover {
    border-color: var(--color-accent-flow);
    background: color-mix(in srgb, var(--color-accent-flow) 13%, transparent);
  }
  .steps-empty {
    padding: var(--space-6);
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-lg);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2\.5);
  }
  .steps-empty-text {
    font-size: var(--text-base);
    color: var(--color-text-faint);
  }
  .steps-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1\.5);
  }
  .step-card {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-bg-muted);
    border-radius: var(--radius-lg);
    transition: border-color var(--duration-normal), box-shadow var(--duration-normal);
  }
  .step-card:hover {
    border-color: var(--color-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .step-card-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2\.5);
    padding: var(--space-3) var(--space-3\.5);
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
    color: var(--color-text-placeholder);
    cursor: grab;
    margin-top: var(--space-1);
    transition: color var(--duration-normal);
  }
  .step-card:hover .drag-handle {
    color: var(--color-text-faint);
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .drag-handle:focus-visible {
    outline: 2px solid var(--color-accent-flow);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
    color: var(--color-text-muted);
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
    background: var(--color-accent-flow);
    border-radius: 2px;
  }
  .step-number {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    color: var(--color-accent-flow);
    background: color-mix(in srgb, var(--color-accent-flow) 5%, transparent);
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
    gap: var(--space-1\.5);
    margin-bottom: 1px;
  }
  .step-file {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    letter-spacing: 0.2px;
    text-transform: uppercase;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-request-name {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--color-text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .step-url-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-1\.5);
  }
  .step-method {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    letter-spacing: 0.3px;
    min-width: 30px;
    flex-shrink: 0;
  }
  .step-label {
    font-size: var(--text-base);
    color: var(--color-text-muted);
    font-weight: var(--weight-regular);
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
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
    flex-shrink: 0;
  }
  .step-resolved-url .resolved-value {
    font-size: var(--text-sm);
    color: var(--color-success);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
  .step-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    flex-shrink: 0;
    margin-top: 3px;
  }
  .btn-continue-toggle {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    padding: 3px var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-continue-toggle.active {
    border-color: color-mix(in srgb, var(--color-primary) 31%, transparent);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    color: var(--color-primary);
  }
  .btn-remove-step {
    width: 22px; height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-placeholder);
    font-size: var(--text-xl);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    visibility: hidden;
    transition: all var(--duration-fast);
  }
  .step-card:hover .btn-remove-step {
    visibility: visible;
  }
  .btn-remove-step:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }

  /* Run button */
  .btn-run-flow {
    padding: var(--space-1) var(--space-3\.5);
    border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-success) 6%, transparent);
    color: var(--color-success);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-run-flow:hover {
    border-color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 13%, transparent);
  }
  .btn-run-flow.stopping {
    border-color: color-mix(in srgb, var(--color-error) 25%, transparent);
    background: color-mix(in srgb, var(--color-error) 6%, transparent);
    color: var(--color-error);
  }
  .btn-run-flow.stopping:hover {
    border-color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 13%, transparent);
  }

  /* Step status */
  .step-card.step-passed { border-color: color-mix(in srgb, var(--color-success) 25%, transparent); }
  .step-card.step-failed { border-color: color-mix(in srgb, var(--color-error) 25%, transparent); }
  .step-card.step-running { border-color: color-mix(in srgb, var(--color-primary) 38%, transparent); }
  .step-card.step-skipped { opacity: 0.5; }

  .step-status-info {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .step-status-icon {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .step-status-icon.passed { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 8%, transparent); }
  .step-status-icon.failed { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, transparent); }
  .step-status-icon.running { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
  .step-status-icon.skipped { color: var(--color-text-faint); background: var(--color-bg-sidebar); }
  .step-http-status {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    padding: 1px var(--space-1);
    border-radius: var(--radius-xs);
  }
  .step-http-status.ok { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 6%, transparent); }
  .step-http-status.err { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 6%, transparent); }
  .step-duration {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
  }

  /* Broken references */
  .broken-warning {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-primary) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 19%, transparent);
    border-radius: var(--radius-default);
    font-size: var(--text-sm);
    color: var(--color-warning);
  }
  .step-card.step-broken {
    border-color: color-mix(in srgb, var(--color-primary) 31%, transparent);
    background: color-mix(in srgb, var(--color-primary) 2%, transparent);
  }
  .step-card.step-broken .step-label {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .step-broken-badge {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-xs);
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
    gap: var(--space-2);
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-5);
  }
  .results-section-title {
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    color: var(--color-text);
  }

  /* Override toggle button */
  .btn-override-toggle {
    width: 24px; height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-placeholder);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-override-toggle .toggle-arrow {
    transition: transform var(--duration-normal);
  }
  .btn-override-toggle.expanded .toggle-arrow {
    transform: rotate(90deg);
  }
  .btn-override-toggle:hover {
    color: var(--color-accent-flow);
    background: color-mix(in srgb, var(--color-accent-flow) 3%, transparent);
  }
  .btn-override-toggle.active {
    color: var(--color-accent-flow);
  }
  .btn-override-toggle.expanded {
    color: var(--color-accent-flow);
  }

  /* Override panel */
  .override-panel {
    border-top: 1px solid var(--color-bg-muted);
    padding: var(--space-3) var(--space-3\.5) var(--space-3) 48px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2\.5);
  }
  .override-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .override-section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
  }
  .override-section-header.collapsible {
    cursor: pointer;
    user-select: none;
    padding: 2px 0;
  }
  .override-section-header.collapsible:hover .override-label {
    color: var(--color-text-secondary);
  }
  .override-collapse-icon {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    transition: transform var(--duration-normal);
    display: inline-block;
    width: 10px;
    flex-shrink: 0;
  }
  .override-collapse-icon.open {
    transform: rotate(90deg);
  }
  .override-count {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    margin-right: auto;
  }
  .override-section-header .override-add-btn {
    margin-left: auto;
  }
  .override-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .modified-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent-flow);
    margin-left: var(--space-1);
    vertical-align: middle;
    position: relative;
    top: -1px;
  }

  /* Override tab bar */
  .override-tab-panel {
    display: flex;
    flex-direction: column;
  }
  .override-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    border-bottom: 1px solid var(--color-bg-muted);
  }
  .override-tab {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1\.5) var(--space-3\.5);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--duration-normal);
    white-space: nowrap;
  }
  .override-tab:hover { color: var(--color-text-secondary); }
  .override-tab.active {
    color: var(--color-text-heading);
    border-bottom-color: var(--color-primary);
  }
  .override-tab-count {
    background: var(--color-bg-muted);
    color: var(--color-text-muted);
    font-size: var(--text-2xs);
    padding: 1px 5px;
    border-radius: var(--radius-lg);
  }
  .override-tab-content {
    padding-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .override-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .override-row .override-label {
    min-width: 50px;
    flex-shrink: 0;
  }
  .override-input {
    flex: 1;
    padding: 5px var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-base);
    color: var(--color-text-heading);
    outline: none;
  }
  .override-input:focus {
    border-color: var(--color-accent-flow);
  }
  .override-input::placeholder {
    color: var(--color-text-placeholder);
  }
  .override-add-btn {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    padding: 2px var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .override-add-btn:hover {
    border-color: color-mix(in srgb, var(--color-accent-flow) 38%, transparent);
    color: var(--color-accent-flow);
  }
  .override-header-row {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
  }
  .override-header-check {
    flex-shrink: 0;
    accent-color: var(--color-accent-flow);
  }
  .override-header-key {
    flex: 0 0 35%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-heading);
    outline: none;
  }
  .override-header-key:focus {
    border-color: var(--color-accent-flow);
  }
  .override-header-value {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-heading);
    outline: none;
  }
  .override-header-value:focus {
    border-color: var(--color-accent-flow);
  }
  .override-header-key::placeholder,
  .override-header-value::placeholder {
    color: var(--color-text-placeholder);
  }
  .override-header-remove {
    width: 20px; height: 20px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-placeholder);
    font-size: var(--text-lg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .override-header-remove:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }
  .override-body {
    padding: var(--space-1\.5) var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-heading);
    outline: none;
    resize: vertical;
    min-height: 120px;
  }
  .override-body:focus {
    border-color: var(--color-accent-flow);
  }
  .override-body::placeholder {
    color: var(--color-text-placeholder);
  }
  .showing-base {
    color: var(--color-text-faint);
  }
  .showing-base:focus {
    color: inherit;
  }
  .override-footer {
    display: flex;
    justify-content: flex-end;
  }
  .override-reset-btn {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    padding: 3px var(--space-2\.5);
    border: 1px solid color-mix(in srgb, var(--color-error) 19%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-error);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .override-reset-btn:hover {
    border-color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 6%, transparent);
  }
</style>
