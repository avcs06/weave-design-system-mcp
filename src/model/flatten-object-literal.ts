import type { Expression, Node, ObjectExpression } from '@babel/types';

import type { DesignToken } from './types.js';

function isStringOrNumberLiteral(node: Node): node is Node & { value: string | number } {
  return node.type === 'StringLiteral' || node.type === 'NumericLiteral';
}

/** Strips `as const` / `satisfies X` / `!` wrappers to reach the real expression underneath. */
export function unwrapExpression(node: Expression): Expression {
  while (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Walks a (possibly nested) object literal, emitting one `DesignToken` per
 * leaf: a string/number literal becomes a token with a resolved `value`; a
 * bare `null` becomes a token with no value (a theme *contract* leaf —
 * shape only). Anything else (a computed expression) can't be statically
 * resolved and is skipped rather than guessed at. Shared by the styles
 * adapter's two token-reading modes (vanilla-extract and plain object).
 */
export function flattenObjectLiteral(
  obj: ObjectExpression,
  pathSoFar: string[],
  referenceRoot: string,
  tokens: DesignToken[],
): void {
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue; // skip spreads/methods — not a token leaf
    const key = prop.key.type === 'Identifier' ? prop.key.name : undefined;
    if (!key) continue;

    const path = [...pathSoFar, key];
    const value = unwrapExpression(prop.value as Expression);

    if (value.type === 'ObjectExpression') {
      flattenObjectLiteral(value, path, referenceRoot, tokens);
      continue;
    }

    const name = path.join('.');
    const reference = [referenceRoot, ...path].join('.');
    if (isStringOrNumberLiteral(value)) {
      tokens.push({ name, group: path[0]!, reference, value: String(value.value) });
    } else if (value.type === 'NullLiteral') {
      tokens.push({ name, group: path[0]!, reference });
    }
  }
}
