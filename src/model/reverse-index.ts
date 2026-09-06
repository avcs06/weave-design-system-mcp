import type { DesignToken } from './types.js';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): Rgb | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Strips a trailing unit (px, %, ms, ...) and parses the leading number, e.g. "8px" -> 8. */
function parseNumeric(value: string): number | undefined {
  const match = /^-?[\d.]+/.exec(value.trim());
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isNaN(n) ? undefined : n;
}

function minBy<T>(items: T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const item of items) {
    const s = score(item);
    if (s < bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return bestScore === Infinity ? undefined : best;
}

export interface ReverseIndex {
  /** Nearest token to a raw value within a group — color distance for hex, numeric proximity otherwise. Only considers tokens with a resolved `value`. */
  nearestToken(value: string, group: string): DesignToken | undefined;
}

/**
 * Builds a value -> nearest-token lookup, once, at load time. This is what
 * turns a bare "unknown color" finding into an actionable one: instead of
 * "use a color token," `suggestion` names the exact token whose value is
 * closest to what was actually written.
 */
export function buildReverseIndex(tokens: DesignToken[]): ReverseIndex {
  return {
    nearestToken(value, group) {
      const candidates = tokens.filter(
        (t): t is DesignToken & { value: string } => t.group === group && t.value !== undefined,
      );
      if (candidates.length === 0) return undefined;

      const targetColor = parseHexColor(value);
      if (targetColor) {
        return minBy(candidates, (t) => {
          const c = parseHexColor(t.value);
          return c ? colorDistance(targetColor, c) : Infinity;
        });
      }

      const targetNumber = parseNumeric(value);
      if (targetNumber !== undefined) {
        return minBy(candidates, (t) => {
          const n = parseNumeric(t.value);
          return n === undefined ? Infinity : Math.abs(n - targetNumber);
        });
      }

      return candidates.find((t) => t.value === value);
    },
  };
}
