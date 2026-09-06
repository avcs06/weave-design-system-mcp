import type { McpServer } from '@modelcontextprotocol/server';

import type { ComponentContract } from '../model/types.js';

/**
 * Keyed by a component's *shape* (name + description + prop signature), not
 * just its name, so a real change to the component invalidates the answer
 * while nothing re-asks the client for a component that hasn't moved.
 */
const cache = new Map<string, string[]>();

function cacheKey(component: ComponentContract): string {
  const signature = component.props.map((p) => `${p.name}:${p.type}`).join(',');
  return `${component.name}|${component.description}|${signature}`;
}

const PROMPT_TAIL =
  'If this component exists specifically to replace a plain native HTML element (e.g. a Button ' +
  'component replaces <button>, a TextField replaces <input>), reply with ONLY that lowercase ' +
  'HTML tag name, or a comma-separated list if more than one genuinely applies. If it does not ' +
  'replace any single native element (e.g. it is a layout, composition, or provider component), ' +
  'reply with exactly "none". No other text.';

function parseTags(text: string): string[] {
  const answer = text.trim().toLowerCase();
  if (!answer || answer === 'none') return [];
  return answer
    .split(',')
    .map((tag) => tag.trim().replace(/[<>]/g, ''))
    .filter((tag) => /^[a-z][a-z0-9]*$/.test(tag));
}

/**
 * Asks the connected client's model which native HTML tag a component is
 * meant to replace, for components that don't declare it themselves with an
 * `@invalidAlternative` JSDoc tag. The answer only ever produces a *warning*
 * — see the JSX check in `tsx-adapter.ts`.
 *
 * Returns `[]` when the client declared no `sampling` capability, and when
 * the model answers "none". A failed *request* propagates instead, so the
 * caller can stop asking after a few in a row rather than working through
 * a whole component set the client cannot answer for — which is what
 * happens on protocol revision 2026-07-28, where push-style sampling was
 * removed. The declared `@invalidAlternative` path is unaffected either way.
 */
export function createInvalidAlternativeSuggester(
  server: McpServer,
): (component: ComponentContract) => Promise<string[]> {
  return async (component) => {
    const key = cacheKey(component);
    const cached = cache.get(key);
    if (cached) return cached;

    if (!server.server.getClientCapabilities()?.sampling) {
      cache.set(key, []);
      return [];
    }

    const propsSummary = component.props.map((p) => `${p.name}: ${p.type}`).join(', ') || '(no props)';

    const result = await server.server.createMessage({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `A UI component named "${component.name}" (${component.description || 'no description given'}) ` +
              `has these props: ${propsSummary}. ${PROMPT_TAIL}`,
          },
        },
      ],
      maxTokens: 20,
    });

    const tags = result.content.type === 'text' ? parseTags(result.content.text) : [];
    cache.set(key, tags);
    return tags;
  };
}
