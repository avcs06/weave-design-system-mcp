import { loadTokens } from './adapters/styles-adapter.js';
import { buildInvalidAlternativeOwners, loadComponents } from './adapters/tsx-adapter.js';
import type { ResolvedConfig } from './config.js';
import { buildReverseIndex } from './reverse-index.js';
import type { ComponentContract, DesignSystem, DesignToken, SearchHit } from './types.js';
import { validate as runValidate } from './validate.js';

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

/** How many invalid-alternative questions may be in flight at once (see `inferInvalidAlternatives`). */
const INFERENCE_CONCURRENCY = 4;
/** Give up on inference entirely after this many consecutive failures — the client evidently can't answer. */
const MAX_CONSECUTIVE_INFERENCE_FAILURES = 3;

function loadAllTokens(config: ResolvedConfig): DesignToken[] {
  return config.tokens.flatMap((sourceConfig) =>
    loadTokens({ ...sourceConfig, configDir: config.configDir }),
  );
}

function loadAllComponents(config: ResolvedConfig): ComponentContract[] {
  return config.components.flatMap((sourceConfig) =>
    loadComponents({ ...sourceConfig, configDir: config.configDir }),
  );
}

/**
 * Ranks a match so an exact name beats a prefix, which beats a substring,
 * which beats a mention anywhere in the surrounding text. Zero means "not a
 * match at all" and is dropped by the callers below.
 */
function scoreMatch(query: string, name: string, haystack: string): number {
  const n = name.toLowerCase();
  if (n === query) return 100;
  if (n.startsWith(query)) return 75;
  if (n.includes(query)) return 50;
  if (haystack.toLowerCase().includes(query)) return 25;
  return 0;
}

function rank(hits: SearchHit[], limit: number): SearchHit[] {
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Builds the `DesignSystem` lookup API from a resolved config: loads every
 * configured token source (concatenated — merging same-named tokens across
 * sources is left to whoever configures the paths, not solved here), the
 * configured component source, and the reverse index derived from whichever
 * tokens have a resolved value.
 */
export function createDesignSystem(config: ResolvedConfig): DesignSystem {
  const tokens = loadAllTokens(config);
  const components = loadAllComponents(config);
  const reverseIndex = buildReverseIndex(tokens);
  // A component source can be an entire icon package, so `component()` gets
  // a map rather than a linear scan — `validate` looks up a name per JSX tag.
  const byName = new Map(components.map((c) => [c.name.toLowerCase(), c]));
  // Built once rather than per `validate` call. Only inference changes what
  // goes into it, and that rebuilds it below.
  let invalidAlternatives = buildInvalidAlternativeOwners(components);

  const system: DesignSystem = {
    tokens(group) {
      return group ? tokens.filter((t) => t.group === group) : tokens;
    },

    nearestToken(value, group) {
      return reverseIndex.nearestToken(value, group);
    },

    components(category) {
      const filtered = category
        ? components.filter((c) => c.category.toLowerCase() === category.toLowerCase())
        : components;
      return filtered.map((c) => ({
        name: c.name,
        description: c.description,
        category: c.category,
        variantProps: c.variantProps,
      }));
    },

    component(name) {
      return byName.get(name.trim().toLowerCase());
    },

    closestComponents(name, limit = 5) {
      return components
        .map((c) => ({ name: c.name, distance: levenshtein(name.toLowerCase(), c.name.toLowerCase()) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((c) => c.name);
    },

    searchTokens(query, limit = 20) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return rank(
        tokens.map((token) => ({
          kind: 'token' as const,
          name: token.name,
          description: token.reference,
          score: scoreMatch(needle, token.name, `${token.group} ${token.reference} ${token.value ?? ''}`),
        })),
        limit,
      );
    },

    searchComponents(query, limit = 20) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return rank(
        components.map((component) => ({
          kind: 'component' as const,
          name: component.name,
          description: component.description,
          score: scoreMatch(
            needle,
            component.name,
            `${component.description} ${component.category} ${component.props.map((p) => p.name).join(' ')}`,
          ),
        })),
        limit,
      );
    },

    async inferInvalidAlternatives(suggest) {
      // Opt-in: each `suggest` is a model call charged to whoever runs the
      // client, so a project that didn't ask for this must not pay for it.
      // Returning before the first call is the point — filtering the results
      // afterwards would already have spent the money.
      if (!config.inferInvalidAlternatives) return;

      // Only components that declare nothing themselves — a declaration is
      // authoritative and must never be second-guessed by a model.
      const queue = components.filter((c) => c.invalidAlternatives.length === 0);
      let next = 0;
      let consecutiveFailures = 0;

      // Bounded concurrency, not `Promise.all` over the whole set: a design
      // system of a few hundred components would otherwise fire a few hundred
      // simultaneous requests at the client the instant it connects. And a
      // run of consecutive failures means the client can't answer these at
      // all, so stop asking rather than working through the whole list.
      const worker = async (): Promise<void> => {
        while (next < queue.length && consecutiveFailures < MAX_CONSECUTIVE_INFERENCE_FAILURES) {
          const component = queue[next++]!;
          try {
            const tags = await suggest(component);
            consecutiveFailures = 0;
            if (tags.length > 0) component.inferredInvalidAlternatives = tags;
          } catch {
            consecutiveFailures++;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(INFERENCE_CONCURRENCY, queue.length) }, worker));
      invalidAlternatives = buildInvalidAlternativeOwners(components);
    },

    validate(code, filename) {
      return runValidate(system, code, filename, {
        styles: config.styles,
        classNames: config.classNames,
        invalidAlternatives,
      });
    },
  };

  return system;
}
