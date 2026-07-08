<script lang="ts">
  import { untrack } from 'svelte';
  import type {
    HttpRequest,
    HttpMethod,
    HttpHeader,
    Variable,
    NamedRequestResult,
    PbDirective,
  } from '../lib/types';
  import { METHOD_COLORS } from '../lib/theme';
  import DependencyBar from './DependencyBar.svelte';
  import VariablePicker from './VariablePicker.svelte';

  type BottomTab = 'body' | 'assertions' | 'before-send' | 'after-receive';

  interface Props {
    request: HttpRequest;
    loading?: boolean;
    resolvedUrl?: string;
    dirty?: boolean;
    fileVariables?: Variable[];
    envVariables?: Record<string, string>;
    namedResults?: Record<string, NamedRequestResult>;
    bottomTab?: BottomTab;
    onUpdate?: (request: HttpRequest) => void;
    onSend?: (request: HttpRequest) => void;
    onSave?: () => void;
    onRunAll?: (dependencies: string[]) => void;
    onBottomTabChange?: (tab: BottomTab) => void;
  }

  let {
    request,
    loading = false,
    resolvedUrl = '',
    dirty = false,
    fileVariables = [],
    envVariables = {},
    namedResults = {},
    bottomTab = $bindable('body'),
    onUpdate,
    onSend,
    onSave,
    onRunAll,
    onBottomTabChange,
  }: Props = $props();

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  // Attachment: keeps the name textarea sized to its content. Re-runs when
  // the value changes (switching requests) and re-measures when the available
  // width changes (resizing the editor pane), so wrapping grows/shrinks the row.
  function autosize(_value: string) {
    return (node: HTMLTextAreaElement) => {
      const grow = () => autoGrow(node);
      let lastWidth = 0;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0].contentRect.width;
        if (w !== lastWidth) {
          lastWidth = w;
          grow();
        }
      });
      ro.observe(node);
      requestAnimationFrame(grow);
      return () => ro.disconnect();
    };
  }

  const methods: HttpMethod[] = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
    'TRACE',
    'CONNECT',
  ];

  let headersOpen = $state(true);
  let showPicker = $state(false);
  let pickerTarget:
    | 'url'
    | 'headerKey'
    | 'headerValue'
    | 'body'
    | 'assertions'
    | 'before-send'
    | 'after-receive'
    | null = null;
  let pickerHeaderIndex: number = -1;
  let cursorPosition: number = -1;

  /** Insert `value` into `text` at `cursorPosition`, or append if -1. */
  function insertAtCursor(text: string, value: string): string {
    if (cursorPosition >= 0 && cursorPosition <= text.length) {
      return text.slice(0, cursorPosition) + value + text.slice(cursorPosition);
    }
    return text + value;
  }

  function update(changes: Partial<HttpRequest>) {
    onUpdate?.({ ...request, ...changes });
  }

  function send() {
    onSend?.(request);
  }

  function addHeader() {
    update({ headers: [...request.headers, { key: '', value: '', enabled: true }] });
  }

  function updateHeader(index: number, changes: Partial<HttpHeader>) {
    const headers = [...request.headers];
    headers[index] = { ...headers[index], ...changes };
    update({ headers });
  }

  function removeHeader(index: number) {
    update({ headers: request.headers.filter((_, i) => i !== index) });
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  // Common HTTP headers for autocomplete
  const commonHeaders = [
    'Accept',
    'Accept-Charset',
    'Accept-Encoding',
    'Accept-Language',
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'Content-Length',
    'Content-Encoding',
    'Content-Language',
    'Content-Disposition',
    'Cookie',
    'Date',
    'Expect',
    'Forwarded',
    'From',
    'Host',
    'If-Match',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'If-Unmodified-Since',
    'Origin',
    'Pragma',
    'Range',
    'Referer',
    'User-Agent',
    'X-Api-Key',
    'X-Correlation-Id',
    'X-Request-Id',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'X-Forwarded-Proto',
  ];

  let headerSuggestIndex: number = $state(-1);
  let headerSuggestItems: string[] = $state([]);
  let headerSuggestSelected: number = $state(-1);

  function onHeaderKeyFocus(index: number) {
    headerSuggestIndex = index;
    updateSuggestions(request.headers[index]?.key ?? '');
  }

  function onHeaderKeyBlur() {
    // Delay to allow click on suggestion
    setTimeout(() => {
      headerSuggestIndex = -1;
      headerSuggestItems = [];
    }, 150);
  }

  function onHeaderKeyInput(index: number, value: string) {
    updateHeader(index, { key: value });
    headerSuggestIndex = index;
    headerSuggestSelected = -1;
    updateSuggestions(value);
  }

  function updateSuggestions(query: string) {
    const q = query.toLowerCase();
    const existing = new Set(request.headers.map((h) => h.key.toLowerCase()));
    headerSuggestItems = commonHeaders.filter(
      (h) => h.toLowerCase().includes(q) && !existing.has(h.toLowerCase()),
    );
    if (q && headerSuggestItems.length === 1 && headerSuggestItems[0].toLowerCase() === q) {
      headerSuggestItems = [];
    }
  }

  function selectSuggestion(index: number, headerName: string) {
    updateHeader(index, { key: headerName });
    headerSuggestIndex = -1;
    headerSuggestItems = [];
  }

  function onHeaderKeyKeydown(e: KeyboardEvent, index: number) {
    if (headerSuggestItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      headerSuggestSelected = Math.min(headerSuggestSelected + 1, headerSuggestItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      headerSuggestSelected = Math.max(headerSuggestSelected - 1, 0);
    } else if (e.key === 'Enter' && headerSuggestSelected >= 0) {
      e.preventDefault();
      selectSuggestion(index, headerSuggestItems[headerSuggestSelected]);
    } else if (e.key === 'Escape') {
      headerSuggestIndex = -1;
      headerSuggestItems = [];
    }
  }

  // ── Assertion directive helpers ──
  const assertionDirectives = $derived(
    (request.directives ?? []).filter(
      (d): d is { type: 'assert'; expr: string; label: string } => d.type === 'assert',
    ),
  );

  function countScriptLines(text: string | undefined): number {
    if (!text) return 0;
    return text.split('\n').filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('//') && !(t.startsWith('#') && !t.match(/^#\s*@pb\./));
    }).length;
  }

  const beforeSendCount = $derived(countScriptLines(request.beforeSend));
  const afterReceiveCount = $derived(countScriptLines(request.afterReceive));

  function directivesToText(directives: PbDirective[]): string {
    return directives
      .filter((d): d is { type: 'assert'; expr: string; label: string } => d.type === 'assert')
      .map((d) => (d.label ? `${d.expr} | ${d.label}` : d.expr))
      .join('\n');
  }

  const requestId = $derived(`${request.name}::${request.method}::${request.url}`);

  // Writable derived: only resyncs from directives when switching to a
  // different request (tracked via requestId); local edits made through the
  // assertions textarea are assigned directly and win until the next switch.
  let assertionsTextInternal = $derived.by(() => {
    void requestId;
    return untrack(() => directivesToText(request.directives ?? []));
  });

  function onAssertionsTextInput(e: Event) {
    const text = (e.target as HTMLTextAreaElement).value;
    assertionsTextInternal = text;
    const nonAssertDirectives = (request.directives ?? []).filter((d) => d.type !== 'assert');
    const newAssertions: PbDirective[] = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const pipeIndex = line.indexOf(' | ');
        if (pipeIndex >= 0) {
          return {
            type: 'assert' as const,
            expr: line.slice(0, pipeIndex),
            label: line.slice(pipeIndex + 3),
          };
        }
        return { type: 'assert' as const, expr: line, label: '' };
      });
    update({ directives: [...nonAssertDirectives, ...newAssertions] });
  }

  // Combine all request text for dependency scanning
  const requestText = $derived(
    [request.url, ...request.headers.map((h) => `${h.key}: ${h.value}`), request.body].join('\n'),
  );

  function openPicker(
    target: 'url' | 'body' | 'assertions' | 'before-send' | 'after-receive' | 'headerValue',
    headerIndex?: number,
  ) {
    // Capture cursor position from the currently focused input/textarea
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    cursorPosition = active?.selectionStart ?? -1;
    pickerTarget = target;
    pickerHeaderIndex = headerIndex ?? -1;
    showPicker = true;
  }

  function handlePickerInsert(value: string) {
    showPicker = false;
    if (pickerTarget === 'url') {
      update({ url: insertAtCursor(request.url, value) });
    } else if (pickerTarget === 'body') {
      update({ body: insertAtCursor(request.body, value) });
    } else if (pickerTarget === 'assertions') {
      assertionsTextInternal = insertAtCursor(assertionsTextInternal, value);
      // Re-parse the updated text into directives
      const nonAssertDirectives = (request.directives ?? []).filter((d) => d.type !== 'assert');
      const newAssertions: PbDirective[] = assertionsTextInternal
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const pipeIndex = line.indexOf(' | ');
          if (pipeIndex >= 0) {
            return {
              type: 'assert' as const,
              expr: line.slice(0, pipeIndex),
              label: line.slice(pipeIndex + 3),
            };
          }
          return { type: 'assert' as const, expr: line, label: '' };
        });
      update({ directives: [...nonAssertDirectives, ...newAssertions] });
    } else if (pickerTarget === 'before-send') {
      update({ beforeSend: insertAtCursor(request.beforeSend ?? '', value) });
    } else if (pickerTarget === 'after-receive') {
      update({ afterReceive: insertAtCursor(request.afterReceive ?? '', value) });
    } else if (pickerTarget === 'headerValue' && pickerHeaderIndex >= 0) {
      const headers = [...request.headers];
      headers[pickerHeaderIndex] = {
        ...headers[pickerHeaderIndex],
        value: insertAtCursor(headers[pickerHeaderIndex].value, value),
      };
      update({ headers });
    }
    cursorPosition = -1;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" onkeydown={handleKeydown}>
  <!-- Request Name -->
  <div class="name-row">
    <textarea
      class="name-input"
      rows="1"
      value={request.name}
      oninput={(e) => {
        update({ name: e.currentTarget.value });
        autoGrow(e.currentTarget);
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      placeholder="Request name"
      {@attach autosize(request.name)}></textarea>
    {#if dirty}
      <button class="btn-save-file" onclick={() => onSave?.()}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path
            d="M12 14H4a1 1 0 01-1-1V3a1 1 0 011-1h6l3 3v8a1 1 0 01-1 1z"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <path d="M5 14v-4h6v4M5 2v3h4" stroke="currentColor" stroke-width="1.5" />
        </svg>
        Save
      </button>
    {/if}
  </div>

  <!-- URL Bar -->
  <div class="url-bar">
    <div class="method-wrapper">
      <select
        class="method-select"
        value={request.method}
        style="color: {METHOD_COLORS[request.method]}"
        onchange={(e) => update({ method: e.currentTarget.value as HttpMethod })}
      >
        {#each methods as method}
          <option value={method} style="color: {METHOD_COLORS[method]}">{method}</option>
        {/each}
      </select>
      <svg class="method-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
        <path
          d="M1 1l4 4 4-4"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <input
      class="url-input"
      type="text"
      value={request.url}
      oninput={(e) => update({ url: e.currentTarget.value })}
      placeholder="https://api.example.com/endpoint"
      spellcheck="false"
    />

    <button
      class="btn-insert-url"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => openPicker('url')}
      title="Insert variable"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <button class={['btn-send', { loading }]} onclick={send} disabled={loading}>
      {#if loading}
        <span class="spinner"></span>
      {:else}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2 7h10M8 3l4 4-4 4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Send
      {/if}
    </button>
  </div>

  {#if resolvedUrl}
    <div class="resolved-url">
      <span class="resolved-arrow">→</span>
      <span class="resolved-value">{resolvedUrl}</span>
    </div>
  {/if}

  <!-- Dependency bar -->
  <DependencyBar {requestText} {namedResults} {onRunAll} />

  <!-- Headers (collapsible) -->
  <div class="section">
    <button class="section-toggle" onclick={() => (headersOpen = !headersOpen)}>
      <span class={['chevron', { open: headersOpen }]}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 1.5l4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      Headers
      {#if request.headers.length > 0}
        <span class="section-count">{request.headers.filter((h) => h.enabled).length}</span>
      {/if}
    </button>
    {#if headersOpen}
      <div class="headers-section">
        {#each request.headers as header, i}
          <div class="header-row">
            <input
              type="checkbox"
              class="header-toggle"
              checked={header.enabled}
              onchange={(e) => updateHeader(i, { enabled: e.currentTarget.checked })}
            />
            <div class="header-key-wrapper">
              <input
                class="header-key"
                type="text"
                value={header.key}
                oninput={(e) => onHeaderKeyInput(i, e.currentTarget.value)}
                onfocus={() => onHeaderKeyFocus(i)}
                onblur={onHeaderKeyBlur}
                onkeydown={(e) => onHeaderKeyKeydown(e, i)}
                placeholder="Header name"
                spellcheck="false"
                autocomplete="off"
              />
              {#if headerSuggestIndex === i && headerSuggestItems.length > 0}
                <div class="header-suggest">
                  {#each headerSuggestItems as item, si}
                    <button
                      class={['suggest-item', { selected: si === headerSuggestSelected }]}
                      onmousedown={(e) => {
                        e.preventDefault();
                        selectSuggestion(i, item);
                      }}>{item}</button
                    >
                  {/each}
                </div>
              {/if}
            </div>
            <input
              class="header-value"
              type="text"
              value={header.value}
              oninput={(e) => updateHeader(i, { value: e.currentTarget.value })}
              placeholder="Value"
              spellcheck="false"
            />
            <button
              class="btn-insert"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => openPicker('headerValue', i)}
              title="Insert variable"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            <button class="btn-remove" onclick={() => removeHeader(i)}>×</button>
          </div>
        {/each}
        <button class="btn-add-header" onclick={addHeader}>+ Add Header</button>
      </div>
    {/if}
  </div>

  <!-- Bottom tabbed panel -->
  <div class="bottom-panel">
    <div class="bottom-tabs">
      <button
        class={['bottom-tab', { active: bottomTab === 'body' }]}
        onclick={() => {
          bottomTab = 'body';
          onBottomTabChange?.(bottomTab);
        }}
      >
        Body
      </button>
      <button
        class={['bottom-tab', { active: bottomTab === 'assertions' }]}
        onclick={() => {
          bottomTab = 'assertions';
          onBottomTabChange?.(bottomTab);
        }}
      >
        Assertions
        {#if assertionDirectives.length > 0}
          <span class="section-count">{assertionDirectives.length}</span>
        {/if}
      </button>
      <button
        class={['bottom-tab', { active: bottomTab === 'before-send' }]}
        onclick={() => {
          bottomTab = 'before-send';
          onBottomTabChange?.(bottomTab);
        }}
      >
        Before Send
        {#if beforeSendCount > 0}
          <span class="section-count">{beforeSendCount}</span>
        {/if}
      </button>
      <button
        class={['bottom-tab', { active: bottomTab === 'after-receive' }]}
        onclick={() => {
          bottomTab = 'after-receive';
          onBottomTabChange?.(bottomTab);
        }}
      >
        After Receive
        {#if afterReceiveCount > 0}
          <span class="section-count">{afterReceiveCount}</span>
        {/if}
      </button>
      <div class="bottom-tab-actions">
        <button
          class="btn-insert"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => openPicker(bottomTab)}
          title="Insert variable"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="bottom-content">
      {#if bottomTab === 'body'}
        <textarea
          class="body-editor"
          value={request.body}
          oninput={(e) => update({ body: e.currentTarget.value })}
          placeholder={'{"key": "value"}'}
          spellcheck="false"></textarea>
      {:else if bottomTab === 'assertions'}
        <textarea
          class="body-editor"
          value={assertionsTextInternal}
          oninput={onAssertionsTextInput}
          placeholder={'# One assertion per line:\n# pb.response.status == 200 | Should return 200\n# pb.response.body.$.name != null | Name should exist'}
          spellcheck="false"></textarea>
      {:else if bottomTab === 'before-send'}
        <textarea
          class="body-editor"
          value={request.beforeSend ?? ''}
          oninput={(e) => update({ beforeSend: e.currentTarget.value })}
          placeholder={'# Scripts to run before sending the request\npb.set(pb.request.header.X-Custom, "value")\npb.set(pb.request.body.$.field, "value")'}
          spellcheck="false"></textarea>
      {:else if bottomTab === 'after-receive'}
        <textarea
          class="body-editor"
          value={request.afterReceive ?? ''}
          oninput={(e) => update({ afterReceive: e.currentTarget.value })}
          placeholder={'# Scripts to run after receiving the response\npb.set("token", pb.response.body.$.token)\npb.global("sessionId", pb.response.body.$.id)'}
          spellcheck="false"></textarea>
      {/if}
    </div>
  </div>

  <div class="keyboard-hint">
    <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send
  </div>
</div>

<!-- Variable picker modal -->
<VariablePicker
  visible={showPicker}
  {fileVariables}
  {envVariables}
  {namedResults}
  onInsert={handlePickerInsert}
  onClose={() => (showPicker = false)}
/>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
    gap: var(--space-3);
  }

  .name-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .name-input {
    flex: 1;
    padding: var(--space-1\.5) 0;
    border: none;
    background: transparent;
    color: var(--color-text-heading);
    font-family: inherit;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: 1.3;
    outline: none;
    border-bottom: 1px solid transparent;
    transition: border-color var(--duration-normal);
    min-width: 0;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .name-input:focus {
    border-bottom-color: var(--zinc-100);
  }
  .btn-save-file {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px var(--space-3\.5);
    border: none;
    border-radius: var(--radius-default);
    background: var(--color-success);
    color: var(--color-bg-surface);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-normal);
  }
  .btn-save-file:hover {
    background: #4a9a50;
  }

  .url-bar {
    display: flex;
    gap: 0;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    overflow: hidden;
    transition: border-color var(--duration-normal);
  }
  .url-bar:focus-within {
    border-color: var(--color-primary);
  }

  .method-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    border-right: 1px solid var(--color-border);
    background: var(--color-bg-sidebar);
  }
  .method-select {
    appearance: none;
    -webkit-appearance: none;
    padding: var(--space-3) 30px var(--space-3) var(--space-2\.5);
    border: none;
    background: transparent;
    color: var(--color-info);
    font-family: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    cursor: pointer;
    outline: none;
  }
  .method-chevron {
    position: absolute;
    right: var(--space-2\.5);
    pointer-events: none;
    color: var(--color-text-muted);
  }
  .method-select option {
    background: var(--color-bg-surface);
  }

  .url-input {
    flex: 1;
    padding: var(--space-3) var(--space-2\.5);
    border: none;
    background: transparent;
    color: var(--color-text-heading);
    font-family: inherit;
    font-size: var(--text-md);
    outline: none;
  }
  .url-input::placeholder {
    color: var(--zinc-300);
  }

  .btn-insert-url {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-insert-url:hover {
    background: var(--color-bg-muted);
    color: var(--color-primary);
  }

  .btn-send {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: var(--space-2\.5) var(--space-4);
    border: none;
    background: var(--color-primary);
    color: var(--color-primary-fg);
    font-family: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    cursor: pointer;
    transition: all var(--duration-normal);
    letter-spacing: 0.3px;
  }
  .btn-send:hover {
    background: var(--color-primary-hover);
  }
  .btn-send:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-send.loading {
    padding: var(--space-2\.5) var(--space-7);
  }

  .spinner {
    width: var(--space-4);
    height: var(--space-4);
    border: 2px solid #ffffff40;
    border-top-color: var(--color-bg-surface);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Resolved URL */
  .resolved-url {
    font-size: var(--text-sm);
    padding: 0 2px;
    margin-top: -4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .resolved-arrow {
    color: var(--zinc-300);
  }
  .resolved-value {
    color: var(--color-success);
  }

  /* Sections */
  .section {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-1);
  }
  .section-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) 0;
    border: none;
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    cursor: pointer;
    text-align: left;
  }
  .section-toggle:hover {
    color: var(--color-text-heading);
  }
  .chevron {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-faint);
    transition: transform var(--duration-normal);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .section-count {
    background: var(--color-bg-muted);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-xl);
  }
  .btn-insert {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: all var(--duration-normal);
  }
  .btn-insert:hover {
    border-color: var(--color-warning);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 6%, transparent);
  }
  /* Bottom tabbed panel */
  .bottom-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--color-divider);
  }
  .bottom-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding-top: var(--space-1);
  }
  .bottom-tab {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: 7px var(--space-4);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .bottom-tab:hover {
    color: var(--slate-450);
  }
  .bottom-tab.active {
    color: var(--color-text-heading);
    border-bottom-color: var(--color-primary);
  }
  .bottom-tab-actions {
    margin-left: auto;
  }
  .bottom-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-top: var(--space-1\.5);
  }

  /* Headers */
  .headers-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
  }
  .header-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .header-toggle {
    accent-color: var(--color-primary);
    flex-shrink: 0;
    cursor: pointer;
  }
  .header-key,
  .header-value {
    flex: 1;
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
    transition: border-color var(--duration-normal);
  }
  .header-key:focus,
  .header-value:focus {
    border-color: #b0b0ba;
  }
  .header-key::placeholder,
  .header-value::placeholder {
    color: var(--zinc-300);
  }
  .header-key {
    color: var(--color-warning);
    max-width: none;
    width: 100%;
  }
  .header-key-wrapper {
    position: relative;
    flex: 1;
    max-width: 180px;
  }
  .header-suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-default);
    box-shadow: var(--shadow-dropdown);
    margin-top: 2px;
    max-height: 200px;
    overflow-y: auto;
    padding: var(--space-1) 0;
  }
  .suggest-item {
    display: block;
    width: 100%;
    padding: var(--space-1\.5) var(--space-2\.5);
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast);
  }
  .suggest-item:hover,
  .suggest-item.selected {
    background: var(--color-bg-muted);
  }

  .btn-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    border: none;
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-size: var(--text-xl);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-remove:hover {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }

  .btn-add-header {
    padding: var(--space-2) var(--space-3\.5);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition: all var(--duration-normal);
    margin-top: var(--space-1);
    align-self: flex-start;
  }
  .btn-add-header:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  /* Body */
  .body-editor {
    width: 100%;
    flex: 1;
    min-height: 120px;
    padding: var(--space-3\.5);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
    outline: none;
    resize: none;
    transition: border-color var(--duration-normal);
  }
  .body-editor:focus {
    border-color: #b0b0ba;
  }
  .body-editor::placeholder {
    color: var(--color-text-placeholder);
  }

  .keyboard-hint {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--zinc-300);
    padding-top: var(--space-1);
  }
  .keyboard-hint kbd {
    padding: 1px var(--space-1\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg-sidebar);
    font-family: inherit;
    font-size: var(--text-xs);
  }
</style>
