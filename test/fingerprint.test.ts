import { describe, expect, it } from 'vitest';
import { auditFingerprint } from '../src/engine/fingerprint';
import { auditConfig, BODY_MEDIUM, data, HEADING, node, solid } from './fixtures';

const n = node({ id: '1:1', fills: [solid('#635BFF')] });

describe('auditFingerprint', () => {
  it('is stable for identical inputs, whatever order Figma returned styles in', () => {
    const a = auditFingerprint([n], data({ textStyles: [BODY_MEDIUM, HEADING] }), auditConfig());
    const b = auditFingerprint([n], data({ textStyles: [HEADING, BODY_MEDIUM] }), auditConfig());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when a layer property the rules read changes', () => {
    const before = auditFingerprint([n], data(), auditConfig());
    expect(auditFingerprint([{ ...n, fills: [solid('#635BFE')] }], data(), auditConfig())).not.toBe(before);
  });

  it('changes when a token value changes', () => {
    const d = data();
    const before = auditFingerprint([n], d, auditConfig());
    const changed = { ...d, variables: d.variables.map((v) => (v.id === 'V:brand' ? { ...v, valuesByMode: { 'M:light': { r: 0, g: 0, b: 0, a: 1 } } } : v)) };
    expect(auditFingerprint([n], changed, auditConfig())).not.toBe(before);
  });

  it('changes when audit settings change', () => {
    expect(auditFingerprint([n], data(), auditConfig({ spacingScale: [0, 8] }))).not.toBe(auditFingerprint([n], data(), auditConfig()));
    expect(auditFingerprint([n], data(), auditConfig({}, { ignoredNodeIds: ['1:1'] }))).not.toBe(auditFingerprint([n], data(), auditConfig()));
  });
});
