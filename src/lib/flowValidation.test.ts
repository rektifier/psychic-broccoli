import { describe, it, expect } from 'vitest';
import { findFileForStep, isStepBroken, resolveStepUrls, urlFromLabel } from './flowValidation';
import type { FileNode, FlowStep, HttpRequest } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROOT = 'C:\\ws';

function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: 'req-1',
    name: 'get user',
    varName: null,
    method: 'GET',
    url: 'https://example.test/users/1',
    headers: [],
    body: '',
    directives: [],
    ...overrides,
  };
}

function makeFile(relPath: string, requests: HttpRequest[]): FileNode {
  return {
    type: 'file',
    name: relPath.split('/').pop() ?? relPath,
    path: `${ROOT}\\${relPath.replaceAll('/', '\\')}`,
    requests,
    variables: [],
    dirty: false,
    savedContent: '',
  };
}

function makeStep(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    id: 'step-1',
    filePath: 'api/users.http',
    requestIndex: 0,
    varName: null,
    aliasLocked: false,
    label: 'GET https://example.test/users/1',
    continueOnFailure: false,
    ...overrides,
  };
}

const files = [makeFile('api/users.http', [makeRequest(), makeRequest({ varName: 'login' })])];

// ─── urlFromLabel ────────────────────────────────────────────────────────────

describe('urlFromLabel', () => {
  it('strips the leading method from a step label', () => {
    expect(urlFromLabel('POST /api/login')).toBe('/api/login');
  });

  it('returns the label unchanged when it has no method prefix', () => {
    expect(urlFromLabel('just-a-label')).toBe('just-a-label');
  });
});

// ─── findFileForStep ─────────────────────────────────────────────────────────

describe('findFileForStep', () => {
  it('matches a step filePath against a backslash workspace path', () => {
    expect(findFileForStep(makeStep(), files, ROOT)).toBe(files[0]);
  });

  it('matches when the step filePath uses backslashes', () => {
    const step = makeStep({ filePath: 'api\\users.http' });
    expect(findFileForStep(step, files, ROOT)).toBe(files[0]);
  });

  it('returns undefined for a file that is not in the workspace', () => {
    const step = makeStep({ filePath: 'api/missing.http' });
    expect(findFileForStep(step, files, ROOT)).toBeUndefined();
  });
});

// ─── isStepBroken ────────────────────────────────────────────────────────────

describe('isStepBroken', () => {
  it('is not broken when the request index exists', () => {
    expect(isStepBroken(makeStep({ requestIndex: 1 }), files, ROOT)).toBe(false);
  });

  it('is broken when the file is missing', () => {
    expect(isStepBroken(makeStep({ filePath: 'gone.http' }), files, ROOT)).toBe(true);
  });

  it('is broken when the request index is out of range and no varName matches', () => {
    expect(isStepBroken(makeStep({ requestIndex: 5 }), files, ROOT)).toBe(true);
  });

  it('falls back to varName lookup when the request index drifted', () => {
    const step = makeStep({ requestIndex: 5, varName: 'login' });
    expect(isStepBroken(step, files, ROOT)).toBe(false);
  });

  it('is broken when the varName no longer exists in the file', () => {
    const step = makeStep({ requestIndex: 5, varName: 'logout' });
    expect(isStepBroken(step, files, ROOT)).toBe(true);
  });
});

// ─── resolveStepUrls ─────────────────────────────────────────────────────────

describe('resolveStepUrls', () => {
  const templatedFiles = [
    makeFile('api/users.http', [makeRequest({ url: '{{baseUrl}}/users/{{userId}}' })]),
  ];

  it('resolves placeholders from environment variables', () => {
    const urls = resolveStepUrls(
      [makeStep()],
      templatedFiles,
      ROOT,
      { baseUrl: 'https://dev.test', userId: '42' },
      {},
      {},
    );
    expect(urls).toEqual(['https://dev.test/users/42']);
  });

  it('returns "" for URLs without placeholders', () => {
    const urls = resolveStepUrls(
      [makeStep()],
      files,
      ROOT,
      { baseUrl: 'https://dev.test' },
      {},
      {},
    );
    expect(urls).toEqual(['']);
  });

  it('returns "" when no placeholder can be resolved', () => {
    const urls = resolveStepUrls([makeStep()], templatedFiles, ROOT, {}, {}, {});
    expect(urls).toEqual(['']);
  });

  it('prefers the step override URL over the base request URL', () => {
    const step = makeStep({
      overrides: { url: '{{baseUrl}}/override' },
    });
    const urls = resolveStepUrls(
      [step],
      templatedFiles,
      ROOT,
      { baseUrl: 'https://dev.test' },
      {},
      {},
    );
    expect(urls).toEqual(['https://dev.test/override']);
  });

  it('resolves flow-scope variables captured from the last run', () => {
    const scopedFiles = [makeFile('api/users.http', [makeRequest({ url: '{{sessionUrl}}' })])];
    const urls = resolveStepUrls(
      [makeStep()],
      scopedFiles,
      ROOT,
      {},
      {},
      {
        sessionUrl: 'https://dev.test/session/abc',
      },
    );
    expect(urls).toEqual(['https://dev.test/session/abc']);
  });

  it('lets flow-scope variables override empty environment values', () => {
    const urls = resolveStepUrls(
      [makeStep()],
      templatedFiles,
      ROOT,
      { baseUrl: '', userId: '42' },
      {},
      { baseUrl: 'https://scope.test' },
    );
    expect(urls).toEqual(['https://scope.test/users/42']);
  });

  it('falls back to the label URL for broken steps', () => {
    const step = makeStep({
      filePath: 'gone.http',
      label: 'GET {{baseUrl}}/from-label',
    });
    const urls = resolveStepUrls([step], files, ROOT, { baseUrl: 'https://dev.test' }, {}, {});
    expect(urls).toEqual(['https://dev.test/from-label']);
  });

  it('returns one entry per step in order', () => {
    const steps = [makeStep(), makeStep({ id: 'step-2', filePath: 'gone.http', label: 'x' })];
    const urls = resolveStepUrls(
      steps,
      templatedFiles,
      ROOT,
      { baseUrl: 'https://dev.test', userId: '1' },
      {},
      {},
    );
    expect(urls).toEqual(['https://dev.test/users/1', '']);
  });
});
