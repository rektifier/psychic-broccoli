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
  import AddFavoriteModal from './components/AddFavoriteModal.svelte';
  import { loadTheme, setTheme, loadFavorites, saveFavorites, type ThemeId } from './lib/theme';
  import logoUrl from './assets/logo.png';
  import {
    workspace,
    selectedLocation,
    currentResponse,
    isLoading,
    activeFile,
    activeRequest,
    activeFileVariables,
    envFile,
    userEnvFile,
    activeEnvironment,
    availableEnvironments,
    resolvedEnvVars,
    baseEnvVarsWithSource,
    pbFileOverrides,
    activeFileOverrides,
    namedResults,
    dotenvVariables,
    pbAssertionResults,
    pbGlobals,
    keyVaultState,
    varSourcePrefs,
    updateRequestInTree,
    addRequestToFile,
    deleteRequestFromFile,
    removeFileFromTree,
    removeFolderFromTree,
    addFileToTree,
    addFolderToTree,
    renameFolderInTree,
    renameFileInTree,
    editingFilePath,
    editingFolderPath,
    toggleFolder,
    markFileSaved,
    addToast,
    tabs,
    isPreview,
    pinTab,
    activateTab,
    closeTab,
    previewRequest,
    cacheCurrentTabResponse,
    currentSentRequest,
    setTabBottomTab,
    setTabResponseTab,
    flows,
    flowRunHistory,
    flowRunState,
    flowTabs,
    activeFlowTabPath,
    openFlowTab,
    closeFlowTab,
    activateFlowTab,
    activeFlowPath,
    activeFlow,
    favorites,
  } from './lib/stores';
  import { extractKeyVaultConfig, fetchKeyVaultSecrets, kvCacheKey } from './lib/keyvault';
  import {
    serializeHttpFile,
    substituteAll,
    ensureSharedEnvironment,
    buildWorkspaceTree,
    createFileNode,
    createEmptyFileNode,
  } from './lib/parser';
  import type { SubstitutionContext } from './lib/parser';
  import { getAllFileNodes, findFile, findFolder, collectFilePaths } from './lib/tree';
  import { errorMessage } from './lib/errors';
  import { importPostmanCollection } from './lib/postman';
  import { importInsomniaExport } from './lib/insomnia';
  import { importOpenApiSpec } from './lib/openapi';
  import type {
    HttpRequest,
    RequestLocation,
    EnvironmentFile,
    ImportResult,
    KeyVaultState,
  } from './lib/types';
  import type { BottomTab, ResponseTab } from './lib/stores';
  import { saveFlowRunRecord, clearFlowRunHistory, FLOWS_DIR } from './lib/flowIO';
  import { openFolderByPath, scanForHttpFiles, safeJoinPath } from './lib/workspaceIO';
  import { generateFolderName } from './lib/folderCreate';
  import { runFlow } from './lib/flowRunner';
  import { executeHttpRequest } from './lib/requestExec';
  import { startMcpBridge } from './lib/mcpBridge';
  import type { PbVarEffects } from './lib/requestExec';
  import type { FlowStepResult, FlowRunRecord } from './lib/types';

  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { join, basename, dirname } from '@tauri-apps/api/path';
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';

  let showEnvEditor = false;
  let showVarInspector = false;

  let showHelp = false;

  // ─── Theme / Settings ───
  let currentTheme: ThemeId = 'default';
  let showSettings = false;
  loadTheme().then((t) => (currentTheme = t));
  loadFavorites().then((f) => favorites.set(f));

  // ─── MCP status (titlebar pill) ───
  // Plain legacy `let` (not $state) so App.svelte stays in legacy mode and
  // the `$:` reactive statements elsewhere in this file keep working.
  let mcpRunning = false;
  let mcpPort = 3742;

  async function refreshMcpStatus() {
    try {
      const settings = await invoke<{ enabled: boolean; port: number; token: string }>(
        'mcp_get_settings',
      );
      mcpPort = settings.port;
      mcpRunning = await invoke<boolean>('mcp_is_running');
    } catch {}
  }

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
      const currentEnv: EnvironmentFile = ensureSharedEnvironment($envFile ?? {});

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

      addToast(
        `Added ${pendingImportVars.length} variable${pendingImportVars.length !== 1 ? 's' : ''} to "${envName}" environment.`,
        'info',
      );
    } catch (e) {
      addToast(`Failed to update environment file: ${errorMessage(e)}`, 'error');
    }

    pendingImportVars = [];
  }

  function handleImportEnvSkip() {
    showImportEnvModal = false;
    pendingImportVars = [];
  }

  // ─── Layout persistence ───
  // Pane/sidebar sizes are persisted to the webview's localStorage, which Tauri
  // keeps across app restarts. Window size/position is handled separately by the
  // tauri-plugin-window-state plugin (see src-tauri).

  const LAYOUT_KEY_EDITOR_PCT = 'pb.layout.editorWidthPercent';
  const LAYOUT_KEY_SIDEBAR_PX = 'pb.layout.sidebarWidth';

  function loadLayoutNumber(key: string, fallback: number): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  function saveLayoutNumber(key: string, value: number) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // ignore (e.g. storage disabled) - persistence is best-effort
    }
  }

  // ─── Resizable Panes ───

  let editorWidthPercent = loadLayoutNumber(LAYOUT_KEY_EDITOR_PCT, 50);
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
    saveLayoutNumber(LAYOUT_KEY_EDITOR_PCT, editorWidthPercent);
  }

  // ─── Resizable Sidebar ───

  let sidebarWidth = loadLayoutNumber(LAYOUT_KEY_SIDEBAR_PX, 260);
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
    saveLayoutNumber(LAYOUT_KEY_SIDEBAR_PX, sidebarWidth);
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
      varSourcePrefs.set({});
    }
    lastKvEnv = env;

    const seq = ++kvFetchSeq;
    keyVaultState.set({ status: 'loading', variables: {}, error: null, cacheKey: newCacheKey });

    try {
      const vars = await fetchKeyVaultSecrets(config);
      if (kvFetchSeq === seq) {
        const state: KeyVaultState = {
          status: 'loaded',
          variables: vars,
          error: null,
          cacheKey: newCacheKey,
        };
        kvCache[newCacheKey] = state;
        kvCache = kvCache;
        keyVaultState.set(state);
      }
    } catch (err: unknown) {
      if (kvFetchSeq === seq) {
        const msg = err instanceof Error ? err.message : String(err);
        const state: KeyVaultState = {
          status: 'error',
          variables: {},
          error: msg,
          cacheKey: newCacheKey,
        };
        keyVaultState.set(state);
        addToast(`Key Vault error: ${msg}`, 'error');
      }
    }
  }

  const unsubKv = activeEnvironment.subscribe(() => {
    refreshKeyVaultSecrets();
  });

  // ─── MCP Bridge ───
  // Bridge logic lives in src/lib/mcpBridge.ts; App.svelte only owns the
  // listener's lifecycle (started here, torn down in onDestroy).

  const mcpBridgeUnlisten = startMcpBridge();

  void refreshMcpStatus();

  onDestroy(() => {
    unsubKv();
    mcpBridgeUnlisten.then((unlisten) => unlisten());
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
    const key =
      $tabs.length > 0 && $selectedLocation
        ? `${$selectedLocation.filePath}::${$selectedLocation.requestIndex}`
        : null;
    if (!key) return 'body' as BottomTab;
    const tab = $tabs.find((t) => `${t.location.filePath}::${t.location.requestIndex}` === key);
    return tab?.bottomTab ?? ('body' as BottomTab);
  })();

  function handleBottomTabChange(e: CustomEvent<BottomTab>) {
    if ($selectedLocation) {
      setTabBottomTab($selectedLocation, e.detail);
    }
  }

  // Active response tab (Body/Headers/Request/Assertions) for pinned tabs
  $: activeResponseTab = (() => {
    const key =
      $tabs.length > 0 && $selectedLocation
        ? `${$selectedLocation.filePath}::${$selectedLocation.requestIndex}`
        : null;
    if (!key) return 'body' as ResponseTab;
    const tab = $tabs.find((t) => `${t.location.filePath}::${t.location.requestIndex}` === key);
    return tab?.responseTab ?? ('body' as ResponseTab);
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
  // Scanning and opening live in src/lib/workspaceIO.ts; App.svelte supplies
  // the Key Vault hooks because the per-environment KV cache is UI state here.

  function openWorkspaceFolder(rootPath: string) {
    return openFolderByPath(rootPath, {
      resetCache: () => {
        kvCache = {};
      },
      refresh: () => {
        refreshKeyVaultSecrets();
      },
    });
  }

  async function openFolder() {
    try {
      const rootPath = await open({ directory: true, title: 'Select workspace folder' });
      if (!rootPath) return;
      await openWorkspaceFolder(rootPath as string);
    } catch (e) {
      addToast(`Failed to open folder: ${errorMessage(e)}`, 'error');
    }
  }

  // ─── Favorites ───

  let showAddFavoriteModal = false;
  let pendingFavoritePath = '';
  let pendingFavoriteName = '';

  /**
   * Toggle the currently open workspace folder in/out of the favorites list.
   * Removing is immediate; adding opens a modal to name the favorite first.
   */
  function toggleFavorite() {
    const ws = get(workspace);
    const rootPath = ws.rootPath;
    if (!rootPath) return;
    if (get(favorites).some((f) => f.path === rootPath)) {
      removeFavorite(rootPath);
    } else {
      pendingFavoritePath = rootPath;
      pendingFavoriteName = ws.rootName;
      showAddFavoriteModal = true;
    }
  }

  /** Create the pending favorite with the chosen name. */
  function confirmAddFavorite(name: string) {
    const path = pendingFavoritePath;
    showAddFavoriteModal = false;
    if (!path) return;
    favorites.update((list) => {
      if (list.some((f) => f.path === path)) return list;
      const next = [...list, { path, name }];
      saveFavorites(next);
      return next;
    });
    pendingFavoritePath = '';
  }

  function cancelAddFavorite() {
    showAddFavoriteModal = false;
    pendingFavoritePath = '';
  }

  /** Remove a path from the favorites list. */
  function removeFavorite(path: string) {
    favorites.update((list) => {
      const next = list.filter((f) => f.path !== path);
      saveFavorites(next);
      return next;
    });
  }

  /**
   * Name shown for the open folder: the favorite's custom name when the open
   * folder is favorited, otherwise the folder basename.
   */
  $: rootDisplayName =
    $favorites.find((f) => f.path === $workspace.rootPath)?.name ?? $workspace.rootName;

  /** Open a favorited folder, surfacing an error toast if it can no longer be read. */
  async function openFavorite(path: string) {
    try {
      await openWorkspaceFolder(path);
    } catch (e) {
      addToast(`Could not open favorite "${path}": ${errorMessage(e)}`, 'error');
    }
  }

  async function openGettingStarted() {
    try {
      const path = await invoke<string>('extract_getting_started');
      await openWorkspaceFolder(path);
    } catch (e) {
      addToast(`Failed to open getting-started folder: ${errorMessage(e)}`, 'error');
    }
  }

  // ─── Import Collections ───

  async function writeImportedFiles(result: ImportResult): Promise<number> {
    const rootPath = $workspace.rootPath!;
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    let written = 0;
    for (const file of result.files) {
      const outPath = await safeJoinPath(rootPath, file.relativePath);
      const parentDir = await dirname(outPath);
      try {
        await mkdir(parentDir, { recursive: true });
      } catch {
        /* already exists */
      }
      await writeTextFile(outPath, file.content);
      written++;
    }

    // Refresh workspace tree
    const { files: discovered, emptyFolders } = await scanForHttpFiles(rootPath);
    const tree = buildWorkspaceTree(discovered, emptyFolders, rootPath);
    const rootName = await basename(rootPath);
    workspace.set({ rootPath, rootName, tree });

    return written;
  }

  /** After writing files, write the env file directly if multi-env, or show the modal. */
  async function showEnvModalIfNeeded(result: ImportResult) {
    if (result.environmentFile && Object.keys(result.environmentFile).length > 0) {
      await writeImportedEnvironmentFile(result.environmentFile);
      return;
    }
    if (result.discoveredVariables.length > 0) {
      pendingImportVars = result.discoveredVariables;
      showImportEnvModal = true;
    }
  }

  async function writeImportedEnvironmentFile(imported: EnvironmentFile) {
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;
    try {
      const current: EnvironmentFile = ensureSharedEnvironment(
        $envFile ? structuredClone($envFile) : {},
      );

      for (const [envName, vars] of Object.entries(imported)) {
        if (!current[envName]) current[envName] = {};
        for (const [key, value] of Object.entries(vars)) {
          if (typeof value === 'string' && !(key in current[envName])) {
            current[envName][key] = value;
          }
        }
      }

      const envPath = await join(rootPath, 'http-client.env.json');
      await writeTextFile(envPath, JSON.stringify(current, null, 2));
      envFile.set(current);

      const envNames = Object.keys(imported).filter((n) => n !== '$shared');
      if (!$activeEnvironment && envNames.length > 0) {
        activeEnvironment.set(envNames[0]);
      }

      addToast(
        `Imported ${envNames.length} environment${envNames.length !== 1 ? 's' : ''}: ${envNames.join(', ')}`,
        'info',
      );
    } catch (e) {
      addToast(`Failed to write environment file: ${errorMessage(e)}`, 'error');
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
        case 'postman':
          result = importPostmanCollection(content);
          break;
        case 'insomnia':
          result = importInsomniaExport(content);
          break;
        case 'openapi':
          result = importOpenApiSpec(content);
          break;
      }
      const written = await writeImportedFiles(result);
      addToast(
        `Imported ${written} file${written !== 1 ? 's' : ''} from "${result.collectionName}".`,
        'info',
      );
      await showEnvModalIfNeeded(result);
    } catch (e) {
      addToast(`Import failed: ${errorMessage(e)}`, 'error');
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
      addToast(
        `Imported ${written} file${written !== 1 ? 's' : ''} from "${result.collectionName}".`,
        'info',
      );
      await showEnvModalIfNeeded(result);
    } catch (e) {
      addToast(`Import failed: ${errorMessage(e)}`, 'error');
    }
  }

  // ─── Save File ───

  async function saveActiveFile() {
    const file = $activeFile;
    if (!file || !file.dirty) return;

    try {
      const content = serializeHttpFile(file.requests, file.variables);
      await writeTextFile(file.path, content);
      markFileSaved(file.path);
    } catch (e) {
      addToast(`Failed to save file: ${errorMessage(e)}`, 'error');
    }
  }

  // ─── Save Environment File ───

  async function saveEnvFile(data: EnvironmentFile) {
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;
    try {
      const envPath = await join(rootPath, 'http-client.env.json');
      await writeTextFile(envPath, JSON.stringify(data, null, 2));
    } catch (e) {
      addToast(`Failed to save environment file: ${errorMessage(e)}`, 'error');
    }
  }

  // ─── Send Request ───

  /** Commit pb.set (file-scoped) and pb.global effects from a manual send to the stores. */
  function commitPbVars(effects: PbVarEffects) {
    if (Object.keys(effects.setVars).length > 0 && $selectedLocation) {
      const filePath = $selectedLocation.filePath;
      pbFileOverrides.update((ev) => ({
        ...ev,
        [filePath]: { ...(ev[filePath] ?? {}), ...effects.setVars },
      }));
    }
    if (Object.keys(effects.globalVars).length > 0) {
      pbGlobals.update((g) => ({ ...g, ...effects.globalVars }));
    }
  }

  async function sendRequest(request: HttpRequest) {
    isLoading.set(true);
    currentResponse.set(null);
    pbAssertionResults.set([]);
    currentSentRequest.set(null);

    const ctx = getSubstitutionContext();
    const startTime = performance.now();

    try {
      const result = await executeHttpRequest(request, ctx, {
        alias: request.varName,
        onBeforeInvoke(sent, beforeSend) {
          currentSentRequest.set(sent);
          commitPbVars(beforeSend);
        },
      });

      currentResponse.set(result.response);
      if (result.namedResult) {
        const { name, result: named } = result.namedResult;
        namedResults.update((nr) => ({ ...nr, [name]: named }));
      }
      pbAssertionResults.set(result.assertionResults);
      commitPbVars(result.afterReceive);
    } catch (e) {
      currentResponse.set({
        status: 0,
        statusText: 'Error',
        headers: {},
        body: errorMessage(e) || 'Request failed.',
        time: Math.round(performance.now() - startTime),
        size: 0,
      });
    } finally {
      isLoading.set(false);
      cacheCurrentTabResponse($currentSentRequest);
    }
  }

  // ─── Event Handlers ───

  function handleSelect(e: CustomEvent<RequestLocation>) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
      showEnvEditor = false;
    }
    // Deactivate any flow tab when selecting a request
    activeFlowTabPath.set(null);
    activeFlowPath.set(null);
    const loc = e.detail;
    const hasTab = $tabs.some(
      (t) => t.location.filePath === loc.filePath && t.location.requestIndex === loc.requestIndex,
    );
    if (hasTab) {
      activateTab(loc);
    } else {
      previewRequest(loc);
    }
  }

  function handlePinRequest(
    e: CustomEvent<{ filePath: string; requestIndex: number; label: string }>,
  ) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
      showEnvEditor = false;
    }
    pinTab({ filePath: e.detail.filePath, requestIndex: e.detail.requestIndex }, e.detail.label);
  }

  function handleTabActivate(e: CustomEvent<RequestLocation>) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
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
      addToast(`Failed to delete file: ${errorMessage(err)}`, 'error');
      return;
    }

    removeFileFromTree(filePath);
  }

  async function handleDeleteFolder(e: CustomEvent<string>) {
    const folderPath = e.detail;

    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(folderPath, { recursive: true });
    } catch (err) {
      addToast(`Failed to delete folder: ${errorMessage(err)}`, 'error');
      return;
    }

    removeFolderFromTree(folderPath);
  }

  async function handleCreateFile(e: CustomEvent<string | null>) {
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const folderPath = e.detail || rootPath;

    // Generate unique filename
    const stem = 'new-request';
    let fileName = stem + '.http';
    let filePath = await join(folderPath, fileName);
    let counter = 2;

    // Check for collisions in the tree
    const existingNames = new Set(collectFilePaths($workspace.tree));

    while (existingNames.has(filePath)) {
      fileName = `${stem}-${counter}.http`;
      filePath = await join(folderPath, fileName);
      counter++;
    }

    const fileNode = createEmptyFileNode(filePath, fileName);
    const content = serializeHttpFile(fileNode.requests, fileNode.variables);

    try {
      await writeTextFile(filePath, content);
    } catch (err) {
      addToast(`Failed to create file: ${errorMessage(err)}`, 'error');
      return;
    }

    fileNode.dirty = false;
    fileNode.savedContent = content;
    addFileToTree(folderPath === rootPath ? null : folderPath, fileNode);
    editingFilePath.set(filePath);
  }

  async function handleCreateFolder(e: CustomEvent<string | null>) {
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const parentDir = e.detail || rootPath;

    // Collect sibling names in the target parent
    const siblings = new Set<string>();
    if (parentDir === rootPath) {
      for (const n of $workspace.tree) siblings.add(n.name);
    } else {
      const parent = findFolder($workspace.tree, parentDir);
      for (const c of parent?.children ?? []) siblings.add(c.name);
    }

    const folderName = generateFolderName(siblings);
    const folderPath = await join(parentDir, folderName);

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      await mkdir(folderPath, { recursive: true });
    } catch (err) {
      addToast(`Failed to create folder: ${errorMessage(err)}`, 'error');
      return;
    }

    addFolderToTree(parentDir === rootPath ? null : parentDir, {
      type: 'folder',
      name: folderName,
      path: folderPath,
      children: [],
      expanded: true,
    });
    editingFolderPath.set(folderPath);
  }

  async function handleRenameFolder(e: CustomEvent<{ oldPath: string; newName: string }>) {
    const { oldPath, newName } = e.detail;
    const dir = await dirname(oldPath);
    const newPath = await join(dir, newName);

    try {
      await rename(oldPath, newPath);
    } catch (err) {
      addToast(`Failed to rename folder: ${errorMessage(err)}`, 'error');
      return;
    }

    renameFolderInTree(oldPath, newPath, newName);
    editingFolderPath.set(null);
  }

  async function handleRenameFile(e: CustomEvent<{ oldPath: string; newName: string }>) {
    const { oldPath, newName } = e.detail;

    // If file is dirty, save first
    const file = findFile($workspace.tree, oldPath);
    if (file && file.dirty) {
      try {
        const content = serializeHttpFile(file.requests, file.variables);
        await writeTextFile(oldPath, content);
        markFileSaved(oldPath);
      } catch (err) {
        addToast(`Failed to save file before rename: ${errorMessage(err)}`, 'error');
        return;
      }
    }

    const dir = await dirname(oldPath);
    const newPath = await join(dir, newName);

    try {
      await rename(oldPath, newPath);
    } catch (err) {
      addToast(`Failed to rename file: ${errorMessage(err)}`, 'error');
      return;
    }

    renameFileInTree(oldPath, newPath, newName);
    editingFilePath.set(null);
  }

  async function handleDuplicateFile(e: CustomEvent<string>) {
    const sourcePath = e.detail;

    let content: string;
    try {
      content = await readTextFile(sourcePath);
    } catch (err) {
      addToast(`Failed to read file: ${errorMessage(err)}`, 'error');
      return;
    }

    const dir = await dirname(sourcePath);
    const sourceBase = await basename(sourcePath);
    const sourceStem = sourceBase.replace(/\.(http|rest)$/, '');

    // Generate unique copy name
    let copyStem = `${sourceStem} (copy)`;
    let copyName = copyStem + '.http';
    let copyPath = await join(dir, copyName);
    let counter = 2;

    const existingNames = new Set(collectFilePaths($workspace.tree));

    while (existingNames.has(copyPath)) {
      copyStem = `${sourceStem} (copy ${counter})`;
      copyName = copyStem + '.http';
      copyPath = await join(dir, copyName);
      counter++;
    }

    try {
      await writeTextFile(copyPath, content);
    } catch (err) {
      addToast(`Failed to duplicate file: ${errorMessage(err)}`, 'error');
      return;
    }

    const fileNode = createFileNode(copyPath, copyName, content);
    const rootPath = $workspace.rootPath;
    const parentPath = dir === rootPath ? null : dir;
    addFileToTree(parentPath, fileNode);
    editingFilePath.set(copyPath);
  }

  function handleCancelRename() {
    editingFilePath.set(null);
    editingFolderPath.set(null);
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
      const text = `${req.url} ${req.headers.map((h) => h.value).join(' ')} ${req.body}`;
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

  function handleNameRequest(
    e: CustomEvent<{ filePath: string; requestIndex: number; varName: string }>,
  ) {
    const { filePath, requestIndex, varName } = e.detail;
    const file = findFile($workspace.tree, filePath);
    if (!file) return;
    const req = file.requests[requestIndex];
    if (!req) return;
    // Block duplicate names
    if (varName) {
      const duplicate = getAllFileNodes($workspace.tree).some((f) =>
        f.requests.some(
          (r, ri) => r.varName === varName && !(f.path === filePath && ri === requestIndex),
        ),
      );
      if (duplicate) {
        addToast(`Name "${varName}" is already in use`);
        return;
      }
    }
    // Remove old name from namedResults if it changed or was cleared
    if (req.varName && req.varName !== varName) {
      namedResults.update((nr) => {
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
    const safeName =
      name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'unnamed';
    const flowsDir = await join(rootPath, FLOWS_DIR);
    try {
      await (await import('@tauri-apps/plugin-fs')).mkdir(flowsDir, { recursive: true });
    } catch {
      /* exists */
    }
    const absolutePath = await join(flowsDir, `${safeName}.pb-flow.json`);
    const relativePath = `${FLOWS_DIR}/${safeName}.pb-flow.json`;

    await writeFlowFile(absolutePath, flow);
    flows.update((f) => ({ ...f, [relativePath]: flow }));
    openFlowTab(relativePath, flow.name);
  }

  let flowAbortController: AbortController | null = null;
  let lastFlowRunRecords: Record<string, FlowRunRecord> = {};
  let runningFlowPath: string | null = null;

  /** Persisted UI state for flow editors, keyed by flow path. */
  let flowUIState: Record<
    string,
    {
      expandedStepId: string | null;
      collapsedKeys: Record<string, boolean>;
      activeOverrideTabs: Record<string, string>;
    }
  > = {};

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
          flowRunState.update((s) =>
            s
              ? {
                  ...s,
                  stepResults: [
                    ...s.stepResults,
                    {
                      stepId,
                      status: 'running',
                      response: null,
                      sentRequest: null,
                      assertionResults: [],
                      durationMs: 0,
                      error: null,
                    },
                  ],
                }
              : s,
          );
        },
        onStepComplete(stepId: string, result: FlowStepResult) {
          flowRunState.update((s) =>
            s
              ? {
                  ...s,
                  stepResults: s.stepResults.map((r) => (r.stepId === stepId ? result : r)),
                }
              : s,
          );
        },
      },
      flowAbortController.signal,
    );

    record.flowFilePath = flowPathVal;
    lastFlowRunRecords[flowPathVal] = record;
    lastFlowRunRecords = lastFlowRunRecords; // trigger reactivity
    flowRunState.set({ status: record.status, stepResults: record.stepResults });
    runningFlowPath = null;

    // Flow runs are fully isolated: their named results, set vars, and pb
    // globals stay inside the FlowRunRecord and do not cross back into the
    // workspace stores the regular request editor / inspector reads from.

    // Persist and update history. Resolved Key Vault values are scrubbed from
    // the on-disk copy so no secrets land in run history; the in-memory record
    // (lastFlowRunRecords / flowRunState) keeps real values for this session.
    try {
      const secretValues = Object.values($keyVaultState.variables ?? {});
      await saveFlowRunRecord(rootPath, record, secretValues);
      flowRunHistory.update((h) => [record, ...h]);
    } catch {
      /* save failed silently */
    }

    flowAbortController = null;
  }

  function handleAbortFlow() {
    flowAbortController?.abort();
  }

  async function handleSaveFlow(
    e: CustomEvent<{ flowPath: string; flow: import('./lib/types').FlowDefinition }>,
  ) {
    const { flowPath, flow } = e.detail;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const { writeFlowFile } = await import('./lib/flowIO');
    const absolutePath = await safeJoinPath(rootPath, flowPath);
    await writeFlowFile(absolutePath, flow);
    flows.update((f) => ({ ...f, [flowPath]: flow }));

    // Update tab label if the name changed
    flowTabs.update((ts) =>
      ts.map((t) => (t.flowPath === flowPath ? { ...t, label: flow.name } : t)),
    );
  }

  async function handleDuplicateFlow(e: CustomEvent<string>) {
    const sourcePath = e.detail;
    const sourceFlow = $flows[sourcePath];
    if (!sourceFlow) return;
    const rootPath = $workspace.rootPath;
    if (!rootPath) return;

    const { writeFlowFile } = await import('./lib/flowIO');
    const newName = `${sourceFlow.name} (copy)`;
    const newFlow = {
      ...sourceFlow,
      name: newName,
      steps: sourceFlow.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
    };
    const safeName =
      newName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'unnamed';
    const flowsDir = await join(rootPath, FLOWS_DIR);
    try {
      await (await import('@tauri-apps/plugin-fs')).mkdir(flowsDir, { recursive: true });
    } catch {
      /* exists */
    }
    const absolutePath = await join(flowsDir, `${safeName}.pb-flow.json`);
    const relativePath = `${FLOWS_DIR}/${safeName}.pb-flow.json`;

    await writeFlowFile(absolutePath, newFlow);
    flows.update((f) => ({ ...f, [relativePath]: newFlow }));
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
    } catch {
      // Silently ignore - flow file may not exist on disk
    }

    flows.update((f) => {
      const updated = { ...f };
      delete updated[path];
      return updated;
    });
    delete flowUIState[path];
    closeFlowTab(path);
  }
