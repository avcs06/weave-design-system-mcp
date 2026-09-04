/** Core domain types for the Weave design system. */

export type TokenCategory =
  'color' | 'spacing' | 'typography' | 'radius' | 'shadow' | 'motion';

export interface DesignToken {
  /** Dot-delimited token name, e.g. `color.surface.raised`. */
  name: string;
  category: TokenCategory;
  /** Resolved value as authored (hex, rem, cubic-bezier, ...). */
  value: string;
  /** CSS custom property that exposes this token at runtime. */
  cssVar: string;
  description: string;
  /** Token this one aliases, if it is a semantic alias of a primitive. */
  aliasOf?: string;
  deprecated?: boolean;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface Component {
  /** PascalCase component name, e.g. `Button`. */
  name: string;
  category: string;
  description: string;
  /** Import specifier consumers should use. */
  importPath: string;
  props: ComponentProp[];
  /** Design tokens this component reads. */
  tokensUsed: string[];
  /** Short, copy-pasteable usage example. */
  example: string;
  /** Accessibility contract callers must honour. */
  a11y: string[];
  deprecated?: boolean;
}

export interface SearchHit {
  kind: 'token' | 'component';
  name: string;
  description: string;
  /** Higher is a better match. */
  score: number;
}
