# weave-design-system-mcp

[![CI](https://github.com/avcs06/weave-design-system-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/avcs06/weave-design-system-mcp/actions/workflows/ci.yml)

Coding agents generate UI that drifts from the design system, because the system lives in docs,
Storybook, and reviewer heads — none of that is queryable at generation time, and nothing checks
the output afterward. This is an [MCP](https://modelcontextprotocol.io) server that makes a design
system queryable by an agent before it writes code, and its output checkable against that same
system afterward. Nothing about a specific design system, token set, or component library is
hardcoded — everything comes from a `designsystem.config.json` in whatever workspace you point
it at.

Your workspace — the codebase holding the design system — keeps its own
`designsystem.config.json`, and you point the server at that folder when you register it.

## Setup

Node `^22.18.0` or `>=24.11.0` (pinned in `.nvmrc`).

There's nothing to install or keep running — your MCP client starts the server as a subprocess and
stops it with the session, and `npx` fetches it on first use.

### 1. Describe your design system

Add `designsystem.config.json` to the root of your workspace. Paths are relative to that file:

```json
{
  "tokens": [{ "source": "vanilla-extract", "path": "src/styles/theme.css.ts" }],
  "components": [{ "source": "react-tsx", "include": ["src/components/**/*.tsx"] }],
  "styles": { "source": "vanilla-extract" },
  "classNames": { "source": "tailwind" }
}
```

Only `tokens` and `components` are required — see the [config reference](#config-reference) for
every source and its fields. Writing this by hand is optional: point your coding agent at that
reference and ask it to write the config for the repo it's sitting in.

Components are read through the real TypeScript checker, so your workspace also needs its own
dependencies installed for them to resolve.

### 2. Register it with your client

Claude Code:

```bash
claude mcp add weave-design-system-mcp -- npx -y @avcs/weave-design-system-mcp /path/to/your-workspace
```

Any client using `mcpServers` JSON (Claude Desktop, Cursor, Windsurf):

```json
{
  "mcpServers": {
    "weave-design-system-mcp": {
      "command": "npx",
      "args": ["-y", "@avcs/weave-design-system-mcp", "/absolute/path/to/your-workspace"]
    }
  }
}
```

`DESIGN_SYSTEM_PATH` works instead of the argument if you'd rather use an environment variable.
With neither, the server reads the folder it was started in.

### 3. Confirm it found your design system

In Claude Code, `/mcp` lists the server and its six tools. Then ask something only the design
system can answer — "what spacing tokens exist?" — and you should see it call `list_tokens`.

That's the whole setup. If the answers come back empty, a client only shows you that the tools
exist and not what they loaded, so you can optionally start the server yourself to see the counts
it found — it prints a summary, then waits for protocol traffic, so `Ctrl-C` out:

```bash
npx -y @avcs/weave-design-system-mcp /path/to/your-workspace
# weave-design-system-mcp ready on stdio — 408 tokens, 103 components
```

`0 components` almost always means the workspace's dependencies aren't installed, or `include`
doesn't match its layout.

## Config reference

`tokens` and `components` take either one source object or an array of them.

| Field        | Purpose                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens`     | Where the design tokens are. Tokens can be spread across several files or formats — list each one and they're concatenated.                                                                                                             |
| `components` | Where the components are: your workspace's own source files, published packages, or both.                                                                                                                                               |
| `styles`     | _Optional._ Which styling system `validate` should check style-defining code with. Omit it and no style check runs — it isn't assumed from `tokens`, since a project can read token values from one place and author styles in another. |
| `classNames` | _Optional._ Which utility-class convention `validate` should check `className` with. Omit it and `className` isn't inspected.                                                                                                           |

Each `source` names an implementation, and each implementation defines its own remaining fields
and its own checks. The ones that ship:

**Token sources** (`tokens[].source`)

- `vanilla-extract` — reads `createThemeContract`/`createGlobalTheme` calls, flattening nested
  paths to dot-separated names. A `createThemeContract` leaf declares shape without a value, so it
  produces a token with a `reference` and no `value`.
- `object` — reads a JSON file, or a `.ts`/`.js` module's `export const X = {...}`, and flattens it
  the same way. Fields: `export` (which named export, if a file has more than one), `rootPath`
  (dot-separated — navigate into a nested key before flattening, e.g. a JSON file wrapped in
  `{ "tokens": {...} }`), `referenceRoot` (override the identifier printed before the dotted path;
  defaults to the export's name, or the file's basename for JSON).

**Component sources** (`components[].source`)

- `react-tsx` — reads React component prop contracts through the real TypeScript type checker
  (`react-docgen-typescript`, the same tool Storybook's autodocs use), which is what lets a variant
  prop typed as `keyof typeof someTokenObject` resolve to its actual allowed values rather than
  only a union written out literally. Also reads each component's colocated `.stories` file and its
  `@invalidAlternative` JSDoc tag (see below). Fields: `include` (glob pattern(s)), `tsconfig` (path
  to a tsconfig, needed to resolve path aliases like a monorepo's `@app/*`).
- `npm-package` — reads an installed package's components from its type declarations, so an icon
  library or a set of headless primitives becomes part of the queryable inventory rather than
  something an agent has to guess at. Fields: `package` (the package name, resolved from your
  workspace), `names` (`"*"` or omitted for everything it exports, or an array of
  specific names).

**Styles sources** (`styles.source`): `vanilla-extract`.

**ClassNames sources** (`classNames.source`): `tailwind`.

A format that isn't listed here needs a new adapter — one file plus one branch, see
[Architecture](#architecture).

## Tools

| Tool                | Purpose                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tokens`       | List tokens, optionally filtered to one group. Call with no group first — group names vary by project (`color`, `spacing`, `iconSize`, `zIndex`, whatever the source defines).           |
| `list_components`   | The component inventory: name, description, category, and which props are variant-like.                                                                                                  |
| `search_tokens`     | Ranked token search across names, groups, references and values — for when you know what you want but not what this system calls it.                                                     |
| `search_components` | Ranked component search across names, descriptions, categories and prop names — the first call to make before building any UI element from scratch.                                      |
| `get_component`     | One component's full contract: every prop with its type and required flag, and the allowed value set for each variant-like prop. An unknown name comes back with the closest real names. |
| `validate`          | Check a JSX/TSX snippet or a style file's content. Unparseable input comes back as a finding.                                                                                            |

### What `validate` checks

Each finding names the exact constraint broken and, where derivable, the exact fix.

**Values that should be tokens**

1. **Hardcoded literals in style-defining code** — for `vanilla-extract`, that's `style()` and
   `styleVariants()` (from `@vanilla-extract/css`) and `recipe()` (from the separate
   `@vanilla-extract/recipes` package), including everything nested inside `selectors`,
   media-query and variant objects, quoted pseudo-selector keys included. In a system that splits
   styling between a CSS-in-TS library and utility classes, this is where most real token
   violations live.
2. **Hardcoded literals in JSX** — an inline `style={{...}}` prop, and utility-class arbitrary
   values (`text-[#1e1e22]`, `p-[13px]` under `tailwind`), which step outside the design system's
   scale by construction.

The `suggestion` on these comes from a value-to-token reverse index built at load time: nearest
color for a hex value, nearest numeric token for spacing, radius and the like — the fix an agent
can apply in one pass.

**Wrong implementations**

3. **Unknown variant value** — a variant-like prop set to a value outside its allowed set, with
   the allowed set named in the message.
4. **An invalid alternative to a design system component** — reaching for a raw `<button>`, or for
   some other library's `MuiButton`, when the system has a `Button` of its own. A component
   declares what it supersedes with an `@invalidAlternative` JSDoc tag, naming native elements and
   components alike:

   ```tsx
   /**
    * Primary interactive control for triggering an action.
    * @invalidAlternative button, MuiButton
    */
   export function Button(props: ButtonProps) {
     /* ... */
   }
   ```

   Declarations use CSS selector syntax, so a component can name a tag _and the classes on it_ —
   which is how a layout primitive says "a plain div is fine, a div doing my job is not":

   | Declaration      | Matches                             |
   | ---------------- | ----------------------------------- |
   | `button`         | any `<button>`                      |
   | `MuiButton`      | another library's component         |
   | `div.flex`       | a `<div>` carrying the class `flex` |
   | `div.flex.gap-2` | a `<div>` carrying both classes     |
   | `.flex`          | any element carrying `flex`         |

   All the classes named must be present; extras are ignored, so `div.flex` matches
   `className="flex items-center"`. The classes are plain literals you wrote — this is unrelated
   to `classNames`, and works whether or not you configure a utility-class convention.

   Any way of writing the value is read, including through a helper — `cn`, `clsx`, `classNames`,
   `twMerge` or your own, since the name of the call is never inspected:

   ```tsx
   <div className="flex items-center" />
   <div className={cn('flex', isActive && 'gap-2')} />
   <div className={clsx({ flex: isRow })} />   // class as key
   <div className={`flex ${extra}`} />
   ```

   Where two declarations both match, the more specific one wins, so `div.flex` is reported over
   a bare `div`. An invalid alternative is always an error.

**Superseded implementations**

5. **A deprecated usage pattern** — a usage reproducing a prop combination the component's own
   `.stories` file marks deprecated, either by an `@deprecated` docblock or a story name saying so.
   The finding names the story, so the reader can go see what replaced it. A warning, not an error.
6. **An undocumented usage pattern** — a prop combination no story demonstrates. This fires only
   for components that _have_ stories: with none, the honest answer is "can't tell", and a warning
   built from no evidence is just noise. A warning, and a soft one.

## Worked example: before / after

[`examples/synthetic-design-system/`](examples/synthetic-design-system/) is a small, fully public
design system (fictional tokens, one `Button` with stories) demonstrating the CSS-in-TS + utility
class split this MCP was built around — run it from inside there (`cd
examples/synthetic-design-system && node ../../dist/mcp/stdio.js`) to try this yourself.

An agent about to write `Button.css.ts` hardcodes a color instead of looking it up:

```ts
// before — an agent invented a hex value
import { style } from '@vanilla-extract/css';
export const bad = style({ color: '#3b5bdb' });
```

```jsonc
// validate({ "code": "..." }) response
{
  "ok": false,
  "findings": [
    {
      "rule": "hardcoded-literal",
      "severity": "error",
      "surface": "vanilla-extract",
      "line": 2,
      "column": 35,
      "message": "\"color: #3b5bdb\" hardcodes a color value instead of using a design token. The closest token is \"color.accent\".",
      "suggestion": "vars.color.accent",
    },
  ],
}
```

The agent applies the suggestion directly:

```ts
// after
import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';
export const good = style({ color: vars.color.accent });
```

```jsonc
// validate(...) response
{ "ok": true, "findings": [] }
```

## Architecture

The design system model has no MCP dependency — everything under [`src/model/`](src/model/)
(config loading, adapters, `validate`) is plain TypeScript that knows nothing about the protocol;
[`src/mcp/`](src/mcp/) is a thin layer that registers tools, calls the model, and formats the
result. That split is deliberate: the model is meant to be reusable by something other than an MCP
server later (a CLI, a lint rule), and a tool handler containing logic beyond formatting would be
a bug rather than a feature.

Exactly three adapters — `tsx-adapter`, `styles-adapter`, `classname-adapter` — one per concern.
All three are dispatchers: they contain no library-specific code of their own, only routing to
whichever implementation `config.source` names, so no particular styling system or component
format is baked into the thing that's supposed to be generic.

```
src/
  model/
    types.ts                  DesignSystem, ComponentContract, DesignToken, Finding
    config.ts                 Zod schema + loadConfig(cwd) -> ResolvedConfig
    design-system.ts          createDesignSystem(config) -> DesignSystem: loads every configured
                               token and component source, builds the reverse index, and holds
                               the lookup/search API
    validate.ts               parses once with Babel, calls the two "validate" entry points below
    reverse-index.ts          value -> nearest-token lookup (color distance / numeric proximity)
    flatten-object-literal.ts shared AST helper both token-reading implementations use
    check-style-object.ts     shared property-group check every styling implementation, and the
                               TSX adapter's inline style prop, run an object literal through
    class-name-strings.ts     reads the classes off a JSX className, whatever expression shape
                               it takes — knows no className convention
    adapters/
      styles-adapter.ts        DISPATCHER — loadTokens(config) and validateStyles(ast, system,
                                config) each pick a branch on config.source and call into it
      styles/
        vanilla-extract.ts      loadTokens() (createThemeContract/createGlobalTheme) and
                                validate() (style()/styleVariants()/recipe() calls)
        object.ts               loadTokens() for a plain JS/JSON file
      classname-adapter.ts      DISPATCHER — check(config, value) picks a branch on config.source
      classnames/
        tailwind.ts             check() for arbitrary-value brackets
      tsx-adapter.ts            DISPATCHER for loadComponents(config), plus validateJsx(ast,
                                system, classNamesConfig): walks JSX elements, checks variant
                                props, invalid alternatives and story-derived patterns itself, and
                                delegates style/className checks to its two sibling adapters
      components/
        react-tsx.ts            component contracts from project source files
        npm-package.ts          component contracts from an installed package's type declarations
        stories.ts              deprecated and documented prop shapes from a colocated .stories file
  mcp/
    server.ts                  tool registration
    stdio.ts                   entrypoint: loadConfig(workspace) -> createDesignSystem -> serveStdio
  index.ts                     public exports
```

Adding another styling system (Sass modules, styled-components) is a new file next to
`styles/vanilla-extract.ts` plus one branch in `styles-adapter.ts` — no concrete implementation
gets touched to add another, and neither does `validate.ts` or `tsx-adapter.ts`, which only ever
call the dispatcher. Same shape for another className convention next to `classnames/tailwind.ts`,
and for another component format next to `components/react-tsx.ts`.

**Why the TSX adapter delegates instead of checking styles/classes itself.** An inline JSX
`style={{...}}` prop needs the _exact_ same governed-property check as a style-authoring call —
same properties, same token groups, same reverse index — so both run through the shared
`check-style-object.ts` rather than keeping a second copy of that logic. Utility-class checking is
unrelated (it's regex over strings, not object literals), so it's the className adapter's own
concern, reached through its dispatcher. `validate.ts` itself calls exactly two things —
`validateStyles` and `validateJsx` — because there are only two places in a file token violations
start from: a style-defining call, or a JSX element.

**Why `styles`/`classNames` are opt-in config.** Earlier this ran the vanilla-extract and Tailwind
checks unconditionally, which quietly contradicted the "nothing hardcoded" premise by assuming
every project uses both. Now each check takes its config field and does nothing when it's absent,
the same way a token check does nothing for a group with no tokens: no signal, no finding.

**Why property→group is a map, not value-matching.** Detecting a violation is structural — is this
governed property set to a literal, or to a reference into the token object? — rather than based
on whether the literal happens to match some token's value. `padding: '8px'` is wrong even when
8px equals a real token today, because it won't track that token if it changes. Value-matching is
used only to compute `suggestion`, once a violation is already established.

**Why the group list isn't fixed.** A real design system's token groups aren't knowable in advance
(some have `shadow`/`motion`, plenty don't; some split typography into `fontSize`/`fontWeight`/
`lineHeight` rather than one `typography` group), so a rule fires only when the configured token
source actually has tokens in that group.

**Why `width`/`height` aren't governed properties.** They're too overloaded — an icon's size and a
card's layout width use the same CSS property — to map onto one token group without a high
false-positive rate, so they're left unchecked.

**Why token sources aren't merged by name.** If a design system splits token _shape_ (a
vanilla-extract contract) from token _values_ (a separate JSON file), those two sources produce
separate token entries rather than one merged entry. Whoever writes the config decides which files
to list; there's no cross-file name-matching to get wrong.

## Known limitations

- **A `TemplateLiteral` value is never flagged**, even a hardcoded one (e.g.
  `` `0 0 0 3px ${theme.shadow}` ``) — it often mixes a real token reference with literal
  structure, and resolving that fully isn't worth the false-positive risk.
- **A computed property key** (`{ [someVar]: '#fff' }`) is checked using the _variable's name_,
  not its runtime value — harmless unless a local variable happens to share a name with a governed
  CSS property.
- **The `react-tsx` component source needs your workspace's own dependencies installed**
  (`npm install`/`pnpm install` run there). It resolves types through the real TypeScript checker,
  so without `react`/`@types/react` and anything a component imports actually present, it detects
  zero components — which looks like a config problem when it's an install problem.
- **Scanning a large package with `names: "*"` is slow.** A full icon library (~3,400 components)
  takes several seconds at startup. Naming the specific components you use keeps it instant.
- **`@modelcontextprotocol/server` v2** (this depends on it per the SDK's own migration guidance
  away from v1's `@modelcontextprotocol/sdk`) reached `2.0.0` a few weeks before this was written.
  It's maintained by the official MCP org, but has far less real-world mileage than the v1 SDK.

## Development

```bash
git clone https://github.com/avcs06/weave-design-system-mcp.git
cd weave-design-system-mcp
npm install
npm run build
```

Point a client at a local build with `node ./dist/mcp/stdio.js /path/to/your-workspace` in place
of the `npx` invocation above.

```bash
npm run format:check   # prettier
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # tsc -> dist/
```

CI runs all four on Node 22 and 24, then starts the built server against the example design system
to confirm the published entrypoint actually loads one.

Runs against [`examples/synthetic-design-system/`](examples/synthetic-design-system/) — the same
fixture the worked example above uses, not a second copy that can drift from it — plus unit tests
per implementation for cases the example doesn't cover (`styles/vanilla-extract.test.ts`,
`styles/object.test.ts`, `components/stories.test.ts`) and dispatcher-level tests
(`styles-adapter.test.ts`, `classname-adapter.test.ts`, `tsx-adapter.test.ts`) covering how an
unrecognized `source` is reported. `createDesignSystem(config)` takes an in-memory config object,
so tests need no `designsystem.config.json` on disk.