</script>

<ToastContainer />
<HelpModal visible={showHelp} on:close={() => (showHelp = false)} />
<SettingsModal
  visible={showSettings}
  {currentTheme}
  onchangeTheme={(id) => {
    currentTheme = id;
    setTheme(id);
  }}
  onclose={() => {
    showSettings = false;
    void refreshMcpStatus();
  }}
/>
<VariableInspector
  visible={showVarInspector}
  fileVariables={$activeFileVariables}
  envVariables={$resolvedEnvVars}
  envVarSources={$baseEnvVarsWithSource}
  kvVariables={$keyVaultState.status === 'loaded' &&
  $keyVaultState.cacheKey?.startsWith($activeEnvironment + '::')
    ? $keyVaultState.variables
    : {}}
  varSourcePrefs={$varSourcePrefs}
  pbOverrides={$activeFileOverrides}
  pbGlobals={$pbGlobals}
  namedResults={$namedResults}
  activeEnv={$activeEnvironment}
  activeFileName={$activeFile?.name?.replace(/\.(http|rest)$/, '') ?? ''}
  on:close={() => (showVarInspector = false)}
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
  on:cancel={() => (showImportCollectionModal = false)}
/>
<AddFavoriteModal
  visible={showAddFavoriteModal}
  folderPath={pendingFavoritePath}
  defaultName={pendingFavoriteName}
  on:confirm={(e) => confirmAddFavorite(e.detail.name)}
  on:cancel={cancelAddFavorite}
