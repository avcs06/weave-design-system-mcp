import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { DesignSystem } from '../model/types.js';

export const SERVER_NAME = 'weave-design-system-mcp';

// Read from package.json rather than duplicated here: the version a client
// sees should be the version that was published, and a second copy only ever
// drifts from it at release time.
const require = createRequire(import.meta.url);
export const SERVER_VERSION = (require('../../package.json') as { version: string }).version;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Builds an MCP server wired to an already-loaded `DesignSystem`. The
 * server itself is thin on purpose: every handler below is one line of
 * calling the model and formatting the result as tool content — anything
 * more than that belongs in `model/`, not here. `system` is loaded once at
 * startup (see `stdio.ts`) and shared by every call; `serveStdio` may
 * invoke this factory more than once per connection (it pins one instance
 * per protocol era), so the factory itself must stay cheap — no I/O here.
 */
export function createServer(system: DesignSystem): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Design system reference and validator, generic across whatever project points a ' +
        'designsystem.config.json at it. Before writing UI code, search or list to find the real ' +
        'token names and component contracts — never invent a color, spacing value, or component ' +
        'prop, and never hand-build an element the system already has a component for. Call ' +
        'validate on the code you generate afterward; fix every finding it returns before ' +
        'considering the task done.',
    },
  );

  server.registerTool(
    'list_tokens',
    {
      title: 'List design tokens',
      description:
        'List design tokens, optionally filtered to one group (e.g. "color", "spacing", ' +
        '"radius" — call this with no group first to see what groups this system actually has, ' +
        'since they vary by project). Each token includes the exact `reference` to write in code ' +
        '— always use that, never the raw resolved value.',
      inputSchema: z.object({
        group: z.string().optional().describe('Restrict results to one token group.'),
      }),
    },
    async ({ group }) => {
      const tokens = system.tokens(group);
      return json({ count: tokens.length, tokens });
    },
  );

  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description:
        'List the component inventory: name, one-line purpose, category, and which props are ' +
        'variant-like. Call this before writing any UI code to see what already exists — do not ' +
        "reach for a raw HTML element or another library's component without checking here first.",
      inputSchema: z.object({
        category: z.string().optional().describe('Restrict results to one component category.'),
      }),
    },
    async ({ category }) => {
      const components = system.components(category);
      return json({ count: components.length, components });
    },
  );

  server.registerTool(
    'get_component',
    {
      title: 'Get a component contract',
      description:
        "Get one component's full contract: every prop with its type and required flag, the " +
        'allowed value set for each variant-like prop, what it is an invalid alternative to, and the ' +
        'prop combinations its stories document. Call this before using any component whose ' +
        'exact props you are not already certain of. An unknown name returns the closest real ' +
        'names — check those before assuming the component does not exist.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Component name, e.g. "Button".'),
      }),
    },
    async ({ name }) => {
      const component = system.component(name);
      if (component) return json(component);
      return json({
        found: false,
        message: `No component named "${name}".`,
        closestMatches: system.closestComponents(name),
      });
    },
  );

  server.registerTool(
    'search_tokens',
    {
      title: 'Search design tokens',
      description:
        'Find tokens by a free-text query, ranked by relevance — searches token names, groups, ' +
        'references and values. Use this when you know what you want ("elevated surface", ' +
        '"danger", "gutter") but not what this system calls it; use list_tokens when you want to ' +
        'browse a whole group instead.',
      inputSchema: z.object({
        query: z.string().min(1).describe('What to look for, e.g. "background" or "spacing".'),
        limit: z.number().int().positive().max(100).optional().describe('Maximum results (default 20).'),
      }),
    },
    async ({ query, limit }) => {
      const results = system.searchTokens(query, limit);
      return json({ count: results.length, results });
    },
  );

  server.registerTool(
    'search_components',
    {
      title: 'Search components',
      description:
        'Find components by a free-text query, ranked by relevance — searches names, ' +
        'descriptions, categories and prop names. Use this before building any UI element from ' +
        'scratch: search for what you are about to write ("modal", "dropdown", "icon") and use ' +
        'what already exists instead of reimplementing it.',
      inputSchema: z.object({
        query: z.string().min(1).describe('What to look for, e.g. "dialog" or "icon".'),
        limit: z.number().int().positive().max(100).optional().describe('Maximum results (default 20).'),
      }),
    },
    async ({ query, limit }) => {
      const results = system.searchComponents(query, limit);
      return json({ count: results.length, results });
    },
  );

  server.registerTool(
    'validate',
    {
      title: 'Validate code against the design system',
      description:
        "Check a JSX/TSX snippet or a style file's content against the real design system: " +
        'hardcoded values that should be tokens, variant props set outside their allowed set, ' +
        'elements or components the design system supersedes, and usages that ' +
        "match a prop combination the component's own stories mark deprecated. Call this on " +
        'every piece of UI code you generate before returning it — a finding names the exact ' +
        'constraint broken and, where derivable, the exact fix to apply. Unparseable input comes ' +
        'back as a finding rather than an error.',
      inputSchema: z.object({
        code: z.string().min(1).describe('The code to check.'),
        filename: z
          .string()
          .optional()
          .describe('Optional label for the snippet, echoed back if it cannot be parsed.'),
      }),
    },
    async ({ code, filename }) => json(system.validate(code, filename)),
  );

  return server;
}
