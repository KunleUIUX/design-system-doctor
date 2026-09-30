// Where settings and the last audit live.
//
// - The design system + audit settings are stored in THIS FILE's plugin data (shared with
//   collaborators, travels with the file). They may contain file-specific ids (local assets,
//   ignored layers), so they are never written anywhere that other files would read.
// - A portable copy of the design system (library refs by key, switches, scales; see
//   toPortable) is kept on this device so it can be offered to other files. It contains no
//   file-specific ids.
// - Earlier versions fell back to a device-wide `clientStorage['dsd-config-v1']` when a file was
//   read-only, which leaked one file's ids into every other file. That key is no longer read.

import type { AuditConfig, AuditResult, DesignSystemConfig } from '../shared/types';

export interface PluginStorage {
  /** Raw saved settings for this file (may be an older shape; the controller migrates it). */
  loadConfig(): Promise<Partial<AuditConfig> | null>;
  /** `session` when the file can't store plugin data (view-only): settings last until close. */
  saveConfig(config: AuditConfig): Promise<'file' | 'session'>;
  loadPortable(): Promise<DesignSystemConfig | null>;
  savePortable(ds: DesignSystemConfig): Promise<void>;
  loadLastAudit(page: PageNode): AuditResult | null;
  saveLastAudit(page: PageNode, result: AuditResult): void;
}

const CONFIG_KEY = 'dsd-config-v1';
const PORTABLE_KEY = 'dsd-portable-design-system-v1';
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
  async loadConfig() {
    return parse<Partial<AuditConfig>>(figma.root.getPluginData(CONFIG_KEY));
  },
  async saveConfig(config) {
    try {
      figma.root.setPluginData(CONFIG_KEY, JSON.stringify(config));
      return 'file';
    } catch {
      return 'session';
    }
  },
  async loadPortable() {
    return (await figma.clientStorage.getAsync(PORTABLE_KEY).catch(() => null)) ?? null;
  },
  async savePortable(ds) {
    await figma.clientStorage.setAsync(PORTABLE_KEY, ds).catch(() => undefined);
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
 * In-memory storage for tests and real-file checks. `files` simulates separate Figma files: each
 * file id gets its own settings, while the portable copy is shared like device storage.
 */
export function memoryStorage(config: Partial<AuditConfig> | null, device: { portable: DesignSystemConfig | null } = { portable: null }): PluginStorage {
  let saved: Partial<AuditConfig> | null = config;
  const audits = new Map<string, AuditResult>();
  return {
    loadConfig: async () => (saved ? JSON.parse(JSON.stringify(saved)) : null),
    saveConfig: async (next) => ((saved = JSON.parse(JSON.stringify(next))), 'file'),
    loadPortable: async () => device.portable,
    savePortable: async (ds) => void (device.portable = JSON.parse(JSON.stringify(ds))),
    loadLastAudit: (page) => audits.get(page.id) ?? null,
    saveLastAudit: (page, result) => void audits.set(page.id, result),
  };
}
