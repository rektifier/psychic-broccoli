<script module lang="ts">
  /** Where an inserted variable should land, relative to this step.
   *  The parent adds the step index to form its full picker target. */
  export type StepOverrideTarget =
    | { kind: 'url' }
    | { kind: 'headerValue'; headerIndex: number }
    | { kind: 'body' }
    | { kind: 'assertions' }
    | { kind: 'beforeSend' }
    | { kind: 'afterReceive' };
</script>

<script lang="ts">
  import type {
    FileNode,
    FlowStep,
    FlowStepOverrides,
    FlowStepResult,
    HttpHeader,
    HttpRequest,
    PbDirective,
  } from '../lib/types';
  import { urlFromLabel as getUrl } from '../lib/flowValidation';
  import { autoAliasFor } from '../lib/flowAlias';
  import { directivesToText } from '../lib/pbScript';
  import { DragReorder } from '../lib/dragReorder.svelte';
  import { METHOD_COLORS } from '../lib/theme';

  interface Props {
    step: FlowStep;
    index: number;
    stepCount: number;
    stepResult?: FlowStepResult;
    broken: boolean;
    /** The workspace file this step points at (undefined when broken). */
    file?: FileNode;
    /** The base request within that file (null when missing). */
    req: HttpRequest | null;
    baseHeaders: HttpHeader[];
    baseDirectives: PbDirective[];
    /** Resolved {{variable}} preview of the step URL ('' when nothing resolves). */
    resolvedUrl: string;
    /** Whether this card's override panel is expanded. */
    expanded: boolean;
    /** Active override tab ('body' | 'assertions' | 'beforeSend' | 'afterReceive'). */
    activeTab: string;
    headersCollapsed: boolean;
    /** Current alias input value (draft if present, else the step's varName). */
    aliasValue: string;
    /** Shared drag-reorder controller owned by the steps list. */
    drag: DragReorder;
    onToggleOverridePanel: () => void;
    onSetActiveTab: (tab: string) => void;
    onToggleHeaders: () => void;
    onRemove: () => void;
    onToggleContinueOnFailure: () => void;
    onAliasInput: (value: string) => void;
    onCommitAlias: () => void;
    onResetAlias: () => void;
    onUpdateOverride: <K extends keyof FlowStepOverrides>(
      field: K,
      value: FlowStepOverrides[K] | undefined,
    ) => void;
    onAddHeader: () => void;
    onRemoveHeader: (headerIndex: number) => void;
    onUpdateHeader: <K extends keyof HttpHeader>(
      headerIndex: number,
      field: K,
      value: HttpHeader[K],
    ) => void;
    onDirectivesTextInput: (text: string) => void;
    onOpenVarPicker: (target: StepOverrideTarget) => void;
    onMoveStep: (from: number, to: number) => void;
    onResetOverrides: () => void;
  }

  let {
    step,
    index,
    stepCount,
    stepResult,
    broken,
    file,
    req,
    baseHeaders,
    baseDirectives,
    resolvedUrl,
    expanded,
    activeTab,
    headersCollapsed,
    aliasValue,
    drag,
    onToggleOverridePanel,
    onSetActiveTab,
    onToggleHeaders,
    onRemove,
    onToggleContinueOnFailure,
    onAliasInput,
    onCommitAlias,
    onResetAlias,
    onUpdateOverride,
    onAddHeader,
    onRemoveHeader,
    onUpdateHeader,
    onDirectivesTextInput,
    onOpenVarPicker,
    onMoveStep,
    onResetOverrides,
  }: Props = $props();

  /** Extract method from label like "POST /api/login" */
  function getMethod(label: string): string {
    const m = label.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\b/);
    return m ? m[1] : '';
  }

  /** Compute URL suffixes for requests in a file, stripping common prefix segments. */
  function computeFileSuffixes(requests: { url: string }[]): string[] {
    if (requests.length === 0) return [];
    if (requests.length === 1) return [requests[0].url];
    const split = requests.map((r) => r.url.split('/'));
    const minLen = Math.min(...split.map((s) => s.length));
    let common = 0;
    for (let i = 0; i < minLen; i++) {
      if (split.every((s) => s[i] === split[0][i])) common = i + 1;
      else break;
    }
    if (common === 0) return requests.map((r) => r.url);
    return split.map((s) => '/' + s.slice(common).join('/'));
  }

  const suffixes = $derived(file ? computeFileSuffixes(file.requests) : null);
  const displayUrl = $derived(
    suffixes && step.requestIndex >= 0 && step.requestIndex < suffixes.length
      ? suffixes[step.requestIndex]
      : getUrl(step.label),
  );
  const requestName = $derived(req?.name ?? '');

  function hasOverrides(step: FlowStep): boolean {
    if (!step.overrides) return false;
    const o = step.overrides;
    return (
      o.url !== undefined ||
      o.headers !== undefined ||
      o.body !== undefined ||
      o.directives !== undefined ||
      o.beforeSend !== undefined ||
      o.afterReceive !== undefined
    );
  }

  function onStepKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      onMoveStep(index, index - 1);
      // Re-focus the moved card's handle after Svelte re-renders
      requestAnimationFrame(() => {
        const list = (e.target as HTMLElement).closest('.steps-list');
        const handles = list?.querySelectorAll<HTMLElement>('.drag-handle');
        handles?.[index - 1]?.focus();
      });
    } else if (e.key === 'ArrowDown' && index < stepCount - 1) {
      e.preventDefault();
      onMoveStep(index, index + 1);
      requestAnimationFrame(() => {
        const list = (e.target as HTMLElement).closest('.steps-list');
        const handles = list?.querySelectorAll<HTMLElement>('.drag-handle');
        handles?.[index + 1]?.focus();
      });
    }
  }
