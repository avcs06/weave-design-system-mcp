#!/usr/bin/env node
import { resolve } from 'node:path';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from '../model/config.js';
import { createDesignSystem } from '../model/design-system.js';
import { createServer } from './server.js';

/**
 * stdio entrypoint. The design system is loaded once, here, before
 * `serveStdio` starts — not inside the server factory, since `serveStdio`
 * may construct more than one `McpServer` instance over a connection's
 * lifetime (it pins one per protocol era) and re-parsing every source file
 * per instance would be wasted work for no benefit; every instance shares
 * this one already-loaded `DesignSystem`.
 *
 * Nothing may be written to stdout except protocol traffic, so all logging
 * goes to stderr — the client's log viewer, not a place a human runs this
 * directly and expects to read.
 */
/**
 * Which folder holds `designsystem.config.json`. An MCP client always
 * controls a server's arguments and environment, but not every client can
 * set its working directory, so the workspace is nameable by argument or
 * environment variable, with the working directory as the fallback.
 */
function workspacePath(): string {
  const fromArgs = process.argv[2];
  const fromEnv = process.env.DESIGN_SYSTEM_PATH;
  return resolve(fromArgs ?? fromEnv ?? process.cwd());
}

async function main(): Promise<void> {
  const config = loadConfig(workspacePath());
  const system = createDesignSystem(config);

  serveStdio(() => createServer(system), {
    onerror: (error) => console.error('[weave-design-system-mcp]', error),
  });

  console.error(
    `weave-design-system-mcp ready on stdio — ${system.tokens().length} tokens, ${system.components().length} components`,
  );
}

main().catch((error: unknown) => {
  console.error('Fatal error starting weave-design-system-mcp:', error);
  process.exit(1);
});
