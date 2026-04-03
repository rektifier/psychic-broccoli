<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HttpResponse, PbAssertionResult } from '../lib/types';
  import type { ResponseTab } from '../lib/stores';

  export let response: HttpResponse | null = null;
  export let loading: boolean = false;
  export let sentRequest: { method: string; url: string; headers: Record<string, string>; body: string } | null = null;
  export let assertionResults: PbAssertionResult[] = [];
  export let activeTab: ResponseTab = 'body';

  const dispatch = createEventDispatcher<{ tabChange: ResponseTab }>();

  function setTab(tab: ResponseTab) {
    activeTab = tab;
    dispatch('tabChange', tab);
  }

  $: passedCount = assertionResults.filter(t => t.passed).length;
  $: failedCount = assertionResults.filter(t => !t.passed).length;

  function getStatusClass(status: number): string {
    if (status >= 200 && status < 300) return 'status-success';
    if (status >= 300 && status < 400) return 'status-redirect';
    if (status >= 400 && status < 500) return 'status-client-error';
    if (status >= 500) return 'status-server-error';
    return 'status-error';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatBody(body: string): string {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  function isJson(body: string): boolean {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  }

  function formatRawRequest(req: { method: string; url: string; headers: Record<string, string>; body: string }): string {
    let raw = `${req.method} ${req.url} HTTP/1.1\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      raw += `${key}: ${value}\n`;
    }
    if (req.body) {
      raw += `\n`;
      try {
        raw += JSON.stringify(JSON.parse(req.body), null, 2);
      } catch {
        raw += req.body;
      }
    }
    return raw;
  }
</script>

<div class="response-viewer">
  {#if loading}
    <div class="empty-state">
      <div class="loading-indicator">
        <div class="pulse-ring"></div>
        <div class="pulse-ring delay"></div>
        <span class="loading-icon">🥦</span>
      </div>
      <span class="empty-text">Sending request...</span>
    </div>
  {:else if !response}
    <div class="empty-state">
      <span class="empty-icon">↗</span>
      <span class="empty-text">Send a request to see the response</span>
      <span class="empty-hint">Use the Send button or Ctrl+Enter</span>
    </div>
  {:else}
    <!-- Status Bar -->
    <div class="status-bar">
      <div class="status-info">
        <span class="status-badge {getStatusClass(response.status)}">
          {response.status}
        </span>
        <span class="status-text">{response.statusText}</span>
      </div>
      <div class="meta-chips">
        <span class="chip">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M6 3v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          {response.time} ms
        </span>
        <span class="chip">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 10V4l4-2 4 2v6l-4 2-4-2z" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          {formatSize(response.size)}
        </span>
      </div>
    </div>

    <!-- Response Tabs -->
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'body'}
        on:click={() => setTab('body')}
      >
        Body
        {#if isJson(response.body)}
          <span class="tab-badge">JSON</span>
        {/if}
      </button>
      <button
        class="tab"
        class:active={activeTab === 'headers'}
        on:click={() => setTab('headers')}
      >
        Headers
        <span class="tab-count">{Object.keys(response.headers).length}</span>
      </button>
      {#if sentRequest}
        <button
          class="tab"
          class:active={activeTab === 'request'}
          on:click={() => setTab('request')}
        >
          Request
        </button>
      {/if}
      {#if assertionResults.length > 0}
        <button
          class="tab"
          class:active={activeTab === 'assertions'}
          on:click={() => setTab('assertions')}
        >
          Assertions
          <span class="tab-count assertion-count" class:all-pass={failedCount === 0} class:has-fail={failedCount > 0}>
            {passedCount}/{assertionResults.length}
          </span>
        </button>
      {/if}
    </div>

    <!-- Content -->
    <div class="content">
      {#if activeTab === 'body'}
        <pre class="body-output" class:json={isJson(response.body)}>{formatBody(response.body)}</pre>
      {:else if activeTab === 'headers'}
        <div class="headers-table">
          {#each Object.entries(response.headers) as [key, value]}
            <div class="header-entry">
              <span class="hdr-key">{key}</span>
              <span class="hdr-value">{value}</span>
            </div>
          {/each}
          {#if Object.keys(response.headers).length === 0}
            <div class="no-headers">No headers returned</div>
          {/if}
        </div>
      {:else if activeTab === 'request' && sentRequest}
        <pre class="body-output">{formatRawRequest(sentRequest)}</pre>
      {:else if activeTab === 'assertions'}
        <div class="assertion-results">
          {#each assertionResults as result}
            <div class="assertion-entry" class:pass={result.passed} class:fail={!result.passed}>
              <span class="assertion-icon">{result.passed ? '\u2713' : '\u2717'}</span>
              <span class="assertion-label">{result.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .response-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
  }

  /* Empty State */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2\.5);
    color: var(--zinc-300);
  }
  .empty-icon {
    font-size: 40px;
    opacity: 0.3;
    margin-bottom: var(--space-2);
  }
  .empty-text {
    font-size: var(--text-lg);
    color: var(--slate-350);
  }
  .empty-hint {
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
  }

  /* Loading */
  .loading-indicator {
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-3);
  }
  .pulse-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid var(--color-primary);
    border-radius: 50%;
    animation: pulse-out 1.5s ease-out infinite;
  }
  .pulse-ring.delay {
    animation-delay: 0.3s;
  }
  @keyframes pulse-out {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(1.4); opacity: 0; }
  }
  .loading-icon {
    font-size: var(--text-2xl);
    z-index: 1;
    animation: pulse-glow 1s ease-in-out infinite alternate;
  }
  @keyframes pulse-glow {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }

  /* Status Bar */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
  }
  .status-info {
    display: flex;
    align-items: center;
    gap: var(--space-2\.5);
  }
  .status-badge {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-default);
    letter-spacing: 0.3px;
  }
  .status-success {
    background: color-mix(in srgb, var(--color-success) 9%, transparent);
    color: var(--color-success);
  }
  .status-redirect {
    background: color-mix(in srgb, var(--color-info) 9%, transparent);
    color: var(--color-info);
  }
  .status-client-error {
    background: color-mix(in srgb, var(--color-warning) 9%, transparent);
    color: var(--color-warning);
  }
  .status-server-error {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }
  .status-error {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }
  .status-text {
    font-size: var(--text-md);
    color: var(--color-text-muted);
  }

  .meta-chips {
    display: flex;
    gap: var(--space-2);
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-1) var(--space-2\.5);
    background: var(--color-bg-sidebar);
    border-radius: var(--radius-default);
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--color-divider);
    margin-bottom: var(--space-3);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-1\.5);
    padding: var(--space-2) var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all var(--duration-normal);
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--color-text-secondary); }
  .tab.active {
    color: var(--color-text-heading);
    border-bottom-color: var(--color-primary);
  }
  .tab-badge {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    padding: 2px var(--space-1\.5);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-info) 8%, transparent);
    color: var(--color-info);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tab-count {
    background: var(--color-bg-muted);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    padding: 1px var(--space-1\.5);
    border-radius: var(--radius-xl);
  }

  /* Content */
  .content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .body-output {
    padding: var(--space-4);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--color-text);
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100%;
  }
  .body-output.json {
    color: var(--slate-600);
  }

  /* Headers Table */
  .headers-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--color-divider);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .header-entry {
    display: grid;
    grid-template-columns: 200px 1fr;
    background: var(--color-bg-surface);
    padding: var(--space-2\.5) var(--space-3\.5);
  }
  .hdr-key {
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--color-warning);
  }
  .hdr-value {
    font-size: var(--text-base);
    color: var(--slate-600);
    word-break: break-all;
  }
  .no-headers {
    padding: var(--space-5);
    text-align: center;
    color: var(--zinc-300);
    font-size: var(--text-base);
    background: var(--color-bg-surface);
  }

  /* Assertion Results */
  .assertion-count.all-pass { background: color-mix(in srgb, var(--color-success) 12%, transparent); color: var(--color-success); }
  .assertion-count.has-fail { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }

  .assertion-results {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--color-divider);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .assertion-entry {
    display: flex;
    align-items: center;
    gap: var(--space-2\.5);
    padding: var(--space-2\.5) var(--space-3\.5);
    background: var(--color-bg-surface);
    font-size: var(--text-base);
  }
  .assertion-icon {
    font-weight: var(--weight-bold);
    font-size: var(--text-lg);
    width: 18px;
    text-align: center;
  }
  .assertion-entry.pass .assertion-icon { color: var(--color-success); }
  .assertion-entry.fail .assertion-icon { color: var(--color-error); }
  .assertion-entry.pass .assertion-label { color: var(--slate-600); }
  .assertion-entry.fail .assertion-label { color: var(--color-error); font-weight: var(--weight-medium); }
</style>
