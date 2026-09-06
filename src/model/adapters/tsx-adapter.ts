import _traverse from '@babel/traverse';
import type { Expression, File, JSXOpeningElement } from '@babel/types';

import { classNameTokens } from '../class-name-strings.js';
import type { ComponentContract, DesignSystem, Finding, SourceConfig } from '../types.js';
import * as classNameAdapter from './classname-adapter.js';
import * as npmPackageComponents from './components/npm-package.js';
import * as reactTsxComponents from './components/react-tsx.js';
import * as stylesAdapter from './styles-adapter.js';

// @babel/traverse's default export is CJS-interop-wrapped depending on how
// Node resolves it; unwrap defensively rather than assume one shape.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse;

// --- reading component contracts -----------------------------------------

/**
 * Dispatches one configured component source to its implementation under
 * `components/`, the same way the styles adapter dispatches token sources.
 * No source-specific code lives here — adding another component source
 * (Vue SFCs, a published metadata JSON) is a new file next to
 * `components/react-tsx.ts` plus one branch below.
 */
export function loadComponents(config: SourceConfig): ComponentContract[] {
  if (config.source === 'react-tsx') return reactTsxComponents.loadComponents(config);
  if (config.source === 'npm-package') return npmPackageComponents.loadComponents(config);
  throw new Error(`Unknown component source "${config.source}" — expected "react-tsx" or "npm-package".`);
}

// --- validating JSX --------------------------------------------------------

function findAttributeValue(node: JSXOpeningElement, name: string): Expression | undefined {
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
    if (attr.name.name !== name) continue;
    if (attr.value?.type === 'JSXExpressionContainer') {
      return attr.value.expression.type === 'JSXEmptyExpression'
        ? undefined
        : (attr.value.expression as Expression);
    }
    if (attr.value?.type === 'StringLiteral') return attr.value;
  }
  return undefined;
}

/** A variant prop's literal value, from either `prop="x"` or `prop={"x"}`. */
function literalAttrValue(attr: JSXOpeningElement['attributes'][number]): string | undefined {
  if (attr.type !== 'JSXAttribute') return undefined;
  if (attr.value?.type === 'StringLiteral') return attr.value.value;
  if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'StringLiteral') {
    return attr.value.expression.value;
  }
  return undefined;
}

function position(node: { loc?: JSXOpeningElement['loc'] }): { line: number; column: number } {
  return { line: node.loc ? node.loc.start.line : 0, column: node.loc ? node.loc.start.column + 1 : 0 };
}

/** Every prop name written on an element, plus the literal values among them. */
function readAttributes(node: JSXOpeningElement): { names: string[]; literals: Map<string, string> } {
  const names: string[] = [];
  const literals = new Map<string, string>();
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
    names.push(attr.name.name);
    const value = literalAttrValue(attr);
    if (value !== undefined) literals.set(attr.name.name, value);
  }
  return { names, literals };
}

/**
 * For a recognized component (unrecognized tags aren't checked — there's no
 * separate "component not present" rule in this build), checks every
 * variant-like prop's literal value against its allowed set. The message
 * names the actual constraint and the legal alternatives, not just "invalid
 * variant" — that's the whole point of a finding an agent can act on.
 */
function checkVariantProps(node: JSXOpeningElement, component: ComponentContract): Finding[] {
  const findings: Finding[] = [];
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
    const propName = attr.name.name;
    if (!component.variantProps.includes(propName)) continue;

    const allowedValues = component.props.find((p) => p.name === propName)?.allowedValues;
    if (!allowedValues) continue;

    const value = literalAttrValue(attr);
    if (value === undefined || allowedValues.includes(value)) continue;

    findings.push({
      rule: 'unknown-variant',
      severity: 'error',
      surface: 'jsx',
      ...position(attr),
      message: `${propName} must be one of ${allowedValues.join(' | ')}, got "${value}".`,
    });
  }
  return findings;
}

/** Does this usage reproduce every prop value the deprecated pattern names? Extra props are allowed. */
function matchesPattern(pattern: Record<string, string>, literals: Map<string, string>): boolean {
  const entries = Object.entries(pattern);
  return entries.length > 0 && entries.every(([prop, value]) => literals.get(prop) === value);
}

/**
 * Two checks against what the component's own `.stories` file documents:
 *
 *  - a usage reproducing a prop combination a story marks `@deprecated` is
 *    the "duplicate/superseded implementation" case — a warning naming the
 *    story, so the reader can go see what replaced it;
 *  - a usage whose prop-name set matches no documented story at all is a
 *    softer warning still. It only fires when the component has stories to
 *    compare against: with none, the answer is "can't tell", and inventing
 *    a warning from no evidence would make the tool noise.
 *
 * Neither is an error — both describe a usage that works but diverges from
 * how the system documents itself.
 */
