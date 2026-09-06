import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { createDesignSystem } from './design-system.js';
import type { DesignSystem } from './types.js';

// The test suite runs against the same synthetic design system the README's
// worked example and `examples/synthetic-design-system/` demonstrate —
// one fixture, not a second near-duplicate one, so a change to the example
// is a change the tests actually exercise.
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(__dirname, '..', '..', 'examples', 'synthetic-design-system');

let system: DesignSystem;

beforeAll(() => {
  system = createDesignSystem({
    tokens: [
      { source: 'vanilla-extract', path: 'theme.css.ts', configDir: EXAMPLE },
      { source: 'object', path: 'tokens.ts', configDir: EXAMPLE },
    ],
    components: [
      {
        source: 'react-tsx',
        include: ['components/**/*.tsx'],
        configDir: EXAMPLE,
      },
    ],
    styles: { source: 'vanilla-extract' },
    classNames: { source: 'tailwind' },
    configDir: EXAMPLE,
  });
});

describe('tokens', () => {
  it('lists tokens across all configured sources', () => {
    expect(system.tokens().length).toBeGreaterThan(0);
  });

  it('filters by group', () => {
    const spacing = system.tokens('spacing');
    expect(spacing.length).toBeGreaterThan(0);
    expect(spacing.every((t) => t.group === 'spacing')).toBe(true);
  });

  it('carries a resolved value from createGlobalTheme', () => {
    const accent = system.tokens('color').find((t) => t.name === 'color.accent');
    expect(accent?.value).toBe('#3B5BDB');
    expect(accent?.reference).toBe('vars.color.accent');
  });
});

describe('nearestToken', () => {
  it('finds the closest spacing token by numeric proximity', () => {
    expect(system.nearestToken('7px', 'spacing')?.name).toBe('spacing.sm');
  });

  it('finds the closest color token by color distance', () => {
    expect(system.nearestToken('#3b5bdc', 'color')?.name).toBe('color.accent');
  });

  it('returns undefined for a group with no valued tokens', () => {
    expect(system.nearestToken('anything', 'not-a-real-group')).toBeUndefined();
  });
});

describe('components', () => {
  it('returns the full contract for a known component', () => {
    const button = system.component('Button');
    expect(button?.name).toBe('Button');
    expect(button?.variantProps.sort()).toEqual(['size', 'variant']);
  });

  it('excludes props inherited from native HTML attributes', () => {
    const button = system.component('Button');
    expect(button?.props.some((p) => p.name === 'variant')).toBe(true);
    expect(button?.props.some((p) => p.name === 'onClick')).toBe(false);
  });

  it('returns undefined, plus closest matches, for an unknown name', () => {
    expect(system.component('Buttn')).toBeUndefined();
    expect(system.closestComponents('Buttn')).toContain('Button');
  });
});

describe('validate — vanilla-extract surface', () => {
  it('accepts the real example Button.css.ts (every governed property already uses a token)', () => {
    const code = readFileSync(join(EXAMPLE, 'components', 'Button.css.ts'), 'utf8');
    expect(system.validate(code)).toEqual({ ok: true, findings: [] });
  });

  it('flags a hardcoded color with the nearest token as a suggestion', () => {
    const code = `
      import { style } from '@vanilla-extract/css';
      export const bad = style({ color: '#3b5bdc' });
    `;
    const result = system.validate(code);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        rule: 'hardcoded-literal',
        surface: 'vanilla-extract',
        suggestion: 'vars.color.accent',
      }),
    ]);
  });

  it('flags a hardcoded value nested inside a styleVariants()/selectors tree', () => {
    const code = `
      import { styleVariants } from '@vanilla-extract/css';
      export const bad = styleVariants({
        danger: { padding: '7px', selectors: { '&:hover': { borderRadius: '3px' } } },
      });
    `;
    const result = system.validate(code);
    expect(result.findings.map((f) => f.message).join('\n')).toContain('padding: 7px');
    expect(result.findings.map((f) => f.message).join('\n')).toContain('borderRadius: 3px');
  });

  it('flags a hardcoded value in recipe() (a separate package from style()/styleVariants())', () => {
    const code = `
      import { recipe } from '@vanilla-extract/recipes';
      export const bad = recipe({ base: { padding: '7px' } });
    `;
    const result = system.validate(code);
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toContain('padding: 7px');
  });

  it("flags a hardcoded value nested inside quoted selector keys (e.g. '&:hover')", () => {
    const code = `
      import { style } from '@vanilla-extract/css';
      export const bad = style({
        selectors: { '&:hover, &:focus': { padding: '7px' } },
      });
    `;
    expect(system.validate(code).findings[0]?.message).toContain('padding: 7px');
  });

  it('still finds a style()-defining call under a renamed import binding', () => {
    const code = `
      import { style as s } from '@vanilla-extract/css';
      export const bad = s({ padding: '7px' });
    `;
    expect(system.validate(code).findings[0]?.message).toContain('padding: 7px');
  });

  it('does not flag a value on a property with no configured token group', () => {
    const code = `
      import { style } from '@vanilla-extract/css';
      export const ok = style({ cursor: 'pointer', display: 'flex' });
    `;
    expect(system.validate(code)).toEqual({ ok: true, findings: [] });
  });

  it('ignores style()-like calls not imported from a vanilla-extract package', () => {
    const code = `
      function style(x) { return x; }
      const notVe = style({ color: '#3b5bdc' });
    `;
    expect(system.validate(code)).toEqual({ ok: true, findings: [] });
  });
});

