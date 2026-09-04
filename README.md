# weave-design-system

An [MCP](https://modelcontextprotocol.io) server that exposes the Weave design system — design
tokens and component APIs — to AI coding tools, so generated UI code uses real token names and
real component props instead of invented ones.

Ships both transports: **stdio** for local editor use, **Streamable HTTP** for deployment.

## Quick start

```bash
npm install
npm run build
npm start          # stdio
npm run start:http # HTTP on http://127.0.0.1:3000/mcp
```

During development, `npm run dev` and `npm run dev:http` run the entrypoints under `tsx` with watch.

## Tools

| Tool                   | Purpose                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tokens`          | List tokens, optionally filtered to a category (`color`, `spacing`, `typography`, `radius`, `shadow`, `motion`).                       |
| `get_token`            | Look up one token by name (`color.accent.default`) or CSS variable (`--weave-color-accent-default`). Includes which components use it. |
| `list_components`      | List components, optionally filtered by category (`actions`, `forms`, `layout`).                                                       |
| `get_component`        | Full API for one component: props with types and defaults, tokens read, usage example, a11y contract.                                  |
| `search_design_system` | Ranked free-text search across tokens and components.                                                                                  |

## Resources

| URI                         | Contents                               |
| --------------------------- | -------------------------------------- |
| `weave://tokens`            | The complete token set as JSON.        |
| `weave://components/{name}` | One component's API as JSON. Listable. |

## Connecting a client

### Claude Code

```bash
claude mcp add weave-design-system -- node /absolute/path/to/weave-design-system/dist/stdio.js
```

### Claude Desktop / Cursor

Add to the MCP config file:

```json
{
  "mcpServers": {
    "weave-design-system": {
      "command": "node",
      "args": ["/absolute/path/to/weave-design-system/dist/stdio.js"]
    }
  }
}
```

### Over HTTP

Point a Streamable HTTP client at `http://127.0.0.1:3000/mcp`. The server is stateful: the client
initializes once, receives an `mcp-session-id` header, and sends it on every later request.
`GET /health` reports status and live session count.

## Configuration (HTTP only)

| Variable                | Default                           | Purpose                                 |
| ----------------------- | --------------------------------- | --------------------------------------- |
| `PORT`                  | `3000`                            | Listen port.                            |
| `HOST`                  | `127.0.0.1`                       | Bind address.                           |
| `WEAVE_ALLOWED_HOSTS`   | `127.0.0.1:$PORT,localhost:$PORT` | Comma-separated `Host` allowlist.       |
| `WEAVE_ALLOWED_ORIGINS` | _(unset)_                         | Comma-separated `Origin` allowlist.     |
| `WEAVE_SESSION_TTL_MS`  | `1800000` (30 min)                | Idle timeout before a session is swept. |

DNS rebinding protection is **on by default**, so a web page the user happens to visit cannot drive
a locally running server. When deploying behind a real domain, set `WEAVE_ALLOWED_HOSTS` (and
`WEAVE_ALLOWED_ORIGINS`) to that domain, or requests will be rejected with a 403.

## Where the content comes from

All design system content lives in [`src/data.ts`](src/data.ts) as plain typed arrays, seeded with a
representative slice of the system. That file is the single place to swap in the real source of
truth — a generated tokens JSON, a Style Dictionary build, or metadata extracted from
`packages/ui`. Everything else reads through [`src/design-system.ts`](src/design-system.ts) and does
not care where the data originates.

## Layout

```
src/
  types.ts          domain types (DesignToken, Component, ...)
  data.ts           the design system content  <- swap this for the real source
  design-system.ts  query layer (list/get/search), independently testable
  server.ts         MCP server: tool and resource registration
  stdio.ts          stdio entrypoint
  http.ts           Streamable HTTP entrypoint (sessions, health, idle sweep)
  index.ts          public exports for use as a library
```

## Tests

```bash
npm test
```

Covers the query layer, including a check that every token a component references actually exists —
that one catches drift when the data source is swapped out.

## Known limitations

- **Sessions are in-memory.** The HTTP server is single-instance as written. To run replicas, move
  the session map to a shared store and supply an `eventStore` to the transport for resumability.
- **No authentication.** The HTTP transport is unauthenticated; put it behind a gateway, or add the
  SDK's OAuth provider, before exposing it beyond localhost.
