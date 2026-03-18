<script lang="ts">
  import TreeSidebar from './components/TreeSidebar.svelte';
  import RequestEditor from './components/RequestEditor.svelte';
  import ResponseViewer from './components/ResponseViewer.svelte';
  import EnvironmentEditor from './components/EnvironmentEditor.svelte';
  import ToastContainer from './components/ToastContainer.svelte';
  import HelpModal from './components/HelpModal.svelte';
  import logoUrl from './assets/logo.png';
  import {
    workspace, selectedLocation, currentResponse, isLoading,
    activeFile, activeRequest, activeFileVariables,
    envFile, userEnvFile, activeEnvironment, availableEnvironments,
    resolvedEnvVars, namedResults, dotenvVariables,
    updateRequestInTree, addRequestToFile, deleteRequestFromFile,
    toggleFolder, markFileSaved, addToast,
  } from './lib/stores';
  import {
    serializeHttpFile, substituteAll, parseEnvironmentFile,
    buildWorkspaceTree, createFileNode, getAllFileNodes,
  } from './lib/parser';
  import type { HttpRequest, HttpResponse, SubstitutionContext, RequestLocation, EnvironmentFile, TreeNode } from './lib/types';
  import type { DiscoveredFile } from './lib/parser';

  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { join, basename } from '@tauri-apps/api/path';
  import { onDestroy } from 'svelte';

  let showEnvEditor = false;

  /** The raw request that was actually sent (resolved URLs, headers, body). */
  let sentRequest: { method: string; url: string; headers: Record<string, string>; body: string } | null = null;
  let showHelp = false;

  // ─── Resizable Panes ───

  let editorWidthPercent = 50;
  let dragging = false;
  let mainPanelsEl: HTMLDivElement;

  function onDividerDown(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    document.addEventListener('mousemove', onDividerMove);
    document.addEventListener('mouseup', onDividerUp);
  }

  function onDividerMove(e: MouseEvent) {
    if (!dragging || !mainPanelsEl) return;
    const rect = mainPanelsEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;
    editorWidthPercent = Math.max(20, Math.min(80, pct));
  }

  function onDividerUp() {
    dragging = false;
    document.removeEventListener('mousemove', onDividerMove);
    document.removeEventListener('mouseup', onDividerUp);
  }

  // ─── Resizable Sidebar ───

  let sidebarWidth = 260;
  let sidebarDragging = false;
  let layoutEl: HTMLDivElement;

  function onSidebarDividerDown(e: MouseEvent) {
    e.preventDefault();
    sidebarDragging = true;
    document.addEventListener('mousemove', onSidebarDividerMove);
    document.addEventListener('mouseup', onSidebarDividerUp);
  }

  function onSidebarDividerMove(e: MouseEvent) {
    if (!sidebarDragging || !layoutEl) return;
    const rect = layoutEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    sidebarWidth = Math.max(160, Math.min(500, x));
  }

  function onSidebarDividerUp() {
    sidebarDragging = false;
    document.removeEventListener('mousemove', onSidebarDividerMove);
    document.removeEventListener('mouseup', onSidebarDividerUp);
  }

  onDestroy(() => {
    document.removeEventListener('mousemove', onDividerMove);
    document.removeEventListener('mouseup', onDividerUp);
    document.removeEventListener('mousemove', onSidebarDividerMove);
    document.removeEventListener('mouseup', onSidebarDividerUp);
  });

  // ─── Substitution Context ───

  function getSubstitutionContext(): SubstitutionContext {
    return {
      fileVariables: $activeFileVariables,
      environmentVariables: $resolvedEnvVars,
      namedResults: $namedResults,
      dotenvVariables: $dotenvVariables,
    };
  }

  // Clear stale named results and response when environment changes
  let lastEnv: string | null = null;
  $: if ($activeEnvironment !== lastEnv) {
    if (lastEnv !== null) {
      namedResults.set({});
      currentResponse.set(null);
      sentRequest = null;
    }
    lastEnv = $activeEnvironment;
  }

  // Reactive resolved URL - all store dependencies are explicit so Svelte tracks them
  $: computedResolvedUrl = (() => {
    if (!$activeRequest || !$activeRequest.url.includes('{{')) return '';
    const resolved = substituteAll($activeRequest.url, {
      fileVariables: $activeFileVariables,
      environmentVariables: $resolvedEnvVars,
      namedResults: $namedResults,
      dotenvVariables: $dotenvVariables,
    });
    // Only show if substitution actually changed something
    return resolved !== $activeRequest.url ? resolved : '';
  })();

  // ─── Open Folder (scan for .http files) ───

  async function openFolder() {
    try {
      const rootPath = await open({ directory: true, title: 'Select workspace folder' });
      if (!rootPath) return;

      const discovered = await scanForHttpFiles(rootPath as string, rootPath as string);
      const tree = buildWorkspaceTree(discovered);
      const rootName = await basename(rootPath as string);

      workspace.set({ rootPath: rootPath as string, rootName, tree });
      selectedLocation.set(null);
      currentResponse.set(null);
      namedResults.set({});

      // Auto-discover env files from workspace root
      await tryLoadEnvFiles(rootPath as string);
    } catch (e: any) {
      addToast(`Failed to open folder: ${e.message || e}`, 'error');
    }
  }

  // ── Recursively scan a directory for .http/.rest files ──

  async function scanForHttpFiles(dir: string, rootDir: string): Promise<DiscoveredFile[]> {
    const entries = await readDir(dir);
    const results: DiscoveredFile[] = [];

    for (const entry of entries) {
      const fullPath = await join(dir, entry.name);
      if (entry.isDirectory) {
        results.push(...await scanForHttpFiles(fullPath, rootDir));
      } else if (entry.name.endsWith('.http') || entry.name.endsWith('.rest')) {
        const content = await readTextFile(fullPath);
        // Compute relative path by stripping root prefix and normalizing separators
        const relativePath = fullPath.substring(rootDir.length + 1).replaceAll('\\', '/');
        results.push({ absolutePath: fullPath, relativePath, content });
      }
    }
    return results;
  }

  // ── Auto-discover env files from workspace root ──

  async function tryLoadEnvFiles(rootDir: string) {
    try {
      const envPath = await join(rootDir, 'http-client.env.json');
      const content = await readTextFile(envPath);
      const parsed = parseEnvironmentFile(content);
      if (parsed) {
        envFile.set(parsed);
        const names = Object.keys(parsed).filter(k => k !== '$shared');
        if (names.length > 0 && !$activeEnvironment) activeEnvironment.set(names[0]);
      }
    } catch { /* file doesn't exist */ }

    try {
      const userPath = await join(rootDir, 'http-client.env.json.user');
      const content = await readTextFile(userPath);
      const parsed = parseEnvironmentFile(content);
      if (parsed) userEnvFile.set(parsed);
    } catch { /* file doesn't exist */ }
  }

  // ─── Save File ───

  function findFileInTree(nodes: TreeNode[], path: string): any {
    for (const n of nodes) {
      if (n.type === 'file' && n.path === path) return n;
      if (n.type === 'folder') { const f = findFileInTree(n.children, path); if (f) return f; }
    }
    return null;
  }

  async function saveActiveFile() {
    const file = $activeFile;
    if (!file || !file.dirty) return;

    try {
      const content = serializeHttpFile(file.requests, file.variables);
      await writeTextFile(file.path, content);
      markFileSaved(file.path);
    } catch (e: any) {
      addToast(`Failed to save file: ${e.message || e}`, 'error');
    }
  }

  // ─── Save Environment File ───

  async function saveEnvFile(data: EnvironmentFile) {
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;
    try {
      const envPath = await join(rootPath, 'http-client.env.json');
      await writeTextFile(envPath, JSON.stringify(data, null, 2));
    } catch (e: any) {
      addToast(`Failed to save environment file: ${e.message || e}`, 'error');
    }
  }

  // ─── Send Request ───

  async function sendRequest(request: HttpRequest) {
    isLoading.set(true);
    currentResponse.set(null);
    sentRequest = null;

    const ctx = getSubstitutionContext();
    const startTime = performance.now();

    try {
      const url = substituteAll(request.url, ctx);
      const body = substituteAll(request.body, ctx);
      const headers: Record<string, string> = {};
      for (const h of request.headers) {
        if (h.enabled) {
          headers[substituteAll(h.key, ctx)] = substituteAll(h.value, ctx);
        }
      }

      sentRequest = { method: request.method, url, headers, body };

      const res: { status: number; status_text: string; headers: Record<string, string>; body: string } =
        await invoke('http_request', {
          payload: {
            method: request.method,
            url,
            headers,
            body: ['GET','HEAD','OPTIONS'].includes(request.method) ? null : body || null,
          },
        });

      const elapsed = performance.now() - startTime;

      const response: HttpResponse = {
        status: res.status,
        statusText: res.status_text,
        headers: res.headers,
        body: res.body,
        time: Math.round(elapsed),
        size: new TextEncoder().encode(res.body).length,
      };
      currentResponse.set(response);

      if (request.varName) {
        namedResults.update(nr => ({
          ...nr,
          [request.varName!]: {
            request: { url, method: request.method, headers, body },
            response,
          },
        }));
      }
    } catch (e: any) {
      currentResponse.set({
        status: 0, statusText: 'Error', headers: {},
        body: e.message || 'Request failed.', time: Math.round(performance.now() - startTime), size: 0,
      });
    } finally {
      isLoading.set(false);
    }
  }

  // ─── Event Handlers ───

  function handleSelect(e: CustomEvent<RequestLocation>) {
    if (showEnvEditor && $envFile) {
      saveEnvFile($envFile);
      showEnvEditor = false;
    }
    selectedLocation.set(e.detail);
    currentResponse.set(null);
  }

  function handleUpdateRequest(e: CustomEvent<HttpRequest>) {
    if (!$selectedLocation) return;
    updateRequestInTree($selectedLocation.filePath, $selectedLocation.requestIndex, e.detail);
  }

  function handleAddRequest(e: CustomEvent<string>) {
    addRequestToFile(e.detail);
  }

  function handleDeleteRequest(e: CustomEvent<{ filePath: string; requestIndex: number }>) {
    deleteRequestFromFile(e.detail.filePath, e.detail.requestIndex);
  }

  function handleToggleFolder(e: CustomEvent<string>) {
    toggleFolder(e.detail);
  }

  function handleAddEnv(e: CustomEvent<string>) {
    const name = e.detail;
    envFile.update(ef => {
      const current = ef ?? {};
      return { ...current, [name]: {} };
    });
    activeEnvironment.set(name);
  }

  async function handleRunAll(e: CustomEvent<string[]>) {
    const depNames = e.detail;
    const allFiles = getAllFileNodes($workspace.tree);
    for (const name of depNames) {
      if ($namedResults[name]) continue;
      for (const file of allFiles) {
        const req = file.requests.find(r => r.varName === name);
        if (req) {
          await sendRequest(req);
          break;
        }
      }
    }
  }

  function handleNameRequest(e: CustomEvent<{ filePath: string; requestIndex: number; varName: string }>) {
    const { filePath, requestIndex, varName } = e.detail;
    const file = findFileInTree($workspace.tree, filePath);
    if (!file) return;
    const req = file.requests[requestIndex];
    if (!req) return;
    // Remove old name from namedResults if it changed or was cleared
    if (req.varName && req.varName !== varName) {
      namedResults.update(nr => {
        const updated = { ...nr };
        delete updated[req.varName!];
        return updated;
      });
    }
    updateRequestInTree(filePath, requestIndex, { ...req, varName: varName || null });
  }
