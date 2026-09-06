import { describe, expect, it } from 'vitest';

import { loadComponents } from './tsx-adapter.js';

describe('tsx-adapter component-source dispatch', () => {
  it('names the unknown source in the error', () => {
    expect(() => loadComponents({ source: 'vue-sfc' })).toThrow(/Unknown component source "vue-sfc"/);
  });

  it('requires an include pattern for react-tsx', () => {
    expect(() => loadComponents({ source: 'react-tsx' })).toThrow(/"include"/);
  });

  it('requires a package name for npm-package', () => {
    expect(() => loadComponents({ source: 'npm-package' })).toThrow(/"package"/);
  });

  it('skips a package whose types cannot be resolved rather than failing the whole load', () => {
    expect(loadComponents({ source: 'npm-package', package: 'definitely-not-installed-xyz' })).toEqual([]);
  });
});
