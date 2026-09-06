import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { parse } from '@babel/parser';
import type { Expression, Node, ObjectExpression } from '@babel/types';

import type { DeprecatedUsagePattern } from '../../types.js';

export interface StoryData {
  deprecatedPatterns: DeprecatedUsagePattern[];
}

const EMPTY: StoryData = { deprecatedPatterns: [] };

function findStoriesFile(componentFilePath: string): string | undefined {
  const base = basename(componentFilePath).replace(/\.[jt]sx?$/, '');
  for (const ext of ['.stories.tsx', '.stories.ts', '.stories.jsx', '.stories.js']) {
    const candidate = join(dirname(componentFilePath), base + ext);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The literal text of a value node, or undefined when it isn't a literal we can pin down. */
function literalValue(node: Node): string | undefined {
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'BooleanLiteral') return String(node.value);
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** Property key as written, whether a bare identifier or a quoted string. */
function propertyKeyName(key: Node, computed: boolean): string | undefined {
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return undefined;
}

function propsFromObject(obj: ObjectExpression): Record<string, string> {
  const props: Record<string, string> = {};
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const name = propertyKeyName(prop.key, prop.computed);
    if (!name) continue;
    const value = literalValue(prop.value);
    if (value !== undefined) props[name] = value;
  }
  return props;
}

/**
 * Reads the first `<ComponentName ... />` inside a story body. A non-literal
 * attribute (`onClick={fn}`) still counts as *present* — recorded as
 * `'true'` — so it isn't silently dropped from the props a deprecated
 * pattern is matched against.
 */
function propsFromJsx(root: Node, componentName: string): Record<string, string>[] {
  // A plain recursive walk rather than `traverse`: this runs on a bare
  // expression node, not a Program, and traversing a detached subtree needs
  // a synthesized scope/parent that buys nothing here.
  // Collected with their source offset and sorted at the end: the walk below
  // is a LIFO stack, so matches surface in reverse document order otherwise.
  const found: { start: number; props: Record<string, string> }[] = [];
  const stack: Node[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.type === 'JSXOpeningElement') {
      const name = node.name;
      if (name.type === 'JSXIdentifier' && name.name === componentName) {
        const props: Record<string, string> = {};
        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
          const value = attr.value;
          if (!value) {
            props[attr.name.name] = 'true';
          } else if (value.type === 'JSXExpressionContainer') {
            props[attr.name.name] =
              value.expression.type === 'JSXEmptyExpression'
                ? 'true'
                : (literalValue(value.expression) ?? 'true');
          } else {
            props[attr.name.name] = literalValue(value) ?? 'true';
          }
        }
        found.push({ start: node.start ?? 0, props });
      }
    }

    for (const value of Object.values(node as unknown as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof (item as Node).type === 'string') {
            stack.push(item as Node);
          }
        }
      } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') {
        stack.push(value as Node);
      }
    }
  }

  return found.sort((a, b) => a.start - b.start).map((entry) => entry.props);
}

/**
 * The prop combinations one story export demonstrates — more than one when
 * it renders the component several times over.
 *
 * A CSF3 `{ args: {...} }` story states its props outright. Otherwise the
 * JSX is the only statement of them, and that covers the `{ render: () =>
 * ... }` form, which is how a story that shows several variations at once
 * is normally written — the common shape in a real Storybook, and invisible
 * if only `args` were read.
 */
function propsOfStory(init: Expression, componentName: string): Record<string, string>[] {
  if (init.type === 'ObjectExpression') {
    const args = init.properties.find(
      (p) => p.type === 'ObjectProperty' && propertyKeyName(p.key, p.computed) === 'args',
    );
    if (args?.type === 'ObjectProperty' && args.value.type === 'ObjectExpression') {
      return [propsFromObject(args.value)];
    }
    const direct = propsFromObject(init);
    if (Object.keys(direct).length > 0) return [direct];
  }
  return propsFromJsx(init, componentName);
}

/**
 * Best-effort: reads a component's colocated `.stories` file (same directory,
 * same base name) for prop combinations it explicitly marks deprecated
 * (story named `*Deprecated*`, or carrying an `@deprecated` JSDoc tag).
 *
 * Returns empty data rather than throwing when there is no stories file or
 * it cannot be parsed. Callers must read that as "can't compare" and skip
 * the related checks — not as "nothing is documented".
 */
export function scanStories(componentFilePath: string, componentName: string): StoryData {
  const storiesPath = findStoriesFile(componentFilePath);
  if (!storiesPath) return EMPTY;

  let ast;
  try {
    ast = parse(readFileSync(storiesPath, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch {
    return EMPTY;
  }

  const deprecatedPatterns: DeprecatedUsagePattern[] = [];

  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration?.type !== 'VariableDeclaration') continue;

    const docblock = (statement.leadingComments ?? []).map((c) => c.value).join('\n');
    const deprecatedByDoc = /@deprecated/i.test(docblock);

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) continue;
      const storyName = declarator.id.name;

      const deprecated = deprecatedByDoc || /deprecated/i.test(storyName);
      if (!deprecated) continue;

      for (const props of propsOfStory(declarator.init, componentName)) {
        if (Object.keys(props).length === 0) continue;
        deprecatedPatterns.push({ storyName, props });
      }
    }
  }

  return { deprecatedPatterns };
}
