import { readTextFile, writeTextFile, readDir, mkdir, remove, rename } from '@tauri-apps/plugin-fs';
import type { DirEntry } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { FlowDefinition, FlowRunRecord, FlowStep, FlowStepOverrides } from './types';
import { applyAliasSync } from './flowAlias';

// ─── Constants ───────────────────────────────────────────────────────────────

const FLOW_EXTENSION = '.pb-flow.json';
export const FLOWS_DIR = '.flows';
const RESULTS_DIR = `${FLOWS_DIR}/.results`;
const MAX_HISTORY_PER_FLOW = 20;

// ─── Flow File Parsing / Serialization ───────────────────────────────────────

/** Parse a .pb-flow.json file's contents into a FlowDefinition. */
export function parseFlowFile(content: string): FlowDefinition {
  const raw = asRecord(JSON.parse(content));
  const steps = Array.isArray(raw.steps) ? raw.steps.map(parseFlowStep) : [];
  // One-time normalization: ensures every step has an auto alias if unlocked.
  // Legacy flows without `aliasLocked`: parseFlowStep infers it from varName presence.
  const normalized = applyAliasSync(steps);
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled Flow',
    description: typeof raw.description === 'string' ? raw.description : '',
    steps: normalized,
  };
}

/** Narrow an unknown JSON value to a plain record, treating anything else as empty. */
function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}

function parseOverrides(raw: unknown): FlowStepOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const o: FlowStepOverrides = {};
  if (typeof r.url === 'string') o.url = r.url;
  if (Array.isArray(r.headers)) o.headers = r.headers as FlowStepOverrides['headers'];
  if (typeof r.body === 'string') o.body = r.body;
  if (Array.isArray(r.directives)) o.directives = r.directives as FlowStepOverrides['directives'];
  return Object.keys(o).length > 0 ? o : undefined;
}

function parseFlowStep(raw: unknown): FlowStep {
  const r = asRecord(raw);
  const varName = typeof r.varName === 'string' ? r.varName : null;
  // Legacy flows don't carry `aliasLocked`. Infer:
  //   - explicit boolean: honor it
  //   - varName matches auto shape `Step{N}`: treat as auto (re-normalized)
  //   - non-null custom varName: preserve as locked
  //   - null varName: auto
  const aliasLocked =
    typeof r.aliasLocked === 'boolean'
      ? r.aliasLocked
      : varName != null && !/^Step\d+$/.test(varName);
  return {
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    filePath: typeof r.filePath === 'string' ? r.filePath : '',
    requestIndex: typeof r.requestIndex === 'number' ? r.requestIndex : 0,
    varName,
    aliasLocked,
    label: typeof r.label === 'string' ? r.label : '',
    continueOnFailure: r.continueOnFailure === true,
    overrides: parseOverrides(r.overrides),
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

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Renames legacy `flows/` to `.flows/` if `flows/` exists and `.flows/` does not.
 * Returns true if migration was performed, false otherwise.
 */
export async function migrateFlowsDirectory(rootPath: string): Promise<boolean> {
  const legacyDir = await join(rootPath, 'flows');
  const dotDir = await join(rootPath, FLOWS_DIR);

  let legacyExists = false;
  try {
    await readDir(legacyDir);
    legacyExists = true;
  } catch {
    // flows/ doesn't exist
  }

  if (!legacyExists) return false;

  let dotExists = false;
  try {
    await readDir(dotDir);
    dotExists = true;
  } catch {
    // .flows/ doesn't exist - good, proceed with migration
  }

  if (dotExists) return false;

  await rename(legacyDir, dotDir);
  return true;
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

/** Scan the flows/ directory for .pb-flow.json files. */
export async function scanForFlowFiles(dir: string, rootDir: string): Promise<DiscoveredFlow[]> {
  const flowsDir = await join(rootDir, FLOWS_DIR);
  let entries: DirEntry[];
  try {
    entries = await readDir(flowsDir);
  } catch {
    return []; // .flows/ directory doesn't exist yet
  }

  const results: DiscoveredFlow[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.name.endsWith(FLOW_EXTENSION)) continue;
    try {
      const fullPath = await join(flowsDir, entry.name);
      const content = await readTextFile(fullPath);
      const flow = parseFlowFile(content);
      const relativePath = `${FLOWS_DIR}/${entry.name}`;
      results.push({ absolutePath: fullPath, relativePath, flow });
    } catch {
      // Skip malformed flow files
    }
  }
  return results;
}

// ─── Flow File Writing ───────────────────────────────────────────────────────

/** Write a flow definition to disk. `absolutePath` is the full path to the .pb-flow.json file. */
export async function writeFlowFile(absolutePath: string, flow: FlowDefinition): Promise<void> {
  await writeTextFile(absolutePath, serializeFlow(flow));
}

// ─── Secret Redaction ────────────────────────────────────────────────────────

const REDACTED = '***';

/**
 * Header names whose values are credentials and must never be persisted.
 * Matches exact auth/cookie headers plus any name containing api-key / secret /
 * token / password / auth, regardless of source (env var, .env, or Key Vault).
 */
const SENSITIVE_HEADER_RE =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|www-authenticate)$|api[-_]?key|secret|token|password|passwd|auth/i;

function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_RE.test(name);
}

