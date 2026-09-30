import type { AuditConfig, DesignSystemData, NodeSnapshot } from '../shared/types';

/**
 * Deterministic hash of every input the audit result depends on. If two fingerprints match, the
 * rules would produce the same findings and score, so a saved result is still current.
 *
 * Inputs are canonicalised (design-system arrays sorted by id) because Figma resolves styles and
 * variables in parallel and their arrival order isn't stable.
 */
export function auditFingerprint(nodes: NodeSnapshot[], data: DesignSystemData, config: AuditConfig): string {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const canonical = JSON.stringify({
    nodes,
    data: {
      collections: byId(data.collections),
      variables: byId(data.variables),
      textStyles: byId(data.textStyles),
      paintStyles: byId(data.paintStyles),
      components: byId(data.components),
    },
    config: {
      designSystem: config.designSystem,
      disabledRules: [...config.disabledRules].sort(),
      includeHidden: config.includeHidden,
      ignoredNodeIds: [...config.ignoredNodeIds].sort(),
      nearColorThreshold: config.nearColorThreshold,
    },
  });
  return fnv1a(canonical);
}

/** 64-bit FNV-1a as two 32-bit halves; fast, dependency-free, fine for change detection. */
function fnv1a(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
