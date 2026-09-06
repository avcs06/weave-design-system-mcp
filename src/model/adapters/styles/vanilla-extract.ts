import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import type { File } from '@babel/types';

import { checkStyleObject } from '../../check-style-object.js';
import { flattenObjectLiteral } from '../../flatten-object-literal.js';
import type { DesignSystem, DesignToken, Finding, SourceConfig } from '../../types.js';

// @babel/traverse's default export is CJS-interop-wrapped depending on how
// Node resolves it; unwrap defensively rather than assume one shape.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse;

const THEME_DEFINITION_PACKAGE = '@vanilla-extract/css';
const THEME_DEFINITION_CALLS = new Set(['createThemeContract', 'createGlobalTheme']);

/**
 * Reads a vanilla-extract theme file and flattens `createThemeContract` /
 * `createGlobalTheme` calls into a token list. Purely static — parses with
 * Babel and reads literal AST nodes, never executes the file. A theme
 * *contract* (`createThemeContract`) only declares shape, so its tokens
 * carry a `reference` but no `value`; `createGlobalTheme` usually inlines
 * real values, so those tokens get both.
 *
 * Config fields: `path` (required), `referenceRoot` (optional — the
 * identifier an agent should write before the dotted path, e.g. `vars` in
 * `vars.color.theme.background`; defaults to the local binding name, which
 * is only correct if nothing re-exports/renames it downstream).
 */
export function loadTokens(config: SourceConfig): DesignToken[] {
  const path = config.path;
  if (typeof path !== 'string') {
    throw new Error('vanilla-extract token source requires a string "path" field.');
  }
  const configDir = typeof config.configDir === 'string' ? config.configDir : process.cwd();
  const filePath = resolve(configDir, path);

  const code = readFileSync(filePath, 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

  const importedNames = new Set<string>();
  const tokens: DesignToken[] = [];

  traverse(ast, {
    ImportDeclaration(nodePath) {
      if (nodePath.node.source.value !== THEME_DEFINITION_PACKAGE) return;
      for (const specifier of nodePath.node.specifiers) {
        // Track by the *local* binding — what a call expression actually
        // uses — not the imported name, so `import { createGlobalTheme as
        // t }` still resolves; filter on the imported name to decide
        // whether this specifier is one of ours at all.
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          THEME_DEFINITION_CALLS.has(specifier.imported.name)
        ) {
          importedNames.add(specifier.local.name);
        }
      }
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (callee.type !== 'Identifier' || !importedNames.has(callee.name)) return;

      // Both createThemeContract(shape) and createGlobalTheme(selector?, shape)
      // take the shape/value object as their last argument.
      const lastArg = nodePath.node.arguments[nodePath.node.arguments.length - 1];
      if (!lastArg || lastArg.type !== 'ObjectExpression') return;

      const declarator = nodePath.parentPath.node;
      const boundName =
        config.referenceRoot ??
        (declarator.type === 'VariableDeclarator' && declarator.id.type === 'Identifier'
          ? declarator.id.name
          : undefined);
      if (typeof boundName !== 'string') return; // not bound to a simple identifier — nothing to reference it by

      flattenObjectLiteral(lastArg, [], boundName, tokens);
    },
  });

  return tokens;
}

const STYLE_DEFINITION_PACKAGES = new Set(['@vanilla-extract/css', '@vanilla-extract/recipes']);
const STYLE_DEFINITION_CALLS = new Set(['style', 'styleVariants', 'recipe']);

/**
 * Finds every `style()`/`styleVariants()` call (from `@vanilla-extract/css`)
 * and `recipe()` call (from the separate `@vanilla-extract/recipes` package
 * — tracked explicitly, since it's easy to assume it lives in `css` too)
 * actually imported from a vanilla-extract package, and checks each one via
 * the shared `checkStyleObject`. This is the primary surface for a system
 * that styles this way: in a system that splits styling between
 * vanilla-extract and Tailwind, this is where real token violations live.
 */
export function validate(ast: File, system: DesignSystem): Finding[] {
  const importedNames = new Set<string>();
  const findings: Finding[] = [];

  traverse(ast, {
    ImportDeclaration(nodePath) {
      if (!STYLE_DEFINITION_PACKAGES.has(nodePath.node.source.value)) return;
      for (const specifier of nodePath.node.specifiers) {
        // Track by the *local* binding, not the imported name — see the
        // matching comment in `loadTokens` above.
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          STYLE_DEFINITION_CALLS.has(specifier.imported.name)
        ) {
          importedNames.add(specifier.local.name);
        }
      }
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (callee.type !== 'Identifier' || !importedNames.has(callee.name)) return;

      const arg = nodePath.node.arguments[0];
      if (!arg || arg.type !== 'ObjectExpression') return;

      findings.push(...checkStyleObject(arg, system, 'vanilla-extract'));
    },
  });

  return findings;
}
