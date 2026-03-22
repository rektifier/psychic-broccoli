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
    padding: 16px;
  }

  /* Empty State */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #AAA;
  }
  .empty-icon {
    font-size: 40px;
    opacity: 0.3;
    margin-bottom: 8px;
  }
  .empty-text {
    font-size: 14px;
    color: #888;
  }
  .empty-hint {
    font-size: 11px;
    color: #BBB;
  }

  /* Loading */
  .loading-indicator {
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }
  .pulse-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid #D4900A;
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
    font-size: 20px;
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
    margin-bottom: 12px;
  }
  .status-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status-badge {
    font-size: 14px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 6px;
    letter-spacing: 0.3px;
  }
  .status-success {
    background: #3D8B4518;
    color: #3D8B45;
  }
  .status-redirect {
    background: #2B7FC518;
    color: #2B7FC5;
  }
  .status-client-error {
    background: #9A752018;
    color: #9A7520;
  }
  .status-server-error {
    background: #CC445518;
    color: #CC4455;
  }
  .status-error {
    background: #CC445518;
    color: #CC4455;
  }
  .status-text {
    font-size: 13px;
    color: #777;
  }

  .meta-chips {
    display: flex;
    gap: 8px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #777;
    padding: 4px 10px;
    background: #F0F0F4;
    border-radius: 6px;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid #DCDCE2;
    margin-bottom: 12px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    margin-bottom: -1px;
  }
  .tab:hover { color: #555; }
  .tab.active {
    color: #1A1A2E;
    border-bottom-color: #D4900A;
  }
  .tab-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: #2B7FC515;
    color: #2B7FC5;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tab-count {
    background: #E4E4EA;
    color: #777;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* Content */
  .content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .body-output {
    padding: 16px;
    background: #FFFFFF;
    border: 1px solid #DCDCE2;
    border-radius: 8px;
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.65;
    color: #333340;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100%;
  }
  .body-output.json {
    color: #4A4A58;
  }

  /* Headers Table */
  .headers-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #DCDCE2;
    border-radius: 8px;
    overflow: hidden;
  }
  .header-entry {
    display: grid;
    grid-template-columns: 200px 1fr;
    background: #FFFFFF;
    padding: 10px 14px;
  }
  .hdr-key {
    font-size: 12px;
    font-weight: 600;
    color: #9A7520;
  }
  .hdr-value {
    font-size: 12px;
    color: #4A4A58;
    word-break: break-all;
  }
  .no-headers {
    padding: 20px;
    text-align: center;
    color: #AAA;
    font-size: 12px;
    background: #FFFFFF;
  }

  /* Assertion Results */
  .assertion-count.all-pass { background: #3D8B4520; color: #3D8B45; }
  .assertion-count.has-fail { background: #CC445520; color: #CC4455; }

  .assertion-results {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #DCDCE2;
    border-radius: 8px;
    overflow: hidden;
  }
  .assertion-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: #FFFFFF;
    font-size: 12px;
  }
  .assertion-icon {
    font-weight: 700;
    font-size: 14px;
    width: 18px;
    text-align: center;
  }
  .assertion-entry.pass .assertion-icon { color: #3D8B45; }
  .assertion-entry.fail .assertion-icon { color: #CC4455; }
  .assertion-entry.pass .assertion-label { color: #4A4A58; }
  .assertion-entry.fail .assertion-label { color: #CC4455; font-weight: 500; }
</style>
