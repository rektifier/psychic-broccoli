<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HttpRequest, HttpMethod, HttpHeader, Variable, NamedRequestResult, PbDirective } from '../lib/types';
  import DependencyBar from './DependencyBar.svelte';
  import VariablePicker from './VariablePicker.svelte';

  export let request: HttpRequest;
  export let loading: boolean = false;
  export let resolvedUrl: string = '';
  export let dirty: boolean = false;
  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
  export let namedResults: Record<string, NamedRequestResult> = {};

  const dispatch = createEventDispatcher();

  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];
  const methodColors: Record<string, string> = {
    GET: '#2B7FC5',
    POST: '#3D8B45',
    PUT: '#9A7520',
    PATCH: '#A06828',
    DELETE: '#CC4455',
    HEAD: '#8040A8',
    OPTIONS: '#1A8898',
    TRACE: '#666677',
    CONNECT: '#CC4455',
  };

  let headersOpen = true;
  let assertionsOpen = true;
  let bottomTab: 'body' | 'assertions' = 'body';
  let showPicker = false;
  let pickerTarget: 'url' | 'headerKey' | 'headerValue' | 'body' | 'assertions' | null = null;
  let pickerHeaderIndex: number = -1;

  function update(changes: Partial<HttpRequest>) {
    dispatch('update', { ...request, ...changes });
  }

  function send() {
    dispatch('send', request);
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
    'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language',
    'Authorization', 'Cache-Control', 'Content-Type', 'Content-Length',
    'Content-Encoding', 'Content-Language', 'Content-Disposition',
    'Cookie', 'Date', 'Expect', 'Forwarded',
    'From', 'Host', 'If-Match', 'If-Modified-Since',
    'If-None-Match', 'If-Range', 'If-Unmodified-Since',
    'Origin', 'Pragma', 'Range', 'Referer',
    'User-Agent', 'X-Api-Key', 'X-Correlation-Id', 'X-Request-Id',
    'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto',
  ];

  let headerSuggestIndex: number = -1;
  let headerSuggestItems: string[] = [];
  let headerSuggestSelected: number = -1;

  function onHeaderKeyFocus(index: number) {
    headerSuggestIndex = index;
    updateSuggestions(request.headers[index]?.key ?? '');
  }

  function onHeaderKeyBlur() {
    // Delay to allow click on suggestion
    setTimeout(() => { headerSuggestIndex = -1; headerSuggestItems = []; }, 150);
  }

  function onHeaderKeyInput(index: number, value: string) {
    updateHeader(index, { key: value });
    headerSuggestIndex = index;
    headerSuggestSelected = -1;
    updateSuggestions(value);
  }

  function updateSuggestions(query: string) {
    const q = query.toLowerCase();
    const existing = new Set(request.headers.map(h => h.key.toLowerCase()));
    headerSuggestItems = commonHeaders.filter(h =>
      h.toLowerCase().includes(q) && !existing.has(h.toLowerCase())
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
  $: assertionDirectives = (request.directives ?? []).filter(
    (d): d is { type: 'assert'; expr: string; label: string } => d.type === 'assert'
  );

  let assertionsTextInternal = '';
  let lastRequestId = '';

  function directivesToText(directives: PbDirective[]): string {
    return directives
      .filter((d): d is { type: 'assert'; expr: string; label: string } => d.type === 'assert')
      .map(d => d.label ? `${d.expr} | ${d.label}` : d.expr)
      .join('\n');
  }

  // Only sync from directives when switching to a different request
  $: {
    const id = `${request.name}::${request.method}::${request.url}`;
    if (id !== lastRequestId) {
      lastRequestId = id;
      assertionsTextInternal = directivesToText(request.directives ?? []);
    }
  }

  function onAssertionsTextInput(e: Event) {
    const text = (e.target as HTMLTextAreaElement).value;
    assertionsTextInternal = text;
    const nonAssertDirectives = (request.directives ?? []).filter(d => d.type !== 'assert');
    const newAssertions: PbDirective[] = text
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const pipeIndex = line.indexOf(' | ');
        if (pipeIndex >= 0) {
          return { type: 'assert' as const, expr: line.slice(0, pipeIndex), label: line.slice(pipeIndex + 3) };
        }
        return { type: 'assert' as const, expr: line, label: '' };
      });
    update({ directives: [...nonAssertDirectives, ...newAssertions] });
  }

  // Combine all request text for dependency scanning
  $: requestText = [
    request.url,
    ...request.headers.map(h => `${h.key}: ${h.value}`),
    request.body,
  ].join('\n');

  function openPicker(target: 'url' | 'body' | 'assertions' | 'headerValue', headerIndex?: number) {
    pickerTarget = target;
    pickerHeaderIndex = headerIndex ?? -1;
    showPicker = true;
  }

  function handlePickerInsert(e: CustomEvent<string>) {
    const value = e.detail;
    showPicker = false;
    if (pickerTarget === 'url') {
      update({ url: request.url + value });
    } else if (pickerTarget === 'body') {
      update({ body: request.body + value });
    } else if (pickerTarget === 'assertions') {
      assertionsTextInternal = assertionsTextInternal + value;
      // Re-parse the updated text into directives
      const nonAssertDirectives = (request.directives ?? []).filter(d => d.type !== 'assert');
      const newAssertions: PbDirective[] = assertionsTextInternal
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const pipeIndex = line.indexOf(' | ');
          if (pipeIndex >= 0) {
            return { type: 'assert' as const, expr: line.slice(0, pipeIndex), label: line.slice(pipeIndex + 3) };
          }
          return { type: 'assert' as const, expr: line, label: '' };
        });
      update({ directives: [...nonAssertDirectives, ...newAssertions] });
    } else if (pickerTarget === 'headerValue' && pickerHeaderIndex >= 0) {
      const headers = [...request.headers];
      headers[pickerHeaderIndex] = { ...headers[pickerHeaderIndex], value: headers[pickerHeaderIndex].value + value };
      update({ headers });
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" on:keydown={handleKeydown}>
  <!-- Request Name -->
  <div class="name-row">
    <input
      class="name-input"
      type="text"
      value={request.name}
      on:input={(e) => update({ name: e.currentTarget.value })}
      placeholder="Request name"
    />
    {#if dirty}
      <button class="btn-save-file" on:click={() => dispatch('save')}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M12 14H4a1 1 0 01-1-1V3a1 1 0 011-1h6l3 3v8a1 1 0 01-1 1z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 14v-4h6v4M5 2v3h4" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        Save
      </button>
    {/if}
  </div>

  <!-- URL Bar -->
  <div class="url-bar">
    <select
      class="method-select"
      value={request.method}
      style="color: {methodColors[request.method]}"
      on:change={(e) => update({ method: e.currentTarget.value as HttpMethod })}
    >
      {#each methods as method}
        <option value={method} style="color: {methodColors[method]}">{method}</option>
      {/each}
    </select>

    <input
      class="url-input"
      type="text"
      value={request.url}
      on:input={(e) => update({ url: e.currentTarget.value })}
      placeholder="https://api.example.com/endpoint"
      spellcheck="false"
    />

    <button class="btn-insert-url" on:click={() => openPicker('url')} title="Insert variable">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>

    <button
      class="btn-send"
      on:click={send}
      disabled={loading}
      class:loading
    >
      {#if loading}
        <span class="spinner"></span>
      {:else}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
  <DependencyBar
    {requestText}
    {namedResults}
    on:runAll
  />

  <!-- Headers (collapsible) -->
  <div class="section">
    <button class="section-toggle" on:click={() => headersOpen = !headersOpen}>
      <span class="chevron" class:open={headersOpen}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      Headers
      {#if request.headers.length > 0}
        <span class="section-count">{request.headers.filter(h => h.enabled).length}</span>
      {/if}
    </button>
    {#if headersOpen}
      <div class="headers-section">
        {#each request.headers as header, i}
          <div class="header-row">
            <input type="checkbox" class="header-toggle" checked={header.enabled}
              on:change={(e) => updateHeader(i, { enabled: e.currentTarget.checked })} />
            <div class="header-key-wrapper">
              <input class="header-key" type="text" value={header.key}
                on:input={(e) => onHeaderKeyInput(i, e.currentTarget.value)}
                on:focus={() => onHeaderKeyFocus(i)}
                on:blur={onHeaderKeyBlur}
                on:keydown={(e) => onHeaderKeyKeydown(e, i)}
                placeholder="Header name" spellcheck="false" autocomplete="off" />
              {#if headerSuggestIndex === i && headerSuggestItems.length > 0}
                <div class="header-suggest">
                  {#each headerSuggestItems as item, si}
                    <button
                      class="suggest-item"
                      class:selected={si === headerSuggestSelected}
                      on:mousedown|preventDefault={() => selectSuggestion(i, item)}
                    >{item}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <input class="header-value" type="text" value={header.value}
              on:input={(e) => updateHeader(i, { value: e.currentTarget.value })} placeholder="Value" spellcheck="false" />
            <button class="btn-insert" on:click={() => openPicker('headerValue', i)} title="Insert variable">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="btn-remove" on:click={() => removeHeader(i)}>×</button>
          </div>
        {/each}
        <button class="btn-add-header" on:click={addHeader}>+ Add Header</button>
      </div>
    {/if}
  </div>

  <!-- Bottom tabbed panel -->
  <div class="bottom-panel">
    <div class="bottom-tabs">
      <button class="bottom-tab" class:active={bottomTab === 'body'} on:click={() => bottomTab = 'body'}>
        Body
      </button>
      <button class="bottom-tab" class:active={bottomTab === 'assertions'} on:click={() => bottomTab = 'assertions'}>
        Assertions
        {#if assertionDirectives.length > 0}
          <span class="section-count">{assertionDirectives.length}</span>
        {/if}
      </button>
      <div class="bottom-tab-actions">
        <button class="btn-insert" on:click={() => openPicker(bottomTab === 'assertions' ? 'assertions' : 'body')} title="Insert variable">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4c0-1.1.9-2 2-2M2 8c0 1.1.9 2 2 2M10 4c0-1.1-.9-2-2-2M10 8c0 1.1-.9 2-2 2M6 3v6M4 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="bottom-content">
      {#if bottomTab === 'body'}
        <textarea
          class="body-editor"
          value={request.body}
          on:input={(e) => update({ body: e.currentTarget.value })}
          placeholder={'{"key": "value"}'}
          spellcheck="false"
        ></textarea>
      {:else if bottomTab === 'assertions'}
        <textarea
          class="body-editor"
          value={assertionsTextInternal}
          on:input={onAssertionsTextInput}
          placeholder={"# One assertion per line:\n# pb.response.status == 200 | Should return 200\n# pb.response.body.$.name != null | Name should exist"}
          spellcheck="false"
        ></textarea>
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
  on:insert={handlePickerInsert}
  on:close={() => showPicker = false}
/>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 16px;
    gap: 12px;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .name-input {
    flex: 1;
    padding: 6px 0;
    border: none;
    background: transparent;
    color: #1A1A2E;
    font-family: inherit;
    font-size: 16px;
    font-weight: 600;
    outline: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s;
    min-width: 0;
  }
  .name-input:focus {
    border-bottom-color: #CCC;
  }
  .btn-save-file {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 14px;
    border: none;
    border-radius: 6px;
    background: #3D8B45;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-save-file:hover {
    background: #4A9A50;
  }

  .url-bar {
    display: flex;
    gap: 0;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .url-bar:focus-within {
    border-color: #D4900A;
  }

  .method-select {
    padding: 12px 14px;
    border: none;
    border-right: 1px solid #D4D4D8;
    background: #F0F0F4;
    color: #2B7FC5;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    outline: none;
    min-width: 90px;
  }
  .method-select option {
    background: #FFFFFF;
  }

  .url-input {
    flex: 1;
    padding: 12px 14px;
    border: none;
    background: transparent;
    color: #1A1A2E;
    font-family: inherit;
    font-size: 13px;
    outline: none;
  }
  .url-input::placeholder {
    color: #AAA;
  }

  .btn-insert-url {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-insert-url:hover {
    background: #E4E4EA;
    color: #D4900A;
  }

  .btn-send {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    border: none;
    background: #D4900A;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.3px;
  }
  .btn-send:hover {
    background: #E09E18;
  }
  .btn-send:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-send.loading {
    padding: 10px 28px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #FFFFFF40;
    border-top-color: #FFFFFF;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Resolved URL */
  .resolved-url {
    font-size: 11px;
    padding: 0 2px;
    margin-top: -4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .resolved-arrow { color: #AAA; }
  .resolved-value { color: #3D8B45; }

  /* Sections */
  .section {
    border-top: 1px solid #DCDCE2;
    padding-top: 4px;
  }
  .section-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 0;
    border: none;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }
  .section-toggle:hover { color: #1A1A2E; }
  .chevron {
    display: inline-flex;
    align-items: center;
    color: #999;
    transition: transform 0.15s;
  }
  .chevron.open { transform: rotate(90deg); }
  .section-count {
    background: #E4E4EA;
    color: #777;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
  }
  .btn-insert {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    border: 1px solid #D4D4D8;
    border-radius: 4px;
    background: transparent;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: all 0.15s;
  }
  .btn-insert:hover {
    border-color: #9A7520;
    color: #9A7520;
    background: #9A752010;
  }
  /* Bottom tabbed panel */
  .bottom-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid #DCDCE2;
  }
  .bottom-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding-top: 4px;
  }
  .bottom-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .bottom-tab:hover { color: #666; }
  .bottom-tab.active {
    color: #1A1A2E;
    border-bottom-color: #D4900A;
  }
  .bottom-tab-actions {
    margin-left: auto;
  }
  .bottom-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-top: 6px;
  }

  /* Headers */
  .headers-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 8px;
  }
  .header-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-toggle {
    accent-color: #D4900A;
    flex-shrink: 0;
    cursor: pointer;
  }
  .header-key, .header-value {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }
  .header-key:focus, .header-value:focus { border-color: #B0B0BA; }
  .header-key::placeholder, .header-value::placeholder { color: #AAA; }
  .header-key { color: #9A7520; max-width: none; width: 100%; }
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
    background: #FFFFFF;
    border: 1px solid #DCDCE2;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    margin-top: 2px;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px 0;
  }
  .suggest-item {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .suggest-item:hover, .suggest-item.selected {
    background: #E4E4EA;
  }

  .btn-remove {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; border-radius: 6px;
    background: transparent; color: #999; font-size: 16px;
    cursor: pointer; flex-shrink: 0; transition: all 0.15s;
  }
  .btn-remove:hover { background: #CC445518; color: #CC4455; }

  .btn-add-header {
    padding: 8px 14px; border: 1px dashed #D4D4D8; border-radius: 6px;
    background: transparent; color: #999; font-family: inherit;
    font-size: 12px; cursor: pointer; transition: all 0.15s;
    margin-top: 4px; align-self: flex-start;
  }
  .btn-add-header:hover { border-color: #D4900A; color: #D4900A; }

  /* Body */
  .body-editor {
    width: 100%;
    flex: 1;
    min-height: 120px;
    padding: 14px;
    border: 1px solid #DCDCE2;
    border-radius: 8px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
    outline: none;
    resize: none;
    transition: border-color 0.15s;
  }
  .body-editor:focus { border-color: #B0B0BA; }
  .body-editor::placeholder { color: #BBB; }

  .keyboard-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #AAA;
    padding-top: 4px;
  }
  .keyboard-hint kbd {
    padding: 1px 6px;
    border: 1px solid #D4D4D8;
    border-radius: 4px;
    background: #F0F0F4;
    font-family: inherit;
    font-size: 10px;
  }
</style>
