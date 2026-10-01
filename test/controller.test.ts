import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/plugin/controller';
import { memoryStorage } from '../src/plugin/storage';
import { applySelection, referenceFromSelection, toSelection } from '../src/shared/reference';
import { auditedName } from '../src/ui/presentation';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import type { MainToUi } from '../src/shared/messages';
import { auditConfig } from './fixtures';

// A small fake of the Figma globals the controller path touches. Real-node behaviour is covered
// by dev/e2e; this pins the message handler's contract.
const MIXED = Symbol('mixed');
const brandRaw = () => [{ type: 'SOLID', visible: true, color: { r: 0x63 / 255, g: 0x5b / 255, b: 0xff / 255 }, opacity: 1 }];

function makeFigma() {
  const listeners: (() => void)[] = [];
  const rect: Record<string, unknown> = {
    id: '9:2', type: 'RECTANGLE', name: 'Pay button', visible: true, removed: false,
    fills: brandRaw(), strokes: [], fillStyleId: '', strokeStyleId: '', resolvedVariableModes: {},
    cornerRadius: 8, width: 100, height: 40,
  };
  const page: Record<string, unknown> = {
    id: '9:1', type: 'PAGE', name: 'Test page', children: [rect], selection: [],
    on: (type: string, cb: () => void) => type === 'nodechange' && listeners.push(cb),
  };
  rect.parent = page;
  const published = { getPublishStatusAsync: async () => 'CURRENT' };
  const brand = { id: 'V:brand', key: 'k', name: 'color/brand/primary', variableCollectionId: 'C:ds', remote: false, resolvedType: 'COLOR',
    valuesByMode: { m: { r: 0x63 / 255, g: 0x5b / 255, b: 0xff / 255, a: 1 } }, ...published };
  const collection = { id: 'C:ds', key: 'c', name: 'Tokens', remote: false, defaultModeId: 'm', variableIds: ['V:brand'],
    modes: [{ modeId: 'm', name: 'Light' }], ...published };
  const scrolled: unknown[] = [];
  const figma = {
    mixed: MIXED,
    skipInvisibleInstanceChildren: false,
    currentPage: page,
    root: { name: 'Acme Library', findAllWithCriteria: () => [] },
    loadAllPagesAsync: async () => undefined,
    viewport: { scrollAndZoomIntoView: (nodes: unknown[]) => scrolled.push(...nodes) },
    getNodeByIdAsync: async (id: string) => ({ '9:2': rect, '9:1': page } as Record<string, unknown>)[id] ?? null,
    setCurrentPageAsync: async (p: unknown) => void (figma.currentPage = p as typeof page),
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getStyleByIdAsync: async () => null,
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getLocalVariablesAsync: async () => [brand],
      getVariableByIdAsync: async (id: string) => (id === 'V:brand' ? brand : null),
      getVariableCollectionByIdAsync: async (id: string) => (id === 'C:ds' ? collection : null),
    },
  };
  return { figma, page, rect, scrolled, fireNodeChange: () => listeners.forEach((l) => l()) };
}

let env: ReturnType<typeof makeFigma>;
let sent: MainToUi[];
const ofType = <T extends MainToUi['type']>(t: T) => sent.filter((m): m is Extract<MainToUi, { type: T }> => m.type === t);

beforeEach(() => {
  env = makeFigma();
  (globalThis as unknown as { figma: unknown }).figma = env.figma;
  sent = [];
});
afterEach(() => vi.useRealTimers());

const setup = () => {
  const cfg = auditConfig({ variableCollections: [{ source: 'local', id: 'C:ds', name: 'Tokens' }] });
  return createController({ post: (m) => sent.push(m), storage: memoryStorage(cfg) });
};