function checkAgainstStories(
  node: JSXOpeningElement,
  component: ComponentContract,
  propNames: string[],
  literals: Map<string, string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const pattern of component.deprecatedPatterns) {
    if (!matchesPattern(pattern.props, literals)) continue;
    const shape = Object.entries(pattern.props)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    findings.push({
      rule: 'deprecated-pattern',
      severity: 'warning',
      surface: 'jsx',
      ...position(node),
      message: `This ${component.name} usage matches ${shape}, which "${pattern.storyName}" in ${component.name}'s stories marks as deprecated.`,
    });
  }

  if (component.storyPropShapes.length > 0 && propNames.length > 0) {
    const used = new Set(propNames);
    const documented = component.storyPropShapes.some((shape) => shape.every((prop) => used.has(prop)));
    if (!documented) {
      findings.push({
        rule: 'undocumented-pattern',
        severity: 'warning',
        surface: 'jsx',
        ...position(node),
        message:
          `This ${component.name} usage (${propNames.join(', ')}) does not match any prop combination ` +
          `${component.name}'s stories demonstrate. It may still be correct — check the stories before relying on it.`,
      });
    }
  }

  return findings;
}

/** One parsed `@invalidAlternative` declaration, e.g. `button` or `div.flex`. */
interface AlternativeMatcher {
  /** Lowercased tag name, or `undefined` for a selector that names only classes (`.flex`). */
  tag?: string;
  /** Classes that must *all* be present on the element. Empty means the tag alone is enough. */
  classNames: string[];
  /** The declaration as written, for the finding's message. */
  source: string;
  /** The design system component that supersedes this. */
  owner: string;
  /** Declared by the component itself, rather than inferred by a model. */
  declared: boolean;
}

/** Invalid alternatives indexed for lookup, built once per design system. */
export interface InvalidAlternativeOwners {
  /** Lowercased tag -> matchers naming that tag. */
  byTag: Map<string, AlternativeMatcher[]>;
  /** Matchers naming classes but no tag, so they apply to any element. */
  anyTag: AlternativeMatcher[];
}

/**
 * Splits on `separator`, ignoring separators inside `[...]` — so an
 * arbitrary value like `p-[1.5rem]` stays one class rather than being torn
 * in half at its decimal point.
 */
function splitOutsideBrackets(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '[') depth++;
    else if (char === ']') depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parses one declaration into a matcher. The syntax is the familiar CSS
 * shape — a tag, then any number of `.class` segments:
 *
 *   `button`            any <button>
 *   `MuiButton`         another library's component
 *   `div.flex`          a <div> carrying the class "flex"
 *   `div.flex.gap-2`    a <div> carrying both classes
 *   `.flex`             any element carrying "flex"
 *
 * The classes are plain literals the author wrote; nothing here knows or
 * cares about a utility-class convention, and matching works whether or not
 * `classNames` is configured.
 */
function parseAlternative(source: string, owner: string, declared: boolean): AlternativeMatcher | undefined {
  const text = source.trim().replace(/[<>]/g, '');
  if (!text) return undefined;

  const [rawTag = '', ...rawClasses] = splitOutsideBrackets(text, '.');
  // Only the leading identifier: `input[type=submit]` narrows to `input`,
  // since the check matches on tag name.
  const tag = /^[A-Za-z][A-Za-z0-9_-]*/.exec(rawTag)?.[0];
  const classNames = rawClasses.map((c) => c.trim()).filter(Boolean);

  if (!tag && classNames.length === 0) return undefined;
  return { tag: tag?.toLowerCase(), classNames, source: text, owner, declared };
}

/** How a matcher reads back in a message: `<button>`, or `<div className="flex">`. */
function describeMatcher(matcher: AlternativeMatcher): string {
  const tag = matcher.tag ?? '*';
  if (matcher.classNames.length === 0) return `<${tag}>`;
  return `<${tag} className="${matcher.classNames.join(' ')}">`;
}

function addMatcher(owners: InvalidAlternativeOwners, matcher: AlternativeMatcher): void {
  if (!matcher.tag) {
    owners.anyTag.push(matcher);
    return;
  }
  const existing = owners.byTag.get(matcher.tag);
  if (existing) existing.push(matcher);
  else owners.byTag.set(matcher.tag, [matcher]);
}

/**
 * Flattens every component's invalid alternatives into one index, so
 * checking a JSX tag costs a hash lookup plus a scan of only the matchers
 * that name that tag, however many components declare however many
 * alternatives.
 *
 * Built once per design system rather than per `validate` call — see
 * `design-system.ts`, which rebuilds it when inference mutates the
 * contracts.
 */
