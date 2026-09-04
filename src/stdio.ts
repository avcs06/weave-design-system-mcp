#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

/**
 * stdio entrypoint — the transport used when an editor (Claude Code, Claude
 * Desktop, Cursor) spawns this server as a subprocess.
 *
 * Nothing may be written to stdout except protocol traffic, so all logging
 * goes to stderr.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('weave-design-system MCP server ready on stdio');
}

main().catch((error: unknown) => {
  console.error('Fatal error starting the stdio server:', error);
  process.exit(1);
});