</script>

<ToastContainer />
<HelpModal visible={showHelp} on:close={() => showHelp = false} />

<main class="app">
  <div class="titlebar" data-tauri-drag-region>
    <button class="help-btn" on:click={() => showHelp = true}>?</button>
  </div>

  <div class="layout" bind:this={layoutEl} class:sidebar-dragging={sidebarDragging}>
    <div class="sidebar-container" style="width: {sidebarWidth}px; min-width: {sidebarWidth}px">
      <TreeSidebar
        tree={$workspace.tree}
        selected={$selectedLocation}
        rootName={$workspace.rootName}
        environments={$availableEnvironments}
        activeEnv={$activeEnvironment}
        on:openFolder={openFolder}
        on:select={handleSelect}
        on:toggleFolder={handleToggleFolder}
        on:addRequest={handleAddRequest}
        on:deleteRequest={handleDeleteRequest}
        on:changeEnv={(e) => activeEnvironment.set(e.detail)}
        on:addEnv={handleAddEnv}
        on:editEnv={() => showEnvEditor = true}
        on:nameRequest={handleNameRequest}
      />
    </div>
    <div class="sidebar-divider" on:mousedown={onSidebarDividerDown} role="separator"></div>

    <div class="main-panels" bind:this={mainPanelsEl} class:dragging>
      {#if showEnvEditor && $envFile && $activeEnvironment}
        <div class="env-editor-pane">
          <EnvironmentEditor
            envFile={$envFile}
            activeEnv={$activeEnvironment}
            on:update={(e) => {
              envFile.set(e.detail);
              saveEnvFile(e.detail);
            }}
            on:changeEnv={(e) => activeEnvironment.set(e.detail)}
            on:close={() => showEnvEditor = false}
          />
        </div>
      {:else if $activeRequest && $selectedLocation}
        <div class="editor-pane" style="flex: 0 0 {editorWidthPercent}%">
          <RequestEditor
            request={$activeRequest}
            loading={$isLoading}
            dirty={$activeFile?.dirty ?? false}
            resolvedUrl={computedResolvedUrl}
            fileVariables={$activeFileVariables}
            envVariables={$resolvedEnvVars}
            namedResults={$namedResults}
            on:update={handleUpdateRequest}
            on:send={(e) => sendRequest(e.detail)}
            on:save={saveActiveFile}
            on:runAll={handleRunAll}
          />
        </div>
        <div class="divider" on:mousedown={onDividerDown} role="separator"></div>
        <div class="response-pane">
          <ResponseViewer response={$currentResponse} loading={$isLoading} {sentRequest} />
        </div>
      {:else}
        <div class="no-selection">
          <img class="no-sel-logo" src={logoUrl} alt="Psychic Broccoli" />
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  :global(*) {
    margin: 0; padding: 0; box-sizing: border-box;
  }
  :global(body) {
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    background: #F8F8FA; color: #333340;
    overflow: hidden; font-size: 13px;
  }

  .app {
    display: flex; flex-direction: column;
    height: 100vh; background: #F8F8FA;
  }

  .titlebar {
    display: flex; justify-content: space-between; align-items: center;
    height: 28px;
    background: #F0F0F4; border-bottom: 1px solid #DCDCE2;
    -webkit-app-region: drag; user-select: none; flex-shrink: 0;
  }
  .help-btn {
    -webkit-app-region: no-drag;
    width: 20px; height: 20px;
    margin-left: auto;
    margin-right: 8px;
    border: 1px solid #D4D4D8;
    border-radius: 50%;
    background: transparent;
    color: #999;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.1s;
  }
  .help-btn:hover { background: #E4E4EA; color: #555; border-color: #BBB; }
  .layout { display: flex; flex: 1; overflow: hidden; }

  .sidebar-container {
    display: flex; flex-direction: column;
    background: #F0F0F4;
    flex-shrink: 0; overflow: hidden;
  }

  .sidebar-divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: #DCDCE2;
    transition: background 0.15s;
  }
  .sidebar-divider:hover, .sidebar-dragging .sidebar-divider {
    background: #D4900A;
  }
  .sidebar-dragging { cursor: col-resize; user-select: none; }

  .main-panels { flex: 1; display: flex; flex-direction: row; overflow: hidden; }
  .main-panels.dragging { cursor: col-resize; user-select: none; }
  .editor-pane { overflow: auto; min-width: 0; }
  .response-pane { flex: 1; overflow: auto; min-width: 0; }

  .divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: #DCDCE2;
    transition: background 0.15s;
  }
  .divider:hover, .dragging .divider {
    background: #D4900A;
  }
  .env-editor-pane { flex: 1; overflow: auto; }

  .no-selection {
    flex: 1; display: flex;
    align-items: center; justify-content: center;
  }
  .no-sel-logo { width: 360px; height: 360px; object-fit: contain; opacity: 0.12; }
</style>
