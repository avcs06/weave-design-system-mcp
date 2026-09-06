import type { File, ObjectExpression } from '@babel/types';

import { checkStyleObject as checkStyleObjectShared } from '../check-style-object.js';
import type { DesignSystem, DesignToken, Finding, SourceConfig, Surface } from '../types.js';
import * as objectStyles from './styles/object.js';
import * as vanillaExtractStyles from './styles/vanilla-extract.js';

/**
 * This file is a pure dispatcher — it contains no styling-system-specific
 * code of its own. Each concrete implementation lives in its own module
 * under `styles/` and is only ever reached through the functions below,
 * chosen by `config.source`. Adding support for another styling system
 * (Sass modules, styled-components, whatever) means writing a new file next
 * to `styles/vanilla-extract.ts` and adding one branch here — never
 * touching a concrete implementation to add another, and never touching
 * `validate.ts` or the TSX adapter, which only ever call this file — never
 * a concrete implementation or the shared checker directly.
 */

/**
 * Checks a single style object literal (a JSX `style={{}}` prop, most
 * likely) for hardcoded values. Not config-gated like `validateStyles`
 * below: a plain style object is a React feature, not tied to any
 * particular styling system, so there's nothing to dispatch on — but it's
 * exposed *here*, not straight from `check-style-object.ts`, so the TSX
 * adapter only ever talks to its sibling adapters, never reaches past one
 * into a shared internal utility on its own.
 */
export function checkStyleObject(obj: ObjectExpression, system: DesignSystem, surface: Surface): Finding[] {
  return checkStyleObjectShared(obj, system, surface);
}

/**
 * Reads one configured token source. `config.source` picks which
 * implementation actually runs — see `styles/vanilla-extract.ts` and
 * `styles/object.ts` for their own config fields.
 */
export function loadTokens(config: SourceConfig): DesignToken[] {
  if (config.source === 'vanilla-extract') return vanillaExtractStyles.loadTokens(config);
  if (config.source === 'object') return objectStyles.loadTokens(config);
  throw new Error(`Unknown token source "${config.source}" — expected "vanilla-extract" or "object".`);
}

/**
 * `validate`'s entry point for style-defining code — deliberately
 * styling-system *agnostic* in name and signature, dispatching on
 * `config.source` the same way `loadTokens` does. Config-driven, not
 * assumed: a project that never sets `styles` in its
 * `designsystem.config.json` gets no findings from this check at all,
 * rather than one styling system's conventions being silently checked
 * whether or not that project actually uses it.
 */
export function validateStyles(ast: File, system: DesignSystem, config: SourceConfig | undefined): Finding[] {
  if (!config) return [];
  if (config.source === 'vanilla-extract') return vanillaExtractStyles.validate(ast, system);
  throw new Error(`Unknown styles source "${config.source}" — expected "vanilla-extract".`);
}
