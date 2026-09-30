import { describe, expect, it } from 'vitest';
import { evaluateNodes, isRuleEnabled } from '../src/engine/orchestrator';
import { computeCompliance } from '../src/engine/scoring';
import type { AuditRule } from '../src/engine/rules/types';
import { auditConfig, data, node, segment, solid, BODY_MEDIUM } from './fixtures';

describe('compliance score', () => {
  it('is null, not 100, when nothing was checked', () => {
    expect(computeCompliance([]).score).toBeNull();
  });

  it('weights warnings at half and errors at zero', () => {
    const s = computeCompliance([{ key: 'a' }, { key: 'b', severity: 'warning' }, { key: 'c', severity: 'error' }, { key: 'd' }]);
    expect(s).toMatchObject({ score: 62, opportunities: 4, passed: 2, warned: 1, errored: 1 });
  });

  it('matches the documented example: 22 checks, 11 passed, 4 warnings, 7 issues → 59.09% shown as 59%', () => {
    const checks = [
      ...Array.from({ length: 11 }, (_, i) => ({ key: `p${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `w${i}`, severity: 'warning' as const })),
      ...Array.from({ length: 7 }, (_, i) => ({ key: `e${i}`, severity: 'error' as const })),
    ];
    const s = computeCompliance(checks);
    expect((11 + 4 * 0.5) / 22).toBeCloseTo(0.5909, 4);
    expect(s).toMatchObject({ score: 59, opportunities: 22, passed: 11, warned: 4, errored: 7 });
  });

  it('counts a property once, at its worst result', () => {
    const s = computeCompliance([{ key: 'a' }, { key: 'a', severity: 'error' }, { key: 'a', severity: 'warning' }]);
    expect(s).toMatchObject({ score: 0, opportunities: 1, errored: 1 });
  });

  it('never rounds a failing page up to 100%', () => {
    const checks = Array.from({ length: 999 }, (_, i) => ({ key: String(i) }));
    expect(computeCompliance([...checks, { key: 'x', severity: 'warning' }]).score).toBe(99);
  });
});

describe('evaluateNodes', () => {
  it('handles an empty page', () => {
    const r = evaluateNodes([], data(), auditConfig());
    expect(r.issues).toEqual([]);
    expect(r.compliance.score).toBeNull();
  });

  it('reports zero issues and 100% when everything passes', () => {
    const r = evaluateNodes(
      [node({ type: 'TEXT', text: [segment({ textStyleId: BODY_MEDIUM.id, fills: [solid('#111111', { boundVariableId: 'V:text' })] })] })],
      data(),
      auditConfig(),
    );
    expect(r.issues).toEqual([]);
    expect(r.compliance.score).toBe(100);
  });

  it('reports multiple issues on the same node, errors first', () => {
    const n = node({
      name: 'Pay button',
      fills: [solid('#635BFF')],
      layout: { mode: 'HORIZONTAL', values: { itemSpacing: 18 }, boundVariables: {} },
      radius: { values: { cornerRadius: 6 }, boundVariables: {}, width: 100, height: 40 },
    });
    const r = evaluateNodes([n], data(), auditConfig());
    expect(r.issues.map((i) => i.ruleId)).toEqual(['color/raw-matches-token', 'spacing/off-scale', 'radius/off-scale']);
    expect(r.issues.every((i) => i.nodeId === n.id && i.nodeName === 'Pay button')).toBe(true);
  });

  it('respects disabled rules and finding codes', () => {
    const n = node({ fills: [solid('#635BFF')], radius: { values: { cornerRadius: 6 }, boundVariables: {}, width: 100, height: 40 } });
    expect(evaluateNodes([n], data(), auditConfig({}, { disabledRules: ['radius'] })).issues.map((i) => i.ruleId)).toEqual([
      'color/raw-matches-token',
    ]);
    expect(evaluateNodes([n], data(), auditConfig({}, { disabledRules: ['color/raw-matches-token'] })).issues.map((i) => i.ruleId)).toEqual([
      'radius/off-scale',
    ]);
    expect(isRuleEnabled('color/near-token', ['color'])).toBe(false);
    expect(isRuleEnabled('colorful/x', ['color'])).toBe(true);
  });

  it('skips ignored nodes entirely', () => {
    const n = node({ fills: [solid('#635BFF')] });
    const r = evaluateNodes([n], data(), auditConfig({}, { ignoredNodeIds: [n.id] }));
    expect(r.issues).toEqual([]);
    expect(r.compliance.opportunities).toBe(0);
  });

  it('isolates a crashing rule and reports it instead of failing the audit', () => {
    const boom: AuditRule = {
      id: 'boom', name: 'Boom', category: 'spacing', defaultSeverity: 'error', description: '', codes: {},
      appliesTo: () => true,
      evaluate: () => { throw new Error('bad node'); },
    };
    const r = evaluateNodes([node()], data(), auditConfig(), [boom]);
    expect(r.ruleErrors).toHaveLength(1);
    expect(r.ruleErrors[0].message).toContain('bad node');
  });

  it('refuses to run without a configured design system', () => {
    expect(() => evaluateNodes([], data(), { ...auditConfig(), designSystem: null })).toThrow(/No design system/);
  });

  it('stays fast on a large page', () => {
    const nodes = Array.from({ length: 20000 }, (_, i) =>
      node({
        fills: [solid(i % 2 ? '#635BFF' : '#123456')],
        layout: { mode: 'VERTICAL', values: { itemSpacing: i % 3 ? 16 : 18, paddingTop: 8 }, boundVariables: {} },
        radius: { values: { cornerRadius: 8 }, boundVariables: {}, width: 100, height: 40 },
      }),
    );
    const t = performance.now();
    const r = evaluateNodes(nodes, data(), auditConfig());
    expect(performance.now() - t).toBeLessThan(2000);
    // 20k spacing + 20k padding + 20k radius + 10k token-matching fills (unrelated #123456 isn't scored).
    expect(r.compliance.opportunities).toBe(70000);
  });
});

describe('confidence', () => {
  it('bands by number of applicable checks', () => {
    expect(computeCompliance([{ key: 'a', severity: 'warning' }])).toMatchObject({ score: 50, confidence: 'low' });
    expect(computeCompliance(Array.from({ length: 10 }, (_, i) => ({ key: `${i}` }))).confidence).toBe('normal');
    expect(computeCompliance(Array.from({ length: 100 }, (_, i) => ({ key: `${i}` }))).confidence).toBe('high');
  });
});

describe('review items', () => {
  it('are listed but never change the score or the number of checks', () => {
    const nodes = [node({ fills: [solid('#E4572E')] }), node({ fills: [solid('#635BFF', { boundVariableId: 'V:brand' })] })];
    const r = evaluateNodes(nodes, data(), auditConfig());
    expect(r.issues.map((i) => i.severity)).toEqual(['review']);
    expect(r.compliance).toMatchObject({ score: 100, opportunities: 1 });
  });

  it('sort after issues and warnings', () => {
    const r = evaluateNodes(
      [node({ fills: [solid('#E4572E')] }), node({ fills: [solid('#635BFF')] }), node({ radius: { values: { cornerRadius: 6 }, boundVariables: {}, width: 100, height: 40 } })],
      data(),
      auditConfig(),
    );
    expect(r.issues.map((i) => i.severity)).toEqual(['error', 'warning', 'review']);
  });
});

describe('consolidated findings', () => {
  it('carry the affected sides and score as one check', () => {
    const r = evaluateNodes(
      [node({ name: 'Card', layout: { mode: 'VERTICAL', values: { paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18 }, boundVariables: {} } })],
      data(),
      auditConfig(),
    );
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ property: 'Padding', affects: ['Top', 'Right', 'Bottom', 'Left'], currentValue: '18px' });
    expect(r.compliance).toMatchObject({ opportunities: 1, errored: 1 });
  });
});
