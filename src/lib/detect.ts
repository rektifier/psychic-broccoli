/**
 * Auto-detect the format of an imported collection file from its content.
 */
export type ImportFormat = 'postman' | 'insomnia' | 'openapi';

export function detectImportFormat(content: string): ImportFormat | null {
  const trimmed = content.trim();

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed);
      const root = Array.isArray(obj) ? null : obj;
      if (!root) return null;

      // Postman: has info.schema containing "schema.getpostman.com"
      if (typeof root.info?.schema === 'string' && root.info.schema.includes('getpostman.com')) {
        return 'postman';
      }

      // Insomnia v4 JSON: has _type === 'export' or __export_format
      if (root._type === 'export' || root.__export_format) {
        return 'insomnia';
      }

      // OpenAPI 3.x or Swagger 2.0
      if (root.openapi || root.swagger || root.paths) {
        return 'openapi';
      }

      // Postman fallback: has info.name and item array
      if (root.info?.name && Array.isArray(root.item)) {
        return 'postman';
      }

      return null;
    } catch {
      return null;
    }
  }

  // YAML content - check for line-level markers

  // Insomnia v5 YAML: starts with "type:" or contains export marker
  if (/^_type:\s/m.test(trimmed) || trimmed.includes('__insomnia_export')) {
    return 'insomnia';
  }

  // OpenAPI/Swagger YAML
  if (/^(?:openapi|swagger)\s*:/m.test(trimmed)) {
    return 'openapi';
  }

  return null;
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
  postman: 'Postman Collection',
  insomnia: 'Insomnia Export',
  openapi: 'OpenAPI / Swagger',
};

export function formatLabel(format: ImportFormat): string {
  return FORMAT_LABELS[format];
}
