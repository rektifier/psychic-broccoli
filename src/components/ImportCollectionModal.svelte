<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile } from '@tauri-apps/plugin-fs';
  import { basename } from '@tauri-apps/api/path';
  import { detectImportFormat, formatLabel, type ImportFormat } from '../lib/detect';

  export let visible: boolean = false;

  const dispatch = createEventDispatcher<{
    importFile: { content: string; format: ImportFormat };
    importUrl: { content: string };
    cancel: void;
  }>();

  const VALID_EXTENSIONS = ['json', 'yaml', 'yml'];

  let mode: 'file' | 'url' = 'file';
  let selectedFile: { name: string; size: string; content: string } | null = null;
  let detectedFormat: ImportFormat | null = null;
  let detectionError = '';
  let isDragOver = false;
  let dragDepth = 0;
  let error = '';

  // URL mode state
  let url = '';
  let urlLoading = false;
  let urlError = '';

  // HTML5 drag-drop handlers for the drop zone
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth++;
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      isDragOver = false;
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
    dragDepth = 0;
    error = '';
    detectionError = '';

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!hasValidExtension(file.name)) {
      error = 'Unsupported file type. Please drop a .json, .yaml, or .yml file.';
      return;
    }

    try {
      const content = await file.text();
      loadFileContent(file.name, content);
      if (detectedFormat) {
        doImport();
      }
    } catch (e: any) {
      error = `Failed to read dropped file: ${e.message || e}`;
    }
  }

  // Reset state when modal opens
  $: if (visible) {
    mode = 'file';
    selectedFile = null;
    detectedFormat = null;
    detectionError = '';
    isDragOver = false;
    dragDepth = 0;
    error = '';
    url = '';
    urlLoading = false;
    urlError = '';
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function hasValidExtension(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return VALID_EXTENSIONS.includes(ext);
  }

  function loadFileContent(name: string, content: string) {
    const size = formatFileSize(new TextEncoder().encode(content).length);
    const format = detectImportFormat(content);
    selectedFile = { name, size, content };
    detectedFormat = format;

    if (!format) {
      detectionError = 'Could not determine format. Ensure this is a Postman Collection, Insomnia Export, or OpenAPI spec.';
    }
  }

  // Drag-drop is handled by Tauri's onDragDropEvent listener above

  async function browseFile() {
    const filePath = await open({
      title: 'Import Collection',
      filters: [
        { name: 'API Collections', extensions: ['json', 'yaml', 'yml'] },
      ],
    });
    if (!filePath) return;

    error = '';
    detectionError = '';

    try {
      const content = await readTextFile(filePath as string);
      const name = await basename(filePath as string);
      loadFileContent(name, content);
    } catch (e: any) {
      error = `Failed to read file: ${e.message || e}`;
    }
  }

  function clearFile() {
    selectedFile = null;
    detectedFormat = null;
    detectionError = '';
    error = '';
  }

  function doImport() {
    if (!selectedFile || !detectedFormat) return;
    dispatch('importFile', { content: selectedFile.content, format: detectedFormat });
  }

  // URL mode
  async function fetchSpec() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      urlError = 'URL must start with http:// or https://';
      return;
    }

    urlLoading = true;
    urlError = '';

    try {
      const res: { status: number; status_text: string; headers: Record<string, string>; body: string } =
        await invoke('http_request', {
          payload: {
            method: 'GET',
            url: trimmedUrl,
            headers: { 'Accept': 'application/json, application/yaml, text/yaml, */*' },
            body: null,
          },
        });

      if (res.status >= 400) {
        urlError = `Server returned ${res.status} ${res.status_text}`;
        return;
      }

      dispatch('importUrl', { content: res.body });
    } catch (e: any) {
      urlError = typeof e === 'string' ? e : e.message || 'Failed to fetch spec';
    } finally {
      urlLoading = false;
    }
  }

  function cancel() {
    dispatch('cancel');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window
  on:keydown={visible ? handleKeydown : undefined}
/>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" on:click|self={cancel} role="dialog" tabindex="-1">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Import Collection</span>
        <button class="btn-close" on:click={cancel}>&times;</button>
      </div>

      <div class="modal-body">
        {#if mode === 'file'}
          {#if !selectedFile}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="drop-zone"
              class:drag-over={isDragOver}
              on:dragenter={handleDragEnter}
              on:dragleave={handleDragLeave}
              on:dragover={handleDragOver}
              on:drop={handleDrop}
            >
              <svg class="drop-icon" width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 4v16M10 14l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 22v3a2 2 0 002 2h16a2 2 0 002-2v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="drop-text">Drop a collection file here</span>
              <span class="drop-or">or</span>
              <button class="btn-browse" on:click={browseFile}>Browse files</button>
            </div>
            <p class="supported-formats">
              Supports Postman, Insomnia, and OpenAPI / Swagger (.json, .yaml, .yml)
            </p>
          {:else}
            <div class="file-indicator">
              <svg class="file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3"/>
                <path d="M9 1v4h4" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <div class="file-details">
                <span class="file-name">{selectedFile.name}</span>
                <span class="file-size">{selectedFile.size}</span>
              </div>
              {#if detectedFormat}
                <span class="format-badge">{formatLabel(detectedFormat)}</span>
              {/if}
              <button class="btn-clear" on:click={clearFile} title="Remove file">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>

            {#if detectionError}
              <p class="error-message">{detectionError}</p>
            {/if}
          {/if}

          {#if error}
            <p class="error-message">{error}</p>
          {/if}

          <button class="mode-switch" on:click={() => { mode = 'url'; clearFile(); }}>
            Import from URL instead
          </button>
        {:else}
          <p class="description">
            Enter the URL of an OpenAPI or Swagger specification (JSON or YAML).
          </p>

          <input
            class="url-input"
            bind:value={url}
            placeholder="https://petstore.swagger.io/v2/swagger.json"
            disabled={urlLoading}
            on:keydown={(e) => { if (e.key === 'Enter') fetchSpec(); }}
          />

          {#if urlError}
            <p class="error-message">{urlError}</p>
          {/if}

          <button class="mode-switch" on:click={() => { mode = 'file'; urlError = ''; }}>
            Import from file instead
          </button>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" on:click={cancel} disabled={urlLoading}>Cancel</button>
        {#if mode === 'file'}
          <button class="btn-confirm" on:click={doImport} disabled={!selectedFile || !detectedFormat}>
            Import
          </button>
        {:else}
          <button class="btn-confirm" on:click={fetchSpec} disabled={urlLoading || !url.trim()}>
            {#if urlLoading}
              Fetching...
            {:else}
              Fetch & Import
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Modal base from shared.css; only overrides here */
  .modal {
    width: 480px;
  }

  /* Drop zone */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-7) var(--space-5);
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-xl);
    transition: all var(--duration-slow);
    background: transparent;
  }
  .drop-zone.drag-over {
    border-color: var(--color-primary);
    background: var(--color-primary-subtle);
  }
  .drop-icon {
    color: var(--color-text-placeholder);
    transition: color var(--duration-slow);
  }
  .drag-over .drop-icon {
    color: var(--color-primary);
  }
  .drop-text {
    font-size: var(--text-md);
    color: var(--slate-350);
  }
  .drop-or {
    font-size: var(--text-sm);
    color: var(--color-text-placeholder);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .btn-browse {
    padding: var(--space-1\.5) var(--space-4);
    border: 1px solid rgba(212, 144, 10, 0.25);
    border-radius: var(--radius-default);
    background: var(--color-primary-subtle);
    color: var(--color-primary);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-browse:hover {
    background: rgba(212, 144, 10, 0.12);
    border-color: var(--color-primary);
  }

  .supported-formats {
    margin-top: var(--space-2\.5);
    font-size: var(--text-sm);
    color: var(--color-text-faint);
    text-align: center;
    line-height: var(--leading-normal);
  }

  /* File indicator */
  .file-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2\.5) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--gray-15);
  }
  .file-icon {
    color: var(--color-text-faint);
    flex-shrink: 0;
  }
  .file-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .file-name {
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-size {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
  }
  .format-badge {
    flex-shrink: 0;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background: rgba(212, 144, 10, 0.1);
    color: var(--color-primary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
  .btn-clear {
    width: 22px; height: 22px;
    border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--color-text-placeholder);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-normal);
  }
  .btn-clear:hover { background: var(--color-bg-muted); color: var(--slate-450); }

  /* Mode switch */
  .mode-switch {
    display: block;
    margin-top: var(--space-3);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-faint);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: all var(--duration-normal);
  }
  .mode-switch:hover {
    color: var(--color-primary);
    text-decoration-color: var(--color-primary);
  }

  /* URL mode */
  .description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin-bottom: var(--space-2\.5);
  }
  .url-input {
    width: 100%;
    padding: var(--space-2) var(--space-2\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
  }
  .url-input:focus { border-color: var(--color-primary); }
  .url-input:disabled { opacity: 0.6; }

  /* Error */
  .error-message {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: #D32F2F;
    line-height: var(--leading-normal);
  }

  /* Footer buttons */
  .btn-cancel {
    padding: var(--space-1\.5) var(--space-3\.5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: transparent;
    color: var(--slate-450);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition: all var(--duration-normal);
  }
  .btn-cancel:hover { border-color: var(--color-text-faint); color: var(--color-text); }
  .btn-cancel:disabled { opacity: 0.5; cursor: default; }
  .btn-confirm {
    padding: var(--space-1\.5) var(--space-3\.5);
    border: none;
    border-radius: var(--radius-default);
    background: var(--color-primary);
    color: var(--color-primary-fg);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    transition: background var(--duration-normal);
  }
  .btn-confirm:hover { background: var(--color-primary-active); }
  .btn-confirm:disabled { opacity: 0.5; cursor: default; }
</style>
