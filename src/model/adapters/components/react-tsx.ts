import { globSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { parse, withCustomConfig, type ComponentDoc } from 'react-docgen-typescript';

import type { ComponentContract, ComponentProp, SourceConfig } from '../../types.js';
import { scanStories } from './stories.js';

/**
 * Stories and tests sit next to the components they cover, so the natural
 * `components/**\/*.tsx` glob sweeps them up too — and docgen will happily
 * report a CSF story object as a component, yielding a phantom entry and a
 * duplicate of the real one. Stories are already read (as stories) by
 * `scanStories`; neither ever defines a component.
 */
const NOT_A_COMPONENT_FILE = /\.(stories|story|test|spec)\.[jt]sx?$/;

/** Parses a prop's printed type as a pure string-literal union, e.g. `"a" | "b"` — this is what makes it "variant-like". */
function stringUnionValues(type: string): string[] | undefined {
  const literals: string[] = [];
  for (const part of type.split('|').map((p) => p.trim())) {
    const match = /^'([^']*)'$/.exec(part) ?? /^"([^"]*)"$/.exec(part);
    if (!match) return undefined;
    literals.push(match[1] ?? '');
  }
  return literals.length > 0 ? literals : undefined;
}

/**
 * A prop inherited from an intersected native type (`ButtonHTMLAttributes`,
 * `AriaAttributes`, ...) reports a `parent` pointing into `node_modules`
 * (React's own `.d.ts`) — vs. `undefined` or a project file for a prop the
 * component actually declares itself. Without this filter, `variantProps`
 * fills up with every inherited attribute that happens to also be a
 * literal union (`type`, `translate`, `popover`, assorted `aria-*`), not
 * just the ones the design system defines — confirmed against a real
 * component whose `ButtonProps` intersects `ButtonHTMLAttributes`.
 */
function isOwnProp(prop: ComponentDoc['props'][string]): boolean {
  return !prop.parent?.fileName.includes('/node_modules/');
}

export function toProps(props: ComponentDoc['props']): ComponentProp[] {
  return Object.values(props)
    .filter(isOwnProp)
    .map((prop) => {
      // `raw` carries the original type text (e.g. a resolved `keyof typeof X` union);
      // `name` alone collapses those to the unhelpful literal `"enum"`.
      const type = prop.type.raw ?? prop.type.name;
      return {
        name: prop.name,
        type,
        required: prop.required,
        default: prop.defaultValue?.value !== undefined ? String(prop.defaultValue.value) : undefined,
        description: prop.description || undefined,
        allowedValues: stringUnionValues(type),
      };
    });
}

/**
 * What a component declares as an invalid stand-in for itself, via an
 * `@invalidAlternative` JSDoc tag (`@invalidAlternative button` or a
 * comma-separated list). Usually a native element the component replaces,
 * but equally another component — a third-party or legacy one the design
 * system's version supersedes.
 *
 * Case is preserved, since `MuiButton` is a component and `button` is an
 * element. Only the leading identifier is kept, so `input[type=submit]`
 * narrows to `input`: the JSX check matches on tag name, and a broader
 * declaration beats one it can't act on at all.
 */
function declaredInvalidAlternatives(doc: ComponentDoc): string[] {
  const raw = doc.tags?.invalidAlternative;
  if (!raw) return [];
  return raw
    .split(',')
    .map((tag) => /^[A-Za-z][A-Za-z0-9._-]*/.exec(tag.trim().replace(/[<>]/g, ''))?.[0])
    .filter((tag): tag is string => Boolean(tag));
}

/**
 * `filePath` is passed in rather than read off `doc.filePath`:
 * react-docgen-typescript trims the path it reports for display, which
 * breaks colocated-sibling lookups like finding a `.stories` file next to
 * the component. The path we globbed is the real one.
 */
function toContract(doc: ComponentDoc, filePath: string): ComponentContract {
  const props = toProps(doc.props);
  const stories = scanStories(filePath, doc.displayName);

  return {
    name: doc.displayName,
    category: basename(dirname(filePath)),
    description: doc.description,
    props,
    variantProps: props.filter((p) => p.allowedValues).map((p) => p.name),
    invalidAlternatives: declaredInvalidAlternatives(doc),
    deprecatedPatterns: stories.deprecatedPatterns,
    storyPropShapes: stories.storyPropShapes,
    filePath,
  };
}

/**
 * Reads React component contracts via the TypeScript type checker
 * (`react-docgen-typescript` — the same tool Storybook's own autodocs use):
 * props, required flags, and — critically — resolves a variant prop's
 * *actual* allowed values even when it's typed as `keyof typeof someObject`
 * rather than a literal union written directly (confirmed against a real
 * component using exactly that pattern).
 *
 * Config fields:
 *  - `include` (required): glob pattern(s) — `node:fs`'s built-in
 *    `globSync`, no extra dependency.
 *  - `tsconfig` (optional): path to a tsconfig for path-alias resolution
 *    (e.g. a monorepo's `@app/*` mappings) — without it, only plain
 *    relative/`node_modules` imports resolve.
 */
export function loadComponents(config: SourceConfig): ComponentContract[] {
  const configDir = typeof config.configDir === 'string' ? config.configDir : process.cwd();
  const patterns = Array.isArray(config.include) ? config.include : [config.include];
  if (patterns.some((p) => typeof p !== 'string')) {
    throw new Error('react-tsx component source requires an "include" string or string[].');
  }

  const files = (patterns as string[])
    .flatMap((pattern) => globSync(isAbsolute(pattern) ? pattern : resolve(configDir, pattern)))
    .filter((file) => !NOT_A_COMPONENT_FILE.test(file));

  const parser =
    typeof config.tsconfig === 'string'
      ? withCustomConfig(resolve(configDir, config.tsconfig), {
          shouldExtractLiteralValuesFromEnum: true,
          shouldRemoveUndefinedFromOptional: true,
        })
      : {
          parse: (f: string) =>
            parse(f, { shouldExtractLiteralValuesFromEnum: true, shouldRemoveUndefinedFromOptional: true }),
        };

  const contracts: ComponentContract[] = [];
  for (const file of files) {
    for (const doc of parser.parse(file)) {
      contracts.push(toContract(doc, file));
    }
  }
  return contracts;
}
