// Environment file handling: parse http-client.env.json files and resolve
// the environment variable cascade ($shared, env-specific, .user overrides).
// Extracted from parser.ts.

import type {
  EnvironmentFile,
  EnvironmentVariables,
  VarSourceLayer,
  ResolvedVarWithCascade,
} from './types';

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
      // Provider-based variable - mark as placeholder
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
