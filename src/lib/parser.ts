import type {
  HttpRequest,
  HttpMethod,
  HttpHeader,
  Variable,
  EnvironmentFile,
  EnvironmentVariables,
  PbDirective,
  TreeNode,
  FileNode,
  FolderNode,
  VarSourceLayer,
  ResolvedVarWithCascade,
} from './types';
import { SIMPLE_VAR_RE } from './substitution';
import { PB_DIRECTIVE_RE, PB_SECTION_RE, BARE_PB_RE, parsePbDirective } from './pbScript';

// ─── Temporary re-exports ───────────────────────────────────────────────────
// parser.ts was split into focused modules (substitution.ts, pbScript.ts).
// These re-exports keep existing `from './parser'` imports working; a
// follow-up updates the importers and drops them.

export { substituteAll, substituteVariables } from './substitution';
export type { SubstitutionContext } from './substitution';
export {
  evaluatePbExpression,
  parseScriptText,
  executePbDirectives,
  applyRequestMutations,
} from './pbScript';
export type { RequestMutations, PbExecutionResult } from './pbScript';

// ─── Constants ──────────────────────────────────────────────────────────────

const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
];

const METHOD_PATTERN = METHODS.join('|');

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/** Request line: METHOD URL [HTTP/version] */
const REQUEST_LINE_RE = new RegExp(`^(${METHOD_PATTERN})\\s+(.+?)(?:\\s+HTTP\\/[\\d.]+)?\\s*$`);

/** Header: Key: Value */
const HEADER_RE = /^([A-Za-z0-9\-_]+)\s*:\s*(.+)$/;

/** File-level variable: @name = value */
const VARIABLE_RE = /^@(\w+)\s*=\s*(.+)$/;

/** Request separator: ### [optional name] */
const SEPARATOR_RE = /^###\s*(.*)?$/;

