// ─── HTTP Methods ───────────────────────────────────────────────────────────
// Full set from the Visual Studio .http spec, including TRACE and CONNECT.

export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  | 'HEAD' | 'OPTIONS' | 'TRACE' | 'CONNECT';

// ─── Request / Response ─────────────────────────────────────────────────────

export interface HttpHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequest {
  id: string;
  /** Display name shown in the sidebar */
  name: string;
  /** Optional request variable name set via `# @name foo` */
  varName: string | null;
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body: string;
  /** Pb script directives (`# @pb.set(...)`, `# @pb.assert(...)`, etc.) */
  directives: PbDirective[];
  /** Scripts to run before the request is sent */
  beforeSend?: string;
  /** Scripts to run after the response is received */
  afterReceive?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
}

// ─── File Model ─────────────────────────────────────────────────────────────

export interface HttpFile {
  path: string | null;
  name: string;
  requests: HttpRequest[];
  variables: Variable[];
  dirty: boolean;
}

// ─── Workspace Tree ─────────────────────────────────────────────────────────

export interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
  expanded: boolean;
}

export interface FileNode {
  type: 'file';
  name: string;
  path: string;
  requests: HttpRequest[];
  variables: Variable[];
  dirty: boolean;
  /** Serialized content at last save/load, used to detect real changes */
  savedContent: string;
}

export type TreeNode = FolderNode | FileNode;

/** Identifies a specific request within the workspace tree. */
export interface RequestLocation {
  /** Path to the .http file */
  filePath: string;
  /** Index of the request within that file */
  requestIndex: number;
}

/** Top-level workspace state. */
export interface Workspace {
  rootPath: string | null;
  rootName: string;
  tree: TreeNode[];
}

// ─── Variables ──────────────────────────────────────────────────────────────

export interface Variable {
  key: string;
  value: string;
}

// ─── Environments ───────────────────────────────────────────────────────────

/** Provider-based variable (Azure Key Vault, DPAPI, ASP.NET User Secrets). */
export interface ProviderVariable {
  provider: string;
  [key: string]: string;
}

/** A $keyvault configuration block within an environment. */
export interface KeyVaultConfig extends ProviderVariable {
  provider: 'AzureKeyVault';
  vaultUrl: string;
  secretName: string;
}

/** A single named environment maps variable names to values (or provider objects).
 *  The special `$keyvault` key holds a KeyVaultConfig block (not a variable). */
export type EnvironmentVariables = Record<string, string | ProviderVariable> & {
  $keyvault?: KeyVaultConfig;
};

/** The full structure of an http-client.env.json file. */
export type EnvironmentFile = Record<string, EnvironmentVariables>;

/** Resolved environment state used at runtime. */
export interface EnvironmentState {
  /** Contents of http-client.env.json */
  envFile: EnvironmentFile | null;
  /** Contents of http-client.env.json.user (overrides envFile) */
  userEnvFile: EnvironmentFile | null;
  /** Currently selected environment name (e.g. "dev", "remote") */
  activeEnvironment: string | null;
  /** All available environment names (excluding $shared) */
  availableEnvironments: string[];
}

// ─── Key Vault ─────────────────────────────────────────────────────────────

/** Source tag for a resolved variable. */
export type VarSource = 'local' | 'keyvault' | 'user-local';

/** Identifies which layer in the 4-level priority chain a variable came from. */
export type VarSourceLayer = 'shared' | 'user-shared' | 'env' | 'user-env';

/** A resolved variable with its winning source layer. */
export interface ResolvedVar {
  value: string;
  source: VarSourceLayer;
}

/** A resolved variable with full cascade showing all layers where it is defined. */
export interface ResolvedVarWithCascade extends ResolvedVar {
  /** Every layer that defines this variable, ordered lowest to highest priority. */
  cascade: Array<{ source: VarSourceLayer; value: string }>;
}

/** Key Vault fetch state for a single environment. */
export interface KeyVaultState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  variables: Record<string, string>;
  error: string | null;
  /** Which environment + vault this was fetched for (cache key). */
  cacheKey: string | null;
}

