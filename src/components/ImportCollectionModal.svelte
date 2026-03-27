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
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 100;
    background: rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #DCDCE2;
  }
  .modal-title {
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

  .modal-body {
    padding: 14px 16px;
  }

  /* Drop zone */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 28px 20px;
    border: 2px dashed #D4D4D8;
    border-radius: 10px;
    transition: all 0.2s;
    background: transparent;
  }
  .drop-zone.drag-over {
    border-color: #D4900A;
    background: rgba(212, 144, 10, 0.04);
  }
  .drop-icon {
    color: #BBB;
    transition: color 0.2s;
  }
  .drag-over .drop-icon {
    color: #D4900A;
  }
  .drop-text {
    font-size: 13px;
    color: #888;
  }
  .drop-or {
    font-size: 11px;
    color: #BBB;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .btn-browse {
    padding: 6px 16px;
    border: 1px solid #D4900A40;
    border-radius: 6px;
    background: rgba(212, 144, 10, 0.06);
    color: #D4900A;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-browse:hover {
    background: rgba(212, 144, 10, 0.12);
    border-color: #D4900A;
  }

  .supported-formats {
    margin-top: 10px;
    font-size: 11px;
    color: #999;
    text-align: center;
    line-height: 1.4;
  }

  /* File indicator */
  .file-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid #D4D4D8;
    border-radius: 8px;
    background: #FAFAFA;
  }
  .file-icon {
    color: #999;
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
    font-size: 12px;
    font-weight: 600;
    color: #333340;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-size {
    font-size: 10px;
    color: #999;
  }
  .format-badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(212, 144, 10, 0.1);
    color: #D4900A;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
  }
  .btn-clear {
    width: 22px; height: 22px;
    border: none; border-radius: 4px;
    background: transparent; color: #BBB;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-clear:hover { background: #E4E4EA; color: #666; }

  /* Mode switch */
  .mode-switch {
    display: block;
    margin-top: 12px;
    padding: 0;
    border: none;
    background: none;
    color: #999;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: all 0.15s;
  }
  .mode-switch:hover {
    color: #D4900A;
    text-decoration-color: #D4900A;
  }

  /* URL mode */
  .description {
    font-size: 12px;
    color: #555;
    line-height: 1.5;
    margin-bottom: 10px;
  }
  .url-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: #FFFFFF;
    color: #333340;
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .url-input:focus { border-color: #D4900A; }
  .url-input:disabled { opacity: 0.6; }

  /* Error */
  .error-message {
    margin-top: 8px;
    font-size: 11px;
    color: #D32F2F;
    line-height: 1.4;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #DCDCE2;
  }
  .btn-cancel {
    padding: 6px 14px;
    border: 1px solid #D4D4D8;
    border-radius: 6px;
    background: transparent;
    color: #666;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-cancel:hover { border-color: #999; color: #333; }
  .btn-cancel:disabled { opacity: 0.5; cursor: default; }
  .btn-confirm {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: #D4900A;
    color: #FFFFFF;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-confirm:hover { background: #C07D08; }
  .btn-confirm:disabled { opacity: 0.5; cursor: default; }
</style>