/** Comment line: # ... or // ... */
const COMMENT_RE = /^(#(?!##)|\/\/)/;

/** Request variable name: # @name foo  or  // @name foo
 *  Allowed characters: letters, digits, underscore, hyphen (aligns with JetBrains HTTP Client spec). */
const NAME_DIRECTIVE_RE = /^(?:#|\/\/)\s*@name\s+([\w-]+)\s*$/;

// ─── ID Generator ───────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `req_${Date.now()}_${++idCounter}`;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

export interface ParseResult {
  requests: HttpRequest[];
  /** File-level @variable declarations */
  variables: Variable[];
}

/**
 * Parse a .http file string into requests and variables.
 *
 * Supports the full Visual Studio / VS Code REST Client syntax:
 *   - ### separators with optional names
 *   - # and // comments (outside bodies; inside a body they are kept as
 *     content unless they match a directive: # @name, # @pb.*, or ###)
 *   - # @name / // @name request variable naming
 *   - @variable = value declarations (can reference earlier variables)
 *   - {{variable}} substitution
 *   - Request line: METHOD URL [HTTP/version]
 *   - Headers (no blank line between request line and headers)
 *   - Body after blank line
 *   - TRACE and CONNECT methods
 */
export function parseHttpFile(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const variables: Variable[] = [];
  const requests: HttpRequest[] = [];

  let currentName = '';
  let currentVarName: string | null = null;
  let currentMethod: HttpMethod | null = null;
  let currentUrl = '';
  let currentHeaders: HttpHeader[] = [];
  let currentBody: string[] = [];
  let currentDirectives: PbDirective[] = [];
  let currentBeforeSend: string[] = [];
  let currentAfterReceive: string[] = [];
  let currentScriptSection: 'beforeSend' | 'afterReceive' | null = null;
  let inBody = false;
  let hasRequest = false;

  function flushRequest() {
    if (currentMethod && currentUrl) {
      const req: HttpRequest = {
        id: nextId(),
        name: currentName || `${currentMethod} ${currentUrl}`,
        varName: currentVarName,
        method: currentMethod,
        url: currentUrl,
        headers: currentHeaders,
        body: currentBody.join('\n').trim(),
        directives: currentDirectives,
      };
      const bs = currentBeforeSend.join('\n').trim();
      const ar = currentAfterReceive.join('\n').trim();
      if (bs) req.beforeSend = bs;
      if (ar) req.afterReceive = ar;
      requests.push(req);
    }
    currentName = '';
    currentVarName = null;
    currentMethod = null;
    currentUrl = '';
    currentHeaders = [];
    currentBody = [];
    currentDirectives = [];
    currentBeforeSend = [];
    currentAfterReceive = [];
    currentScriptSection = null;
    inBody = false;
    hasRequest = false;
  }

  for (const line of lines) {
    // ── Separator: ### [name] ──
    const sepMatch = line.match(SEPARATOR_RE);
    if (sepMatch) {
      flushRequest();
      currentName = sepMatch[1]?.trim() || '';
      continue;
    }

    // ── Request variable name directive: # @name foo ──
    const nameMatch = line.match(NAME_DIRECTIVE_RE);
    if (nameMatch) {
      // If we're not yet in a request, this names the NEXT request.
      // If we already have a request, flush it first.
      if (hasRequest) {
        flushRequest();
      }
      currentVarName = nameMatch[1];
      if (!currentName) {
        currentName = nameMatch[1]; // Use varName as display name fallback
      }
      continue;
    }

    // ── Pb script section markers: # @pb.beforeSend, # @pb.afterReceive ──
    const sectionMatch = line.match(PB_SECTION_RE);
    if (sectionMatch) {
      currentScriptSection = sectionMatch[1] as 'beforeSend' | 'afterReceive';
      continue;
    }

    // ── Pb directives: # @pb.set(...), # @pb.assert(...), # @pb.global(...) ──
    const pbMatch = line.match(PB_DIRECTIVE_RE);
    if (pbMatch) {
      if (currentScriptSection) {
        // Convert comment-prefixed back to bare form for the textarea
        const bare = `pb.${pbMatch[1]}(${pbMatch[2]})`;
        if (currentScriptSection === 'beforeSend') {
          currentBeforeSend.push(bare);
        } else {
          currentAfterReceive.push(bare);
        }
      } else {
        const directive = parsePbDirective(pbMatch[1], pbMatch[2]);
        if (directive) currentDirectives.push(directive);
      }
      continue;
    }

    // ── Comment lines (# or //) — skip, unless inside a body where they
    //    are content (directives above are still handled first) ──
    if (!inBody && COMMENT_RE.test(line)) {
      continue;
    }

    // ── Variable declaration: @name = value ──
    const varMatch = line.match(VARIABLE_RE);
    if (varMatch && !hasRequest) {
      let value = varMatch[2].trim();
      // Variables can reference earlier variables: @host={{hostname}}:{{port}}
      value = resolveVariableReferences(value, variables);
      variables.push({ key: varMatch[1], value });
      continue;
    }

    // ── Request line: METHOD URL [HTTP/version] ──
    const reqMatch = line.match(REQUEST_LINE_RE);
    if (reqMatch && !hasRequest) {
      currentMethod = reqMatch[1] as HttpMethod;
      currentUrl = reqMatch[2].trim();
      hasRequest = true;
      continue;
    }

    // ── Inside a request ──
    if (hasRequest) {
      // Blank line → transition to body
      if (line.trim() === '' && !inBody) {
        inBody = true;
        continue;
      }

      if (inBody) {
        currentBody.push(line);
      } else {
        // Header: Key: Value
        const headerMatch = line.match(HEADER_RE);
        if (headerMatch) {
          currentHeaders.push({
            key: headerMatch[1],
            value: headerMatch[2].trim(),
            enabled: true,
          });
        }
      }
    }
  }

  // Flush the last request
  flushRequest();

  return { requests, variables };
}

/**
 * Resolve {{var}} references within a variable definition using
 * already-defined variables. This supports:
 *   @hostname=localhost
 *   @port=44320
 *   @host={{hostname}}:{{port}}
 */
function resolveVariableReferences(value: string, definedVars: Variable[]): string {
  return value.replace(SIMPLE_VAR_RE, (match, name) => {
    const found = definedVars.find((v) => v.key === name);
    return found ? found.value : match;
  });
}

// ─── Serializer ─────────────────────────────────────────────────────────────

/**
 * Serialize requests back to .http file format.
 */
export function serializeHttpFile(requests: HttpRequest[], variables: Variable[] = []): string {
  const parts: string[] = [];

  // Write variables at the top
  for (const v of variables) {
    parts.push(`@${v.key} = ${v.value}`);
  }
  if (variables.length > 0) {
    parts.push('');
  }

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];

    if (i > 0) {
      parts.push('');
    }

    // Separator with name
    parts.push(`### ${req.name}`);

    // If this request has a variable name, emit the @name directive
    if (req.varName) {
      parts.push(`# @name ${req.varName}`);
    }

    // Request line
    parts.push(`${req.method} ${req.url}`);

    // Headers
    for (const h of req.headers) {
      if (h.enabled) {
        parts.push(`${h.key}: ${h.value}`);
      }
    }

    // Body
    if (req.body.trim()) {
      parts.push('');
      parts.push(req.body);
    }

    // Pb directives
    if (req.directives && req.directives.length > 0) {
      parts.push('');
      for (const d of req.directives) {
        switch (d.type) {
          case 'set':
            parts.push(`# @pb.set("${d.key}", ${d.expr})`);
            break;
          case 'global':
            parts.push(`# @pb.global("${d.key}", ${d.expr})`);
            break;
          case 'assert':
            parts.push(`# @pb.assert(${d.expr}, "${d.label}")`);
            break;
        }
      }
    }

    // Before-send scripts
    if (req.beforeSend?.trim()) {
      if (!req.directives || req.directives.length === 0) parts.push('');
      parts.push('# @pb.beforeSend');
      for (const line of req.beforeSend.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Wrap bare pb.* lines in comment-directive syntax
        if (trimmed.match(BARE_PB_RE)) {
          parts.push(`# @${trimmed}`);
        } else {
          parts.push(trimmed);
        }
      }
    }

    // After-receive scripts
    if (req.afterReceive?.trim()) {
      if ((!req.directives || req.directives.length === 0) && !req.beforeSend?.trim())
        parts.push('');
      parts.push('# @pb.afterReceive');
      for (const line of req.afterReceive.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.match(BARE_PB_RE)) {
          parts.push(`# @${trimmed}`);
        } else {
          parts.push(trimmed);
        }
      }
    }
  }

  parts.push(''); // trailing newline
  return parts.join('\n');
}