// ─── Import / Conversion ────────────────────────────────────────────────────

/** A single converted .http file produced by an importer (Postman, Insomnia, etc.). */
export interface ConvertedFile {
  /** Suggested file path relative to output folder (e.g. "Users/Get Users.http") */
  relativePath: string;
  /** .http file content */
  content: string;
}

/** Result returned by collection importers. */
export interface ImportResult {
  files: ConvertedFile[];
  collectionName: string;
  /** Collection-level variables (defined explicitly in the source collection) */
  variables: Variable[];
  /**
   * All {{variable}} references found across requests, for environment file population.
   * Includes both collection-defined variables (with values) and undefined ones (empty value).
   */
  discoveredVariables: Variable[];
}

// ─── Pb Script Directives ───────────────────────────────────────────────────

/** A parsed `# @pb.*` directive attached to a request. */
export type PbDirective =
  | { type: 'set'; key: string; expr: string; enabled?: boolean }
  | { type: 'global'; key: string; expr: string; enabled?: boolean }
  | { type: 'assert'; expr: string; label: string; enabled?: boolean };

/** Result of a single pb.assert() assertion. */
export interface PbAssertionResult {
  label: string;
  passed: boolean;
}

// ─── Request Variable References ────────────────────────────────────────────

/** Stored response for a named request, enabling request variable chaining. */
export interface NamedRequestResult {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  response: HttpResponse;
}

// ─── Test Flows ──────────────────────────────────────────────────────────────

/** Per-step overrides that replace corresponding fields from the base request. */
export interface FlowStepOverrides {
  url?: string;
  headers?: HttpHeader[];
  body?: string;
  directives?: PbDirective[];
  beforeSend?: string;
  afterReceive?: string;
}

/** A single step in a test flow, referencing a request in a .http file. */
export interface FlowStep {
  /** Unique identifier for this step within the flow */
  id: string;
  /** Relative path from workspace root to the .http file (forward slashes) */
  filePath: string;
  /** Index of the request within that file */
  requestIndex: number;
  /** @name alias from the request, used as fallback when indices shift */
  varName: string | null;
  /** Cached display label (e.g. "POST /api/login") */
  label: string;
  /** If true, the runner continues to the next step even if this step fails */
  continueOnFailure: boolean;
  /** Optional per-step overrides that replace base request fields without modifying the .http file */
  overrides?: FlowStepOverrides;
}

/** A test flow definition stored as a .pb-flow.json file. */
export interface FlowDefinition {
  version: number;
  name: string;
  description: string;
  steps: FlowStep[];
}

/** Execution status of a single flow step. */
export type FlowStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/** Result of executing a single flow step. */
export interface FlowStepResult {
  stepId: string;
  status: FlowStepStatus;
  /** HTTP response if the step was executed */
  response: HttpResponse | null;
  /** Resolved request that was actually sent */
  sentRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  } | null;
  /** Assertion results from pb directives */
  assertionResults: PbAssertionResult[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if the request failed at the network level */
  error: string | null;
}

/** Overall status of a flow run. */
export type FlowRunStatus = 'idle' | 'running' | 'completed' | 'aborted';

/** A persisted record of a single flow run. */
export interface FlowRunRecord {
  /** Unique run identifier */
  id: string;
  flowName: string;
  /** Relative path to the .pb-flow.json file */
  flowFilePath: string;
  /** Environment used for this run (null if none) */
  environment: string | null;
  /** ISO 8601 timestamp when the run started */
  startedAt: string;
  /** ISO 8601 timestamp when the run completed (null if still running) */
  completedAt: string | null;
  status: FlowRunStatus;
  stepResults: FlowStepResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  /** Variables collected during the flow run (set/global directives) */
  variables?: {
    setVars: Record<string, string>;
    globalVars: Record<string, string>;
    namedResults: Record<string, NamedRequestResult>;
  };
}
