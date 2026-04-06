<script lang="ts">
  import TreeSidebar from './components/TreeSidebar.svelte';
  import RequestEditor from './components/RequestEditor.svelte';
  import ResponseViewer from './components/ResponseViewer.svelte';
  import EnvironmentEditor from './components/EnvironmentEditor.svelte';
  import ToastContainer from './components/ToastContainer.svelte';
  import HelpModal from './components/HelpModal.svelte';
  import VariableInspector from './components/VariableInspector.svelte';
  import ImportEnvModal from './components/ImportEnvModal.svelte';
  import ImportCollectionModal from './components/ImportCollectionModal.svelte';
  import type { ImportFormat } from './lib/detect';
  import TabBar from './components/TabBar.svelte';
  import FlowEditor from './components/FlowEditor.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import { loadTheme, setTheme, type ThemeId } from './lib/theme';
  import logoUrl from './assets/logo.png';
  import {
    workspace, selectedLocation, currentResponse, isLoading,
    activeFile, activeRequest, activeFileVariables,
    envFile, userEnvFile, activeEnvironment, availableEnvironments,
    resolvedEnvVars, pbFileOverrides, activeFileOverrides, namedResults, dotenvVariables,
    pbAssertionResults, pbGlobals,
    keyVaultState, kvConflictPrefs,
    updateRequestInTree, addRequestToFile, deleteRequestFromFile, removeFileFromTree,
    toggleFolder, markFileSaved, addToast,
    tabs, isPreview, pinTab, activateTab, closeTab, previewRequest,
    cacheCurrentTabResponse, currentSentRequest, setTabBottomTab, setTabResponseTab,
    flows, flowRunHistory, flowRunState, flowTabs, activeFlowTabPath,
    openFlowTab, closeFlowTab, activateFlowTab, activeFlowPath, activeFlow,
  } from './lib/stores';
  import { extractKeyVaultConfig, fetchKeyVaultSecrets, kvCacheKey } from './lib/keyvault';
  import {
    serializeHttpFile, substituteAll, parseEnvironmentFile,
    buildWorkspaceTree, createFileNode, getAllFileNodes,
    executePbDirectives, parseScriptText, applyRequestMutations,
  } from './lib/parser';
  import type { SubstitutionContext } from './lib/parser';
  import { importPostmanCollection } from './lib/postman';
  import { importInsomniaExport } from './lib/insomnia';
  import { importOpenApiSpec } from './lib/openapi';
  import type { HttpRequest, HttpResponse, RequestLocation, EnvironmentFile, TreeNode, ImportResult, PbAssertionResult, KeyVaultState } from './lib/types';
  import type { BottomTab, ResponseTab } from './lib/stores';
  import type { DiscoveredFile } from './lib/parser';
  import { scanForFlowFiles, loadFlowHistory, saveFlowRunRecord, clearFlowRunHistory, FLOWS_DIR } from './lib/flowIO';
  import { runFlow } from './lib/flowRunner';
  import type { FlowStepResult, FlowRunRecord } from './lib/types';

  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { join, basename, dirname } from '@tauri-apps/api/path';
  import { onDestroy } from 'svelte';

  let showEnvEditor = false;
  let showVarInspector = false;

  let showHelp = false;

  // ─── Theme / Settings ───
  let currentTheme: ThemeId = 'default';
  let showSettings = false;
  loadTheme().then(t => currentTheme = t);

  // ─── Import Collection Modal ───
  let showImportCollectionModal = false;

  // ─── Import Environment Modal ───
  let showImportEnvModal = false;
  let pendingImportVars: import('./lib/types').Variable[] = [];

  async function handleImportEnvConfirm(e: CustomEvent<{ target: string }>) {
    showImportEnvModal = false;
    const envName = e.detail.target;
    const rootPath = $workspace.rootPath;
    if (!rootPath || pendingImportVars.length === 0) return;

    try {
      // Load or create the env file
      let currentEnv: EnvironmentFile = $envFile ?? {};

      // Ensure the target environment exists
      if (!currentEnv[envName]) {
        currentEnv[envName] = {};
      }

      // Add discovered variables with their values (only if not already present)
      for (const v of pendingImportVars) {
        if (!(v.key in currentEnv[envName])) {
          (currentEnv[envName] as Record<string, string>)[v.key] = v.value;
        }
      }

      // Write the env file
      const envPath = await join(rootPath, 'http-client.env.json');
      await writeTextFile(envPath, JSON.stringify(currentEnv, null, 2));

      // Update stores
      envFile.set(currentEnv);
      if (!$activeEnvironment) {
        activeEnvironment.set(envName);
      }

      addToast(`Added ${pendingImportVars.length} variable${pendingImportVars.length !== 1 ? 's' : ''} to "${envName}" environment.`, 'info');
    } catch (e: any) {
      addToast(`Failed to update environment file: ${e.message || e}`, 'error');
    }

    pendingImportVars = [];
  }

  function handleImportEnvSkip() {
    showImportEnvModal = false;
    pendingImportVars = [];
  }

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

  // ─── Key Vault ───

  let lastKvEnv: string | null = null;
  let kvFetchSeq = 0;
  /** Per-environment KV cache - persists across env switches, cleared on folder change. */
  let kvCache: Record<string, KeyVaultState> = {};
  const idleKv: KeyVaultState = { status: 'idle', variables: {}, error: null, cacheKey: null };

  async function refreshKeyVaultSecrets(forEnv?: string) {
    const env = forEnv ?? $activeEnvironment;
    if (!env) {
      keyVaultState.set(idleKv);
      return;
    }

    const config = extractKeyVaultConfig(env, $envFile, $userEnvFile);
    if (!config) {
      // No KV config for this env - restore idle but keep cache for other envs
      keyVaultState.set(idleKv);
      return;
    }

    const newCacheKey = kvCacheKey(env, config);

    // Check per-env cache first
    const cached = kvCache[newCacheKey];
    if (cached && cached.status === 'loaded') {
      keyVaultState.set(cached);
      return;
    }

    // Only clear conflict preferences when switching environments
    if (lastKvEnv !== env) {
      kvConflictPrefs.set({});
    }
    lastKvEnv = env;

    const seq = ++kvFetchSeq;
    keyVaultState.set({ status: 'loading', variables: {}, error: null, cacheKey: newCacheKey });

    try {
      const vars = await fetchKeyVaultSecrets(config);
      if (kvFetchSeq === seq) {
        const state: KeyVaultState = { status: 'loaded', variables: vars, error: null, cacheKey: newCacheKey };
        kvCache[newCacheKey] = state;
        kvCache = kvCache;
        keyVaultState.set(state);
      }
    } catch (err: unknown) {
      if (kvFetchSeq === seq) {
        const msg = err instanceof Error ? err.message : String(err);
        const state: KeyVaultState = { status: 'error', variables: {}, error: msg, cacheKey: newCacheKey };
        keyVaultState.set(state);
        addToast(`Key Vault error: ${msg}`, 'error');
      }
    }
  }

  const unsubKv = activeEnvironment.subscribe(() => {
    refreshKeyVaultSecrets();
  });

  onDestroy(() => {
    unsubKv();
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
      currentSentRequest.set(null);
    }
    lastEnv = $activeEnvironment;
  }

  // Active tab's section tab (Body/Assertions) for pinned tabs
  $: activeBottomTab = (() => {
    const key = $tabs.length > 0 && $selectedLocation
      ? `${$selectedLocation.filePath}::${$selectedLocation.requestIndex}`
      : null;
    if (!key) return 'body' as BottomTab;
    const tab = $tabs.find(t => `${t.location.filePath}::${t.location.requestIndex}` === key);
    return tab?.bottomTab ?? 'body' as BottomTab;
  })();

  function handleBottomTabChange(e: CustomEvent<BottomTab>) {
    if ($selectedLocation) {
      setTabBottomTab($selectedLocation, e.detail);
    }
  }

  // Active response tab (Body/Headers/Request/Assertions) for pinned tabs
  $: activeResponseTab = (() => {
    const key = $tabs.length > 0 && $selectedLocation
      ? `${$selectedLocation.filePath}::${$selectedLocation.requestIndex}`
      : null;
    if (!key) return 'body' as ResponseTab;
    const tab = $tabs.find(t => `${t.location.filePath}::${t.location.requestIndex}` === key);
    return tab?.responseTab ?? 'body' as ResponseTab;
  })();

  function handleResponseTabChange(e: CustomEvent<ResponseTab>) {
    if ($selectedLocation) {
      setTabResponseTab($selectedLocation, e.detail);
    }
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

  async function openFolderByPath(rootPath: string) {
    const discovered = await scanForHttpFiles(rootPath, rootPath);
    const tree = buildWorkspaceTree(discovered);
    const rootName = await basename(rootPath);

    workspace.set({ rootPath, rootName, tree });
    selectedLocation.set(null);
    currentResponse.set(null);
    namedResults.set({});
    tabs.set([]);
    currentSentRequest.set(null);

    // Reset environment state before loading new env files
    envFile.set(null);
    userEnvFile.set(null);
    kvCache = {};
    activeEnvironment.set(null);

    // Auto-discover env files from workspace root
    await tryLoadEnvFiles(rootPath);

    // Discover test flows and load run history
    try {
      const discoveredFlows = await scanForFlowFiles(rootPath, rootPath);
      const flowMap: Record<string, import('./lib/types').FlowDefinition> = {};
      for (const df of discoveredFlows) {
        flowMap[df.relativePath] = df.flow;
      }
      flows.set(flowMap);
    } catch { /* no flows yet */ }

    try {
      const history = await loadFlowHistory(rootPath);
      flowRunHistory.set(history);
    } catch { /* no history yet */ }

    // Reset flow tabs
    flowTabs.set([]);
    activeFlowTabPath.set(null);
  }

  async function openFolder() {
    try {
      const rootPath = await open({ directory: true, title: 'Select workspace folder' });
      if (!rootPath) return;
      await openFolderByPath(rootPath as string);
    } catch (e: any) {
      addToast(`Failed to open folder: ${e.message || e}`, 'error');
    }
  }

  async function openGettingStarted() {
    try {
      const path = await invoke<string>('extract_getting_started');
      await openFolderByPath(path);
    } catch (e: any) {
      addToast(`Failed to open getting-started folder: ${e.message || e}`, 'error');
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

    refreshKeyVaultSecrets();
  }

  // ─── Import Collections ───

  /** Validate and join a relative path onto a root, preventing directory traversal. */
  async function safeJoinPath(rootPath: string, relativePath: string): Promise<string> {
    for (const seg of relativePath.split('/')) {
      if (!seg || seg === '..' || seg === '.' || seg.includes('\0') || seg.includes('\\') || seg.includes('/')) {
        throw new Error(`Invalid path segment: "${seg}"`);
      }
    }
    return join(rootPath, relativePath);
  }

  async function writeImportedFiles(result: ImportResult): Promise<number> {
    const rootPath = $workspace.rootPath!;
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    let written = 0;
    for (const file of result.files) {
      const outPath = await safeJoinPath(rootPath, file.relativePath);
      const parentDir = await dirname(outPath);
      try {
        await mkdir(parentDir, { recursive: true });
      } catch { /* already exists */ }
      await writeTextFile(outPath, file.content);
      written++;
    }

    // Refresh workspace tree
    const discovered = await scanForHttpFiles(rootPath, rootPath);
    const tree = buildWorkspaceTree(discovered);
    const rootName = await basename(rootPath);
    workspace.set({ rootPath, rootName, tree });

    return written;
  }

  /** After writing files, show the env modal if there are discovered variables. */
  function showEnvModalIfNeeded(result: ImportResult) {
    if (result.discoveredVariables.length > 0) {
      pendingImportVars = result.discoveredVariables;
      showImportEnvModal = true;
    }
  }

  async function handleImportFile(e: CustomEvent<{ content: string; format: ImportFormat }>) {
    showImportCollectionModal = false;
    const { content, format } = e.detail;

    if (!$workspace.rootPath) {
      addToast('Open a workspace folder first before importing.', 'error');
      return;
    }

    try {
      let result: ImportResult;
      switch (format) {
        case 'postman': result = importPostmanCollection(content); break;
        case 'insomnia': result = importInsomniaExport(content); break;
        case 'openapi': result = importOpenApiSpec(content); break;
      }
      const written = await writeImportedFiles(result);
      addToast(`Imported ${written} file${written !== 1 ? 's' : ''} from "${result.collectionName}".`, 'info');
      showEnvModalIfNeeded(result);
    } catch (e: any) {
      addToast(`Import failed: ${e.message || e}`, 'error');
    }
  }

  async function handleImportUrl(e: CustomEvent<{ content: string }>) {
    showImportCollectionModal = false;

    if (!$workspace.rootPath) {
      addToast('Open a workspace folder first before importing.', 'error');
      return;
    }

    try {
      const result = importOpenApiSpec(e.detail.content);
      const written = await writeImportedFiles(result);
      addToast(`Imported ${written} file${written !== 1 ? 's' : ''} from "${result.collectionName}".`, 'info');
      showEnvModalIfNeeded(result);
    } catch (e: any) {
      addToast(`Import failed: ${e.message || e}`, 'error');
    }
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
    pbAssertionResults.set([]);
    currentSentRequest.set(null);

    const ctx = getSubstitutionContext();
    const startTime = performance.now();

    try {
      let url = substituteAll(request.url, ctx);
      let body = substituteAll(request.body, ctx);
      let headers: Record<string, string> = {};
      for (const h of request.headers) {
        if (h.enabled) {
          headers[substituteAll(h.key, ctx)] = substituteAll(h.value, ctx);
        }
      }

      // ── Execute beforeSend scripts ──
      const beforeSendDirectives = parseScriptText(request.beforeSend ?? '');
      if (beforeSendDirectives.length > 0) {
        const mergedVars: Record<string, string> = { ...$resolvedEnvVars, ...$pbGlobals };
        for (const v of $activeFileVariables) mergedVars[v.key] = v.value;

        const dummyResponse = { status: 0, statusText: '', headers: {}, body: '', time: 0, size: 0 };
        const bsResult = executePbDirectives(
          beforeSendDirectives, dummyResponse,
          { url, method: request.method, headers, body },
          mergedVars, $namedResults,
        );

        // Apply request mutations
        const mutated = applyRequestMutations(
          { url, method: request.method, headers, body },
          bsResult.requestMutations,
        );
        url = mutated.url;
        headers = mutated.headers;
        body = mutated.body;

        // Apply set vars from beforeSend (file-scoped)
        if (Object.keys(bsResult.setVars).length > 0) {
          const filePath = $selectedLocation!.filePath;
          pbFileOverrides.update(ev => ({
            ...ev,
            [filePath]: { ...(ev[filePath] ?? {}), ...bsResult.setVars },
          }));
        }
        if (Object.keys(bsResult.globalVars).length > 0) {
          pbGlobals.update(g => ({ ...g, ...bsResult.globalVars }));
        }
      }

      currentSentRequest.set({ method: request.method, url, headers, body });

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

      // ── Execute pb directives + afterReceive scripts ──
      const afterReceiveDirectives = parseScriptText(request.afterReceive ?? '');
      const allDirectives = [...(request.directives || []), ...afterReceiveDirectives];
      if (allDirectives.length > 0) {
        const mergedVars: Record<string, string> = { ...$resolvedEnvVars, ...$pbGlobals };
        for (const v of $activeFileVariables) mergedVars[v.key] = v.value;

        const pbResult = executePbDirectives(
          allDirectives, response,
          { url, method: request.method, headers, body },
          mergedVars,
          $namedResults,
        );

        pbAssertionResults.set(pbResult.assertionResults);

        // Apply set vars as named results so {{key}} resolves in later requests
        if (Object.keys(pbResult.setVars).length > 0) {
          namedResults.update(nr => {
            const updated = { ...nr };
            for (const [key, value] of Object.entries(pbResult.setVars)) {
              // Store as a pseudo named result so substituteAll can pick it up.
              // We also inject into env vars for simpler resolution.
              updated[`__pb_${key}`] = {
                request: { url, method: request.method, headers, body },
                response,
              };
            }
            return updated;
          });
          // Inject set vars into file-scoped overrides so {{key}} works in this file
          const filePath = $selectedLocation!.filePath;
          pbFileOverrides.update(ev => ({
            ...ev,
            [filePath]: { ...(ev[filePath] ?? {}), ...pbResult.setVars },
          }));
        }

        // Apply global vars (workspace-scoped)
        if (Object.keys(pbResult.globalVars).length > 0) {
          pbGlobals.update(g => ({ ...g, ...pbResult.globalVars }));
        }
      }
    } catch (e: any) {
      currentResponse.set({
        status: 0, statusText: 'Error', headers: {},
        body: (typeof e === 'string' ? e : e.message) || 'Request failed.', time: Math.round(performance.now() - startTime), size: 0,
      });
    } finally {
      isLoading.set(false);
      cacheCurrentTabResponse($currentSentRequest);
    }
  }

  // ─── Event Handlers ───

  function handleSelect(e: CustomEvent<RequestLocation>) {
    if (showEnvEditor && $envFile) {
      saveEnvFile($envFile);
      showEnvEditor = false;
    }
    // Deactivate any flow tab when selecting a request
    activeFlowTabPath.set(null);
    activeFlowPath.set(null);
    const loc = e.detail;
    const hasTab = $tabs.some(t => t.location.filePath === loc.filePath && t.location.requestIndex === loc.requestIndex);
    if (hasTab) {
      activateTab(loc);
    } else {
      previewRequest(loc);
    }
  }

  function handlePinRequest(e: CustomEvent<{ filePath: string; requestIndex: number; label: string }>) {
    if (showEnvEditor && $envFile) {
      saveEnvFile($envFile);
      showEnvEditor = false;
    }
    pinTab(
      { filePath: e.detail.filePath, requestIndex: e.detail.requestIndex },
      e.detail.label,
    );
  }

  function handleTabActivate(e: CustomEvent<RequestLocation>) {
    if (showEnvEditor && $envFile) {
      saveEnvFile($envFile);
      showEnvEditor = false;
    }
    // Deactivate any flow tab when switching to a request tab
    activeFlowTabPath.set(null);
    activeFlowPath.set(null);
    activateTab(e.detail);
  }

  function handleTabClose(e: CustomEvent<RequestLocation>) {
    closeTab(e.detail);
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

  async function handleDeleteFile(e: CustomEvent<string>) {
    const filePath = e.detail;

    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(filePath);
    } catch (err) {
      addToast(`Failed to delete file: ${err instanceof Error ? err.message : err}`, 'error');
      return;
    }

    removeFileFromTree(filePath);
  }

  function handleToggleFolder(e: CustomEvent<string>) {
    toggleFolder(e.detail);
  }


  /** Resolve the full dependency chain in topological order, then run each unsent request. */
  async function handleRunAll(e: CustomEvent<string[]>) {
    const allFiles = getAllFileNodes($workspace.tree);
    const depRe = /\{\{(\w+)\.(?:request|response)\./g;

    // Build a lookup: varName -> HttpRequest
    const requestByName = new Map<string, HttpRequest>();
    for (const file of allFiles) {
      for (const req of file.requests) {
        if (req.varName) requestByName.set(req.varName, req);
      }
    }

    // Collect transitive dependencies in execution order (deepest first)
    const ordered: string[] = [];
    const visited = new Set<string>();

    function resolve(name: string) {
      if (visited.has(name)) return;
      visited.add(name);
      const req = requestByName.get(name);
      if (!req) return;
      // Find this request's own dependencies
      const text = `${req.url} ${req.headers.map(h => h.value).join(' ')} ${req.body}`;
      let match;
      const re = new RegExp(depRe.source, 'g');
      while ((match = re.exec(text)) !== null) {
        resolve(match[1]);
      }
      ordered.push(name);
    }

    for (const name of e.detail) {
      resolve(name);
    }

    // Execute in order, skipping already-sent requests
    for (const name of ordered) {
      if ($namedResults[name]) continue;
      const req = requestByName.get(name);
      if (req) await sendRequest(req);
    }
  }

  function handleNameRequest(e: CustomEvent<{ filePath: string; requestIndex: number; varName: string }>) {
    const { filePath, requestIndex, varName } = e.detail;
    const file = findFileInTree($workspace.tree, filePath);
    if (!file) return;
    const req = file.requests[requestIndex];
    if (!req) return;
    // Block duplicate names
    if (varName) {
      const duplicate = getAllFileNodes($workspace.tree).some(f =>
        f.requests.some((r, ri) =>
          r.varName === varName && !(f.path === filePath && ri === requestIndex)
        )
      );
      if (duplicate) {
        addToast(`Name "${varName}" is already in use`);
        return;
      }
    }
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

  // ─── Flow Handlers ───

  function handleOpenFlow(e: CustomEvent<string>) {
    const path = e.detail;
    const flow = $flows[path];
    if (!flow) return;
    openFlowTab(path, flow.name);
  }

  async function handleCreateFlow(e: CustomEvent<string>) {
    const name = e.detail;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const { createEmptyFlow, writeFlowFile } = await import('./lib/flowIO');
    const flow = createEmptyFlow(name);
    const safeName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
    const flowsDir = await join(rootPath, FLOWS_DIR);
    try { await (await import('@tauri-apps/plugin-fs')).mkdir(flowsDir, { recursive: true }); } catch { /* exists */ }
    const absolutePath = await join(flowsDir, `${safeName}.pb-flow.json`);
    const relativePath = `${FLOWS_DIR}/${safeName}.pb-flow.json`;

    await writeFlowFile(absolutePath, flow);
    flows.update(f => ({ ...f, [relativePath]: flow }));
    openFlowTab(relativePath, flow.name);
  }

  let flowAbortController: AbortController | null = null;
  let lastFlowRunRecords: Record<string, FlowRunRecord> = {};
  let runningFlowPath: string | null = null;

  /** Persisted UI state for flow editors, keyed by flow path. */
  let flowUIState: Record<string, { expandedStepId: string | null; collapsedKeys: Record<string, boolean>; activeOverrideTabs: Record<string, string> }> = {};

  async function handleRunFlow() {
    const flow = $activeFlow;
    const flowPathVal = $activeFlowTabPath;
    const rootPath = $workspace.rootPath;
    if (!flow || !flowPathVal || !rootPath) return;

    // Abort any previous run
    flowAbortController?.abort();
    flowAbortController = new AbortController();

    runningFlowPath = flowPathVal;
    flowRunState.set({ status: 'running', stepResults: [] });

    const record = await runFlow(
      flow,
      rootPath,
      $workspace.tree,
      $resolvedEnvVars,
      $dotenvVariables,
      $activeEnvironment,
      {
        onStepStart(stepId: string) {
          flowRunState.update(s => s ? {
            ...s,
            stepResults: [...s.stepResults, {
              stepId, status: 'running', response: null, sentRequest: null,
              assertionResults: [], durationMs: 0, error: null,
            }],
          } : s);
        },
        onStepComplete(stepId: string, result: FlowStepResult) {
          flowRunState.update(s => s ? {
            ...s,
            stepResults: s.stepResults.map(r => r.stepId === stepId ? result : r),
          } : s);
        },
      },
      flowAbortController.signal,
    );

    record.flowFilePath = flowPathVal;
    lastFlowRunRecords[flowPathVal] = record;
    lastFlowRunRecords = lastFlowRunRecords; // trigger reactivity
    flowRunState.set({ status: record.status, stepResults: record.stepResults });
    runningFlowPath = null;

    // Propagate flow variables back to app stores
    // Note: flow set vars are not propagated - they are file-scoped and only
    // meaningful within the flow's isolated execution context. Only globals
    // and named results cross the boundary back to the workspace.
    if (record.variables) {
      if (Object.keys(record.variables.globalVars).length > 0) {
        pbGlobals.update(g => ({ ...g, ...record.variables!.globalVars }));
      }
      if (Object.keys(record.variables.namedResults).length > 0) {
        namedResults.update(nr => ({ ...nr, ...record.variables!.namedResults }));
      }
    }

    // Persist and update history
    try {
      await saveFlowRunRecord(rootPath, record);
      flowRunHistory.update(h => [record, ...h]);
    } catch { /* save failed silently */ }

    flowAbortController = null;
  }

  function handleAbortFlow() {
    flowAbortController?.abort();
  }

  async function handleSaveFlow(e: CustomEvent<{ flowPath: string; flow: import('./lib/types').FlowDefinition }>) {
    const { flowPath, flow } = e.detail;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const { writeFlowFile } = await import('./lib/flowIO');
    const absolutePath = await safeJoinPath(rootPath, flowPath);
    await writeFlowFile(absolutePath, flow);
    flows.update(f => ({ ...f, [flowPath]: flow }));

    // Update tab label if the name changed
    flowTabs.update(ts => ts.map(t =>
      t.flowPath === flowPath ? { ...t, label: flow.name } : t
    ));
  }

  async function handleDuplicateFlow(e: CustomEvent<string>) {
    const sourcePath = e.detail;
    const sourceFlow = $flows[sourcePath];
    if (!sourceFlow) return;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const { writeFlowFile } = await import('./lib/flowIO');
    const newName = `${sourceFlow.name} (copy)`;
    const newFlow = { ...sourceFlow, name: newName, steps: sourceFlow.steps.map(s => ({ ...s, id: crypto.randomUUID() })) };
    const safeName = newName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
    const flowsDir = await join(rootPath, FLOWS_DIR);
    try { await (await import('@tauri-apps/plugin-fs')).mkdir(flowsDir, { recursive: true }); } catch { /* exists */ }
    const absolutePath = await join(flowsDir, `${safeName}.pb-flow.json`);
    const relativePath = `${FLOWS_DIR}/${safeName}.pb-flow.json`;

    await writeFlowFile(absolutePath, newFlow);
    flows.update(f => ({ ...f, [relativePath]: newFlow }));
    openFlowTab(relativePath, newFlow.name);
  }

  async function handleDeleteFlow(e: CustomEvent<string>) {
    const path = e.detail;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const absolutePath = await safeJoinPath(rootPath, path);
      await remove(absolutePath);
    } catch (err) {
      console.warn('Could not delete flow file:', path, err);
    }

    flows.update(f => {
      const updated = { ...f };
      delete updated[path];
      return updated;
    });
    delete flowUIState[path];
    closeFlowTab(path);
  }
</script>

<ToastContainer />
<HelpModal visible={showHelp} on:close={() => showHelp = false} />
<SettingsModal
  visible={showSettings}
  currentTheme={currentTheme}
  on:changeTheme={(e) => { currentTheme = e.detail; setTheme(e.detail); }}
  on:close={() => showSettings = false}
/>
<VariableInspector
  visible={showVarInspector}
  fileVariables={$activeFileVariables}
  envVariables={$resolvedEnvVars}
  kvVariables={$keyVaultState.status === 'loaded' ? $keyVaultState.variables : {}}
  pbOverrides={$activeFileOverrides}
  pbGlobals={$pbGlobals}
  namedResults={$namedResults}
  activeEnv={$activeEnvironment}
  activeFileName={$activeFile?.name?.replace(/\.(http|rest)$/, '') ?? ''}
  on:close={() => showVarInspector = false}
  on:clearRuntime={() => {
    pbFileOverrides.set({});
    pbGlobals.set({});
    namedResults.set({});
  }}
/>
<ImportEnvModal
  visible={showImportEnvModal}
  variables={pendingImportVars}
  existingEnvironments={$availableEnvironments}
  hasEnvFile={$envFile !== null}
  on:confirm={handleImportEnvConfirm}
  on:skip={handleImportEnvSkip}
/>
<ImportCollectionModal
  visible={showImportCollectionModal}
  on:importFile={handleImportFile}
  on:importUrl={handleImportUrl}
  on:cancel={() => showImportCollectionModal = false}
/>

<svelte:window
  on:dragover|preventDefault={() => {}}
  on:drop|preventDefault={() => {}}
/>

<main class="app">
  <div class="titlebar" data-tauri-drag-region></div>

  <div class="layout" bind:this={layoutEl} class:sidebar-dragging={sidebarDragging}>
    <div class="sidebar-container" style="width: {sidebarWidth}px; min-width: {sidebarWidth}px">
      <TreeSidebar
        tree={$workspace.tree}
        selected={$selectedLocation}
        rootName={$workspace.rootName}
        hasWorkspace={!!$workspace.rootPath}
        environments={$availableEnvironments}
        activeEnv={$activeEnvironment}
        flows={$flows}
        activeFlowPath={$activeFlowTabPath}
        on:openFolder={openFolder}
        on:openGettingStarted={openGettingStarted}
        on:importCollection={() => showImportCollectionModal = true}
        on:select={handleSelect}
        on:pinRequest={handlePinRequest}
        on:toggleFolder={handleToggleFolder}
        on:addRequest={handleAddRequest}
        on:deleteRequest={handleDeleteRequest}
        on:deleteFile={handleDeleteFile}
        on:changeEnv={(e) => activeEnvironment.set(e.detail)}
        on:editEnv={() => showEnvEditor = true}
        on:openVarInspector={() => showVarInspector = true}
        on:openHelp={() => showHelp = true}
        on:openSettings={() => showSettings = true}
        on:nameRequest={handleNameRequest}
        on:openFlow={handleOpenFlow}
        on:createFlow={handleCreateFlow}
        on:duplicateFlow={handleDuplicateFlow}
        on:deleteFlow={handleDeleteFlow}
      />
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="sidebar-divider" on:mousedown={onSidebarDividerDown} role="separator"></div>

    <div class="main-area">
      <TabBar
        tabs={$tabs}
        activeLocation={$selectedLocation}
        isPreview={$isPreview}
        previewLabel={$activeRequest?.name ?? ''}
        flowTabs={$flowTabs}
        activeFlowPath={$activeFlowTabPath}
        on:activate={handleTabActivate}
        on:close={handleTabClose}
        on:activateFlowTab={(e) => activateFlowTab(e.detail)}
        on:closeFlowTab={(e) => { delete flowUIState[e.detail]; closeFlowTab(e.detail); }}
      />
      <div class="main-panels" bind:this={mainPanelsEl} class:dragging>
        {#if showEnvEditor && $envFile && $activeEnvironment}
          <div class="env-editor-pane">
            <EnvironmentEditor
              envFile={$envFile}
              activeEnv={$activeEnvironment}
              kvState={$keyVaultState}
              on:update={(e) => {
                envFile.set(e.detail);
                saveEnvFile(e.detail);
              }}
              on:changeEnv={(e) => activeEnvironment.set(e.detail)}
              on:close={() => showEnvEditor = false}
              on:conflictPref={(e) => {
                kvConflictPrefs.update(p => ({ ...p, [e.detail.key]: e.detail.source }));
              }}
              on:refreshKv={(e) => {
                // Invalidate cache for this env so fresh secrets are fetched
                for (const key of Object.keys(kvCache)) {
                  if (key.startsWith(e.detail + '::')) delete kvCache[key];
                }
                kvCache = kvCache;
                keyVaultState.update(s => ({ ...s, cacheKey: null }));
                refreshKeyVaultSecrets(e.detail);
              }}
            />
          </div>
        {:else if $activeFlowTabPath && $activeFlow}
          <FlowEditor
            flow={$activeFlow}
            flowPath={$activeFlowTabPath}
            tree={$workspace.tree}
            rootPath={$workspace.rootPath ?? ''}
            runState={runningFlowPath === $activeFlowTabPath ? $flowRunState : null}
            lastRunRecord={lastFlowRunRecords[$activeFlowTabPath] ?? null}
            runHistory={$flowRunHistory.filter(r => r.flowFilePath === $activeFlowTabPath)}
            uiState={flowUIState[$activeFlowTabPath] ?? null}
            on:uiStateChange={(e) => { flowUIState[$activeFlowTabPath] = e.detail; flowUIState = flowUIState; }}
            on:save={handleSaveFlow}
            on:run={handleRunFlow}
            on:abort={handleAbortFlow}
            on:clearHistory={() => {
              flowRunHistory.set($flowRunHistory.filter(r => r.flowFilePath !== $activeFlowTabPath));
              delete lastFlowRunRecords[$activeFlowTabPath];
              lastFlowRunRecords = lastFlowRunRecords;
              if ($workspace.rootPath && $activeFlow) {
                clearFlowRunHistory($workspace.rootPath, $activeFlow.name);
              }
            }}
          />
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
              bottomTab={activeBottomTab}
              on:update={handleUpdateRequest}
              on:send={(e) => sendRequest(e.detail)}
              on:save={saveActiveFile}
              on:runAll={handleRunAll}
              on:bottomTabChange={handleBottomTabChange}
            />
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="divider" on:mousedown={onDividerDown} role="separator"></div>
          <div class="response-pane">
            <ResponseViewer response={$currentResponse} loading={$isLoading} sentRequest={$currentSentRequest} assertionResults={$pbAssertionResults} activeTab={activeResponseTab} on:tabChange={handleResponseTabChange} />
          </div>
        {:else}
          <div class="no-selection">
            <img class="no-sel-logo" src={logoUrl} alt="Psychic Broccoli" />
          </div>
        {/if}
      </div>
    </div>
  </div>
</main>

<style>
  :global(*) {
    margin: 0; padding: 0; box-sizing: border-box;
  }
  :global(body) {
    font-family: var(--font-ui);
    background: var(--color-bg); color: var(--color-text);
    overflow: hidden; font-size: var(--text-md);
  }

  .app {
    display: flex; flex-direction: column;
    height: 100vh; background: var(--color-bg);
  }

  .titlebar {
    display: flex; justify-content: space-between; align-items: center;
    height: 28px;
    background: var(--color-bg-sidebar); border-bottom: 1px solid var(--color-divider);
    -webkit-app-region: drag; user-select: none; flex-shrink: 0;
  }
  .layout { display: flex; flex: 1; overflow: hidden; }

  .sidebar-container {
    display: flex; flex-direction: column;
    background: var(--color-bg-sidebar);
    flex-shrink: 0; overflow: hidden;
  }

  .sidebar-divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--color-divider);
    transition: background var(--duration-normal);
  }
  .sidebar-divider:hover, .sidebar-dragging .sidebar-divider {
    background: var(--color-primary);
  }
  .sidebar-dragging { cursor: col-resize; user-select: none; }

  .main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .main-panels { flex: 1; display: flex; flex-direction: row; overflow: hidden; }
  .main-panels.dragging { cursor: col-resize; user-select: none; }
  .editor-pane { overflow: auto; min-width: 0; }
  .response-pane { flex: 1; overflow: auto; min-width: 0; }

  .divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--color-divider);
    transition: background var(--duration-normal);
  }
  .divider:hover, .dragging .divider {
    background: var(--color-primary);
  }
  .env-editor-pane { flex: 1; overflow: auto; }

  .no-selection {
    flex: 1; display: flex;
    align-items: center; justify-content: center;
  }
  .no-sel-logo { width: 360px; height: 360px; object-fit: contain; opacity: 0.45; }
</style>
