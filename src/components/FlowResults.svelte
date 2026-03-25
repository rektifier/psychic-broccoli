<script lang="ts">
  import type { FlowRunRecord, FlowStepResult } from '../lib/types';

  export let runRecord: FlowRunRecord | null = null;
  export let history: FlowRunRecord[] = [];
  export let flowFilePath: string = '';

  let selectedRunId: string | null = null;
  let expandedStep: string | null = null;

  $: relevantHistory = history.filter(r => r.flowFilePath === flowFilePath);
  $: displayRecord = selectedRunId
    ? relevantHistory.find(r => r.id === selectedRunId) ?? runRecord
    : runRecord;

  function selectRun(id: string) {
    selectedRunId = selectedRunId === id ? null : id;
  }

  function toggleStep(stepId: string) {
    expandedStep = expandedStep === stepId ? null : stepId;
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
  }

  function totalDuration(record: FlowRunRecord): number {
    return record.stepResults.reduce((sum, r) => sum + r.durationMs, 0);
  }

  function statusColor(status: string): string {
    if (status === 'passed') return '#3D8B45';
    if (status === 'failed') return '#CC4455';
    if (status === 'running') return '#D4900A';
    return '#999';
  }

  function truncateBody(body: string, maxLen: number = 500): string {
    if (body.length <= maxLen) return body;
    return body.slice(0, maxLen) + '...';
  }
</script>

