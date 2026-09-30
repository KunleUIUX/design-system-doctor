import { DesignSystemResolver } from '../src/engine/resolver';
import type { AssetRef } from '../src/shared/designSystem';
import type { AuditContext } from '../src/engine/rules/types';
import {
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_RADIUS_SCALE,
  DEFAULT_SPACING_SCALE,
  type AuditConfig,
  type DesignSystemConfig,
  type DesignSystemData,
  type NodeSnapshot,
  type PaintSnapshot,
  type RGBA,
  type TextSegmentSnapshot,
  type TextStyleInfo,
  type VariableInfo,
} from '../src/shared/types';

export const hex = (h: string, a = 1): RGBA => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
  a,
});

export const solid = (h: string, extra: Partial<PaintSnapshot> = {}): PaintSnapshot => ({
  type: 'SOLID',
  visible: true,
  color: hex(h),
  ...extra,
});

let nextId = 1;
export function node(partial: Partial<NodeSnapshot> = {}): NodeSnapshot {
  const id = partial.id ?? `1:${nextId++}`;
  return { id, name: 'Layer', type: 'FRAME', path: ['Frame'], variableModes: {}, insideInstance: false, ...partial };
}

export const BODY_MEDIUM: TextStyleInfo = {
  id: 'S:body-medium',
  key: 'k-body',
  name: 'Body / Medium',
  remote: true,
  fontFamily: 'Inter',
  fontStyle: 'Medium',
  fontSize: 16,
  lineHeight: { unit: 'PIXELS', value: 24 },
  letterSpacing: { unit: 'PERCENT', value: 0 },
};

export const HEADING: TextStyleInfo = {
  ...BODY_MEDIUM,
  id: 'S:heading',
  key: 'k-heading',
  name: 'Heading / L',
  fontStyle: 'Bold',
  fontSize: 24,
  lineHeight: { unit: 'PIXELS', value: 32 },
};

export const LOCAL_BODY: TextStyleInfo = { ...BODY_MEDIUM, id: 'S:local-body', key: '', name: 'Body 15', remote: false, fontSize: 15 };

export function segment(partial: Partial<TextSegmentSnapshot> = {}): TextSegmentSnapshot {
  return {
    start: 0,
    end: 7,
    characters: 'Pay now',
    textStyleId: '',
    fills: [],
    fillStyleId: '',
    fontFamily: 'Inter',
    fontStyle: 'Medium',
    fontSize: 16,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PERCENT', value: 0 },
    ...partial,
  };
}

export function colorVar(id: string, name: string, h: string, collectionId = 'C:ds', extraModes: Record<string, string> = {}): VariableInfo {
  const valuesByMode: VariableInfo['valuesByMode'] = { 'M:light': hex(h) };
  for (const [mode, value] of Object.entries(extraModes)) valuesByMode[mode] = hex(value);
  return { id, key: id, name, collectionId, remote: true, resolvedType: 'COLOR', valuesByMode };
}

export const BRAND_PRIMARY = colorVar('V:brand', 'color/brand/primary', '#635BFF', 'C:ds', { 'M:dark': '#8A84FF' });
export const TEXT_PRIMARY = colorVar('V:text', 'color/text/primary', '#111111');
export const LOCAL_ACCENT = colorVar('V:local', 'accent', '#FF0000', 'C:local');

export function data(partial: Partial<DesignSystemData> = {}): DesignSystemData {
  return {
    collections: [
      { id: 'C:ds', key: 'ck', name: 'Acme tokens', remote: true, defaultModeId: 'M:light', variableCount: 2 },
      { id: 'C:local', key: '', name: 'Local', remote: false, defaultModeId: 'M:light', variableCount: 1 },
    ],
    variables: [BRAND_PRIMARY, TEXT_PRIMARY, LOCAL_ACCENT],
    textStyles: [BODY_MEDIUM, HEADING, LOCAL_BODY],
    paintStyles: [],
    components: [],
    ...partial,
  };
}

/** The fixture's approved token collection is a library one ('C:ds', key 'ck'), so it's a key ref. */
export const DS_TOKENS: AssetRef = { source: 'library', key: 'ck', name: 'Acme tokens' };
export const LOCAL_TOKENS: AssetRef = { source: 'local', id: 'C:local', name: 'Local' };

export function dsConfig(partial: Partial<DesignSystemConfig> = {}): DesignSystemConfig {
  return {
    version: 2,
    name: 'Acme',
    variableCollections: [DS_TOKENS],
    textStyles: { library: true, local: false, items: [] },
    paintStyles: { library: true, local: false },
    components: { library: true, local: false, items: [] },
    spacingScale: DEFAULT_SPACING_SCALE,
    radiusScale: DEFAULT_RADIUS_SCALE,
    ...partial,
  };
}

export function auditConfig(ds: Partial<DesignSystemConfig> = {}, extra: Partial<AuditConfig> = {}): AuditConfig {
  return { ...DEFAULT_AUDIT_CONFIG, designSystem: dsConfig(ds), ...extra };
}

export function ctx(d: DesignSystemData = data(), cfg: AuditConfig = auditConfig()): AuditContext {
  return { resolver: new DesignSystemResolver(d, cfg.designSystem!), config: cfg };
}
