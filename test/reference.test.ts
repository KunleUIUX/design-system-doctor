import { describe, expect, it } from 'vitest';
import { auditFingerprint } from '../src/engine/fingerprint';
import { evaluateNodes } from '../src/engine/orchestrator';
import { prepareReference } from '../src/engine/prepareReference';
import type { AssetRef } from '../src/shared/designSystem';
import {
  applySelection,
  migrateToReference,
  referenceFromSelection,
  toSelection,
  type DesignSystemReference,
} from '../src/shared/reference';
import type { AuditConfig, DesignSystemConfig, DesignSystemData, NodeSnapshot } from '../src/shared/types';
import { BODY_MEDIUM, DS_TOKENS, LOCAL_TOKENS, auditConfig, data, dsConfig, hex, node, segment, solid } from './fixtures';

const lib = (key: string, name: string): AssetRef => ({ source: 'library', key, name });
const NONE = { library: false, local: false };

/** Runs the engine the way the plugin now does: reference → prepare → existing engine. */
function auditWith(reference: DesignSystemReference, live: DesignSystemData, nodes: NodeSnapshot[]) {
  const prepared = prepareReference(reference, live);
  const config: AuditConfig = { ...auditConfig(), designSystem: prepared.designSystem };
  return { ...evaluateNodes(nodes, prepared.data, config), prepared, config };
}

/** A design system captured in its own library file (values known for everything). */
function captured(over: Partial<DesignSystemReference> = {}): DesignSystemReference {
  return {
    schema: 1,
    id: 'acme',
    name: 'Acme',
    source: { kind: 'library-file', fileName: 'Acme Library' },
    capturedAt: '2026-10-02T09:00:00.000Z',
    variableCollections: [],
    textStyles: [],
    paintStyles: [],
    components: [],
    spacingScale: [0, 4, 8, 16],
    radiusScale: [0, 4, 8],
    alsoAccept: { textStyles: { ...NONE }, paintStyles: { ...NONE }, components: { ...NONE } },
    ...over,
  };
}

const CAPTION = { fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 12, lineHeight: { unit: 'PIXELS' as const, value: 16 }, letterSpacing: { unit: 'PERCENT' as const, value: 0 } };
const unstyled = (props = {}) => node({ type: 'TEXT', name: 'Footnote', text: [segment({ ...CAPTION, ...props })] });

describe('migration of older settings', () => {
  const variants: [string, DesignSystemConfig][] = [
    ['library switches', dsConfig()],
    ['individual picks', dsConfig({ textStyles: { library: false, local: false, items: [lib('k-body', 'Body / Medium')] }, components: { library: false, local: true, items: [] } })],
    ['local collection', dsConfig({ variableCollections: [LOCAL_TOKENS], paintStyles: { library: false, local: true } })],
  ];

  it.each(variants)('reproduces the original settings exactly, key order included (%s)', (_label, ds) => {
    const ref = migrateToReference(ds);
    expect(ref.source.kind).toBe('migrated');
    expect(JSON.stringify(toSelection(ref))).toBe(JSON.stringify(ds));
    // Same id every time it's migrated, so reopening never creates a second copy.
    expect(migrateToReference(ds).id).toBe(ref.id);
  });

  it.each(variants)('audits identically before and after migration, with the same fingerprint (%s)', (_label, ds) => {
    const nodes = [
      node({ id: '1:1', fills: [solid('#635BFF')] }),
      node({ id: '1:2', type: 'TEXT', text: [segment({ fontSize: 17 })] }),
      node({ id: '1:3', layout: { mode: 'HORIZONTAL', values: { itemSpacing: 13 }, boundVariables: {} } }),
      node({ id: '1:4', type: 'INSTANCE', instance: { main: { id: 'C:x', key: 'kx', name: 'Chip', remote: true } } }),
    ];
    const before: AuditConfig = { ...auditConfig(), designSystem: ds };
    const old = evaluateNodes(nodes, data(), before);
    const now = auditWith(migrateToReference(ds), data(), nodes);
    expect(now.issues).toEqual(old.issues);
    expect(now.compliance).toEqual(old.compliance);
    expect(now.prepared.data).toEqual(data()); // nothing captured, nothing added
    expect(auditFingerprint(nodes, now.prepared.data, now.config)).toBe(auditFingerprint(nodes, data(), before));
  });
});

describe('edit vs new design system', () => {
  it('a new design system carries nothing over from the previous one', () => {
    const rayna = captured({ name: 'Rayna UI', textStyles: [{ ref: lib('r-body', 'Body'), props: CAPTION }] });
    const fresh = referenceFromSelection({ ...toSelection(rayna), name: 'Material 3', textStyles: { ...NONE, items: [lib('m3-label', 'Label')] } }, 'in-use');
    expect(fresh.id).not.toBe(rayna.id);
    expect(fresh.source.kind).toBe('in-use');
    expect(JSON.stringify(fresh)).not.toContain('r-body');
  });

  it('editing keeps the same design system: id, source and captured values of kept items', () => {
    const ref = captured({ textStyles: [{ ref: lib('a', 'A'), props: CAPTION }, { ref: lib('b', 'B'), props: CAPTION }] });
    const sel = toSelection(ref);
    const edited = applySelection(ref, { ...sel, name: 'Acme v2', textStyles: { ...sel.textStyles, items: [lib('a', 'A'), lib('c', 'C')] } });
    expect(edited).toMatchObject({ id: 'acme', name: 'Acme v2', source: ref.source, capturedAt: ref.capturedAt });
    expect(edited.textStyles).toEqual([{ ref: lib('a', 'A'), props: CAPTION }, { ref: lib('c', 'C') }]);
  });
});

