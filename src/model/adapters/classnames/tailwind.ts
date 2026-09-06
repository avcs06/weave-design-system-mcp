import type { Expression } from '@babel/types';

import { collectClassNameStrings } from '../../class-name-strings.js';
import type { Finding } from '../../types.js';

/** Tailwind arbitrary-value brackets: `text-[#1e1e22]`, `p-[13px]`, `top-[2.5rem]`, ... */
const TAILWIND_ARBITRARY_VALUE = /\[(#[0-9a-fA-F]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em))\]/g;

/**
 * Checks a JSX `className` value for Tailwind arbitrary-value brackets,
 * which bypass the design system's spacing/color scale entirely by
 * construction.
 */
export function check(classNameValue: Expression): Finding[] {
  const strings: string[] = [];
  collectClassNameStrings(classNameValue, strings);
  const loc = classNameValue.loc;

  const findings: Finding[] = [];
  for (const str of strings) {
    for (const match of str.matchAll(TAILWIND_ARBITRARY_VALUE)) {
      findings.push({
        rule: 'hardcoded-literal',
        severity: 'error',
        surface: 'tailwind',
        line: loc ? loc.start.line : 0,
        column: loc ? loc.start.column + 1 : 0,
        message: `"${match[0]}" is a Tailwind arbitrary value — it bypasses the design system's scale. Use a token-backed utility class instead.`,
      });
    }
  }
  return findings;
}
