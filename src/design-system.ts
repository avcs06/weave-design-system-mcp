import { components, tokens } from './data.js';
import type {
  Component,
  DesignToken,
  SearchHit,
  TokenCategory,
} from './types.js';

/**
 * Query layer over the design system content. The MCP server in `server.ts`
 * is a thin wrapper around these functions, so they stay independently testable.
 */

export function listTokens(category?: TokenCategory): DesignToken[] {
  const all = category ? tokens.filter((t) => t.category === category) : tokens;
  return [...all].sort((a, b) => a.name.localeCompare(b.name));
}

export function getToken(name: string): DesignToken | undefined {
  const needle = name.trim().toLowerCase();
  return tokens.find(
    (t) => t.name.toLowerCase() === needle || t.cssVar.toLowerCase() === needle,
  );
}

export function listComponents(category?: string): Component[] {
  const all = category
    ? components.filter(
        (c) => c.category.toLowerCase() === category.toLowerCase(),
      )
    : components;
  return [...all].sort((a, b) => a.name.localeCompare(b.name));
}

export function getComponent(name: string): Component | undefined {
  const needle = name.trim().toLowerCase();
  return components.find((c) => c.name.toLowerCase() === needle);
}

export function tokenCategories(): TokenCategory[] {
  return [...new Set(tokens.map((t) => t.category))].sort();
}

export function componentCategories(): string[] {
  return [...new Set(components.map((c) => c.category))].sort();
}

/** Components that read a given token — the "what breaks if I change this" query. */
export function componentsUsingToken(tokenName: string): Component[] {
  const needle = tokenName.trim().toLowerCase();
  return components.filter((c) =>
    c.tokensUsed.some((t) => t.toLowerCase() === needle),
  );
}

function scoreMatch(query: string, name: string, haystack: string): number {
  const n = name.toLowerCase();
  if (n === query) return 100;
  if (n.startsWith(query)) return 75;
  if (n.includes(query)) return 50;
  if (haystack.toLowerCase().includes(query)) return 25;
  return 0;
}

/** Ranked search across token and component names, descriptions, and values. */
export function search(query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];

  for (const t of tokens) {
    const score = scoreMatch(
      q,
      t.name,
      `${t.description} ${t.value} ${t.cssVar}`,
    );
    if (score > 0) {
      hits.push({
        kind: 'token',
        name: t.name,
        description: t.description,
        score,
      });
    }
  }

  for (const c of components) {
    const score = scoreMatch(
      q,
      c.name,
      `${c.description} ${c.category} ${c.props.map((p) => p.name).join(' ')}`,
    );
    if (score > 0) {
      hits.push({
        kind: 'component',
        name: c.name,
        description: c.description,
        score,
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
