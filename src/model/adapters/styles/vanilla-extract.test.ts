import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadTokens } from './vanilla-extract.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 've-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('vanilla-extract loadTokens', () => {
  it('createThemeContract: a shape-only leaf gets a reference but no value', () => {
    const file = join(dir, 'vars.css.ts');
    writeFileSync(
      file,
      `import { createThemeContract } from '@vanilla-extract/css';
       export const vars = createThemeContract({ color: { surface: null } });`,
    );

    expect(loadTokens({ source: 'vanilla-extract', path: file, configDir: dir })).toEqual([
      { name: 'color.surface', group: 'color', reference: 'vars.color.surface' },
    ]);
  });

  it('createGlobalTheme: an inline literal leaf gets both a reference and a resolved value', () => {
    const file = join(dir, 'theme.css.ts');
    writeFileSync(
      file,
      `import { createGlobalTheme } from '@vanilla-extract/css';
       export const vars = createGlobalTheme(':root', { color: { surface: '#FFFFFF' } });`,
    );

    expect(loadTokens({ source: 'vanilla-extract', path: file, configDir: dir })).toEqual([
      { name: 'color.surface', group: 'color', reference: 'vars.color.surface', value: '#FFFFFF' },
    ]);
  });

  it('still resolves the call under a renamed import binding', () => {
    const file = join(dir, 'vars.css.ts');
    writeFileSync(
      file,
      `import { createThemeContract as makeContract } from '@vanilla-extract/css';
       export const vars = makeContract({ color: { surface: null } });`,
    );

    expect(loadTokens({ source: 'vanilla-extract', path: file, configDir: dir })).toEqual([
      { name: 'color.surface', group: 'color', reference: 'vars.color.surface' },
    ]);
  });

  it('respects an explicit referenceRoot override', () => {
    const file = join(dir, 'vars.css.ts');
    writeFileSync(
      file,
      `import { createThemeContract } from '@vanilla-extract/css';
       export const vars = createThemeContract({ color: { surface: null } });`,
    );

    const tokens = loadTokens({
      source: 'vanilla-extract',
      path: file,
      configDir: dir,
      referenceRoot: 'theme',
    });
    expect(tokens[0]?.reference).toBe('theme.color.surface');
  });
});