describe('reference preparation: live, else captured, else unavailable', () => {
  it('uses captured values when the file can’t read an approved text style, and labels them', () => {
    const ref = captured({ textStyles: [{ ref: lib('k-caption', 'Caption'), props: CAPTION }] });
    const r = auditWith(ref, data({ textStyles: [] }), [unstyled()]);
    expect(r.issues).toEqual([
      expect.objectContaining({ ruleId: 'typography/local-matches-style', severity: 'error', expectedValue: 'Caption (captured)' }),
    ]);
    expect(r.prepared.coverage.textStyles).toEqual({ total: 1, live: 0, captured: 1, unavailable: 0 });
    expect(r.prepared.coverage.capturedAt).toBe('2026-10-02T09:00:00.000Z');
  });

  it('a genuine one-off is a warning, not "Not verifiable", once the design system’s values are known', () => {
    const ref = captured({ textStyles: [{ ref: lib('k-caption', 'Caption'), props: CAPTION }] });
    const r = auditWith(ref, data({ textStyles: [] }), [unstyled({ fontSize: 28, lineHeight: { unit: 'PIXELS', value: 36 } })]);
    expect(r.issues.map((i) => [i.ruleId, i.severity])).toEqual([['typography/no-style', 'warning']]);
  });

  it('live data wins over captured values', () => {
    const stale = { ...CAPTION, fontSize: 99 };
    const ref = captured({ textStyles: [{ ref: lib(BODY_MEDIUM.key, BODY_MEDIUM.name), props: stale }] });
    const r = auditWith(ref, data(), [node({ type: 'TEXT', text: [segment()] })]);
    expect(r.prepared.coverage.textStyles).toEqual({ total: 1, live: 1, captured: 0, unavailable: 0 });
    expect(r.prepared.data.textStyles.some((s) => s.id.startsWith('captured:'))).toBe(false);
    expect(r.issues[0]).toMatchObject({ ruleId: 'typography/local-matches-style', expectedValue: 'Body / Medium' });
  });

  it('with neither live nor captured values the check stays "Not verifiable" and is never scored', () => {
    const ref = referenceFromSelection(dsConfig({ textStyles: { ...NONE, items: [lib('k-caption', 'Caption')] } }), 'in-use');
    const r = auditWith(ref, data({ textStyles: [] }), [unstyled()]);
    expect(r.issues.map((i) => [i.ruleId, i.severity])).toEqual([['typography/not-verifiable', 'unverifiable']]);
    expect(r.compliance.opportunities).toBe(0);
    expect(r.prepared.coverage.textStyles).toEqual({ total: 1, live: 0, captured: 0, unavailable: 1 });
  });

  it('matches raw colours against captured tokens the file has never used', () => {
    const ref = captured({
      variableCollections: [{ ref: lib('k-colors', 'Acme Colors'), defaultModeId: 'L', modes: [{ id: 'L', name: 'Light' }],
        variables: [{ ref: lib('k-danger', 'color/danger'), resolvedType: 'COLOR', valuesByMode: { L: hex('#E4572E') } }] }],
    });
    const r = auditWith(ref, data({ collections: [], variables: [] }), [node({ fills: [solid('#E4572E')] })]);
    expect(r.issues).toEqual([expect.objectContaining({ ruleId: 'color/raw-matches-token', expectedValue: 'color/danger (captured)' })]);
    expect(r.prepared.coverage.tokens).toEqual({ total: 1, live: 0, captured: 1, unavailable: 0 });
  });

  it('adds captured tokens to a live collection only in modes it can match by name', () => {
    const tokens = { ref: DS_TOKENS, modes: [{ id: 'lib-light', name: 'Light' }, { id: 'lib-dark', name: 'Dark' }],
      variables: [{ ref: lib('k-danger', 'color/danger'), resolvedType: 'COLOR' as const, valuesByMode: { 'lib-light': hex('#E4572E'), 'lib-dark': hex('#FF8A65') } }] };
    const live = data();
    live.collections[0] = { ...live.collections[0], modes: [{ id: 'M:light', name: 'Light' }] }; // no "Dark" here
    const r = auditWith(captured({ variableCollections: [tokens] }), live, [node({ fills: [solid('#E4572E')] })]);
    const added = r.prepared.data.variables.find((v) => v.key === 'k-danger');
    expect(added).toMatchObject({ collectionId: 'C:ds', valuesByMode: { 'M:light': hex('#E4572E') } });
    expect(r.issues[0]).toMatchObject({ ruleId: 'color/raw-matches-token', expectedValue: 'color/danger (captured)' });
  });

  it('inside the library’s own file, a library entry matches the local asset with the same key', () => {
    const ownStyle = { ...BODY_MEDIUM, id: 'S:own', key: 'k-own', remote: false };
    const ref = captured({ textStyles: [{ ref: lib('k-own', 'Body / Medium'), props: CAPTION }] });
    const r = auditWith(ref, data({ textStyles: [ownStyle] }), [node({ type: 'TEXT', text: [segment({ textStyleId: 'S:own' })] })]);
    expect(r.prepared.coverage.textStyles.live).toBe(1);
    expect(r.issues).toEqual([]);
  });

  it('a selected design system is the reference: components from other libraries aren’t approved', () => {
    const ref = captured({ components: [{ ref: lib('k-button', 'Button') }] });
    const other = node({ type: 'INSTANCE', instance: { main: { id: 'C:v', key: 'visionos-button', name: 'Button', remote: true } } });
    const own = node({ type: 'INSTANCE', instance: { main: { id: 'C:b', key: 'k-button', name: 'Button', remote: true } } });
    const r = auditWith(ref, data({ components: [] }), [own, other]);
    expect(r.issues.map((i) => [i.ruleId, i.nodeId])).toEqual([['component/unapproved-source', other.id]]);
  });
});
