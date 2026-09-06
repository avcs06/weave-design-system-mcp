/**
 * The design-system model: config, adapters, and the lookup API. Nothing
 * under `model/` imports from `@modelcontextprotocol/*` — this layer is
 * meant to be reusable by something other than an MCP server later (a CLI,
 * a lint rule).
 */

export type Severity = 'error' | 'warning';

/** Where a `validate()` finding was seen. Not a fixed enum of the whole domain — just the surfaces this server walks. */
export type Surface = 'vanilla-extract' | 'jsx' | 'tailwind';

export interface DesignToken {
  /** Semantic dot path, e.g. "color.theme.background" or "spacing.x6". */
  name: string;
  /**
   * Whatever the token source calls this group (color, spacing, iconSize,
   * zIndex, ...). Deliberately not a fixed enum — a real design system's
   * category set isn't knowable in advance, and assuming one (e.g. that
   * "shadow" or "motion" always exist) breaks on systems that don't have it.
   */
  group: string;
  /** The exact code an agent should write to use this token, e.g. "tokens.spacing.x6" or "vars.color.theme.background". */
  reference: string;
  /**
   * Resolved literal value (hex, px, ...), when the source can actually see
   * one statically. Not guaranteed: a vanilla-extract theme *contract* only
   * declares shape (`createThemeContract`), and the values a `createTheme`
   * call resolves to may come from a computed expression the adapter can't
   * evaluate — those tokens still have a name/reference, just no `value`.
   * `nearestToken()` (see `DesignSystem`) can only suggest among tokens that
   * do have one.
   */
  value?: string;
}

/** Config bag passed to an adapter's load function — one adapter's own fields, plus `configDir` for resolving relative paths. */
export interface SourceConfig {
  source: string;
  [key: string]: unknown;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description?: string;
  /** Present when this is a variant-like prop: the closed set of allowed literal values. */
  allowedValues?: string[];
}

/** One prop combination a component's own `.stories` file marks as deprecated. */
export interface DeprecatedUsagePattern {
  /** The story export that demonstrates it, named in the finding so a human can go read it. */
  storyName: string;
  /** Prop name -> literal value. A usage matches when it reproduces every entry here; extra props are allowed. */
  props: Record<string, string>;
}

export interface ComponentContract {
  name: string;
  category: string;
  description: string;
  props: ComponentProp[];
  /** Subset of `props` names considered variant-like (i.e. have `allowedValues`). */
  variantProps: string[];
  /**
   * What this component declares invalid to reach for in its place — a
   * native element it supersedes (`@invalidAlternative button`), another
   * component it replaces, or several. Using one directly is an error: the
   * design system has this component for exactly that job.
   */
  invalidAlternatives: string[];
  /**
   * Same idea, but *guessed* by a model rather than declared (see
   * `DesignSystem.inferInvalidAlternatives`). Kept separate from
   * `invalidAlternatives` precisely because a guess must not carry a
   * declaration's authority: it produces a warning, never an error.
   */
  inferredInvalidAlternatives?: string[];
  /** Deprecated prop combinations read from the component's colocated `.stories` file. */
  deprecatedPatterns: DeprecatedUsagePattern[];
  /**
   * The prop-*name* set each story demonstrates (values ignored, sorted).
   * Empty when the component has no stories at all — which means "can't
   * tell", not "nothing is documented", so the undocumented-pattern check
   * skips the component entirely rather than warning about everything.
   */
  storyPropShapes: string[][];
  /** Absolute path of the file declaring the component, when it came from one. */
  filePath?: string;
}

export interface Finding {
  /** Stable rule id, e.g. "hardcoded-literal" | "unknown-variant". */
  rule: string;
  severity: Severity;
  surface: Surface;
  line: number;
  column: number;
  message: string;
  /** The exact fix, when derivable from the reverse index — e.g. a token reference. */
  suggestion?: string;
}

export interface ValidateResult {
  ok: boolean;
  findings: Finding[];
}

export interface ComponentSummary {
  name: string;
  description: string;
  category: string;
  variantProps: string[];
}

/** One ranked result from `searchTokens`/`searchComponents`. */
export interface SearchHit {
  kind: 'token' | 'component';
  name: string;
  description: string;
  /** Relevance, higher is better — an exact name match outranks a substring match, which outranks a body-text match. */
  score: number;
}

/** The MCP-independent lookup API. `mcp/server.ts` only calls this and formats the result. */
export interface DesignSystem {
  tokens(group?: string): DesignToken[];
  /** Nearest token to a raw value within a group, for `Finding.suggestion`. Only searches tokens that have a resolved `value`. */
  nearestToken(value: string, group: string): DesignToken | undefined;
  components(category?: string): ComponentSummary[];
  component(name: string): ComponentContract | undefined;
  /** Fuzzy name matches, for `get_component`'s "closest matches" on a miss. */
  closestComponents(name: string, limit?: number): string[];
  /** Ranked token search across name, group, reference and value — for "is there a token for X?" */
  searchTokens(query: string, limit?: number): SearchHit[];
  /** Ranked component search across name, description, category and prop names — for "is there a component for X?" */
  searchComponents(query: string, limit?: number): SearchHit[];
  /**
   * Best-effort enrichment, and a no-op unless the config opts in with
   * `inferInvalidAlternatives`: for every component that does *not* declare
   * `@invalidAlternative`, asks `suggest` which native element it stands in
   * for and
   * records the answer as `inferredInvalidAlternatives`. Takes a plain
   * function so this layer stays free of any MCP dependency — the server
   * passes one backed by client sampling. A component whose suggestion
   * fails is left un-enriched rather than failing the pass.
   */
  inferInvalidAlternatives(suggest: (component: ComponentContract) => Promise<string[]>): Promise<void>;
  validate(code: string, filename?: string): ValidateResult;
}