/>

<svelte:window on:dragover|preventDefault={() => {}} on:drop|preventDefault={() => {}} />

<main class="app">
  <div class="titlebar" data-tauri-drag-region>
    {#if mcpRunning}
      <button
        class="mcp-pill"
        on:click={() => (showSettings = true)}
        title="MCP server running on port {mcpPort}"
      >
        <span class="mcp-dot"></span>
        MCP :{mcpPort}
      </button>
    {/if}
  </div>

  <div class="layout" bind:this={layoutEl} class:sidebar-dragging={sidebarDragging}>
    <div class="sidebar-container" style="width: {sidebarWidth}px; min-width: {sidebarWidth}px">
      <TreeSidebar
        tree={$workspace.tree}
        selected={$selectedLocation}
        rootName={rootDisplayName}
        hasWorkspace={!!$workspace.rootPath}
        rootPath={$workspace.rootPath}
        favorites={$favorites}
        editingFilePath={$editingFilePath}
        editingFolderPath={$editingFolderPath}
        environments={$availableEnvironments}
        activeEnv={$activeEnvironment}
        flows={$flows}
        activeFlowPath={$activeFlowTabPath}
        on:openFolder={openFolder}
        on:openGettingStarted={openGettingStarted}
        on:toggleFavorite={toggleFavorite}
        on:openFavorite={(e) => openFavorite(e.detail)}
        on:removeFavorite={(e) => removeFavorite(e.detail)}
        on:importCollection={() => (showImportCollectionModal = true)}
        on:select={handleSelect}
        on:pinRequest={handlePinRequest}
        on:toggleFolder={handleToggleFolder}
        on:addRequest={handleAddRequest}
        on:deleteRequest={handleDeleteRequest}
        on:deleteFile={handleDeleteFile}
        on:deleteFolder={handleDeleteFolder}
        on:createFile={handleCreateFile}
        on:createFolder={handleCreateFolder}
        on:renameFile={handleRenameFile}
        on:renameFolder={handleRenameFolder}
        on:duplicateFile={handleDuplicateFile}
        on:cancelRename={handleCancelRename}
        on:changeEnv={(e) => activeEnvironment.set(e.detail)}
        on:editEnv={() => (showEnvEditor = true)}
        on:openVarInspector={() => (showVarInspector = true)}
        on:openHelp={() => (showHelp = true)}
        on:openSettings={() => (showSettings = true)}
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
        on:closeFlowTab={(e) => {
          delete flowUIState[e.detail];
          closeFlowTab(e.detail);
        }}
      />
      <div class="main-panels" bind:this={mainPanelsEl} class:dragging>
        {#if showEnvEditor}
          <div class="env-editor-pane">
            <EnvironmentEditor
              envFile={$envFile ?? { $shared: {} }}
              userEnvFile={$userEnvFile}
              activeEnv={$activeEnvironment ?? '$shared'}
              kvState={$keyVaultState}
              on:update={(e) => {
                envFile.set(e.detail);
                saveEnvFile(e.detail);
              }}
              on:changeEnv={(e) => activeEnvironment.set(e.detail)}
              on:close={() => (showEnvEditor = false)}
              on:sourcePref={(e) => {
                varSourcePrefs.update((p) => ({ ...p, [e.detail.key]: e.detail.source }));
              }}
              on:refreshKv={(e) => {
                // Invalidate cache for this env so fresh secrets are fetched
                for (const key of Object.keys(kvCache)) {
                  if (key.startsWith(e.detail + '::')) delete kvCache[key];
                }
                kvCache = kvCache;
                keyVaultState.update((s) => ({ ...s, cacheKey: null }));
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
            runHistory={$flowRunHistory.filter((r) => r.flowFilePath === $activeFlowTabPath)}
            uiState={flowUIState[$activeFlowTabPath] ?? null}
            on:uiStateChange={(e) => {
              flowUIState[$activeFlowTabPath] = e.detail;
              flowUIState = flowUIState;
            }}
            on:save={handleSaveFlow}
            on:run={handleRunFlow}
            on:abort={handleAbortFlow}
            on:clearHistory={() => {
              flowRunHistory.set(
                $flowRunHistory.filter((r) => r.flowFilePath !== $activeFlowTabPath),
              );
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
            <ResponseViewer
              response={$currentResponse}
              loading={$isLoading}
              sentRequest={$currentSentRequest}
              assertionResults={$pbAssertionResults}
              activeTab={activeResponseTab}
              on:tabChange={handleResponseTabChange}
            />
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
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  :global(body) {
    font-family: var(--font-ui);
    background: var(--color-bg);
    color: var(--color-text);
    overflow: hidden;
    font-size: var(--text-md);
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--color-bg);
  }

  .titlebar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    height: 28px;
    padding-right: var(--space-2);
    background: var(--color-bg-sidebar);
    border-bottom: 1px solid var(--color-divider);
    -webkit-app-region: drag;
    user-select: none;
    flex-shrink: 0;
  }
  .mcp-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-size: var(--text-xs);
    font-family: var(--font-mono, monospace);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    -webkit-app-region: no-drag;
    transition:
      background var(--duration-normal),
      border-color var(--duration-normal);
  }
  .mcp-pill:hover {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-primary) 70%, transparent);
  }
  .mcp-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
    box-shadow: 0 0 4px var(--color-primary);
  }
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar-container {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-sidebar);
    flex-shrink: 0;
    overflow: hidden;
  }

  .sidebar-divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--color-divider);
    transition: background var(--duration-normal);
  }
  .sidebar-divider:hover,
  .sidebar-dragging .sidebar-divider {
    background: var(--color-primary);
  }
  .sidebar-dragging {
    cursor: col-resize;
    user-select: none;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .main-panels {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }
  .main-panels.dragging {
    cursor: col-resize;
    user-select: none;
  }
  .editor-pane {
    overflow: auto;
    min-width: 0;
  }
  .response-pane {
    flex: 1;
    overflow: auto;
    min-width: 0;
  }

  .divider {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--color-divider);
    transition: background var(--duration-normal);
  }
  .divider:hover,
  .dragging .divider {
    background: var(--color-primary);
  }
  .env-editor-pane {
    flex: 1;
    overflow: auto;
  }

  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .no-sel-logo {
    width: 360px;
    height: 360px;
    object-fit: contain;
    opacity: 0.45;
  }
</style>
