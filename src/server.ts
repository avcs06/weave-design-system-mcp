import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  componentCategories,
  componentsUsingToken,
  getComponent,
  getToken,
  listComponents,
  listTokens,
  search,
  tokenCategories,
} from './design-system.js';
import type { TokenCategory } from './types.js';

export const SERVER_NAME = 'weave-design-system';
export const SERVER_VERSION = '0.1.0';

const TOKEN_CATEGORIES = [
  'color',
  'spacing',
  'typography',
  'radius',
  'shadow',
  'motion',
] as const satisfies readonly TokenCategory[];

/** Render a value as a pretty-printed JSON tool result. */
function json(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** Render an error the model can act on, rather than throwing. */
function notFound(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

/**
 * Build a fully configured Weave design system MCP server.
 *
 * The returned server is not connected to any transport — the caller picks
 * stdio (`stdio.ts`) or Streamable HTTP (`http.ts`). A fresh instance should be
 * created per HTTP session, since `McpServer` is stateful per connection.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Weave design system reference. Use these tools to look up design tokens ' +
        'and component APIs before writing UI code, so generated markup uses real ' +
        'token names and real component props instead of invented ones.',
    },
  );

  server.registerTool(
    'list_tokens',
    {
      title: 'List design tokens',
      description:
        'List Weave design tokens, optionally filtered to one category. Returns each ' +
        "token's name, value, and CSS custom property.",
      inputSchema: {
        category: z
          .enum(TOKEN_CATEGORIES)
          .optional()
          .describe('Restrict results to a single token category.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category }) => {
      const result = listTokens(category);
      return json({
        count: result.length,
        categories: tokenCategories(),
        tokens: result,
      });
    },
  );

  server.registerTool(
    'get_token',
    {
      title: 'Get a design token',
      description:
        'Look up one design token by name (`color.accent.default`) or by CSS custom ' +
        'property (`--weave-color-accent-default`).',
      inputSchema: {
        name: z.string().min(1).describe('Token name or CSS custom property.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const token = getToken(name);
      if (!token) {
        return notFound(
          `No token named "${name}". Call list_tokens to see the available tokens.`,
        );
      }
      return json({
        ...token,
        usedBy: componentsUsingToken(token.name).map((c) => c.name),
      });
    },
  );

  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description:
        'List Weave UI components, optionally filtered to one category (for example ' +
        '`forms` or `layout`). Returns names and one-line descriptions.',
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe('Restrict results to a single component category.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category }) => {
      const result = listComponents(category);
      return json({
        count: result.length,
        categories: componentCategories(),
        components: result.map((c) => ({
          name: c.name,
          category: c.category,
          description: c.description,
        })),
      });
    },
  );

  server.registerTool(
    'get_component',
    {
      title: 'Get a component API',
      description:
        'Get the full API for one component: props with types and defaults, the tokens ' +
        'it reads, a usage example, and its accessibility contract. Call this before ' +
        'writing code that uses a Weave component.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('Component name, for example `Button`.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const component = getComponent(name);
      if (!component) {
        return notFound(
          `No component named "${name}". Call list_components to see what exists.`,
        );
      }
      return json(component);
    },
  );

  server.registerTool(
    'search_design_system',
    {
      title: 'Search the design system',
      description:
        'Ranked free-text search across token and component names, descriptions, and ' +
        'values. Use this when you know what you want but not what it is called.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Free-text query, for example `danger` or `gap`.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Maximum number of hits to return (default 20).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const hits = search(query, limit);
      return json({ query, count: hits.length, hits });
    },
  );

  server.registerResource(
    'tokens',
    'weave://tokens',
    {
      title: 'All design tokens',
      description: 'The complete Weave token set as JSON.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(listTokens(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'component',
    new ResourceTemplate('weave://components/{name}', {
      list: async () => ({
        resources: listComponents().map((c) => ({
          uri: `weave://components/${c.name}`,
          name: c.name,
          description: c.description,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Component API',
      description: 'The API for a single Weave component, as JSON.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = variables.name;
      const name = Array.isArray(raw) ? raw[0] : raw;
      const component = name ? getComponent(name) : undefined;
      if (!component) {
        throw new Error(`Unknown component: ${String(name)}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(component, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
