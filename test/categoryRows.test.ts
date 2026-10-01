import { describe, expect, it } from 'vitest';
import { evaluateNodes } from '../src/engine/orchestrator';
import { allPassedLabel, categoryRows } from '../src/ui/categoryRows';
import { auditConfig, data, node, segment } from './fixtures';

// Three approved library instances (Components passes) and one off-scale gap (a Spacing issue),
// like the Material 3 smoke test where Components was checked but never listed.
const libraryInstance = (id: string) =>
  node({ id, type: 'INSTANCE', instance: { main: { id: `C:${id}`, key: `k-${id}`, name: 'Button', remote: true } } });
const offScaleGap = node({ id: '9:1', layout: { mode: 'HORIZONTAL', values: { itemSpacing: 66 }, boundVariables: {} } });
const nodes = [libraryInstance('1:1'), libraryInstance('1:2'), libraryInstance('1:3'), offScaleGap];

describe('results categories', () => {
  it('lists a category that was checked and fully passed, with its check count', () => {
    const r = evaluateNodes(nodes, data({ components: [] }), auditConfig());
    const components = categoryRows(r).find((row) => row.category === 'components');
    expect(r.issues.filter((i) => i.category === 'components')).toEqual([]);
    expect(components).toMatchObject({ allPassed: true, checks: 3, error: 0, warning: 0, review: 0, unverifiable: 0 });
    expect(allPassedLabel(3)).toBe('All 3 checks passed');
    expect(allPassedLabel(1)).toBe('The 1 check passed');
  });

  it('does not change the compliance score: per-category counts are the same scored checks', () => {
    const r = evaluateNodes(nodes, data({ components: [] }), auditConfig());
    expect(r.compliance).toMatchObject({ opportunities: 4, passed: 3, warned: 0, errored: 1, score: 75 });
    expect(r.checksByCategory).toEqual({ components: 3, spacing: 1 });
    const summed = Object.values(r.checksByCategory).reduce((a, b) => a + (b ?? 0), 0);
    expect(summed).toBe(r.compliance.opportunities);
  });

  it('keeps categories with findings exactly as before, including not-verifiable-only ones and older saved results', () => {
    const unavailable = { source: 'library' as const, key: 'k-caption', name: 'Caption' };
    const cfg = auditConfig({ textStyles: { library: false, local: false, items: [unavailable] } });
    const unstyled = node({ id: '5:1', type: 'TEXT', text: [segment({ fontSize: 12 })] });
    const r = evaluateNodes([...nodes, unstyled], data({ components: [] }), cfg);
    const rows = categoryRows(r);
    expect(rows.map((row) => row.category)).toEqual(['typography', 'components', 'spacing']);
    expect(rows.find((row) => row.category === 'spacing')).toMatchObject({ allPassed: false, error: 1, checks: 1 });
    // Not verifiable is never scored, so typography has no checks and stays a findings row.
    expect(rows.find((row) => row.category === 'typography')).toMatchObject({ allPassed: false, unverifiable: 1, checks: 0 });

    // A result saved before per-category counts existed shows only categories with findings, as before.
    const { checksByCategory: _omit, ...old } = r;
    expect(categoryRows(old).map((row) => row.category)).toEqual(['typography', 'spacing']);
  });
});