// ─── Environment File Handling ──────────────────────────────────────────────

/**
 * Parse an http-client.env.json file contents.
 */
export function parseEnvironmentFile(jsonString: string): EnvironmentFile | null {
  try {
    return JSON.parse(jsonString) as EnvironmentFile;
  } catch {
    return null;
  }
}

/**
 * Ensure `$shared` exists on an env file as a baseline for the variable resolution cascade.
 * Mutates and returns the passed object. No-op when `$shared` already exists.
 */
export function ensureSharedEnvironment(envFile: EnvironmentFile): EnvironmentFile {
  if (!envFile['$shared']) {
    envFile['$shared'] = {};
  }
  return envFile;
}

/**
 * Get the list of selectable environment names from an env file.
 * Excludes the special "$shared" environment.
 */
export function getEnvironmentNames(envFile: EnvironmentFile | null): string[] {
  if (!envFile) return [];
  return Object.keys(envFile).filter((k) => k !== '$shared');
}

/**
 * Resolve variables for a given environment name.
 *
 * Resolution order (highest priority first):
 *   1. .user file env-specific variables
 *   2. env file env-specific variables
 *   3. .user file $shared variables
 *   4. env file $shared variables
 *
 * Note: file-level @variables override ALL of the above,
 * but that's handled in substituteAll(), not here.
 */