export function buildInvalidAlternativeOwners(components: ComponentContract[]): InvalidAlternativeOwners {
  const owners: InvalidAlternativeOwners = { byTag: new Map(), anyTag: [] };

  for (const component of components) {
    for (const source of component.invalidAlternatives) {
      const matcher = parseAlternative(source, component.name, true);
      if (matcher) addMatcher(owners, matcher);
    }
  }
  for (const component of components) {
    for (const source of component.inferredInvalidAlternatives ?? []) {
      const matcher = parseAlternative(source, component.name, false);
      if (matcher) addMatcher(owners, matcher);
    }
  }

  return owners;
}

/**
 * The best matcher for an element, or `undefined`. "Best" is the most
 * authoritative and then the most specific: a declaration outranks a model's
 * guess so an inference can never downgrade one to a warning, and among
 * equals the matcher naming more classes wins, so `div.flex` beats a bare
 * `div` and the reader is pointed at the closer-fitting component.
 */
function bestMatch(
  tag: string,
  classes: Set<string> | undefined,
  owners: InvalidAlternativeOwners,
): AlternativeMatcher | undefined {
  const candidates = [...(owners.byTag.get(tag.toLowerCase()) ?? []), ...owners.anyTag];

  let best: AlternativeMatcher | undefined;
  for (const matcher of candidates) {
    // A component naming itself would be a config mistake, but reporting it
    // would be worse — it would tell the reader to replace `X` with `X`.
    if (matcher.owner === tag) continue;
    if (matcher.classNames.some((name) => !classes?.has(name))) continue;

    if (
      !best ||
      (matcher.declared && !best.declared) ||
      (matcher.declared === best.declared && matcher.classNames.length > best.classNames.length)
    ) {
      best = matcher;
    }
  }
  return best;
}

/**
 * Reaching for a raw `<button>`, a `<div className="flex">`, or some other
 * library's Button, when the design system has a component for exactly that
 * is the "wrong implementation" case — the component exists precisely so
 * this doesn't happen. A *declared* invalid alternative is an error; one a
 * model only inferred is a warning, because a guess should never block on
 * its own authority.
 */
function checkInvalidAlternative(
  node: JSXOpeningElement,
  tag: string,
  owners: InvalidAlternativeOwners,
): Finding[] {
  const classNameValue = findAttributeValue(node, 'className');
  const classes = classNameValue ? classNameTokens(classNameValue) : undefined;

  const match = bestMatch(tag, classes, owners);
  if (!match) return [];

  const used = describeMatcher({ ...match, tag: tag.toLowerCase() });
  return [
    {
      rule: 'invalid-alternative',
      severity: match.declared ? 'error' : 'warning',
      surface: 'jsx',
      ...position(node),
      message: match.declared
        ? `Use the ${match.owner} component instead of ${used} — ${match.owner} declares ${match.source} an invalid alternative to itself.`
        : `${used} may be better written as the ${match.owner} component. This one is inferred, not declared — confirm before changing it.`,
      suggestion: match.owner,
    },
  ];
}

/**
 * Finds every JSX opening tag (self-closing or not — Babel represents both
 * as `JSXOpeningElement`) and checks it against the design system: any tag
 * some component declares an invalid alternative to itself, and for a
 * recognized component its variant props, its stories, an inline `style`
 * prop (via the styles adapter — not config-gated, since `style={{}}` is a
 * React feature, not tied to any styling system) and `className` (via the
 * className adapter, dispatched to whichever convention `classNamesConfig`
 * names, or skipped entirely if it names none).
 *
 * This adapter never reaches past a sibling adapter into its internals —
 * every style/className check below goes through one of the other two
 * adapters' own public functions, never a shared utility directly.
 */
export function validateJsx(
  ast: File,
  system: DesignSystem,
  classNamesConfig: SourceConfig | undefined,
  owners: InvalidAlternativeOwners,
): Finding[] {
  const findings: Finding[] = [];

  traverse(ast, {
    JSXOpeningElement(nodePath) {
      const node = nodePath.node;

      if (node.name.type === 'JSXIdentifier') {
        const tag = node.name.name;

        // Runs for every tag, not just lowercase ones: what a component
        // supersedes can be a native element or another component, and both
        // are equally wrong to reach for.
        findings.push(...checkInvalidAlternative(node, tag, owners));

        const component = system.component(tag);
        if (component) {
          const { names, literals } = readAttributes(node);
          findings.push(...checkVariantProps(node, component));
          findings.push(...checkAgainstStories(node, component, names, literals));
        }
      }

      const styleValue = findAttributeValue(node, 'style');
      if (styleValue?.type === 'ObjectExpression') {
        findings.push(...stylesAdapter.checkStyleObject(styleValue, system, 'jsx'));
      }

      const classNameValue = findAttributeValue(node, 'className');
      if (classNameValue) {
        findings.push(...classNameAdapter.check(classNamesConfig, classNameValue));
      }
    },
  });

  return findings;
}
