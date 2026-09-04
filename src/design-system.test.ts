import { describe, expect, it } from 'vitest';

import {
  componentsUsingToken,
  getComponent,
  getToken,
  listComponents,
  listTokens,
  search,
} from './design-system.js';

describe('tokens', () => {
  it('returns every token when no category is given', () => {
    expect(listTokens().length).toBeGreaterThan(0);
  });

  it('filters by category', () => {
    const colors = listTokens('color');
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((t) => t.category === 'color')).toBe(true);
  });

  it('looks a token up by name or by CSS custom property', () => {
    const byName = getToken('color.accent.default');
    const byVar = getToken('--weave-color-accent-default');
    expect(byName?.value).toBe('#3b5bdb');
    expect(byVar).toEqual(byName);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(getToken('  COLOR.Accent.Default ')?.name).toBe(
      'color.accent.default',
    );
  });

  it('returns undefined for an unknown token', () => {
    expect(getToken('color.does.not.exist')).toBeUndefined();
  });

  it('has a unique name and CSS variable per token', () => {
    const all = listTokens();
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.cssVar)).size).toBe(all.length);
  });
});

describe('components', () => {
  it('lists components sorted by name', () => {
    const names = listComponents().map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it('filters by category case-insensitively', () => {
    expect(listComponents('LAYOUT').every((c) => c.category === 'layout')).toBe(
      true,
    );
  });

  it('returns a full API for a known component', () => {
    const button = getComponent('button');
    expect(button?.name).toBe('Button');
    expect(button?.props.some((p) => p.name === 'variant')).toBe(true);
    expect(button?.a11y.length).toBeGreaterThan(0);
  });

  it('returns undefined for an unknown component', () => {
    expect(getComponent('Carousel')).toBeUndefined();
  });

  it('only references tokens that actually exist', () => {
    for (const component of listComponents()) {
      for (const token of component.tokensUsed) {
        expect(
          getToken(token),
          `${component.name} references missing token ${token}`,
        ).toBeDefined();
      }
    }
  });
});

describe('componentsUsingToken', () => {
  it('finds the components that read a token', () => {
    const users = componentsUsingToken('radius.md').map((c) => c.name);
    expect(users).toContain('Button');
    expect(users).toContain('Card');
  });

  it('returns an empty list for a token nothing uses', () => {
    expect(componentsUsingToken('typography.heading.size')).toEqual([]);
  });
});

describe('search', () => {
  it('ranks an exact name match first', () => {
    expect(search('Button')[0]).toMatchObject({
      kind: 'component',
      name: 'Button',
    });
  });

  it('matches on description text as well as names', () => {
    expect(
      search('destructive').some((h) => h.name === 'color.danger.default'),
    ).toBe(true);
  });

  it('respects the limit', () => {
    expect(search('color', 3).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for an empty or unmatched query', () => {
    expect(search('   ')).toEqual([]);
    expect(search('zzzzqqq')).toEqual([]);
  });
});
