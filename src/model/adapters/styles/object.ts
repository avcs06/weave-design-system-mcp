import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import { parse } from '@babel/parser';
import type { Expression, ObjectExpression } from '@babel/types';

import { flattenObjectLiteral, unwrapExpression } from '../../flatten-object-literal.js';
import type { DesignToken, SourceConfig } from '../../types.js';

/** Flattens a real (already-parsed) JS value — used for JSON sources, which need no AST. */
function flattenPlainValue(
  value: unknown,
  pathSoFar: string[],
  referenceRoot: string,
  tokens: DesignToken[],
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (pathSoFar.length === 0) return; // the root itself isn't a leaf
    const name = pathSoFar.join('.');
    const reference = [referenceRoot, ...pathSoFar].join('.');
    if (typeof value === 'string' || typeof value === 'number') {
      tokens.push({ name, group: pathSoFar[0]!, reference, value: String(value) });
    } else if (value === null) {
      tokens.push({ name, group: pathSoFar[0]!, reference });
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenPlainValue(child, [...pathSoFar, key], referenceRoot, tokens);
  }
}

/** Navigates a dot-separated `rootPath` into a plain JS value before flattening starts. */
function navigatePlainValue(value: unknown, rootPath: string | undefined): unknown {
  if (!rootPath) return value;
  let current = value;
  for (const key of rootPath.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`rootPath "${rootPath}" does not exist — stopped at "${key}".`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Navigates a dot-separated `rootPath` into an object-literal AST node before flattening starts. */
function navigateObjectExpression(node: ObjectExpression, rootPath: string | undefined): ObjectExpression {
  if (!rootPath) return node;
  let current = node;
  for (const key of rootPath.split('.')) {
    const prop = current.properties.find(
      (p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === key,
    );
    const value =
      prop && prop.type === 'ObjectProperty' ? unwrapExpression(prop.value as Expression) : undefined;
    if (!value || value.type !== 'ObjectExpression') {
      throw new Error(`rootPath "${rootPath}" does not exist — stopped at "${key}".`);
    }
    current = value;
  }
  return current;
}

/** Finds `export const <name> = <expr>` (or the sole one, if `exportName` isn't given) in a parsed module. */
function findNamedExportObject(
  ast: ReturnType<typeof parse>,
  exportName: string | undefined,
): { name: string; init: Expression } {
  const candidates: { name: string; init: Expression }[] = [];

  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || !statement.declaration) continue;
    if (statement.declaration.type !== 'VariableDeclaration') continue;
    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) continue;
      if (exportName && declarator.id.name !== exportName) continue;
      candidates.push({ name: declarator.id.name, init: unwrapExpression(declarator.init) });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      exportName
        ? `No "export const ${exportName} = ..." found.`
        : 'No exported object literal found — set "export" to name one explicitly.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple exported objects found (${candidates.map((c) => c.name).join(', ')}) — set "export" to pick one.`,
    );
  }
  return candidates[0]!;
}

/**
 * Reads a plain token object — a JSON file, or a TS/JS module exporting a
 * (possibly nested) object literal — and flattens it into a token list.
 * Covers both a hand-written `tokens.ts` and a generated `colors.json`;
 * unlike vanilla-extract, every leaf here is expected to be a real value,
 * since there's no "contract" concept for a plain object.
 *
 * Config fields: `path` (required), `export` (which named export, if a
 * file has more than one), `rootPath` (dot-separated — navigate into a
 * nested key before flattening, e.g. a JSON file wrapped in
 * `{ "tokens": {...} }`), `referenceRoot` (defaults to the export's name,
 * or the file's basename for JSON).
 */
export function loadTokens(config: SourceConfig): DesignToken[] {
  const path = config.path;
  if (typeof path !== 'string') {
    throw new Error('object token source requires a string "path" field.');
  }
  const configDir = typeof config.configDir === 'string' ? config.configDir : process.cwd();
  const filePath = resolve(configDir, path);
  const tokens: DesignToken[] = [];
  const rootPath = typeof config.rootPath === 'string' ? config.rootPath : undefined;

  if (extname(filePath) === '.json') {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    const referenceRoot =
      typeof config.referenceRoot === 'string' ? config.referenceRoot : basename(filePath, '.json');
    flattenPlainValue(navigatePlainValue(data, rootPath), [], referenceRoot, tokens);
    return tokens;
  }

  const code = readFileSync(filePath, 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const exportName = typeof config.export === 'string' ? config.export : undefined;
  const { name, init } = findNamedExportObject(ast, exportName);
  if (init.type !== 'ObjectExpression') {
    throw new Error(`"${name}" is not an object literal — object token source can't read it.`);
  }

  const referenceRoot = typeof config.referenceRoot === 'string' ? config.referenceRoot : name;
  flattenObjectLiteral(navigateObjectExpression(init, rootPath), [], referenceRoot, tokens);
  return tokens;
}
