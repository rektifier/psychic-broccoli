<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Variable, NamedRequestResult } from '../lib/types';

  export let fileVariables: Variable[] = [];
  export let envVariables: Record<string, string> = {};
  export let namedResults: Record<string, NamedRequestResult> = {};
  export let visible: boolean = false;

  const dispatch = createEventDispatcher();

  // Flatten JSON object into dot-path entries: { "$.id": 1, "$.name": "Foo", ... }
  function flattenJson(obj: any, prefix: string = '$', maxDepth: number = 4): { path: string; value: string }[] {
    const entries: { path: string; value: string }[] = [];
    if (maxDepth <= 0 || obj == null) return entries;

    if (typeof obj !== 'object') {
      entries.push({ path: prefix, value: String(obj) });
      return entries;
    }

    if (Array.isArray(obj)) {
      // Show first 3 items
      obj.slice(0, 3).forEach((item, i) => {
        entries.push(...flattenJson(item, `${prefix}[${i}]`, maxDepth - 1));
      });
      if (obj.length > 3) {
        entries.push({ path: `${prefix}[...]`, value: `${obj.length} items` });
      }
      return entries;
    }

    for (const [key, value] of Object.entries(obj)) {
      const path = `${prefix}.${key}`;
      if (typeof value === 'object' && value !== null) {
        entries.push(...flattenJson(value, path, maxDepth - 1));
      } else {
        entries.push({ path, value: String(value ?? 'null') });
      }
    }
    return entries;
  }

  // Build response field options for each named result
  $: responseGroups = Object.entries(namedResults).map(([name, result]) => {
    let bodyFields: { path: string; value: string }[] = [];
    try {
      const parsed = JSON.parse(result.response.body);
      bodyFields = flattenJson(parsed);
    } catch {
      bodyFields = [{ path: '*', value: result.response.body.slice(0, 50) }];
    }

    const headerFields = Object.entries(result.response.headers).map(([k, v]) => ({
      path: k,
      value: String(v),
    }));

    return { name, status: result.response.status, bodyFields, headerFields };
  });

  function insertEnvVar(key: string) {
    dispatch('insert', `{{${key}}}`);
  }

  function insertResponseBody(reqName: string, path: string) {
    dispatch('insert', `{{${reqName}.response.body.${path}}}`);
  }

  function insertResponseHeader(reqName: string, headerName: string) {
    dispatch('insert', `{{${reqName}.response.headers.${headerName}}}`);
  }

  function close() {
    dispatch('close');
  }
</script>

{#if visible}
  <div class="picker-overlay" on:click|self={close}>
    <div class="picker">
      <div class="picker-header">
        <span class="picker-title">Insert variable</span>
        <button class="btn-close" on:click={close}>×</button>
      </div>

      <!-- Environment variables -->
      <div class="group-header">Environment</div>
      {#each Object.entries(envVariables) as [key, value]}
        <button class="picker-row" on:click={() => insertEnvVar(key)}>
          <span class="row-key">{key}</span>
          <span class="row-value">{value.length > 30 ? value.slice(0, 30) + '...' : value}</span>
        </button>
      {/each}
      {#each fileVariables as v}
        {#if !(v.key in envVariables)}
          <button class="picker-row" on:click={() => insertEnvVar(v.key)}>
            <span class="row-key">{v.key}</span>
            <span class="row-value">{v.value.length > 30 ? v.value.slice(0, 30) + '...' : v.value}</span>
          </button>
        {/if}
      {/each}
      {#if Object.keys(envVariables).length === 0 && fileVariables.length === 0}
        <div class="empty-hint">No environment variables</div>
      {/if}

      <!-- Dynamic variables -->
      <div class="group-header">Dynamic</div>
      <button class="picker-row" on:click={() => dispatch('insert', '{{$randomInt 1 100}}')}>
        <span class="row-key">$randomInt</span>
        <span class="row-value">random number</span>
      </button>
      <button class="picker-row" on:click={() => dispatch('insert', '{{$timestamp}}')}>
        <span class="row-key">$timestamp</span>
        <span class="row-value">unix epoch</span>
      </button>
      <button class="picker-row" on:click={() => dispatch('insert', '{{$datetime iso8601}}')}>
        <span class="row-key">$datetime</span>
        <span class="row-value">ISO 8601 date</span>
      </button>

      <!-- Response groups -->
      {#each responseGroups as group}
        <div class="group-header">
          Response body from {group.name}
          <span class="status-badge" class:success={group.status < 400} class:error={group.status >= 400}>
            {group.status}
          </span>
        </div>
        {#each group.bodyFields.slice(0, 12) as field}
          <button class="picker-row" on:click={() => insertResponseBody(group.name, field.path)}>
            <span class="row-key">{field.path}</span>
            <span class="row-value">{field.value.length > 30 ? field.value.slice(0, 30) + '...' : field.value}</span>
          </button>
        {/each}
        {#if group.bodyFields.length > 12}
          <div class="empty-hint">{group.bodyFields.length - 12} more fields...</div>
        {/if}

        <div class="group-header">Response headers from {group.name}</div>
        {#each group.headerFields as field}
          <button class="picker-row" on:click={() => insertResponseHeader(group.name, field.path)}>
            <span class="row-key">{field.path}</span>
            <span class="row-value">{field.value.length > 30 ? field.value.slice(0, 30) + '...' : field.value}</span>
          </button>
        {/each}
      {/each}

      {#if responseGroups.length === 0}
        <div class="group-header">Response references</div>
        <div class="empty-hint">Send a named request first (right-click a request → "Name this request")</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .picker-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 100;
    background: rgba(0,0,0,0.1);
  }

  .picker {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    max-height: 500px;
    overflow-y: auto;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
  }

  .picker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid #DCDCE2;
    position: sticky;
    top: 0;
    background: #FFFFFF;
    z-index: 1;
  }
  .picker-title {
    font-size: 13px;
    font-weight: 600;
    color: #1A1A2E;
  }
  .btn-close {
    width: 24px; height: 24px;
    border: none; border-radius: 4px;
    background: transparent; color: #999;
    font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-close:hover { background: #E4E4EA; color: #444; }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #999;
    background: #F0F0F4;
    border-top: 1px solid #DCDCE2;
    position: sticky;
    top: 45px;
    z-index: 1;
  }

  .status-badge {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: none;
    letter-spacing: 0;
  }
  .status-badge.success { background: #3D8B4518; color: #3D8B45; }
  .status-badge.error { background: #CC445518; color: #CC4455; }

  .picker-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    border-bottom: 1px solid #DCDCE208;
  }
  .picker-row:hover {
    background: #F0F0F4;
  }

  .row-key {
    font-family: inherit;
    color: #9A7520;
    font-weight: 500;
  }
  .row-value {
    color: #999;
    font-size: 11px;
    text-align: right;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-hint {
    padding: 8px 14px;
    font-size: 11px;
    color: #AAA;
  }
</style>
