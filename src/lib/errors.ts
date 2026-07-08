/**
 * Extract a human-readable message from an unknown thrown value.
 * Tauri commands reject with plain strings; JS code throws Error instances.
 */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  return String(e);
}
