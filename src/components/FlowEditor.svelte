<script lang="ts">
  import FlowStepPicker from './FlowStepPicker.svelte';
  import FlowResults from './FlowResults.svelte';
  import FlowStepCard, { type StepOverrideTarget } from './FlowStepCard.svelte';
  import VariablePicker from './VariablePicker.svelte';
  import type {
    FlowDefinition,
    FlowStep,
    FlowStepResult,
    FlowRunRecord,
    FlowRunStatus,
    FileNode,
    TreeNode as TNode,
    HttpHeader,
    FlowStepOverrides,
    PbDirective,
    Variable,
    NamedRequestResult,
  } from '../lib/types';
  import { parseScriptText, directivesToText } from '../lib/pbScript';
  import { getAllFileNodes } from '../lib/tree';
  import {
    findFileForStep as findStepFile,
    isStepBroken as stepIsBroken,
    resolveStepUrls,
    urlFromLabel as getUrl,
  } from '../lib/flowValidation';
  import { applyAliasSync, autoAliasFor } from '../lib/flowAlias';
  import { DragReorder } from '../lib/dragReorder.svelte';
  import { reorderBySlot } from '../lib/dragReorder';
  import { baseEnvVars, dotenvVariables } from '../lib/stores';

  interface FlowEditorUiState {
    expandedStepId: string | null;
    collapsedKeys: Record<string, boolean>;
    activeOverrideTabs: Record<string, string>;
  }

  interface Props {
    flow: FlowDefinition;
    flowPath: string;
    tree?: TNode[];
    rootPath?: string;
    runState?: { status: FlowRunStatus; stepResults: FlowStepResult[] } | null;
    lastRunRecord?: FlowRunRecord | null;
    runHistory?: FlowRunRecord[];
    uiState?: FlowEditorUiState | null;
    onSave?: (detail: { flowPath: string; flow: FlowDefinition }) => void;
    onRun?: () => void;
    onAbort?: () => void;
    onClearHistory?: () => void;
    onUiStateChange?: (detail: FlowEditorUiState) => void;
  }

  let {
    flow = $bindable(),
    flowPath,
    tree = [],
    rootPath = '',
    runState = null,
    lastRunRecord = null,
    runHistory = [],
    uiState = null,
    onSave,
    onRun,
    onAbort,
    onClearHistory,
    onUiStateChange,
  }: Props = $props();

  const isRunning = $derived(runState?.status === 'running');
  const allFiles = $derived(getAllFileNodes(tree));

  /** Find the FileNode matching a step's filePath. */
  function findFileForStep(step: FlowStep): FileNode | undefined {
    return findStepFile(step, allFiles, rootPath);
  }

  /** Check if a step's target file and request still exist in the workspace. */
  function isStepBroken(step: FlowStep): boolean {
    return stepIsBroken(step, allFiles, rootPath);
  }

  const brokenCount = $derived(flow.steps.filter(isStepBroken).length);
  const hasAnyBroken = $derived(brokenCount > 0);

  /** Captured responses from the most recent flow run, keyed by step alias.
   *  Flow-run results never reach the global `$namedResults` store, so the
   *  VariablePicker needs this flow-scoped map to preview body/header values. */
  const flowLocalNamedResults = $derived.by(() => {
    const source = runState?.stepResults ?? lastRunRecord?.stepResults ?? [];
    const map: Record<string, NamedRequestResult> = {};
    for (const result of source) {
      if (!result.response || !result.sentRequest) continue;
      const step = flow.steps.find((s) => s.id === result.stepId);
      const alias = step?.varName;
      if (!alias) continue;
      map[alias] = { request: result.sentRequest, response: result.response };
    }
    return map;
  });

  /** Variables set by `pb.set` / `pb.global` during the flow's most recent run.
   *  Available only after a completed run (flowRunner attaches them to the record).
   *  Both kinds are merged: from the user's perspective inside the flow they are
   *  just "variables this flow defines." */
  const flowScopeVars = $derived.by((): Record<string, string> => {
    const v = lastRunRecord?.variables;
    if (!v) return {};
    return { ...v.setVars, ...v.globalVars };
  });

  const resolvedStepUrls = $derived(
    resolveStepUrls(flow.steps, allFiles, rootPath, $baseEnvVars, $dotenvVariables, flowScopeVars),
  );

  function getStepStatus(stepId: string): FlowStepResult | undefined {
    return runState?.stepResults.find((r) => r.stepId === stepId);
  }

  let editingName = $state(false);
  let nameInputEl: HTMLInputElement | undefined = $state();
  let showPicker = $state(false);

  // Drag-and-drop reordering: handle-gated drags with cached rects and a
  // hysteresis deadzone (see lib/dragReorder.svelte.ts).
  const drag = new DragReorder({
    listSelector: '.steps-list',
    itemSelector: '.step-card',
    onDrop: (from, slot) => {
      flow = { ...flow, steps: applyAliasSync(reorderBySlot(flow.steps, from, slot)) };
      save();
    },
  });

  function moveStep(from: number, to: number) {
    if (from === to || to < 0 || to >= flow.steps.length) return;
    const steps = [...flow.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    flow = { ...flow, steps: applyAliasSync(steps) };
    save();
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
    if (e.key === 'Escape') {
      editingName = false;
    }
  }

  function save() {
    onSave?.({ flowPath, flow });
  }

  function addStep(step: FlowStep) {
    flow = { ...flow, steps: applyAliasSync([...flow.steps, step]) };
    save();
  }

  function removeStep(index: number) {
    const next = flow.steps.filter((_, i) => i !== index);
    flow = { ...flow, steps: applyAliasSync(next) };
    save();
  }

  function toggleContinueOnFailure(index: number) {
    const steps = [...flow.steps];
    steps[index] = { ...steps[index], continueOnFailure: !steps[index].continueOnFailure };
    flow = { ...flow, steps };
    save();
  }

  /** Draft alias values keyed by step id. Keeps the input responsive on every
   *  keystroke without running `applyAliasSync` / `save()` until the user commits
   *  (blur, Enter, or native `change`). */
  const aliasDraft: Record<string, string> = $state({});

  const AUTO_ALIAS_SHAPE = /^Step\d+$/;

  /** Commit the alias draft for step `index`. Empty input, a value matching the
   *  position's auto name, or any `Step{N}`-shaped value unlocks the alias -
   *  auto-shaped names are system-managed and cannot be user-locked.
   *  Other non-empty values lock the alias as user-customized. */
  function setStepAlias(index: number, raw: string) {
    const trimmed = raw.trim();
    const steps = [...flow.steps];
    const auto = autoAliasFor(index);
    if (trimmed === '' || trimmed === auto || AUTO_ALIAS_SHAPE.test(trimmed)) {
      steps[index] = { ...steps[index], varName: null, aliasLocked: false };
    } else {
      steps[index] = { ...steps[index], varName: trimmed, aliasLocked: true };
    }
    flow = { ...flow, steps: applyAliasSync(steps) };
    delete aliasDraft[steps[index].id];
    save();
  }

  function onAliasInput(stepId: string, value: string) {
    aliasDraft[stepId] = value;
  }

  function commitAliasDraft(index: number) {
    const stepId = flow.steps[index]?.id;
    if (stepId == null) return;
    const draft = aliasDraft[stepId];
    if (draft === undefined) return;
    setStepAlias(index, draft);
  }

  /** "Reset to auto" affordance: unlocks the step so it takes the auto Step{N} name. */
  function resetStepAlias(index: number) {
    const steps = [...flow.steps];
    steps[index] = { ...steps[index], varName: null, aliasLocked: false };
    flow = { ...flow, steps: applyAliasSync(steps) };
    save();
  }

  // ─── Override editing ───────────────────────────────────────────────────────

  // The initial-value captures below are intentional: local UI state seeds from
  // the uiState prop once and is re-seeded by the $effect when the prop changes.
  // svelte-ignore state_referenced_locally
  let expandedStepId: string | null = $state(uiState?.expandedStepId ?? null);
  /** Tracks which sections are collapsed, keyed as "stepId:section" (only used for Headers now) */
  // svelte-ignore state_referenced_locally
  let collapsedKeys: Record<string, boolean> = $state(uiState?.collapsedKeys ?? {});
  /** Active tab per step in the override panel */
  // svelte-ignore state_referenced_locally
  let activeOverrideTabs: Record<string, string> = $state(uiState?.activeOverrideTabs ?? {});

  // Sync local UI state when the parent passes a new uiState (e.g. switching flow tabs)
  // svelte-ignore state_referenced_locally
  let prevUiState = uiState;
  $effect(() => {
    if (uiState !== prevUiState) {
      prevUiState = uiState;
      expandedStepId = uiState?.expandedStepId ?? null;
      collapsedKeys = uiState?.collapsedKeys ?? {};
      activeOverrideTabs = uiState?.activeOverrideTabs ?? {};
    }
  });

  /** Which tab is active for a step in the override panel. Falls back to 'body'. */
  function activeTabLookup(stepId: string): string {
    return activeOverrideTabs[stepId] ?? 'body';
  }

  function setActiveTab(stepId: string, tab: string) {
    activeOverrideTabs[stepId] = tab;
    emitUIState();
  }

  function emitUIState() {
    onUiStateChange?.({
      expandedStepId,
      collapsedKeys: $state.snapshot(collapsedKeys),
      activeOverrideTabs: $state.snapshot(activeOverrideTabs),
    });
  }

  function toggleSection(stepId: string, section: string) {
    const key = `${stepId}:${section}`;
    collapsedKeys[key] = !collapsedKeys[key];
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
        collapsedKeys[headersKey] = true;
      }
    }
    emitUIState();
  }

  function updateStepOverride<K extends keyof FlowStepOverrides>(
    index: number,
    field: K,
    value: FlowStepOverrides[K] | undefined,
  ) {
    const steps = [...flow.steps];
    const step = { ...steps[index] };
    const overrides = { ...(step.overrides || {}) };

    if (value === undefined || value === '') {
      delete overrides[field];
    } else {
      overrides[field] = value;
    }

    step.overrides = Object.keys(overrides).length > 0 ? overrides : undefined;
    steps[index] = step;
    flow = { ...flow, steps };
    save();
  }

  function addOverrideHeader(index: number, baseHeaders: HttpHeader[]) {
    const current = flow.steps[index].overrides?.headers ?? baseHeaders.map((h) => ({ ...h }));
    updateStepOverride(index, 'headers', [...current, { key: '', value: '', enabled: true }]);
  }

  function removeOverrideHeader(stepIndex: number, headerIndex: number, baseHeaders: HttpHeader[]) {
    const current = flow.steps[stepIndex].overrides?.headers ?? baseHeaders.map((h) => ({ ...h }));
    const updated = current.filter((_, i) => i !== headerIndex);
    updateStepOverride(stepIndex, 'headers', updated.length > 0 ? updated : undefined);
  }

  function updateOverrideHeader<K extends keyof HttpHeader>(
    stepIndex: number,
    headerIndex: number,
    field: K,
    value: HttpHeader[K],
    baseHeaders: HttpHeader[],
  ) {
    const current = (
      flow.steps[stepIndex].overrides?.headers ?? baseHeaders.map((h) => ({ ...h }))
    ).map((h) => ({ ...h }));
    current[headerIndex] = { ...current[headerIndex], [field]: value };
    updateStepOverride(stepIndex, 'headers', current);
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
        if (pipeIndex >= 0)
          directives.push({
            type: 'assert' as const,
            expr: trimmed.slice(0, pipeIndex),
            label: trimmed.slice(pipeIndex + 3),
          });
        else directives.push({ type: 'assert' as const, expr: trimmed, label: '' });
      }
    }
    const baseText = directivesToText(baseDirectives);
    updateStepOverride(stepIndex, 'directives', text === baseText ? undefined : directives);
  }

  // ─── Variable picker ────────────────────────────────────────────────────────

  type PickerTarget =
    | { kind: 'url'; stepIndex: number }
    | { kind: 'headerValue'; stepIndex: number; headerIndex: number }
    | { kind: 'body'; stepIndex: number }
    | { kind: 'assertions'; stepIndex: number }
    | { kind: 'beforeSend'; stepIndex: number }
    | { kind: 'afterReceive'; stepIndex: number };

  let showVarPicker = $state(false);
  let pickerTarget: PickerTarget | null = null;
  let pickerCursor = -1;
  let pickerFileVars: Variable[] = $state([]);
  let pickerNamedResults: Record<string, NamedRequestResult> = $state({});
  let pickerFlowAliases: { name: string; stepNumber: number }[] = $state([]);

  /** Collect aliases from every step before `stepIndex`. `applyAliasSync` guarantees
   *  every step has a unique non-null `varName`, so this is a straight map. */
  function collectPrecedingFlowAliases(stepIndex: number): { name: string; stepNumber: number }[] {
    const out: { name: string; stepNumber: number }[] = [];
    for (let i = 0; i < stepIndex && i < flow.steps.length; i++) {
      const name = flow.steps[i].varName;
      if (name) out.push({ name, stepNumber: i + 1 });
    }
    return out;
  }

  function insertAtCursor(text: string, value: string): string {
    if (pickerCursor >= 0 && pickerCursor <= text.length) {
      return text.slice(0, pickerCursor) + value + text.slice(pickerCursor);
    }
    return text + value;
  }

  function openVarPicker(target: PickerTarget, file: FileNode | undefined) {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    pickerCursor = active?.selectionStart ?? -1;
    pickerTarget = target;
    pickerFileVars = file?.variables ?? [];
    const aliases = collectPrecedingFlowAliases(target.stepIndex);
    pickerFlowAliases = aliases;
    const scoped: Record<string, NamedRequestResult> = {};
    for (const { name } of aliases) {
      if (flowLocalNamedResults[name]) scoped[name] = flowLocalNamedResults[name];
    }
    pickerNamedResults = scoped;
    showVarPicker = true;
  }

  function handleVarPickerInsert(value: string) {
    showVarPicker = false;
    const t = pickerTarget;
    if (!t) return;
    const step = flow.steps[t.stepIndex];
    const file = findFileForStep(step);
    const req =
      file && step.requestIndex >= 0 && step.requestIndex < file.requests.length
        ? file.requests[step.requestIndex]
        : null;
    const baseHeaders = req?.headers ?? [];
    const baseDirectives = req?.directives ?? [];
    if (t.kind === 'url') {
      const base = req?.url ?? getUrl(step.label);
      const current = step.overrides?.url ?? base;
      const next = insertAtCursor(current, value);
      updateStepOverride(t.stepIndex, 'url', next === base ? undefined : next);
    } else if (t.kind === 'body') {
      const current = step.overrides?.body ?? req?.body ?? '';
      const next = insertAtCursor(current, value);
      updateStepOverride(
        t.stepIndex,
        'body',
        next === (req?.body ?? '') ? undefined : next || undefined,
      );
    } else if (t.kind === 'beforeSend') {
      const current = step.overrides?.beforeSend ?? req?.beforeSend ?? '';
      const next = insertAtCursor(current, value);
      updateStepOverride(
        t.stepIndex,
        'beforeSend',
        next === (req?.beforeSend ?? '') ? undefined : next || undefined,
      );
    } else if (t.kind === 'afterReceive') {
      const current = step.overrides?.afterReceive ?? req?.afterReceive ?? '';
      const next = insertAtCursor(current, value);
      updateStepOverride(
        t.stepIndex,
        'afterReceive',
        next === (req?.afterReceive ?? '') ? undefined : next || undefined,
      );
    } else if (t.kind === 'assertions') {
      const currentText = directivesToText(step.overrides?.directives ?? baseDirectives);
      const nextText = insertAtCursor(currentText, value);
      onDirectivesTextInput(t.stepIndex, nextText, baseDirectives);
    } else if (t.kind === 'headerValue') {
      const headers = (step.overrides?.headers ?? baseHeaders).map((h) => ({ ...h }));
      headers[t.headerIndex] = {
        ...headers[t.headerIndex],
        value: insertAtCursor(headers[t.headerIndex].value, value),
      };
      updateStepOverride(t.stepIndex, 'headers', headers);
    }
    pickerCursor = -1;
    pickerTarget = null;
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
        <path
          d="M3 3h3v3H3zM10 3h3v3h-3zM10 10h3v3h-3z"
          stroke="currentColor"
          stroke-width="1.2"
          fill="currentColor"
          fill-opacity="0.1"
        />
        <path
          d="M6 4.5h4M11.5 6v4"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
        />
      </svg>
      {#if editingName}
        <input
          bind:this={nameInputEl}
          value={flow.name}
          oninput={(e) => (flow = { ...flow, name: e.currentTarget.value })}
          onblur={commitName}
          onkeydown={handleNameKeydown}
          class="flow-name-input"
          spellcheck="false"
        />
      {:else}
        <button class="flow-name" onclick={startEditName} title="Click to rename">
          {flow.name}
        </button>
      {/if}
    </div>
    <textarea
      class="flow-description"
      value={flow.description}
      oninput={(e) => (flow = { ...flow, description: e.currentTarget.value })}
      onblur={save}
      placeholder="Add a description..."
      rows="2"></textarea>
  </div>

  <!-- Steps -->
  <div class="flow-steps-section">
    <div class="steps-header">
      <span class="steps-title">Steps</span>
      <span class="steps-count">{flow.steps.length}</span>
      <button class="btn-add-step" onclick={() => (showPicker = true)}>+ Add step</button>
      {#if flow.steps.length > 0}
        {#if isRunning}
          <button class="btn-run-flow stopping" onclick={() => onAbort?.()}>Stop</button>
        {:else}
          <button
            class="btn-run-flow"
            onclick={() => onRun?.()}
            disabled={hasAnyBroken}
            title={hasAnyBroken ? 'Fix broken step references before running' : ''}>Run flow</button
          >
        {/if}
      {/if}
    </div>

    {#if hasAnyBroken}
      <div class="broken-warning">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5l6.5 12H1.5L8 1.5z"
            stroke="currentColor"
            stroke-width="1.3"
            fill="currentColor"
            fill-opacity="0.06"
          />
          <path
            d="M8 6v3M8 11v.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <span
          >{brokenCount} step{brokenCount === 1 ? '' : 's'} reference requests that no longer exist. Remove
          or re-add them.</span
        >
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
        ondragover={drag.handleListDragOver}
        ondrop={drag.handleListDrop}
        ondragleave={drag.handleListDragLeave}
      >
        {#each flow.steps as step, i (step.id)}
          {#if drag.insertSlot === i}
            <div class="drop-indicator"></div>
          {/if}
          {@const file = findFileForStep(step)}
          {@const req =
            file && step.requestIndex >= 0 && step.requestIndex < (file.requests?.length ?? 0)
              ? file.requests[step.requestIndex]
              : null}
          {@const baseHeaders = req?.headers ?? []}
          {@const baseDirectives = req?.directives ?? []}
          <FlowStepCard
            {step}
            index={i}
            stepCount={flow.steps.length}
            stepResult={getStepStatus(step.id)}
            broken={isStepBroken(step)}
            {file}
            {req}
            {baseHeaders}
            {baseDirectives}
            resolvedUrl={resolvedStepUrls[i] ?? ''}
            expanded={expandedStepId === step.id}
            activeTab={activeTabLookup(step.id)}
            headersCollapsed={!!collapsedKeys[`${step.id}:headers`]}
            aliasValue={aliasDraft[step.id] ?? step.varName ?? ''}
            {drag}
            onToggleOverridePanel={() => toggleOverridePanel(step.id)}
            onSetActiveTab={(tab) => setActiveTab(step.id, tab)}
            onToggleHeaders={() => toggleSection(step.id, 'headers')}
            onRemove={() => removeStep(i)}
            onToggleContinueOnFailure={() => toggleContinueOnFailure(i)}
            onAliasInput={(value) => onAliasInput(step.id, value)}
            onCommitAlias={() => commitAliasDraft(i)}
            onResetAlias={() => resetStepAlias(i)}
            onUpdateOverride={(field, value) => updateStepOverride(i, field, value)}
            onAddHeader={() => addOverrideHeader(i, baseHeaders)}
            onRemoveHeader={(hi) => removeOverrideHeader(i, hi, baseHeaders)}
            onUpdateHeader={(hi, field, value) =>
              updateOverrideHeader(i, hi, field, value, baseHeaders)}
            onDirectivesTextInput={(text) => onDirectivesTextInput(i, text, baseDirectives)}
            onOpenVarPicker={(target: StepOverrideTarget) =>
              openVarPicker({ ...target, stepIndex: i }, file)}
            onMoveStep={moveStep}
            onResetOverrides={() => resetOverrides(i)}
          />
        {/each}
        {#if drag.insertSlot === flow.steps.length}
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
        onClearHistory={() => onClearHistory?.()}
      />
    </div>
  {/if}
</div>

{#if showPicker}
  <FlowStepPicker
    {tree}
    {rootPath}
    onPick={(step) => {
      addStep(step);
      showPicker = false;
    }}
    onClose={() => (showPicker = false)}
  />
{/if}

<VariablePicker
  visible={showVarPicker}
  fileVariables={pickerFileVars}
  envVariables={$baseEnvVars}
  namedResults={pickerNamedResults}
  flowAliases={pickerFlowAliases}
  flowName={flow.name}
  flowSetVars={flowScopeVars}
  onInsert={handleVarPickerInsert}
  onClose={() => {
    showVarPicker = false;
    pickerTarget = null;
  }}
/>

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
</style>