export function resolveEnvironmentVariables(
  envName: string,
  envFile: EnvironmentFile | null,
  userEnvFile: EnvironmentFile | null,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  // 4. env file $shared (lowest priority)
  mergeEnvVars(resolved, envFile?.['$shared']);

  // 3. .user file $shared
  mergeEnvVars(resolved, userEnvFile?.['$shared']);

  // 2. env file env-specific
  mergeEnvVars(resolved, envFile?.[envName]);

  // 1. .user file env-specific (highest priority)
  mergeEnvVars(resolved, userEnvFile?.[envName]);

  return resolved;
}

/**
 * Merge environment variables into a target map.
 * Skips provider-based variables (Azure Key Vault, DPAPI, etc.)
 * since those require platform-specific APIs to resolve.
 */
function mergeEnvVars(
  target: Record<string, string>,
  source: EnvironmentVariables | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (key === '$keyvault') continue;
    if (typeof value === 'string') {
      target[key] = value;
    } else if (typeof value === 'object' && value !== null && 'provider' in value) {
      // Provider-based variable — mark as placeholder
      // In a full Tauri app, you'd resolve these via the appropriate API.
      target[key] = `[${value.provider}:${(value as any).secretName || key}]`;
    }
  }
}

/**
 * Like resolveEnvironmentVariables but tracks the source layer and full cascade
 * for each variable. Used by display components to show where values come from.
 */
export function resolveEnvironmentVariablesWithSource(
  envName: string,
  envFile: EnvironmentFile | null,
  userEnvFile: EnvironmentFile | null,
): Record<string, ResolvedVarWithCascade> {
  const result: Record<string, ResolvedVarWithCascade> = {};

  const layers: Array<{ source: VarSourceLayer; vars: EnvironmentVariables | undefined }> = [
    { source: 'shared', vars: envFile?.['$shared'] },
    { source: 'user-shared', vars: userEnvFile?.['$shared'] },
    { source: 'env', vars: envFile?.[envName] },
    { source: 'user-env', vars: userEnvFile?.[envName] },
  ];

  for (const { source, vars } of layers) {
    if (!vars) continue;
    for (const [key, raw] of Object.entries(vars)) {
      if (key === '$keyvault') continue;
      let value: string;
      if (typeof raw === 'string') {
        value = raw;
      } else if (typeof raw === 'object' && raw !== null && 'provider' in raw) {
        value = `[${raw.provider}:${(raw as any).secretName || key}]`;
      } else {
        continue;
      }

      const entry = { source, value };
      if (result[key]) {
        result[key].cascade.push(entry);
        result[key].value = value;
        result[key].source = source;
      } else {
        result[key] = { value, source, cascade: [entry] };
      }
    }
  }

  return result;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new empty request.
 */
export function createEmptyRequest(name?: string): HttpRequest {
  return {
    id: nextId(),
    name: name || 'New Request',
    varName: null,
    method: 'GET',
    url: 'https://',
    headers: [],
    body: '',
    directives: [],
  };
}

// ─── Workspace Tree Builder ─────────────────────────────────────────────────

/**
 * An entry discovered on disk: a file path + its raw content.
 * The path is relative to the workspace root.
 */
export interface DiscoveredFile {
  /** Absolute path */
  absolutePath: string;
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
  /** Raw file contents */
  content: string;
}

/** A directory discovered on disk with no .http files (empty or non-http-only). */
export interface DiscoveredFolder {
  /** Path relative to workspace root, using '/' separators */
  relativePath: string;
}

/**
 * Create a FileNode from a parsed .http file.
 */
export function createFileNode(absolutePath: string, fileName: string, content: string): FileNode {
  const { requests, variables } = parseHttpFile(content);
  const reqs = requests.length > 0 ? requests : [createEmptyRequest()];
  const savedContent = serializeHttpFile(reqs, variables);
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables,
    dirty: false,
    savedContent,
  };
}

