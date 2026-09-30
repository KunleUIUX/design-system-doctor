// Bundles the plugin's real controller (message handler), audit pipeline, navigation and
// design-system helpers for running inside a Figma file via the Figma MCP `use_figma` tool.
import { checkFreshness, performAudit } from '../src/figma/audit';
import { goToNode } from '../src/figma/navigate';
import { countLayers } from '../src/figma/snapshot';
import { createController } from '../src/plugin/controller';
import { memoryStorage } from '../src/plugin/storage';
import { parseScale, refFor, toPortable, validateDesignSystem } from '../src/shared/designSystem';
import { DEFAULT_AUDIT_CONFIG } from '../src/shared/types';
import * as configs from './e2e/configs';

(globalThis as unknown as { DSD: unknown }).DSD = {
  createController, memoryStorage, performAudit, checkFreshness, goToNode, countLayers, DEFAULT_AUDIT_CONFIG,
  parseScale, refFor, toPortable, validateDesignSystem, configs,
};