describe('controller', () => {
  it('runs an audit from a UI message and stores a fingerprinted result', async () => {
    const c = setup();
    await c.handle({ type: 'init' });
    expect(ofType('init-state')[0].lastAudit).toBeNull();
    await c.handle({ type: 'run-audit', scope: 'page' });
    const [{ result }] = ofType('audit-result');
    expect(result.issues.map((i) => `${i.ruleId} ${i.nodeId}`)).toEqual(['color/raw-matches-token 9:2']);
    expect(result.rootIds).toEqual(['9:2']);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reports a saved audit as current until an audited property changes', async () => {
    const c = setup();
    await c.handle({ type: 'init' });
    await c.handle({ type: 'run-audit', scope: 'page' });
    await c.handle({ type: 'check-freshness' });
    expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('current');

    env.rect.cornerRadius = 12; // still valid, but a different design
    await c.handle({ type: 'check-freshness' });
    expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('changed');
  });

  it('re-checks after edits on the page (debounced nodechange)', async () => {
    vi.useFakeTimers();
    const c = setup();
    await c.handle({ type: 'init' });
    await c.handle({ type: 'run-audit', scope: 'page' });
    env.rect.fills = [{ ...brandRaw()[0], boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:brand' } } }];
    env.fireNodeChange();
    env.fireNodeChange();
    await vi.advanceTimersByTimeAsync(1000);
    const states = ofType('audit-freshness').map((m) => m.state);
    expect(states).toEqual(['changed']); // two edits, one check
  });

  it('selects and scrolls to the node a go-to-node message names', async () => {
    const c = setup();
    await c.handle({ type: 'go-to-node', nodeId: '9:2' });
    expect(ofType('navigate-result')[0]).toMatchObject({ nodeId: '9:2', ok: true });
    expect((env.figma.currentPage.selection as unknown[])[0]).toBe(env.rect);
    expect(env.scrolled).toEqual([env.rect]);
  });

  it('says so instead of selecting something else when the node is gone', async () => {
    const c = setup();
    await c.handle({ type: 'go-to-node', nodeId: '404:1' });
    expect(ofType('navigate-result')[0]).toMatchObject({ ok: false, message: 'This layer no longer exists. Re-run the audit.' });
    expect(env.figma.currentPage.selection).toEqual([]);
  });
});

describe('design system persistence', () => {
  const localTokens = { source: 'local' as const, id: 'C:ds', name: 'Tokens' };
  const library = { source: 'library' as const, key: 'lib-key', name: 'Acme Colors' };
  const acme = () => referenceFromSelection({ ...auditConfig().designSystem!, name: 'Acme', variableCollections: [localTokens, library] }, 'in-use');

  it('keeps the selected design system across a plugin close and reopen', async () => {
    const device = { library: [] };
    const fileStorage = memoryStorage(null, device);
    const first = createController({ post: (m) => sent.push(m), storage: fileStorage });
    await first.handle({ type: 'init' });
    expect(ofType('init-state')[0].settings.designSystem).toBeNull();

    const ds = acme();
    await first.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: ds, ignoredNodeIds: ['9:2'] } });
    expect(ofType('settings-saved')[0].savedTo).toBe('file');

    sent = [];
    const reopened = createController({ post: (m) => sent.push(m), storage: fileStorage });
    await reopened.handle({ type: 'init' });
    const { settings } = ofType('init-state')[0];
    expect(settings.designSystem).toEqual(ds);
    expect(settings.ignoredNodeIds).toEqual(['9:2']);
  });

  it('never applies another file’s design system silently; it is offered to select as a whole', async () => {
    const device = { library: [] };
    const fileA = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    const ds = acme();
    await fileA.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: ds, ignoredNodeIds: ['9:2'] } });

    sent = [];
    const fileB = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    await fileB.handle({ type: 'init' });
    const init = ofType('init-state')[0];
    expect(init.settings.designSystem).toBeNull(); // file B has no settings of its own
    expect(init.settings.ignoredNodeIds).toEqual([]);
    expect(init.library.map((r) => r.name)).toEqual(['Acme']);

    await fileB.handle({ type: 'switch-design-system', id: ds.id });
    const saved = ofType('settings-saved')[0];
    expect(saved.settings.designSystem).toEqual(ds);
    expect(saved.settings.ignoredNodeIds).toEqual([]); // file A's options stay in file A
  });

  it('switching replaces the design system completely: nothing from the previous one is kept', async () => {
    const device = { library: [] };
    const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    const rayna = referenceFromSelection({ ...auditConfig().designSystem!, name: 'Rayna UI', textStyles: { library: false, local: false, items: [{ source: 'library', key: 'rayna-body', name: 'Body' }] } }, 'in-use');
    const material = referenceFromSelection({ ...auditConfig().designSystem!, name: 'Material 3', textStyles: { library: false, local: false, items: [{ source: 'library', key: 'm3-label', name: 'Label' }] } }, 'in-use');
    await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: rayna } });
    await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: material } });
    await c.handle({ type: 'switch-design-system', id: rayna.id });
    await c.handle({ type: 'switch-design-system', id: material.id });
    const active = ofType('settings-saved').slice(-1)[0].settings.designSystem!;
    expect(active.name).toBe('Material 3');
    expect(JSON.stringify(active)).not.toContain('rayna');
  });

  it('migrates a v1 config (consuming-file collection ids) to a reference that behaves as before', async () => {
    const v1 = { ...auditConfig(), designSystem: { name: 'Old', approvedCollectionIds: ['C:ds'], textStyles: { library: true, local: false },
      paintStyles: { library: false, local: false }, components: { library: true, local: false }, spacingScale: [0, 8], radiusScale: [0] } };
    const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(v1 as never) });
    await c.handle({ type: 'init' });
    const ref = ofType('init-state')[0].settings.designSystem!;
    expect(ref).toMatchObject({ schema: 1, name: 'Old', source: { kind: 'migrated' } });
    const ds = toSelection(ref);
    expect(ds).toMatchObject({ version: 2, variableCollections: [{ source: 'local', id: 'C:ds', name: 'Tokens' }] });
    expect(ds.textStyles).toEqual({ library: true, local: false, items: [] });
  });

  it('captures this file as a design system and audits against it', async () => {
    const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, { library: [] }) });
    await c.handle({ type: 'init' });
    await c.handle({ type: 'capture-design-system' });
    const ref = ofType('settings-saved')[0].settings.designSystem!;
    expect(ref).toMatchObject({ name: 'Acme Library', source: { kind: 'library-file', fileName: 'Acme Library' } });
    // Published collection → recorded by key, with its values captured.
    expect(ref.variableCollections[0]).toMatchObject({ ref: { source: 'library', key: 'c' }, modes: [{ id: 'm', name: 'Light' }] });
    expect(ref.variableCollections[0].variables?.[0]).toMatchObject({ ref: { source: 'library', key: 'k', name: 'color/brand/primary' }, resolvedType: 'COLOR' });

    // In the library's own file its assets are local but carry the same keys, so they read live.
    await c.handle({ type: 'run-audit', scope: 'page' });
    const [{ result }] = ofType('audit-result');
    expect(result.issues.map((i) => `${i.ruleId} ${i.nodeId}`)).toEqual(['color/raw-matches-token 9:2']);
    expect(result.coverage?.tokens).toEqual({ total: 1, live: 1, captured: 0, unavailable: 0 });
  });

  describe('saved design systems: rename and remove', () => {
    const named = (name: string, key: string) =>
      referenceFromSelection({ ...auditConfig().designSystem!, name, textStyles: { library: false, local: false, items: [{ source: 'library', key, name: 'Body' }] } }, 'in-use');
    const twoSaved = async () => {
      const device = { library: [] };
      const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
      const rayna = named('Rayna UI', 'rayna-body');
      const m3 = named('Material 3', 'm3-body');
      await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: rayna } });
      await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: m3 } }); // Material 3 selected
      sent = [];
      return { c, device, rayna, m3 };
    };
    const lastUpdate = () => ofType('library-updated').slice(-1)[0];

    it('renames a saved design system, and the selected one keeps its id and stays selected', async () => {
      const { c, device, m3 } = await twoSaved();
      await c.handle({ type: 'rename-design-system', id: m3.id, name: '  Material 3 (2026)  ' });
      const u = lastUpdate();
      expect(u.settings.designSystem).toMatchObject({ id: m3.id, name: 'Material 3 (2026)' });
      expect(u.library.find((r) => r.id === m3.id)?.name).toBe('Material 3 (2026)');
      expect((device.library as { id: string; name: string }[]).find((r) => r.id === m3.id)?.name).toBe('Material 3 (2026)');
      expect(ofType('settings-saved')).toEqual([]); // renaming doesn't count as choosing a design system
    });

    it('switching after a rename selects the renamed system, whole', async () => {
      const { c, rayna } = await twoSaved();
      await c.handle({ type: 'rename-design-system', id: rayna.id, name: 'Rayna UI v2' });
      await c.handle({ type: 'switch-design-system', id: rayna.id });
      const selected = ofType('settings-saved').slice(-1)[0].settings.designSystem!;
      expect(selected).toEqual({ ...rayna, name: 'Rayna UI v2' });
    });

    it('removing another system keeps the selected one', async () => {
      const { c, rayna, m3 } = await twoSaved();
      await c.handle({ type: 'remove-design-system', id: rayna.id });
      const u = lastUpdate();
      expect(u.settings.designSystem?.id).toBe(m3.id);
      expect(u.library.map((r) => r.name)).toEqual(['Material 3']);
    });

    it('removing the selected system leaves none selected, so the user chooses again', async () => {
      const { c, rayna, m3 } = await twoSaved();
      await c.handle({ type: 'remove-design-system', id: m3.id });
      const u = lastUpdate();
      expect(u.settings.designSystem).toBeNull();
      expect(u.library.map((r) => r.id)).toEqual([rayna.id]);
      sent = [];
      await c.handle({ type: 'run-audit', scope: 'page' });
      expect(ofType('audit-error')[0]).toMatchObject({ kind: 'no-design-system' });
    });

    it('ignores an empty name', async () => {
      const { c, m3 } = await twoSaved();
      await c.handle({ type: 'rename-design-system', id: m3.id, name: '   ' });
      expect(lastUpdate()).toBeUndefined();
    });
  });

  describe('renaming the selected design system keeps its last audit', () => {
    const tokens = { source: 'local' as const, id: 'C:ds', name: 'Tokens' };
    const audited = async () => {
      const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, { library: [] }) });
      const rayna = referenceFromSelection({ ...auditConfig().designSystem!, name: 'Rayna UI', variableCollections: [tokens] }, 'in-use');
      await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: rayna } });
      await c.handle({ type: 'run-audit', scope: 'page' });
      const result = ofType('audit-result').slice(-1)[0].result;
      return { c, rayna, result: JSON.parse(JSON.stringify(result)) as typeof result };
    };
    const freshness = async (c: ReturnType<typeof createController>) => {
      await c.handle({ type: 'check-freshness' });
      return ofType('audit-freshness').slice(-1)[0]?.state;
    };

    it('stays current, with the same findings and score, and shows the new name', async () => {
      const { c, rayna, result } = await audited();
      expect(result.issues).toHaveLength(1);
      expect(await freshness(c)).toBe('current');

      await c.handle({ type: 'rename-design-system', id: rayna.id, name: 'Rayna Design System' });
      expect(await freshness(c)).toBe('current');

      sent = [];
      await c.handle({ type: 'init' }); // reopen: the stored last audit is untouched
      const { lastAudit, settings } = ofType('init-state')[0];
      expect(lastAudit).toEqual(result);
      expect(settings.designSystem).toMatchObject({ id: rayna.id, name: 'Rayna Design System' });
      expect(auditedName(lastAudit!, settings.designSystem)).toBe('Rayna Design System');
      expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('current');

      // Running it again gives the identical result: the name was never part of it.
      await c.handle({ type: 'run-audit', scope: 'page' });
      const rerun = ofType('audit-result').slice(-1)[0].result;
      expect(rerun.fingerprint).toBe(result.fingerprint);
      expect(rerun.compliance).toEqual(result.compliance);
      expect(rerun.issues).toEqual(result.issues);
    });

    it('still goes out of date when the design system itself changes', async () => {
      const changes: [string, (ds: ReturnType<typeof referenceFromSelection>) => ReturnType<typeof referenceFromSelection>][] = [
        ['reference assets', (ds) => applySelection(ds, { ...toSelection(ds), variableCollections: [] })],
        ['spacing scale', (ds) => ({ ...ds, spacingScale: [0, 8] })],
        ['corner-radius scale', (ds) => ({ ...ds, radiusScale: [0, 2] })],
      ];
      for (const [, change] of changes) {
        sent = [];
        const { c, rayna } = await audited();
        await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, designSystem: change(rayna) } });
        expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('changed');
      }
      for (const options of [{ disabledRules: ['color/raw-matches-token'] }, { ignoredNodeIds: ['9:2'] }, { includeHidden: true }]) {
        sent = [];
        const { c, rayna } = await audited();
        await c.handle({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, ...options, designSystem: rayna } });
        expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('changed');
      }
    });
  });

  it('saving the same library again updates that design system in place', async () => {
    const device = { library: [] };
    const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    await c.handle({ type: 'init' });
    await c.handle({ type: 'capture-design-system' });
    const first = ofType('settings-saved').slice(-1)[0].settings.designSystem!;
    await c.handle({ type: 'rename-design-system', id: first.id, name: 'Acme' });
    await c.handle({ type: 'capture-design-system' });
    const again = ofType('settings-saved').slice(-1)[0];
    expect(again.settings.designSystem).toMatchObject({ id: first.id, name: 'Acme', source: { kind: 'library-file' } });
    expect(again.library.map((r) => r.id)).toEqual([first.id]);
  });
});

