import type { Expression } from '@babel/types';

import type { Finding, SourceConfig } from '../types.js';
import * as tailwindClassNames from './classnames/tailwind.js';

/**
 * This file is a pure dispatcher — it contains no utility-class-convention
 * code of its own. Each concrete implementation lives in its own module
 * under `classnames/` (currently just `tailwind.ts`) and is only ever
 * reached through `check` below, chosen by `config.source`. Adding support
 * for another convention (Bootstrap, whatever) means writing a new file
 * next to `classnames/tailwind.ts` and adding one branch here — never
 * touching the TSX adapter, which only ever calls `check`.
 *
 * `validate`'s entry point — config-driven, not assumed: a project that
 * never sets `classNames` in its `designsystem.config.json` gets `className`
 * left entirely uninspected, rather than one convention's rules being
 * silently applied whether or not that project actually uses it.
 */
export function check(config: SourceConfig | undefined, value: Expression): Finding[] {
  if (!config) return [];
  if (config.source === 'tailwind') return tailwindClassNames.check(value);
  throw new Error(`Unknown classNames source "${config.source}" — expected "tailwind".`);
}
