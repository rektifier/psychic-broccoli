import { readTextFile, writeTextFile, readDir, mkdir } from '@tauri-apps/plugin-fs';
import { join, basename } from '@tauri-apps/api/path';
import type { FlowDefinition, FlowRunRecord, FlowStep } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const FLOW_EXTENSION = '.pb-flow.json';
const RESULTS_DIR = '.pb-flow-results';
const MAX_HISTORY_PER_FLOW = 50;

// ─── Flow File Parsing / Serialization ───────────────────────────────────────

/** Parse a .pb-flow.json file's contents into a FlowDefinition. */
export function parseFlowFile(content: string): FlowDefinition {
  const raw = JSON.parse(content);
  return {
    version: raw.version ?? 1,
    name: raw.name ?? 'Untitled Flow',
    description: raw.description ?? '',
    steps: Array.isArray(raw.steps) ? raw.steps.map(parseFlowStep) : [],
  };
}

function parseFlowStep(raw: any): FlowStep {
  return {
    id: raw.id ?? crypto.randomUUID(),
    filePath: raw.filePath ?? '',
    requestIndex: raw.requestIndex ?? 0,
    varName: raw.varName ?? null,
    label: raw.label ?? '',
    continueOnFailure: raw.continueOnFailure ?? false,
  };
}

/** Serialize a FlowDefinition to a JSON string for writing to disk. */
export function serializeFlow(flow: FlowDefinition): string {
  return JSON.stringify(flow, null, 2);
}

/** Create a new empty flow with a given name. */
export function createEmptyFlow(name: string): FlowDefinition {
  return {
    version: 1,
    name,
    description: '',
    steps: [],
  };
}

// ─── Flow Discovery ──────────────────────────────────────────────────────────

export interface DiscoveredFlow {
  /** Absolute path to the .pb-flow.json file */
  absolutePath: string;
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
  /** Parsed flow definition */
  flow: FlowDefinition;
}

/** Recursively scan a directory for .pb-flow.json files. */
export async function scanForFlowFiles(dir: string, rootDir: string): Promise<DiscoveredFlow[]> {
  const entries = await readDir(dir);
  const results: DiscoveredFlow[] = [];

  for (const entry of entries) {
    const fullPath = await join(dir, entry.name);
    if (entry.isDirectory) {
      // Skip the results directory
      if (entry.name === RESULTS_DIR) continue;
      results.push(...await scanForFlowFiles(fullPath, rootDir));
    } else if (entry.name.endsWith(FLOW_EXTENSION)) {
      try {
        const content = await readTextFile(fullPath);
        const flow = parseFlowFile(content);
        const relativePath = fullPath.substring(rootDir.length + 1).replaceAll('\\', '/');
        results.push({ absolutePath: fullPath, relativePath, flow });
      } catch {
        // Skip malformed flow files
      }
    }
  }
  return results;
}

// ─── Flow File Writing ───────────────────────────────────────────────────────

/** Write a flow definition to disk. `absolutePath` is the full path to the .pb-flow.json file. */
export async function writeFlowFile(absolutePath: string, flow: FlowDefinition): Promise<void> {
  await writeTextFile(absolutePath, serializeFlow(flow));
}

// ─── Results Persistence ─────────────────────────────────────────────────────

/** Sanitize a flow name into a filesystem-safe directory name. */
function sanitizeFlowName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unnamed';
}

/** Save a flow run record to disk under .pb-flow-results/<flow-name>/. */
export async function saveFlowRunRecord(rootDir: string, record: FlowRunRecord): Promise<void> {
  const dirName = sanitizeFlowName(record.flowName);
  const resultsDir = await join(rootDir, RESULTS_DIR, dirName);
  try {
    await mkdir(resultsDir, { recursive: true });
  } catch { /* already exists */ }

  const timestamp = record.startedAt.replace(/[:.]/g, '-');
  const filePath = await join(resultsDir, `${timestamp}.json`);
  await writeTextFile(filePath, JSON.stringify(record, null, 2));
}

/** Load all flow run history from .pb-flow-results/. Returns records sorted newest first. */
export async function loadFlowHistory(rootDir: string): Promise<FlowRunRecord[]> {
  const resultsRoot = await join(rootDir, RESULTS_DIR);
  const records: FlowRunRecord[] = [];

  let flowDirs: { name: string; isDirectory: boolean }[];
  try {
    flowDirs = await readDir(resultsRoot) as any[];
  } catch {
    return []; // No results directory yet
  }

  for (const flowDir of flowDirs) {
    if (!flowDir.isDirectory) continue;

    const flowDirPath = await join(resultsRoot, flowDir.name);
    let files: { name: string; isDirectory: boolean }[];
    try {
      files = await readDir(flowDirPath) as any[];
    } catch {
      continue;
    }

    // Sort by name descending (newest first) and limit
    const jsonFiles = files
      .filter(f => !f.isDirectory && f.name.endsWith('.json'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, MAX_HISTORY_PER_FLOW);

    for (const file of jsonFiles) {
      try {
        const filePath = await join(flowDirPath, file.name);
        const content = await readTextFile(filePath);
        const record = JSON.parse(content) as FlowRunRecord;
        records.push(record);
      } catch {
        // Skip malformed records
      }
    }
  }

  // Sort all records newest first
  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return records;
}
