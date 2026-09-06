import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadTokens } from './object.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'object-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('object loadTokens', () => {
  it('flattens a JSON file', () => {
    const file = join(dir, 'colors.json');
    writeFileSync(file, JSON.stringify({ color: { accent: '#3B5BDB' } }));

    expect(loadTokens({ source: 'object', path: file, configDir: dir })).toEqual([
      { name: 'color.accent', group: 'color', reference: 'colors.color.accent', value: '#3B5BDB' },
    ]);
  });

  it('flattens a plain exported TS object', () => {
    const file = join(dir, 'tokens.ts');
    writeFileSync(file, `export const tokens = { spacing: { x1: '4px' } } as const;`);

    expect(loadTokens({ source: 'object', path: file, configDir: dir })).toEqual([
      { name: 'spacing.x1', group: 'spacing', reference: 'tokens.spacing.x1', value: '4px' },
    ]);
  });

  it('navigates rootPath before flattening, fixing the group a wrapper key would otherwise produce', () => {
    const file = join(dir, 'colors.json');
    writeFileSync(file, JSON.stringify({ tokens: { color: { accent: '#3B5BDB' } } }));

    expect(loadTokens({ source: 'object', path: file, configDir: dir, rootPath: 'tokens' })).toEqual([
      { name: 'color.accent', group: 'color', reference: 'colors.color.accent', value: '#3B5BDB' },
    ]);
  });
});
