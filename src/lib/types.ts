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

/** A single named environment maps variable names → values (or provider objects). */
export type EnvironmentVariables = Record<string, string | ProviderVariable>;

/** Provider-based variable (Azure Key Vault, DPAPI, ASP.NET User Secrets). */
export interface ProviderVariable {
  provider: string;
  [key: string]: string;
}

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
  | { type: 'set'; key: string; expr: string }
  | { type: 'global'; key: string; expr: string }
  | { type: 'assert'; expr: string; label: string };

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