/**
 * Recursively build a redacted copy of a value:
 *  - any string occurrence of a known secret value is replaced with `***`
 *  - inside a `headers` map, values under a sensitive header name are replaced
 * Returns new objects/arrays, leaving the input untouched (so the in-memory
 * record the UI shows during the session keeps real values).
 */
function redactNode(node: unknown, secrets: string[], parentKey: string): unknown {
  if (typeof node === 'string') {
    let s = node;
    for (const secret of secrets) s = s.split(secret).join(REDACTED);
    return s;
  }
  if (Array.isArray(node)) {
    return node.map((n) => redactNode(n, secrets, parentKey));
  }
  if (node && typeof node === 'object') {
    const isHeaders = parentKey === 'headers';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] =
        isHeaders && typeof v === 'string' && isSensitiveHeaderName(k)
          ? REDACTED
          : redactNode(v, secrets, k);
    }
    return out;
  }
  return node;
}

/**
 * Produce a copy of a flow run record safe to write to disk: configured secret
 * values (e.g. resolved Key Vault entries) are scrubbed everywhere they appear,
 * and sensitive request/response headers are redacted by name. The original
 * record is not mutated.
 */
export function redactFlowRunRecord(
  record: FlowRunRecord,
  secretValues: string[] = [],
): FlowRunRecord {
  // Ignore trivially short values to avoid mangling unrelated text.
  const secrets = secretValues.filter((v) => typeof v === 'string' && v.length >= 4);
  return redactNode(record, secrets, '') as FlowRunRecord;
}

// ─── Results Persistence ─────────────────────────────────────────────────────

/** Sanitize a flow name into a filesystem-safe directory name. */
function sanitizeFlowName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed'
  );
}

/**
 * Save a flow run record to disk under .flows/.results/<flow-name>/.
 * `secretValues` are scrubbed from the persisted copy so no credentials are
 * written to history; the caller passes resolved secrets (e.g. Key Vault values).
 */
export async function saveFlowRunRecord(
  rootDir: string,
  record: FlowRunRecord,
  secretValues: string[] = [],
): Promise<void> {
  const dirName = sanitizeFlowName(record.flowName);
  const resultsDir = await join(rootDir, RESULTS_DIR, dirName);
  try {
    await mkdir(resultsDir, { recursive: true });
  } catch {
    /* already exists */
  }

  const timestamp = record.startedAt.replace(/[:.]/g, '-');
  const filePath = await join(resultsDir, `${timestamp}.json`);
  const safeRecord = redactFlowRunRecord(record, secretValues);
  await writeTextFile(filePath, JSON.stringify(safeRecord, null, 2));

  // Prune old records beyond the limit
  await pruneFlowHistory(resultsDir);
}

/** Delete the oldest run records if the count exceeds MAX_HISTORY_PER_FLOW. */
async function pruneFlowHistory(resultsDir: string): Promise<void> {
  try {
    const files = await readDir(resultsDir);
    const jsonFiles = files
      .filter((f) => !f.isDirectory && f.name.endsWith('.json'))
      .sort((a, b) => b.name.localeCompare(a.name));

    if (jsonFiles.length <= MAX_HISTORY_PER_FLOW) return;

    const toDelete = jsonFiles.slice(MAX_HISTORY_PER_FLOW);
    for (const file of toDelete) {
      try {
        const filePath = await join(resultsDir, file.name);
        await remove(filePath);
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* best effort */
  }
}

/** Delete all persisted run records for a given flow name. */
export async function clearFlowRunHistory(rootDir: string, flowName: string): Promise<void> {
  const dirName = sanitizeFlowName(flowName);
  const resultsDir = await join(rootDir, RESULTS_DIR, dirName);
  try {
    await remove(resultsDir, { recursive: true });
  } catch {
    /* directory may not exist */
  }
}

/** Load all flow run history from .pb-flow-results/. Returns records sorted newest first. */
export async function loadFlowHistory(rootDir: string): Promise<FlowRunRecord[]> {
  const resultsRoot = await join(rootDir, RESULTS_DIR);
  const records: FlowRunRecord[] = [];

  let flowDirs: DirEntry[];
  try {
    flowDirs = await readDir(resultsRoot);
  } catch {
    return []; // No results directory yet
  }

  for (const flowDir of flowDirs) {
    if (!flowDir.isDirectory) continue;

    const flowDirPath = await join(resultsRoot, flowDir.name);
    let files: DirEntry[];
    try {
      files = await readDir(flowDirPath);
    } catch {
      continue;
    }

    // Sort by name descending (newest first) and limit
    const jsonFiles = files
      .filter((f) => !f.isDirectory && f.name.endsWith('.json'))
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
