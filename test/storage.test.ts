import { describe, expect, it } from 'vitest';
import { pluginDataStorage } from '../src/plugin/storage';
import { migrateToReference } from '../src/shared/reference';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { auditConfig } from './fixtures';

function fakeFigma(opts: { readOnly?: boolean; device?: Record<string, unknown>; fileData?: Record<string, string> }) {
  const device = opts.device ?? {};
  const fileData = opts.fileData ?? {};
  (globalThis as unknown as { figma: unknown }).figma = {
    root: {
      getPluginData: (k: string) => fileData[k] ?? '',
      setPluginData: (k: string, v: string) => {
        if (opts.readOnly) throw new Error('read-only');
        fileData[k] = v;
      },
    },
    clientStorage: {
      getAsync: async (k: string) => device[k],
      setAsync: async (k: string, v: unknown) => void (device[k] = v),
    },
  };
  return { device, fileData };
}

describe('pluginDataStorage', () => {
  it('never reads the old device-wide config key (it leaked one file’s ids into others)', async () => {
    fakeFigma({ device: { 'dsd-config-v1': JSON.stringify(auditConfig()) } });
    expect(await pluginDataStorage.loadSettings()).toBeNull();
    expect(await pluginDataStorage.loadLegacyConfig()).toBeNull();
  });

  it('stores settings in the file, or only for the session when the file is read-only', async () => {
    const settings = { ...DEFAULT_SETTINGS, designSystem: migrateToReference(auditConfig().designSystem!) };
    const { fileData, device } = fakeFigma({});
    expect(await pluginDataStorage.saveSettings(settings)).toBe('file');
    expect(JSON.parse(fileData['dsd-settings-v3']).designSystem.name).toBe('Acme');

    const ro = fakeFigma({ readOnly: true });
    expect(await pluginDataStorage.saveSettings(settings)).toBe('session');
    expect(ro.device).toEqual({});
    expect(device['dsd-config-v1']).toBeUndefined();
  });

  it('still reads, and never deletes, the older settings key so migration and rollback work', async () => {
    const { fileData } = fakeFigma({ fileData: { 'dsd-config-v1': JSON.stringify(auditConfig()) } });
    expect((await pluginDataStorage.loadLegacyConfig())?.designSystem?.name).toBe('Acme');
    await pluginDataStorage.saveSettings({ ...DEFAULT_SETTINGS, designSystem: migrateToReference(auditConfig().designSystem!) });
    expect(fileData['dsd-config-v1']).toBeDefined();
  });
});