</script>

<div
  class={[
    'step-card',
    {
      'step-passed': stepResult?.status === 'passed',
      'step-failed': stepResult?.status === 'failed',
      'step-running': stepResult?.status === 'running',
      'step-skipped': stepResult?.status === 'skipped',
      'step-broken': broken,
      dragging: drag.draggingIndex === index,
    },
  ]}
  draggable="true"
  ondragstart={(e) => drag.handleDragStart(e, index)}
  ondragover={(e) => e.preventDefault()}
  ondragend={drag.handleDragEnd}
  role="listitem"
>
  <div class="step-card-row">
    <span
      class="drag-handle"
      title="Drag to reorder"
      role="button"
      tabindex="0"
      aria-label="Reorder step {index + 1}, use arrow keys"
      onkeydown={onStepKeydown}
      onmousedown={drag.grabHandle}
      onmouseup={drag.releaseHandle}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
        <circle cx="3" cy="2.5" r="1.2" fill="currentColor" />
        <circle cx="7" cy="2.5" r="1.2" fill="currentColor" />
        <circle cx="3" cy="7" r="1.2" fill="currentColor" />
        <circle cx="7" cy="7" r="1.2" fill="currentColor" />
        <circle cx="3" cy="11.5" r="1.2" fill="currentColor" />
        <circle cx="7" cy="11.5" r="1.2" fill="currentColor" />
      </svg>
    </span>
    <button
      class={['btn-override-toggle', { active: hasOverrides(step), expanded }]}
      onclick={(e) => {
        e.stopPropagation();
        onToggleOverridePanel();
      }}
      title={hasOverrides(step)
        ? 'Edit overrides (has customizations)'
        : 'Customize request for this step'}
    >
      <svg class="toggle-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M3 1.5l4 3.5-4 3.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <span class="step-number">{index + 1}</span>
    <div class="step-content">
      <div class="step-top-row">
        <span class="step-file" title={step.filePath}
          >{step.filePath
            .replace(/\.[^.]+$/, '')
            .split('/')
            .pop()}</span
        >
        {#if broken}
          <span class="step-broken-badge">missing</span>
        {/if}
      </div>
      {#if requestName}
        <span class="step-request-name">{requestName}</span>
      {/if}
      <div class="step-url-row">
        {#if getMethod(step.label)}
          <span
            class="step-method"
            style="color: {METHOD_COLORS[getMethod(step.label)] || 'var(--color-text-muted)'}"
            >{getMethod(step.label)}</span
          >
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
        class={['btn-continue-toggle', { active: step.continueOnFailure }]}
        onclick={onToggleContinueOnFailure}
        title={step.continueOnFailure
          ? 'Continues on failure (click to stop on failure)'
          : 'Stops on failure (click to continue on failure)'}
      >
        {step.continueOnFailure ? 'skip' : 'stop'}
      </button>
      {#if stepResult}
        <span class="step-status-info">
          {#if stepResult.status === 'running'}
            <span class="step-status-icon running">...</span>
          {:else if stepResult.status === 'passed'}
            <span class="step-status-icon passed">&#10003;</span>
          {:else if stepResult.status === 'failed'}
            <span class="step-status-icon failed">&#10005;</span>
          {:else if stepResult.status === 'skipped'}
            <span class="step-status-icon skipped">-</span>
          {/if}
          {#if stepResult.response}
            <span
              class={[
                'step-http-status',
                { ok: stepResult.response.status < 400, err: stepResult.response.status >= 400 },
              ]}>{stepResult.response.status}</span
            >
          {/if}
          {#if stepResult.durationMs > 0}
            <span class="step-duration">{stepResult.durationMs}ms</span>
          {/if}
        </span>
      {/if}
      <button class="btn-remove-step" onclick={onRemove} title="Remove step">&times;</button>
    </div>
  </div>

  {#if expanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="override-panel"
      onmousedown={(e) => e.stopPropagation()}
      ondragstart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div class="override-section">
        <div class="override-row">
          <span
            class="override-label"
            title="Flow-local alias for this step's response. Referenced as {'{'}{'{'}alias.response.body.$....}} in later steps. Auto-named Step{index +
              1} unless you customize it."
            >Alias{#if step.aliasLocked}<span class="modified-dot" title="Custom"></span>{/if}</span
          >
          <input
            class={['override-input', { 'showing-base': !step.aliasLocked }]}
            type="text"
            value={aliasValue}
            placeholder={autoAliasFor(index)}
            oninput={(e) => onAliasInput(e.currentTarget.value)}
            onchange={() => onCommitAlias()}
            onblur={() => onCommitAlias()}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitAlias();
              }
            }}
            spellcheck="false"
          />
          {#if step.aliasLocked}
            <button
              type="button"
              class="btn-alias-reset"
              onclick={() => onResetAlias()}
              title="Reset to auto alias (Step{index + 1}) and rewrite references across all steps"
              >Reset</button
            >
          {/if}
        </div>
      </div>

      <div class="override-section">
        <div class="override-row">
          <span class="override-label"
            >URL{#if step.overrides?.url !== undefined}<span class="modified-dot" title="Modified"
              ></span>{/if}</span
          >
          <input
            class={[
              'override-input',
              {
                'showing-base':
                  step.overrides?.url === undefined && !!(req?.url ?? getUrl(step.label)),
              },
            ]}
            type="text"
            value={step.overrides?.url ?? req?.url ?? getUrl(step.label)}
            placeholder="No URL"
            oninput={(e) => {
              const val = e.currentTarget.value;
              const base = req?.url ?? getUrl(step.label);
              onUpdateOverride('url', val === base ? undefined : val || undefined);
            }}
            spellcheck="false"
          />
          <button
            class="btn-insert-var"
            aria-label="Insert variable"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => onOpenVarPicker({ kind: 'url' })}
            title="Insert variable"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              ><path
                d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              /></svg
            >
          </button>
        </div>
      </div>

      <div class="override-section">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="override-section-header collapsible"
          onclick={() => onToggleHeaders()}
          onkeydown={(e) => {
            if (e.key === 'Enter') onToggleHeaders();
          }}
        >
          <span class={['override-collapse-icon', { open: !headersCollapsed }]}>&#9656;</span>
          <span class="override-label"
            >Headers{#if step.overrides?.headers !== undefined}<span
                class="modified-dot"
                title="Modified"
              ></span>{/if}</span
          >
          <span class="override-count">{(step.overrides?.headers ?? baseHeaders).length}</span>
          {#if !headersCollapsed}
            <button
              class="override-add-btn"
              onclick={(e) => {
                e.stopPropagation();
                onAddHeader();
              }}>+ Add</button
            >
          {/if}
        </div>
        {#if !headersCollapsed}
          {#each step.overrides?.headers ?? baseHeaders as h, hi (hi)}
            <div class="override-header-row">
              <input
                type="checkbox"
                checked={h.enabled}
                onchange={() => onUpdateHeader(hi, 'enabled', !h.enabled)}
                class="override-header-check"
              />
              <input
                class="override-header-key"
                type="text"
                value={h.key}
                placeholder="Header name"
                oninput={(e) => onUpdateHeader(hi, 'key', e.currentTarget.value)}
                spellcheck="false"
              />
              <input
                class="override-header-value"
                type="text"
                value={h.value}
                placeholder="Value"
                oninput={(e) => onUpdateHeader(hi, 'value', e.currentTarget.value)}
                spellcheck="false"
              />
              <button
                class="btn-insert-var"
                aria-label="Insert variable"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => onOpenVarPicker({ kind: 'headerValue', headerIndex: hi })}
                title="Insert variable"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  ><path
                    d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  /></svg
                >
              </button>
              <button class="override-header-remove" onclick={() => onRemoveHeader(hi)}
                >&times;</button
              >
            </div>
          {/each}
        {/if}
      </div>

      <div class="override-tab-panel">
        <div class="override-tabs">
          <button
            class={['override-tab', { active: activeTab === 'body' }]}
            onclick={() => onSetActiveTab('body')}
          >
            Body
            {#if step.overrides?.body !== undefined}<span class="modified-dot" title="Modified"
              ></span>{/if}
          </button>
          <button
            class={['override-tab', { active: activeTab === 'assertions' }]}
            onclick={() => onSetActiveTab('assertions')}
          >
            Assertions
            {#if (step.overrides?.directives ?? baseDirectives).length > 0}
              <span class="override-tab-count"
                >{(step.overrides?.directives ?? baseDirectives).length}</span
              >
            {/if}
            {#if step.overrides?.directives !== undefined}<span
                class="modified-dot"
                title="Modified"
              ></span>{/if}
          </button>
          <button
            class={['override-tab', { active: activeTab === 'beforeSend' }]}
            onclick={() => onSetActiveTab('beforeSend')}
          >
            Before Send
            {#if step.overrides?.beforeSend !== undefined}<span
                class="modified-dot"
                title="Modified"
              ></span>{/if}
          </button>
          <button
            class={['override-tab', { active: activeTab === 'afterReceive' }]}
            onclick={() => onSetActiveTab('afterReceive')}
          >
            After Receive
            {#if step.overrides?.afterReceive !== undefined}<span
                class="modified-dot"
                title="Modified"
              ></span>{/if}
          </button>
          <div class="override-tab-spacer"></div>
          <button
            class="btn-insert-var"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => {
              const kind =
                activeTab === 'body'
                  ? 'body'
                  : activeTab === 'assertions'
                    ? 'assertions'
                    : activeTab === 'beforeSend'
                      ? 'beforeSend'
                      : 'afterReceive';
              onOpenVarPicker({ kind });
            }}
            title="Insert variable"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              ><path
                d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              /></svg
            >
          </button>
        </div>
        <div class="override-tab-content">
          {#if activeTab === 'body'}
            <textarea
              class={[
                'override-body',
                { 'showing-base': step.overrides?.body === undefined && !!req?.body },
              ]}
              value={step.overrides?.body ?? req?.body ?? ''}
              placeholder="No body"
              oninput={(e) => {
                const val = e.currentTarget.value;
                onUpdateOverride('body', val === (req?.body ?? '') ? undefined : val || undefined);
              }}
              spellcheck="false"
              rows="8"></textarea>
          {:else if activeTab === 'assertions'}
            <textarea
              class={[
                'override-body',
                {
                  'showing-base':
                    step.overrides?.directives === undefined && baseDirectives.length > 0,
                },
              ]}
              value={directivesToText(step.overrides?.directives ?? baseDirectives)}
              placeholder={'One assertion per line:\npb.response.status == 200 | Should return 200\npb.response.body.$.name != null | Name should exist'}
              oninput={(e) => onDirectivesTextInput(e.currentTarget.value)}
              spellcheck="false"
              rows="8"></textarea>
          {:else if activeTab === 'beforeSend'}
            <textarea
              class={[
                'override-body',
                {
                  'showing-base': step.overrides?.beforeSend === undefined && !!req?.beforeSend,
                },
              ]}
              value={step.overrides?.beforeSend ?? req?.beforeSend ?? ''}
              placeholder="No before-send script"
              oninput={(e) => {
                const val = e.currentTarget.value;
                onUpdateOverride(
                  'beforeSend',
                  val === (req?.beforeSend ?? '') ? undefined : val || undefined,
                );
              }}
              spellcheck="false"
              rows="8"></textarea>
          {:else if activeTab === 'afterReceive'}
            <textarea
              class={[
                'override-body',
                {
                  'showing-base': step.overrides?.afterReceive === undefined && !!req?.afterReceive,
                },
              ]}
              value={step.overrides?.afterReceive ?? req?.afterReceive ?? ''}
              placeholder="No after-receive script"
              oninput={(e) => {
                const val = e.currentTarget.value;
                onUpdateOverride(
                  'afterReceive',
                  val === (req?.afterReceive ?? '') ? undefined : val || undefined,
                );
              }}
              spellcheck="false"
              rows="8"></textarea>
          {/if}
        </div>
      </div>

      {#if hasOverrides(step)}
        <div class="override-footer">
          <button class="override-reset-btn" onclick={() => onResetOverrides()}
            >Reset all overrides</button
          >
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .step-card {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-bg-muted);
    border-radius: var(--radius-lg);
    transition:
      border-color var(--duration-normal),
      box-shadow var(--duration-normal);
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
    width: 22px;
    height: 22px;
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

  /* Step status */
  .step-card.step-passed {
    border-color: color-mix(in srgb, var(--color-success) 25%, transparent);
  }
  .step-card.step-failed {
    border-color: color-mix(in srgb, var(--color-error) 25%, transparent);
  }
  .step-card.step-running {
    border-color: color-mix(in srgb, var(--color-primary) 38%, transparent);
  }
  .step-card.step-skipped {
    opacity: 0.5;
  }

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
  .step-status-icon.passed {
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
  }
  .step-status-icon.failed {
    color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
  }
  .step-status-icon.running {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }
  .step-status-icon.skipped {
    color: var(--color-text-faint);
    background: var(--color-bg-sidebar);
  }
  .step-http-status {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    padding: 1px var(--space-1);
    border-radius: var(--radius-xs);
  }
  .step-http-status.ok {
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 6%, transparent);
  }
  .step-http-status.err {
    color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 6%, transparent);
  }
  .step-duration {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
  }

  /* Broken references */
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

  /* Override toggle button */
  .btn-override-toggle {
    width: 24px;
    height: 24px;
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
  .override-tab:hover {
    color: var(--color-text-secondary);
  }
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
    min-width: 18px;
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
    width: 20px;
    height: 20px;
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
  .btn-insert-var {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: all var(--duration-normal);
  }
  .btn-insert-var:hover {
    border-color: var(--color-warning);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 6%, transparent);
  }
  .btn-alias-reset {
    font-size: var(--text-xs);
    padding: 2px var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-alias-reset:hover {
    border-color: var(--color-accent-flow);
    color: var(--color-accent-flow);
    background: color-mix(in srgb, var(--color-accent-flow) 6%, transparent);
  }
  .override-tab-spacer {
    flex: 1;
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