describe('validate — jsx surface', () => {
  it('accepts a real token reference in an inline style prop', () => {
    expect(system.validate('<div style={{ color: vars.color.accent }} />')).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('flags a hardcoded value in an inline style prop', () => {
    const result = system.validate('<div style={{ padding: "7px" }} />');
    expect(result.findings[0]).toMatchObject({ rule: 'hardcoded-literal', surface: 'jsx' });
  });

  it('flags a Tailwind arbitrary-value bracket', () => {
    const result = system.validate('<span className="items-center text-[#1e1e22]" />');
    expect(result.findings[0]).toMatchObject({ rule: 'hardcoded-literal', surface: 'tailwind' });
  });

  it('flags an arbitrary value inside a classNames()-style helper call', () => {
    const code = 'const el = <span className={classNames("block", isActive && "p-[13px]")} />;';
    expect(system.validate(code).findings[0]?.message).toContain('[13px]');
  });

  it('accepts a plain Tailwind utility class', () => {
    expect(system.validate('<span className="items-center gap-2" />')).toEqual({
      ok: true,
      findings: [],
    });
  });
});

describe('validate — unknown-variant', () => {
  it('accepts a variant value in the allowed set', () => {
    expect(system.validate('<Button variant="secondary" size="lg" />')).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('flags a variant value outside the allowed set, naming the legal alternatives', () => {
    const result = system.validate('<Button variant="warning">Click</Button>');
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe(
      'variant must be one of primary | secondary | danger, got "warning".',
    );
  });

  it('does not fire for an unrecognized component', () => {
    expect(system.validate('<TotallyMadeUp variant="whatever" />')).toEqual({
      ok: true,
      findings: [],
    });
  });
});

describe('validate — styles/classNames checks are config-driven, not assumed', () => {
  it('skips the vanilla-extract check entirely when "styles" is omitted from config', () => {
    const noStyles = createDesignSystem({
      tokens: [{ source: 'object', path: 'tokens.ts', configDir: EXAMPLE }],
      components: [{ source: 'react-tsx', include: ['components/**/*.tsx'], configDir: EXAMPLE }],
      configDir: EXAMPLE,
      // no `styles` field
    });
    const code = `
      import { style } from '@vanilla-extract/css';
      export const bad = style({ padding: '7px' });
    `;
    expect(noStyles.validate(code)).toEqual({ ok: true, findings: [] });
  });

  it('skips the className check entirely when "classNames" is omitted from config', () => {
    const noClassNames = createDesignSystem({
      tokens: [{ source: 'object', path: 'tokens.ts', configDir: EXAMPLE }],
      components: [{ source: 'react-tsx', include: ['components/**/*.tsx'], configDir: EXAMPLE }],
      configDir: EXAMPLE,
      // no `classNames` field
    });
    expect(noClassNames.validate('<div className="text-[#1e1e22]" />')).toEqual({
      ok: true,
      findings: [],
    });
  });
});

describe('validate — never throws', () => {
  it('returns a parse-error finding for unparseable input instead of throwing', () => {
    const result = system.validate('<<<not parseable{{{');
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.rule).toBe('parse-error');
  });

  it('handles empty input cleanly', () => {
    expect(system.validate('')).toEqual({ ok: true, findings: [] });
  });
});

describe('search', () => {
  it('ranks an exact token name above a mere substring match', () => {
    const hits = system.searchTokens('color.accent');
    expect(hits[0]?.name).toBe('color.accent');
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('finds a token by a fragment of its name', () => {
    expect(system.searchTokens('accent').map((h) => h.name)).toContain('color.accent');
  });

  it('finds a component by description text, not just its name', () => {
    expect(system.searchComponents('triggering an action').map((h) => h.name)).toContain('Button');
  });

  it('respects the limit and returns nothing for a blank query', () => {
    expect(system.searchTokens('color', 2)).toHaveLength(2);
    expect(system.searchTokens('   ')).toEqual([]);
  });
});

describe('validate — invalid alternatives (wrong implementation)', () => {
  it('errors on a native element a component declares itself the replacement for', () => {
    const result = system.validate('<button onClick={go}>Save</button>');
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({
      rule: 'invalid-alternative',
      severity: 'error',
      suggestion: 'Button',
    });
  });

  it('leaves an element no component claims alone', () => {
    expect(system.validate('<span>hello</span>')).toEqual({ ok: true, findings: [] });
  });

  it('flags a superseded component, not just a native element', () => {
    // Button declares `button, MuiButton` — a declaration names whatever is
    // wrong to reach for, another library's component as much as a bare tag.
    expect(system.component('Button')?.invalidAlternatives).toEqual(['button', 'MuiButton']);
    expect(system.validate('<MuiButton />').findings[0]).toMatchObject({
      rule: 'invalid-alternative',
      severity: 'error',
      suggestion: 'Button',
    });
  });

  function systemForInference(inferInvalidAlternatives?: boolean) {
    return createDesignSystem({
      tokens: [{ source: 'object', path: 'tokens.ts', configDir: EXAMPLE }],
      components: [{ source: 'react-tsx', include: ['components/**/*.tsx'], configDir: EXAMPLE }],
      inferInvalidAlternatives,
      configDir: EXAMPLE,
    });
  }

  it('flags a tag+class combination, and leaves the same tag without that class alone', () => {
    // Flex declares `div.flex`: a bare <div> is fine, a <div className="flex"> is not.
    expect(system.validate('<div />')).toEqual({ ok: true, findings: [] });

    const result = system.validate('<div className="flex items-center" />');
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({
      rule: 'invalid-alternative',
      severity: 'error',
      suggestion: 'Flex',
    });
    expect(result.findings[0]?.message).toContain('div.flex');
  });

  it('matches a combination however the className expression is written', () => {
    for (const code of [
      '<div className={`flex ${extra}`} />',
      // Any helper: the walk never looks at what the call is named.
      '<div className={cn("flex", "items-center")} />',
      '<div className={classNames("flex", cond && "gap-2")} />',
      '<div className={twMerge(base, "flex")} />',
      '<div className={clsx(["flex", cond && "gap-2"])} />',
      // The conditional-object idiom, where the class is the key.
      '<div className={cn(base, { flex: isRow })} />',
      '<div className={clsx({ "flex": isRow })} />',
      '<div className={cond ? "flex" : "block"} />',
    ]) {
      expect(system.validate(code).findings[0]?.suggestion).toBe('Flex');
    }
  });

  it('does not fire on a tag+class combination when only some classes are present', () => {
    expect(system.validate('<div className="items-center gap-2" />')).toEqual({
      ok: true,
      findings: [],
    });
    expect(system.validate('<div className={cn({ grid: true })} />')).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('asks the model nothing at all unless the config opts in — each call would cost the user', async () => {
    const off = systemForInference();
    let calls = 0;
    await off.inferInvalidAlternatives(async () => {
      calls++;
      return ['div'];
    });
    expect(calls).toBe(0);
    expect(off.component('Stack')?.inferredInvalidAlternatives).toBeUndefined();
  });

  it('infers only for components that declare nothing, once opted in', async () => {
    const on = systemForInference(true);
    const asked: string[] = [];
    await on.inferInvalidAlternatives(async (component) => {
      asked.push(component.name);
      return ['div'];
    });
    // Button declares `button`; a declaration is authoritative and must never
    // be re-asked, let alone overwritten, by a model.
    expect(asked).toEqual(['Stack']);
    expect(on.component('Button')?.inferredInvalidAlternatives).toBeUndefined();
    expect(on.component('Stack')?.inferredInvalidAlternatives).toEqual(['div']);
  });

  it('reports an inferred alternative as a warning, while a declared one stays an error', async () => {
    const on = systemForInference(true);
    await on.inferInvalidAlternatives(async () => ['div']);

    expect(on.validate('<div />').findings[0]).toMatchObject({
      rule: 'invalid-alternative',
      severity: 'warning',
      suggestion: 'Stack',
    });
    expect(on.validate('<button />').findings[0]?.severity).toBe('error');
  });

  it('survives a suggester that throws', async () => {
    await expect(
      systemForInference(true).inferInvalidAlternatives(async () => {
        throw new Error('client said no');
      }),
    ).resolves.toBeUndefined();
  });
});

describe('validate — story-derived patterns (superseded implementation)', () => {
  it('warns when a usage reproduces a prop combination the stories mark deprecated', () => {
    const result = system.validate('<Button variant="danger" size="sm" />');
    expect(result.findings.map((f) => f.rule)).toContain('deprecated-pattern');
    expect(result.findings[0]?.message).toContain('DangerButton');
    // A warning describes a divergence, it does not block.
    expect(result.ok).toBe(true);
  });

  it('does not warn for a usage that only partly overlaps a deprecated pattern', () => {
    const result = system.validate('<Button variant="danger" size="lg" />');
    expect(result.findings.map((f) => f.rule)).not.toContain('deprecated-pattern');
  });

  it('warns about a prop combination no story demonstrates', () => {
    const result = system.validate('<Button size="lg" />');
    expect(result.findings.map((f) => f.rule)).toContain('undocumented-pattern');
    expect(result.ok).toBe(true);
  });

  it('stays quiet for a usage matching a documented shape', () => {
    expect(system.validate('<Button variant="primary" size="lg" />')).toEqual({
      ok: true,
      findings: [],
    });
  });
});
