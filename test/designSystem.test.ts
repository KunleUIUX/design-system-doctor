import { describe, expect, it } from 'vitest';
import { DesignSystemResolver } from '../src/engine/resolver';
import { evaluateNodes } from '../src/engine/orchestrator';
import {
  matchesRef,
  migrateDesignSystem,
  parseScale,
  toPortable,
  validateDesignSystem,
  type AssetRef,
} from '../src/shared/designSystem';
import type { DesignSystemData } from '../src/shared/types';
import { auditConfig, colorVar, data, dsConfig, hex, node, solid } from './fixtures';

// The same published library ("Acme Colors", key 5cf0ef50) as seen from two consuming files.
// Figma gives it a different, file-specific id in each (observed in the Phase 4 real-file check).
const ACME: AssetRef = { source: 'library', key: '5cf0ef50', name: 'Acme Colors' };
const inFile = (collectionId: string, variableId: string): DesignSystemData => ({
  collections: [{ id: collectionId, key: '5cf0ef50', name: 'Acme Colors', remote: true, defaultModeId: 'm', variableCount: 1 }],
  variables: [{ ...colorVar(variableId, 'color/brand/primary', '#635BFF', collectionId), key: 'f0cea0bc', valuesByMode: { m: hex('#635BFF') } }],
  textStyles: [],
  paintStyles: [],
  components: [],
});
const FILE_A = inFile('VariableCollectionId:5cf0ef50/1:0', 'VariableID:f0cea0bc/1:4');
const FILE_B = inFile('VariableCollectionId:5cf0ef50/7:3', 'VariableID:f0cea0bc/7:9');

describe('cross-file identity', () => {
  it('matches library refs by key and local refs by id', () => {
    expect(matchesRef(ACME, { id: 'VariableCollectionId:5cf0ef50/7:3', key: '5cf0ef50', name: 'x', remote: true })).toBe(true);
    expect(matchesRef(ACME, { id: 'VariableCollectionId:5cf0ef50/1:0', key: '5cf0ef50', name: 'x', remote: false })).toBe(false);
    const local: AssetRef = { source: 'local', id: 'VariableCollectionId:45:3', name: 'Tokens' };
    expect(matchesRef(local, { id: 'VariableCollectionId:45:3', key: 'zzz', name: 'x', remote: false })).toBe(true);
    expect(matchesRef(local, { id: 'VariableCollectionId:45:3', key: 'zzz', name: 'x', remote: true })).toBe(false);
  });

  it('one saved library ref approves the same tokens in two files with different ids', () => {
    const cfg = dsConfig({ variableCollections: [ACME] });
    for (const d of [FILE_A, FILE_B]) {
      const r = new DesignSystemResolver(d, cfg);
      expect(r.isVariableApproved(d.variables[0].id)).toBe(true);
      expect(r.findColorVariables(hex('#635BFF'), {}).map((v) => v.name)).toEqual(['color/brand/primary']);
      expect(r.unresolved).toEqual([]);
    }
  });

  it('does not treat a consuming-file id like VariableID:<key>/1:4 as portable', async () => {
    // A v1 config saved in file A stored its collection id. Migrating it in file A turns it into
    // a key ref; the portable copy then holds only the key, never the file-A ids.
    const v1 = { name: 'Acme', approvedCollectionIds: ['VariableCollectionId:5cf0ef50/1:0'], textStyles: { library: true, local: false },
      paintStyles: { library: false, local: false }, components: { library: true, local: false }, spacingScale: [0, 8], radiusScale: [0] };
    const inA = await migrateDesignSystem(v1 as never, async (id) => FILE_A.collections.find((c) => c.id === id) ?? null);
    expect(inA.variableCollections).toEqual([ACME]);
    const portable = JSON.stringify(toPortable(inA));
    expect(portable).not.toMatch(/VariableCollectionId:|VariableID:|\/1:0|\/1:4/);

    // The same raw v1 config read in file B: file A's id doesn't exist there, so it is NOT
    // silently treated as Acme; it becomes an unknown local ref that validation rejects.
    const inB = await migrateDesignSystem(v1 as never, async (id) => FILE_B.collections.find((c) => c.id === id) ?? null);
    expect(inB.variableCollections).toEqual([{ source: 'local', id: 'VariableCollectionId:5cf0ef50/1:0', name: 'Unknown collection' }]);
    const r = new DesignSystemResolver(FILE_B, inB);
    expect(r.isVariableApproved('VariableID:f0cea0bc/7:9')).toBe(false);
    const v = validateDesignSystem(inB, { spacing: parseScale('Spacing scale', '0, 8'), radius: parseScale('Corner radius scale', '0') }, {
      collections: FILE_B.collections, textStyles: [], components: [],
    });
    expect(v.errors[0]).toContain('no longer exists in this file');
  });

  it('drops local refs from the portable copy (their ids mean nothing in other files)', () => {
    const local: AssetRef = { source: 'local', id: 'VariableCollectionId:45:3', name: 'Tokens' };
    const ds = dsConfig({
      variableCollections: [ACME, local],
      textStyles: { library: true, local: true, items: [{ source: 'local', id: 'S:abc,1:2', name: 'Body' }, { source: 'library', key: 'sty', name: 'Acme / Body' }] },
      components: { library: false, local: true, items: [{ source: 'local', id: '12:34', name: 'Card' }] },
    });
    const p = toPortable(ds);
    expect(p.variableCollections).toEqual([ACME]);
    expect(p.textStyles).toEqual({ library: true, local: false, items: [{ source: 'library', key: 'sty', name: 'Acme / Body' }] });
    expect(p.components).toEqual({ library: false, local: false, items: [] });
    expect(p.spacingScale).toEqual(ds.spacingScale);
  });
});