<div class="flow-results">
  {#if displayRecord}
    <!-- Summary bar -->
    <div class="results-summary">
      <div class="summary-stats">
        <span class="stat passed">{displayRecord.summary.passed} passed</span>
        <span class="stat failed">{displayRecord.summary.failed} failed</span>
        {#if displayRecord.summary.skipped > 0}
          <span class="stat skipped">{displayRecord.summary.skipped} skipped</span>
        {/if}
        <span class="stat total">of {displayRecord.summary.total}</span>
      </div>
      <div class="summary-meta">
        {#if displayRecord.environment}
          <span class="meta-chip env">{displayRecord.environment}</span>
        {/if}
        <span class="meta-chip time">{totalDuration(displayRecord)}ms</span>
        <span class="meta-chip date">{formatTime(displayRecord.startedAt)}</span>
      </div>
    </div>

    <!-- Step results -->
    <div class="results-steps">
      {#each displayRecord.stepResults as sr, i}
        {@const step = sr}
        <div class="result-step">
          <button class="result-step-header" on:click={() => toggleStep(sr.stepId)}>
            <span class="result-status-icon" style="color: {statusColor(sr.status)}">
              {#if sr.status === 'passed'}&#10003;{:else if sr.status === 'failed'}&#10005;{:else if sr.status === 'running'}...{:else}-{/if}
            </span>
            <span class="result-step-num">{i + 1}</span>
            {#if sr.sentRequest}
              <span class="result-method" style="color: {statusColor(sr.status === 'passed' ? 'passed' : sr.status === 'failed' ? 'failed' : '')}">{sr.sentRequest.method.slice(0, 3)}</span>
              <span class="result-url">{sr.sentRequest.url}</span>
            {:else}
              <span class="result-url">{sr.error || 'Skipped'}</span>
            {/if}
            {#if sr.response}
              <span class="result-http-code" class:ok={sr.response.status < 400} class:err={sr.response.status >= 400}>{sr.response.status}</span>
            {/if}
            {#if sr.durationMs > 0}
              <span class="result-dur">{sr.durationMs}ms</span>
            {/if}
            <span class="result-chevron" class:open={expandedStep === sr.stepId}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>

          {#if expandedStep === sr.stepId}
            <div class="result-detail">
              {#if sr.error}
                <div class="detail-section">
                  <span class="detail-label">Error</span>
                  <pre class="detail-pre error">{sr.error}</pre>
                </div>
              {/if}
              {#if sr.assertionResults.length > 0}
                <div class="detail-section">
                  <span class="detail-label">Assertions ({sr.assertionResults.filter(a => a.passed).length}/{sr.assertionResults.length})</span>
                  <div class="assertions-list">
                    {#each sr.assertionResults as ar}
                      <div class="assertion-row" class:pass={ar.passed} class:fail={!ar.passed}>
                        <span class="assertion-icon">{ar.passed ? '\u2713' : '\u2717'}</span>
                        <span class="assertion-label">{ar.label}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if sr.response}
                <div class="detail-section">
                  <span class="detail-label">Response body</span>
                  <pre class="detail-pre">{truncateBody(sr.response.body)}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="results-empty">Run the flow to see results here.</div>
  {/if}

  <!-- History -->
  {#if relevantHistory.length > 0}
    <div class="results-history">
      <span class="history-title">Run history</span>
      <div class="history-list">
        {#each relevantHistory.slice(0, 20) as rec}
          <button
            class="history-item"
            class:active={selectedRunId === rec.id}
            class:is-current={rec.id === runRecord?.id}
            on:click={() => selectRun(rec.id)}
          >
            <span class="history-status" style="color: {statusColor(rec.summary.failed > 0 ? 'failed' : 'passed')}">
              {rec.summary.failed > 0 ? '\u2717' : '\u2713'}
            </span>
            <span class="history-stats">{rec.summary.passed}/{rec.summary.total}</span>
            <span class="history-date">{formatTime(rec.startedAt)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .flow-results {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Summary */
  .results-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 14px;
    background: #FAFAFA;
    border: 1px solid #E4E4EA;
    border-radius: 8px;
  }
  .summary-stats {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stat {
    font-size: 12px;
    font-weight: 600;
  }
  .stat.passed { color: #3D8B45; }
  .stat.failed { color: #CC4455; }
  .stat.skipped { color: #999; }
  .stat.total { color: #888; font-weight: 400; }
  .summary-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .meta-chip {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    background: #F0F0F4;
    color: #777;
  }
  .meta-chip.env {
    color: #3D8B45;
    background: #3D8B4510;
    font-weight: 600;
  }

  /* Step results */
  .results-steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .result-step {
    border: 1px solid #E4E4EA;
    border-radius: 6px;
    overflow: hidden;
  }
  .result-step-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: #FAFAFA;
    color: #555;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .result-step-header:hover {
    background: #F0F0F4;
  }
  .result-status-icon {
    font-size: 11px;
    font-weight: 700;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .result-step-num {
    font-size: 10px;
    color: #AAA;
    flex-shrink: 0;
  }
  .result-method {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    min-width: 28px;
    flex-shrink: 0;
  }
  .result-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #333;
  }
  .result-http-code {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .result-http-code.ok { color: #3D8B45; background: #3D8B4510; }
  .result-http-code.err { color: #CC4455; background: #CC445510; }
  .result-dur {
    font-size: 10px;
    color: #AAA;
    flex-shrink: 0;
  }
  .result-chevron {
    display: flex;
    align-items: center;
    color: #CCC;
    transition: transform 0.15s;
    transform: rotate(0deg);
    flex-shrink: 0;
  }
  .result-chevron.open {
    transform: rotate(90deg);
  }

  /* Detail */
  .result-detail {
    padding: 8px 12px 10px;
    border-top: 1px solid #EDEDF0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .detail-label {
    font-size: 10px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .detail-pre {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    color: #444;
    background: #F6F6FA;
    border: 1px solid #EDEDF0;
    border-radius: 4px;
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    margin: 0;
  }
  .detail-pre.error {
    color: #CC4455;
    background: #CC445508;
    border-color: #CC445520;
  }
  .assertions-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .assertion-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 3px 0;
  }
  .assertion-icon {
    font-weight: 700;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .assertion-row.pass .assertion-icon { color: #3D8B45; }
  .assertion-row.fail .assertion-icon { color: #CC4455; }
  .assertion-row.pass .assertion-label { color: #555; }
  .assertion-row.fail .assertion-label { color: #CC4455; }

  /* Empty state */
  .results-empty {
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: #BBB;
    border: 1px dashed #DCDCE2;
    border-radius: 8px;
  }

  /* History */
  .results-history {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid #EDEDF0;
    padding-top: 16px;
  }
  .history-title {
    font-size: 11px;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #777;
    font-family: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition: all 0.1s;
  }
  .history-item:hover {
    background: #F0F0F4;
    color: #555;
  }
  .history-item.active {
    background: #E8E0F0;
    border-color: #8040A830;
    color: #333;
  }
  .history-item.is-current {
    font-weight: 600;
  }
  .history-status {
    font-weight: 700;
    font-size: 12px;
    flex-shrink: 0;
  }
  .history-stats {
    flex-shrink: 0;
  }
  .history-date {
    flex: 1;
    text-align: right;
    color: #AAA;
    font-size: 10px;
  }
</style>
