import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as z from 'zod/v4';

const CONFIG_FILENAME = 'designsystem.config.json';

/** An adapter-specific config bag. `source` picks the adapter; every other field is that adapter's own business — not assumed to be a filesystem path (it could be a URL). */
const SourceConfigSchema = z.object({ source: z.string().min(1) }).catchall(z.unknown());

/** One source, or a list of them — both spellings accepted for `tokens` and `components`. */
const OneOrMoreSources = z.union([SourceConfigSchema, z.array(SourceConfigSchema).min(1)]);

const ConfigSchema = z.object({
  /** One token source, or several — a system's tokens can be spread across more than one file or format. */
  tokens: OneOrMoreSources,
  /** One component source, or several — e.g. the project's own components plus an external icon package. */
  components: OneOrMoreSources,
  /**
   * Which styling system's calls `validate` scans for hardcoded values (e.g.
   * `{ "source": "vanilla-extract" }`). Omit it and that check is simply
   * skipped — never assumed. Separate from `tokens[].source`: a project
   * could read token *values* from a plain JSON file while still writing
   * styles through vanilla-extract, or vice versa.
   */
  styles: SourceConfigSchema.optional(),
  /**
   * Which utility-class convention `validate` scans `className` for (e.g.
   * `{ "source": "tailwind" }` for arbitrary-value brackets). Omit it and
   * `className` is never inspected — a project with no such convention
   * shouldn't get findings invented for one.
   */
  classNames: SourceConfigSchema.optional(),
  /**
   * Whether to ask the connected client's model which native element each
   * component stands in for, for the components that don't declare it
   * themselves with an `@invalidAlternative` tag. Off unless asked for: it spends one
   * model call per undeclared component on every connect — billed to
   * whoever runs the client — to produce warnings. Declared
   * `@invalidAlternative` tags are unaffected either way.
   */
  inferInvalidAlternatives: z.boolean().optional(),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export interface ResolvedConfig {
  tokens: SourceConfig[];
  components: SourceConfig[];
  styles?: SourceConfig;
  classNames?: SourceConfig;
  /** Defaults to `false` — see the schema above for why it isn't on by default. */
  inferInvalidAlternatives?: boolean;
  /** Directory the config file lives in — adapters that treat a field as a filesystem path resolve relative to this, not to `process.cwd()`. */
  configDir: string;
}

const EXAMPLE_CONFIG = `{
  "tokens": { "source": "vanilla-extract", "path": "src/styles/theme.css.ts" },
  "components": [
    { "source": "react-tsx", "include": ["src/components/**/*.tsx"] },
    { "source": "npm-package", "package": "lucide-react", "names": "*" }
  ],
  "styles": { "source": "vanilla-extract" },
  "classNames": { "source": "tailwind" }
}`;

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

/**
 * Loads and validates `designsystem.config.json` from `cwd`, failing with a
 * message that names the offending field for a schema violation, or shows
 * how to create the file when it's missing.
 */
export function loadConfig(cwd: string = process.cwd()): ResolvedConfig {
  const configPath = join(cwd, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    throw new Error(
      `No ${CONFIG_FILENAME} found in ${cwd}.\n\n` + `Create one there, for example:\n\n${EXAMPLE_CONFIG}\n`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`${configPath} is not valid JSON: ${(error as Error).message}`);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${configPath} is invalid:\n${formatZodError(result.error)}`);
  }

  const { tokens, components, styles, classNames, inferInvalidAlternatives } = result.data;
  return {
    tokens: Array.isArray(tokens) ? tokens : [tokens],
    components: Array.isArray(components) ? components : [components],
    styles,
    classNames,
    inferInvalidAlternatives: inferInvalidAlternatives ?? false,
    configDir: resolve(dirname(configPath)),
  };
}
