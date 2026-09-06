import { describe, expect, it } from 'vitest';

import { check } from './classname-adapter.js';

const fakeExpression = {} as never; // never reached when config is undefined or invalid

describe('classname-adapter dispatch', () => {
  it('skips entirely when no classNames config is given', () => {
    expect(check(undefined, fakeExpression)).toEqual([]);
  });

  it('names the unknown source in the error', () => {
    expect(() => check({ source: 'bootstrap' }, fakeExpression)).toThrow(
      /Unknown classNames source "bootstrap"/,
    );
  });
});
