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
    editingFilePath,
    editingFolderPath,
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
    flowRunHistory,
    flowRunState,
    flowTabs,
    activeFlowTabPath,
    closeFlowTab,
    activateFlowTab,
    activeFlowPath,
    activeFlow,
    favorites,
  } from './lib/stores';
  import {
    refreshKeyVaultSecrets,
    resetKeyVaultCache,
    refreshKeyVaultForEnv,
  } from './lib/keyvaultCache';
  import { serializeHttpFile } from './lib/parser';
  import { substituteAll } from './lib/substitution';
  import type { SubstitutionContext } from './lib/substitution';
  import { errorMessage } from './lib/errors';
  import type { HttpRequest, RequestLocation, EnvironmentFile } from './lib/types';
  import type { BottomTab, ResponseTab } from './lib/stores';
  import { saveFlowRunRecord, clearFlowRunHistory } from './lib/flowIO';
  import { openFolderByPath } from './lib/workspaceIO';
  import { importCollectionContent, applyImportedVariables } from './lib/importIO';
  import { saveFlow, deleteFlow } from './lib/flowOps';
  import { runAllRequests } from './lib/requestOps';
  import { runFlow } from './lib/flowRunner';
  import { executeHttpRequest } from './lib/requestExec';
  import { startMcpBridge } from './lib/mcpBridge';
  import type { PbVarEffects } from './lib/requestExec';
  import type { FlowStepResult, FlowRunRecord } from './lib/types';

  import { open } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { join } from '@tauri-apps/api/path';
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

  async function handleImportEnvConfirm(target: string) {
    showImportEnvModal = false;
    await applyImportedVariables(target, pendingImportVars);
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
  // Cache and fetch live in src/lib/keyvaultCache.ts; App.svelte only owns
  // the environment-change subscription.

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

  function handleBottomTabChange(tab: BottomTab) {
    if ($selectedLocation) {
      setTabBottomTab($selectedLocation, tab);
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

  function handleResponseTabChange(tab: ResponseTab) {
    if ($selectedLocation) {
      setTabResponseTab($selectedLocation, tab);
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
  // Scanning and opening live in src/lib/workspaceIO.ts; the Key Vault hooks
  // reset and refill the per-environment secret cache in lib/keyvaultCache.ts.

  function openWorkspaceFolder(rootPath: string) {
    return openFolderByPath(rootPath, {
      resetCache: resetKeyVaultCache,
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
  // Writing and env-merge live in src/lib/importIO.ts; App.svelte only owns
  // the modal state and shows the env-target modal for returned variables.

  function showEnvModalIfNeeded(vars: import('./lib/types').Variable[]) {
    if (vars.length > 0) {
      pendingImportVars = vars;
      showImportEnvModal = true;
    }
  }

  async function handleImportFile(content: string, format: ImportFormat) {
    showImportCollectionModal = false;
    showEnvModalIfNeeded(await importCollectionContent(content, format));
  }

  async function handleImportUrl(content: string) {
    showImportCollectionModal = false;
    showEnvModalIfNeeded(await importCollectionContent(content, 'openapi'));
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

  function handleSelect(loc: RequestLocation) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
      showEnvEditor = false;
    }
    // Deactivate any flow tab when selecting a request
    activeFlowTabPath.set(null);
    activeFlowPath.set(null);
    const hasTab = $tabs.some(
      (t) => t.location.filePath === loc.filePath && t.location.requestIndex === loc.requestIndex,
    );
    if (hasTab) {
      activateTab(loc);
    } else {
      previewRequest(loc);
    }
  }

  function handlePinRequest(detail: { filePath: string; requestIndex: number; label: string }) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
      showEnvEditor = false;
    }
    pinTab({ filePath: detail.filePath, requestIndex: detail.requestIndex }, detail.label);
  }

  function handleTabActivate(location: RequestLocation) {
    if (showEnvEditor) {
      if ($envFile) saveEnvFile($envFile);
      showEnvEditor = false;
    }
    // Deactivate any flow tab when switching to a request tab
    activeFlowTabPath.set(null);
    activeFlowPath.set(null);
    activateTab(location);
  }

  function handleTabClose(location: RequestLocation) {
    closeTab(location);
  }

  function handleUpdateRequest(updated: HttpRequest) {
    if (!$selectedLocation) return;
    updateRequestInTree($selectedLocation.filePath, $selectedLocation.requestIndex, updated);
  }

  // ─── Flow Handlers ───

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

  async function handleDeleteFlow(path: string) {
    delete flowUIState[path];
    await deleteFlow(path);
  }
</script>

<ToastContainer />
<HelpModal visible={showHelp} onClose={() => (showHelp = false)} />
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
  onClose={() => (showVarInspector = false)}
  onClearRuntime={() => {
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
  onConfirm={handleImportEnvConfirm}
  onSkip={handleImportEnvSkip}
/>
<ImportCollectionModal
  visible={showImportCollectionModal}
  onImportFile={handleImportFile}
  onImportUrl={handleImportUrl}
  onCancel={() => (showImportCollectionModal = false)}
/>
<AddFavoriteModal
  visible={showAddFavoriteModal}
  folderPath={pendingFavoritePath}
  defaultName={pendingFavoriteName}
  onConfirm={confirmAddFavorite}
  onCancel={cancelAddFavorite}
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
        selected={$selectedLocation}
        editingFilePath={$editingFilePath}
        editingFolderPath={$editingFolderPath}
        onOpenFolder={openFolder}
        onOpenGettingStarted={openGettingStarted}
        onToggleFavorite={toggleFavorite}
        onOpenFavorite={openFavorite}
        onRemoveFavorite={removeFavorite}
        onImportCollection={() => (showImportCollectionModal = true)}
        onSelect={handleSelect}
        onPinRequest={handlePinRequest}
        onEditEnv={() => (showEnvEditor = true)}
        onOpenVarInspector={() => (showVarInspector = true)}
        onOpenHelp={() => (showHelp = true)}
        onOpenSettings={() => (showSettings = true)}
        onDeleteFlow={handleDeleteFlow}
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
        onActivate={handleTabActivate}
        onClose={handleTabClose}
        onActivateFlowTab={(flowPath) => activateFlowTab(flowPath)}
        onCloseFlowTab={(flowPath) => {
          delete flowUIState[flowPath];
          closeFlowTab(flowPath);
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
              on:refreshKv={(e) => refreshKeyVaultForEnv(e.detail)}
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
            on:save={(e) => saveFlow(e.detail.flowPath, e.detail.flow)}
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
              onUpdate={handleUpdateRequest}
              onSend={sendRequest}
              onSave={saveActiveFile}
              onRunAll={(deps) => runAllRequests(deps, sendRequest)}
              onBottomTabChange={handleBottomTabChange}
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
              onTabChange={handleResponseTabChange}
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
