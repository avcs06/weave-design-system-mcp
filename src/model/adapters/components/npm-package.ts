import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { parse, type ComponentDoc } from 'react-docgen-typescript';
import ts from 'typescript';

import type { ComponentContract, SourceConfig } from '../../types.js';
import { toProps } from './react-tsx.js';

/**
 * Resolves an installed package's TypeScript declaration entry point,
 * looking from the *target repo* rather than from this server's own
 * install — the package belongs to the design system being scanned, and
 * this server may well be installed somewhere else entirely.
 */
function resolveTypesEntry(packageName: string, configDir: string): string | undefined {
  const require = createRequire(join(configDir, 'noop.js'));

  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    types?: string;
    typings?: string;
  };
  const typesField = packageJson.types ?? packageJson.typings;
  if (typesField) return resolve(dirname(packageJsonPath), typesField);

  try {
    return require.resolve(`@types/${packageName.replace('/', '__')}/index.d.ts`);
  } catch {
    return undefined;
  }
}

/**
 * Which of `names` the module at `entryPath` actually exports, asked of the
 * TypeScript checker so re-exports (`export * from './icons'`, the norm for
 * an icon package's barrel) resolve properly.
 */
function existingExports(entryPath: string, names: string[]): Set<string> {
  const program = ts.createProgram([entryPath], {
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(entryPath);
  if (!source) return new Set();

  const symbol = program.getTypeChecker().getSymbolAtLocation(source);
  if (!symbol) return new Set();

  const exported = new Set(
    program
      .getTypeChecker()
      .getExportsOfModule(symbol)
      .map((s) => s.getName()),
  );
  return new Set(names.filter((name) => exported.has(name)));
}

function toContract(doc: ComponentDoc, packageName: string): ComponentContract {
  return {
    name: doc.displayName,
    // The package name is the category: it's the honest answer to "where does
    // this come from", and it keeps external components filterable as a group.
    category: packageName,
    description: doc.description,
    props: toProps(doc.props),
    variantProps: toProps(doc.props)
      .filter((p) => p.allowedValues)
      .map((p) => p.name),
    invalidAlternatives: [],
    deprecatedPatterns: [],
    storyPropShapes: [],
  };
}

/**
 * Scans an installed npm package (an icon library, a headless primitive set)
 * so its components become first-class members of the design system —
 * listed, searchable, and gettable, rather than merely tolerated by name.
 *
 * Config fields:
 *  - `package` (required): the package name, e.g. `"lucide-react"`.
 *  - `names` (optional): `"*"` or omitted for every component the package
 *    exports, or an array of specific names.
 *
 * A package whose types can't be resolved is reported on stderr and skipped
 * rather than failing the whole load — one unresolvable icon library should
 * not take the design system's own components down with it.
 */
export function loadComponents(config: SourceConfig): ComponentContract[] {
  const configDir = typeof config.configDir === 'string' ? config.configDir : process.cwd();
  const packageName = config.package;
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('npm-package component source requires a "package" name.');
  }

  const names = config.names;
  if (names !== undefined && names !== '*' && !Array.isArray(names)) {
    throw new Error(
      `npm-package component source "${packageName}": "names" must be "*" or an array of names.`,
    );
  }
  const wanted = Array.isArray(names) ? new Set(names.map(String)) : undefined;

  const entry = resolveTypesEntry(packageName, configDir);
  if (!entry) {
    console.error(
      `[weave-design-system-mcp] could not resolve type declarations for "${packageName}" from ${configDir}; skipping it.`,
    );
    return [];
  }

  let docs: ComponentDoc[];
  try {
    docs = parse(entry, {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
    });
  } catch (error) {
    console.error(`[weave-design-system-mcp] failed to scan "${packageName}": ${(error as Error).message}`);
    return [];
  }

  const contracts: ComponentContract[] = [];
  for (const doc of docs) {
    if (wanted && !wanted.has(doc.displayName)) continue;
    contracts.push(toContract(doc, packageName));
  }

  // A name asked for by hand that docgen didn't recognize as a component —
  // routine for the terse one-liners an icon package is made of — is still
  // listed, but only after the checker confirms the package really exports
  // it. A typo stays a typo instead of quietly becoming a valid component.
  if (wanted) {
    const found = new Set(docs.map((d) => d.displayName));
    const missing = [...wanted].filter((name) => !found.has(name));
    if (missing.length > 0) {
      const confirmed = existingExports(entry, missing);
      for (const name of missing) {
        if (confirmed.has(name)) {
          contracts.push({
            name,
            category: packageName,
            description: '',
            props: [],
            variantProps: [],
            invalidAlternatives: [],
            deprecatedPatterns: [],
            storyPropShapes: [],
          });
        } else {
          console.error(
            `[weave-design-system-mcp] "${name}" is not exported by "${packageName}"; skipping it.`,
          );
        }
      }
    }
  }

  return contracts;
}
