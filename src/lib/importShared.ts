// Helpers shared by the collection importers (postman.ts, insomnia.ts, openapi.ts).

import type { HttpMethod } from './types';

// ─── Valid HTTP methods ──────────────────────────────────────────────────────

export const VALID_METHODS = new Set<string>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
]);

/** Uppercase a method name, falling back to GET for anything unrecognized. */
export function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  return VALID_METHODS.has(upper) ? (upper as HttpMethod) : 'GET';
}

/** Strip characters that are invalid in filenames. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unnamed';
}

/** Reduce a name to a valid `{{variable}}` identifier. */
export function sanitizeVarName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}

/** Unique id for a request created by an importer. */
export function newImportId(): string {
  return `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
