import { describe, it, expect } from 'vitest';
import { normalizeMethod, sanitizeFilename, sanitizeVarName, newImportId } from './importShared';

describe('normalizeMethod', () => {
  it('uppercases known methods', () => {
    expect(normalizeMethod('get')).toBe('GET');
    expect(normalizeMethod('Delete')).toBe('DELETE');
    expect(normalizeMethod('CONNECT')).toBe('CONNECT');
  });

  it('falls back to GET for unknown methods', () => {
    expect(normalizeMethod('FETCH')).toBe('GET');
    expect(normalizeMethod('')).toBe('GET');
  });
});

describe('sanitizeFilename', () => {
  it('replaces invalid filename characters', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('falls back to unnamed for empty input', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('   ')).toBe('unnamed');
  });
});

describe('sanitizeVarName', () => {
  it('replaces non-identifier characters and trims underscores', () => {
    expect(sanitizeVarName('base url!')).toBe('base_url');
    expect(sanitizeVarName('-token-')).toBe('token');
  });

  it('falls back to unnamed for empty input', () => {
    expect(sanitizeVarName('')).toBe('unnamed');
    expect(sanitizeVarName('---')).toBe('unnamed');
  });
});

describe('newImportId', () => {
  it('produces unique import-prefixed ids', () => {
    const a = newImportId();
    const b = newImportId();
    expect(a).toMatch(/^import_\d+_[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});