/**
 * Build a workspace tree from a flat list of discovered .http files and optional empty folders.
 * All FolderNode.path values are absolute (joining rootDir with the relative folder path).
 *
 * Input:  [ { relativePath: "Customers/auth.http", ... }, ... ]
 * Output: FolderNode("Customers") → FileNode("auth.http") → requests
 */
export function buildWorkspaceTree(
  files: DiscoveredFile[],
  emptyFolders: DiscoveredFolder[] = [],
  rootDir = '',
): TreeNode[] {
  const root: TreeNode[] = [];

  // Build an absolute path from the root and a relative folder path.
  // Uses the same separator logic as the absolutePath values in DiscoveredFile.
  function absPath(relPath: string): string {
    if (!rootDir) return relPath;
    const sep = rootDir.includes('\\') ? '\\' : '/';
    return rootDir + sep + relPath.replaceAll('/', sep);
  }

  function ensureFolder(relativePath: string): void {
    const parts = relativePath.split('/');
    let currentLevel = root;
    let currentRelPath = '';

    for (const folderName of parts) {
      currentRelPath += (currentRelPath ? '/' : '') + folderName;

      let folder = currentLevel.find(
        (n): n is FolderNode => n.type === 'folder' && n.name === folderName,
      );

      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: absPath(currentRelPath),
          children: [],
          expanded: false,
        };
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }
  }

  // Pre-create all discovered empty/empty-subtree folder paths so they appear in the tree
  const sortedFolders = [...emptyFolders]
    .filter((f) => !f.relativePath.startsWith('.'))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const folder of sortedFolders) {
    ensureFolder(folder.relativePath);
  }

  // Sort files so folder structure is stable
  const sorted = [...files]
    .filter((f) => !f.relativePath.startsWith('.'))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    const parts = file.relativePath.split('/');
    const fileName = parts.pop()!;

    // Walk/create folder path
    let currentLevel = root;
    let currentRelPath = '';

    for (const folderName of parts) {
      currentRelPath += (currentRelPath ? '/' : '') + folderName;

      let folder = currentLevel.find(
        (n): n is FolderNode => n.type === 'folder' && n.name === folderName,
      );

      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: absPath(currentRelPath),
          children: [],
          expanded: false,
        };
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }

    // Create file node at the correct level
    const fileNode = createFileNode(file.absolutePath, fileName, file.content);
    currentLevel.push(fileNode);
  }

  return root;
}

/**
 * Create a new empty .http file node for adding to the tree.
 */
export function createEmptyFileNode(absolutePath: string, fileName: string): FileNode {
  const reqs = [createEmptyRequest('New Request')];
  return {
    type: 'file',
    name: fileName,
    path: absolutePath,
    requests: reqs,
    variables: [],
    dirty: true,
    savedContent: '',
  };
}

// ─── Import Helpers ─────────────────────────────────────────────────────────

/**
 * Scan generated .http file content for {{variableName}} references.
 * Returns a deduplicated, sorted list of variables. Known variables
 * (from the source collection) carry their original values; unknown
 * ones get an empty value so the user can fill them in.
 */
export function extractVariableRefs(
  files: { content: string }[],
  knownVars: Variable[],
): Variable[] {
  const knownMap = new Map(knownVars.map((v) => [v.key, v.value]));
  const found = new Set<string>();
  const re = /\{\{([^${}][^{}]*?)\}\}/g;

  for (const file of files) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content)) !== null) {
      const name = match[1].trim();
      // Skip dynamic vars and request variable refs (contain dots)
      if (!name.includes('.')) {
        found.add(name);
      }
    }
  }

  return Array.from(found)
    .sort()
    .map((name) => ({
      key: name,
      value: knownMap.get(name) ?? '',
    }));
}
