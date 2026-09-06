import { describe, expect, it } from 'vitest';

import type { DesignSystem } from '../types.js';
import { loadTokens, validateStyles } from './styles-adapter.js';

const fakeSystem = {} as DesignSystem; // never reached — these tests only exercise dispatch, not a concrete implementation

describe('styles-adapter dispatch', () => {
  it('loadTokens names the unknown source in the error', () => {
    expect(() => loadTokens({ source: 'sass' })).toThrow(/Unknown token source "sass"/);
  });

  it('validateStyles skips entirely when no styles config is given', () => {
    const ast = { type: 'File' } as never;
    expect(validateStyles(ast, fakeSystem, undefined)).toEqual([]);
  });

  it('validateStyles names the unknown source in the error', () => {
    const ast = { type: 'File' } as never;
    expect(() => validateStyles(ast, fakeSystem, { source: 'styled-components' })).toThrow(
      /Unknown styles source "styled-components"/,
    );
  });
});
