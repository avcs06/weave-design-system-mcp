export { createServer, SERVER_NAME, SERVER_VERSION } from './mcp/server.js';
export { createDesignSystem } from './model/design-system.js';
export { loadConfig } from './model/config.js';
export type { ResolvedConfig, SourceConfig } from './model/config.js';
export type {
  ComponentContract,
  ComponentProp,
  ComponentSummary,
  DeprecatedUsagePattern,
  DesignSystem,
  DesignToken,
  Finding,
  SearchHit,
  Severity,
  Surface,
  ValidateResult,
} from './model/types.js';
