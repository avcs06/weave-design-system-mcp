import { parse } from '@babel/parser';

import { validateStyles } from './adapters/styles-adapter.js';
import { validateJsx, type InvalidAlternativeOwners } from './adapters/tsx-adapter.js';
import type { SourceConfig } from './config.js';
import type { DesignSystem, Finding, ValidateResult } from './types.js';

export interface ValidateContext {
  /** Which styling system's calls to scan — omit to skip that check entirely. */
  styles?: SourceConfig;
  /** Which utility-class convention to scan `className` for — omit to skip that check entirely. */
  classNames?: SourceConfig;
  /** Prebuilt tag lookup, owned by the design system so it isn't rebuilt per call. */
  invalidAlternatives: InvalidAlternativeOwners;
}

/**
 * Parses `code` (JSX/TSX or a `.css.ts` file — same parser either way) once,
 * then asks the two adapters that know how to check something to check it:
 * the styles adapter for style-defining calls (which styling system,
 * decided by `config.styles`), and the TSX adapter for JSX elements (which
 * itself dispatches `className` by `config.classNames`). Neither check
 * assumes a styling system exists — omitting the corresponding config
 * field skips it, rather than guessing at conventions the project may not
 * even use.
 *
 * Never throws: an unparseable snippet becomes a `parse-error` finding.
 */
export function validate(
  system: DesignSystem,
  code: string,
  filename: string | undefined,
  context: ValidateContext,
): ValidateResult {
  let findings: Finding[];
  try {
    const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    findings = [
      ...validateStyles(ast, system, context.styles),
      ...validateJsx(ast, system, context.classNames, context.invalidAlternatives),
    ];
  } catch (error) {
    findings = [
      {
        rule: 'parse-error',
        severity: 'error',
        surface: 'jsx',
        line: 1,
        column: 1,
        message: `Could not parse this as JSX/TSX: ${(error as Error).message}${filename ? ` (${filename})` : ''}`,
      },
    ];
  }

  return { ok: findings.every((f) => f.severity !== 'error'), findings };
}
