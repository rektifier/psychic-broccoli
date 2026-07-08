import { describe, it, expect } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns strings as-is (Tauri command rejections)', () => {
    expect(errorMessage('file not found')).toBe('file not found');
  });

  it('returns the message of Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns message from error-like objects', () => {
    expect(errorMessage({ message: 'object error' })).toBe('object error');
  });

  it('stringifies everything else', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
