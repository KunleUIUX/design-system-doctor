// Where settings, saved design systems and the last audit live.
//
// - THIS FILE's plugin data holds the settings: the selected design system (a whole reference)
//   and audit options. It travels with the file and is shared with collaborators.
// - THIS DEVICE keeps a list of saved design systems, so one captured or set up in one file can be
//   selected in another. Selecting is always explicit; nothing is applied silently.
// - Older keys are only read, for migration, and never deleted (rollback stays possible):
//   `dsd-config-v1` (selection-based settings in the file) and `dsd-portable-design-system-v1`
//   (its device copy). The old device-wide `clientStorage['dsd-config-v1']` fallback leaked one
//   file's ids into others and is never read.

import type { DesignSystemReference } from '../shared/reference';
import type { AuditConfig, AuditResult, DesignSystemConfig, PluginSettings } from '../shared/types';

export interface PluginStorage {
  /** Saved settings for this file in the current shape, or null. */
  loadSettings(): Promise<PluginSettings | null>;
  /** `session` when the file can't store plugin data (view-only, or too large): settings last until close. */
  saveSettings(settings: PluginSettings): Promise<'file' | 'session'>;
  /** Older selection-based settings for this file, for migration. */
  loadLegacyConfig(): Promise<Partial<AuditConfig> | null>;
  /** Design systems saved on this device. */
  loadLibrary(): Promise<DesignSystemReference[]>;
  saveLibrary(list: DesignSystemReference[]): Promise<void>;
  /** The older device copy of a design system, for migration. */
  loadLegacyPortable(): Promise<DesignSystemConfig | null>;
  loadLastAudit(page: PageNode): AuditResult | null;
  saveLastAudit(page: PageNode, result: AuditResult): void;
}

const SETTINGS_KEY = 'dsd-settings-v3';
const LEGACY_CONFIG_KEY = 'dsd-config-v1';
const LIBRARY_KEY = 'dsd-design-systems-v1';
const LEGACY_PORTABLE_KEY = 'dsd-portable-design-system-v1';
const LAST_AUDIT_KEY = 'dsd-last-audit-v1';
/** Plugin data is stored in the file; keep very large results out of it. */
const LAST_AUDIT_MAX_BYTES = 500_000;

const parse = <T>(raw: string | undefined | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const pluginDataStorage: PluginStorage = {
  async loadSettings() {
    return parse<PluginSettings>(figma.root.getPluginData(SETTINGS_KEY));
  },
  async saveSettings(settings) {
    try {
      figma.root.setPluginData(SETTINGS_KEY, JSON.stringify(settings));
      return 'file';
    } catch {
      return 'session';
    }
  },
  async loadLegacyConfig() {
    return parse<Partial<AuditConfig>>(figma.root.getPluginData(LEGACY_CONFIG_KEY));
  },
  async loadLibrary() {
    const list = await figma.clientStorage.getAsync(LIBRARY_KEY).catch(() => null);
    return Array.isArray(list) ? (list as DesignSystemReference[]) : [];
  },
  async saveLibrary(list) {
    await figma.clientStorage.setAsync(LIBRARY_KEY, list).catch(() => undefined);
  },
  async loadLegacyPortable() {
    return (await figma.clientStorage.getAsync(LEGACY_PORTABLE_KEY).catch(() => null)) ?? null;
  },
  loadLastAudit(page) {
    try {
      return parse<AuditResult>(page.getPluginData(LAST_AUDIT_KEY));
    } catch {
      return null;
    }
  },
  saveLastAudit(page, result) {
    const raw = JSON.stringify(result);
    try {
      page.setPluginData(LAST_AUDIT_KEY, raw.length <= LAST_AUDIT_MAX_BYTES ? raw : '');
    } catch {
      // Read-only file: the result still lives in the UI for this session.
    }
  },
};

/**
 * In-memory storage for tests and real-file checks. `initial` is this file's saved settings,
 * either current (a reference) or the older selection shape. `device` is shared like device
 * storage, so several controllers can simulate separate files on one machine.
 */
export function memoryStorage(
  initial: Partial<AuditConfig> | PluginSettings | null,
  device: { library: DesignSystemReference[]; portable?: DesignSystemConfig | null } = { library: [] },
): PluginStorage {
  const isCurrent = (x: unknown): x is PluginSettings => !!x && !!(x as PluginSettings).designSystem && (x as { designSystem: { schema?: number } }).designSystem.schema === 1;
  let settings: PluginSettings | null = isCurrent(initial) ? initial : null;
  const legacy = isCurrent(initial) ? null : initial;
  const audits = new Map<string, AuditResult>();
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    loadSettings: async () => (settings ? copy(settings) : null),
    saveSettings: async (next) => ((settings = copy(next)), 'file'),
    loadLegacyConfig: async () => (legacy ? copy(legacy) : null),
    loadLibrary: async () => copy(device.library ?? []),
    saveLibrary: async (list) => void (device.library = copy(list)),
    loadLegacyPortable: async () => device.portable ?? null,
    loadLastAudit: (page) => audits.get(page.id) ?? null,
    saveLastAudit: (page, result) => void audits.set(page.id, result),
  };
}