describe('not verifiable', () => {
  const unusedLibrary: AssetRef = { source: 'library', key: 'not-in-this-file', name: 'Acme Spacing' };

  it('never scores a raw colour as passing when an approved library collection can’t be read', () => {
    const r = evaluateNodes([node({ fills: [solid('#123456')] })], data(), auditConfig({ variableCollections: [unusedLibrary] }));
    expect(r.issues.map((i) => [i.ruleId, i.severity])).toEqual([['color/not-verifiable', 'unverifiable']]);
    expect(r.compliance).toMatchObject({ opportunities: 0, score: null });
    expect(r.unresolvedSources).toEqual([unusedLibrary]);
  });

  it('still reports a real match against the tokens it can read', () => {
    const r = evaluateNodes([node({ fills: [solid('#635BFF')] })], data(), auditConfig({ variableCollections: [{ source: 'library', key: 'ck', name: 'Acme tokens' }, unusedLibrary] }));
    expect(r.issues.map((i) => i.ruleId)).toEqual(['color/raw-matches-token']);
  });

  it('reports bound variables and instances Figma can’t read', () => {
    const r = evaluateNodes(
      [node({ fills: [solid('#635BFF', { boundVariableId: 'V:gone' })] }), node({ type: 'INSTANCE', instance: { main: null } })],
      data(),
      auditConfig(),
    );
    expect(r.issues.map((i) => [i.ruleId, i.severity])).toEqual([
      ['color/not-verifiable', 'unverifiable'],
      ['component/not-verifiable', 'unverifiable'],
    ]);
    expect(r.compliance.opportunities).toBe(0);
  });
});

describe('individual approvals', () => {
  it('approves listed text styles and components by key (library) or id (local)', () => {
    const d = data({ components: [] });
    const cfg = dsConfig({
      textStyles: { library: false, local: false, items: [{ source: 'library', key: 'k-body', name: 'Body / Medium' }] },
      components: { library: false, local: false, items: [{ source: 'library', key: 'btn', name: 'Button' }] },
    });
    const r = new DesignSystemResolver(d, cfg);
    expect(r.isTextStyleApproved('S:body-medium')).toBe(true);
    expect(r.isTextStyleApproved('S:heading')).toBe(false);
    expect(r.isComponentApproved({ id: '1:13', key: 'btn', name: 'Button', remote: true })).toBe(true);
    expect(r.isComponentApproved({ id: '1:14', key: 'other', name: 'Other', remote: true })).toBe(false);
  });
});

describe('validation', () => {
  const found = { collections: data().collections, textStyles: [], components: [] };
  const scales = (s: string, r = '0, 4, 8') => ({ spacing: parseScale('Spacing scale', s), radius: parseScale('Corner radius scale', r) });

  it('names duplicate, non-numeric and negative scale values', () => {
    expect(parseScale('Spacing scale', '0, 8, 16, 16').errors).toEqual(['Spacing scale contains duplicate value: 16.']);
    expect(parseScale('Spacing scale', '0, 1o').errors).toEqual(['Spacing scale contains “1o”, which isn’t a number.']);
    expect(parseScale('Corner radius scale', '-4').errors).toEqual(['Corner radius scale contains a negative value: -4.']);
    expect(parseScale('Spacing scale', '16, 4 8').values).toEqual([4, 8, 16]);
  });

  it('requires a name and at least one source', () => {
    const empty = dsConfig({ name: ' ', variableCollections: [], textStyles: { library: false, local: false, items: [] },
      components: { library: false, local: false, items: [] }, paintStyles: { library: false, local: false } });
    expect(validateDesignSystem(empty, scales('0, 8'), found).errors).toEqual([
      'Give the design system a name.',
      'Choose at least one source: a variable collection, text styles or components.',
    ]);
  });

  it('blocks missing local sources but only warns about library sources not used in this file', () => {
    const ds = dsConfig({ variableCollections: [{ source: 'local', id: 'C:gone', name: 'Old tokens' }, { source: 'library', key: 'nope', name: 'Acme Spacing' }] });
    const v = validateDesignSystem(ds, scales('0, 8'), found);
    expect(v.errors).toEqual(['The collection “Old tokens” no longer exists in this file. Remove it or pick another.']);
    expect(v.warnings[0]).toContain('“Acme Spacing” isn’t used in this file yet');
  });

  it('warns that an empty scale switches that rule off', () => {
    expect(validateDesignSystem(dsConfig(), scales('', ''), found).warnings).toEqual([
      'Spacing scale is empty, so spacing won’t be checked.',
      'Corner radius scale is empty, so corner radii won’t be checked.',
    ]);
  });
});
