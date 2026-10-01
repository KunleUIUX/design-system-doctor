// Collects everything Figma knows about styles, variables and components that the audit may
// need, once per audit, with unique ids resolved in parallel.

import type {
  CollectionInfo,
  ComponentInfo,
  DesignSystemData,
  NodeSnapshot,
  PaintStyleInfo,
  RGBA,
  TextStyleInfo,
  VariableInfo,
} from '../shared/types';
import { mainComponentRef, readPaint, toStructure } from './snapshot';
import { buildStructureSignature } from '../engine/signature';
import { matchesRef, type AssetRef } from '../shared/designSystem';

const MAX_ALIAS_DEPTH = 10;

export async function loadDesignSystemData(
  nodes: NodeSnapshot[],
  mains: Map<string, ComponentNode>,
  approvedCollections: AssetRef[],
): Promise<DesignSystemData> {
  const [localCollections, localVariables, localTextStyles, localPaintStyles] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
  ]);

  // ── Referenced ids ──────────────────────────────────────────────────────
  const textStyleIds = new Set<string>();
  const paintStyleIds = new Set<string>();
  const variableIds = new Set<string>();
  const detachedLocalIds = new Set<string>();
  for (const n of nodes) {
    for (const seg of n.text ?? []) {
      if (seg.textStyleId) textStyleIds.add(seg.textStyleId);
      if (seg.fillStyleId) paintStyleIds.add(seg.fillStyleId);
      for (const p of seg.fills) if (p.boundVariableId) variableIds.add(p.boundVariableId);
    }
    if (n.fillStyleId) paintStyleIds.add(n.fillStyleId);
    if (n.strokeStyleId) paintStyleIds.add(n.strokeStyleId);
    for (const p of [...(n.fills ?? []), ...(n.strokes ?? [])]) if (p.boundVariableId) variableIds.add(p.boundVariableId);
    for (const id of Object.values(n.layout?.boundVariables ?? {})) if (id) variableIds.add(id);
    for (const id of Object.values(n.radius?.boundVariables ?? {})) if (id) variableIds.add(id);
    if (n.detached?.type === 'local') detachedLocalIds.add(n.detached.componentId);
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const textStyles = new Map<string, TextStyle>(localTextStyles.map((s) => [s.id, s]));
  const paintStyles = new Map<string, PaintStyle>(localPaintStyles.map((s) => [s.id, s]));
  await Promise.all([
    ...[...textStyleIds].filter((id) => !textStyles.has(id)).map(async (id) => {
      const s = await figma.getStyleByIdAsync(id).catch(() => null);
      if (s?.type === 'TEXT') textStyles.set(id, s as TextStyle);
    }),
    ...[...paintStyleIds].filter((id) => !paintStyles.has(id)).map(async (id) => {
      const s = await figma.getStyleByIdAsync(id).catch(() => null);
      if (s?.type === 'PAINT') paintStyles.set(id, s as PaintStyle);
    }),
  ]);
  const paintStyleInfos = [...paintStyles.values()].map(toPaintStyleInfo);
  for (const s of paintStyleInfos) if (s.boundVariableId) variableIds.add(s.boundVariableId);

  // ── Variables ───────────────────────────────────────────────────────────
  const collections = new Map<string, VariableCollection>(localCollections.map((c) => [c.id, c]));
  const variables = new Map<string, Variable>(localVariables.map((v) => [v.id, v]));
  const fetchCollection = async (id: string) => {
    if (collections.has(id)) return collections.get(id)!;
    const c = await figma.variables.getVariableCollectionByIdAsync(id).catch(() => null);
    if (c) collections.set(id, c);
    return c;
  };
  const fetchVariable = async (id: string) => {
    if (variables.has(id)) return variables.get(id)!;
    const v = await figma.variables.getVariableByIdAsync(id).catch(() => null);
    if (v) variables.set(id, v);
    return v;
  };

  await Promise.all([...variableIds].map(fetchVariable));
  await Promise.all([...variables.values()].map((v) => fetchCollection(v.variableCollectionId)));

  // Every variable this file has for an approved collection, so raw values can be matched against
  // tokens the page doesn't use. Library collections are found by key (their id here is
  // file-specific); for them Figma only lists variables already imported into this file.
  const approved = [...collections.values()].filter((c) => approvedCollections.some((r) => matchesRef(r, c)));
  await Promise.all(approved.flatMap((c) => c.variableIds).filter((id) => !variables.has(id)).map(fetchVariable));

  const resolveValue = async (value: VariableValue, depth: number): Promise<VariableInfo['valuesByMode'][string]> => {
    if (isAlias(value)) {
      if (depth >= MAX_ALIAS_DEPTH) return null;
      const target = await fetchVariable(value.id);
      if (!target) return null;
      // Aliases are followed in the target collection's default mode (see ARCHITECTURE.md).
      const col = await fetchCollection(target.variableCollectionId);
      const modeId = col?.defaultModeId ?? Object.keys(target.valuesByMode)[0];
      return resolveValue(target.valuesByMode[modeId], depth + 1);
    }
    if (typeof value === 'object' && value && 'r' in value) {
      return { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 } as RGBA;
    }
    return value as number | string | boolean;
  };

  const variableInfos: VariableInfo[] = [];
  for (const v of [...variables.values()]) {
    if (v.resolvedType !== 'COLOR' && v.resolvedType !== 'FLOAT' && v.resolvedType !== 'STRING' && v.resolvedType !== 'BOOLEAN') continue;
    const valuesByMode: VariableInfo['valuesByMode'] = {};
    for (const [modeId, value] of Object.entries(v.valuesByMode)) valuesByMode[modeId] = await resolveValue(value, 0);
    variableInfos.push({
      id: v.id,
      key: v.key,
      name: v.name,
      collectionId: v.variableCollectionId,
      remote: v.remote,
      resolvedType: v.resolvedType,
      valuesByMode,
    });
  }

  const collectionInfos: CollectionInfo[] = [...collections.values()].map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    remote: c.remote,
    defaultModeId: c.defaultModeId,
    variableCount: c.variableIds.length,
    ...(c.modes ? { modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })) } : {}),
  }));

  // ── Components ──────────────────────────────────────────────────────────
  const components: ComponentInfo[] = [...mains.values()].map((c) => ({
    ...mainComponentRef(c),
    setId: c.parent?.type === 'COMPONENT_SET' ? c.parent.id : undefined,
    // Library components are fingerprinted so local copies of them can be spotted.
    structureSignature: c.remote ? safeSignature(c) : undefined,
    width: c.width,
    height: c.height,
  }));
  await Promise.all(
    [...detachedLocalIds].filter((id) => !mains.has(id)).map(async (id) => {
      const n = await figma.getNodeByIdAsync(id).catch(() => null);
      if (n?.type === 'COMPONENT') components.push(mainComponentRef(n));
    }),
  );

  return {
    collections: collectionInfos,
    variables: variableInfos,
    textStyles: [...textStyles.values()].map(toTextStyleInfo),
    paintStyles: paintStyleInfos,
    components,
  };
}

export function isAlias(v: VariableValue): v is VariableAlias {
  return typeof v === 'object' && v !== null && 'type' in v && v.type === 'VARIABLE_ALIAS';
}

function safeSignature(c: ComponentNode): string | undefined {
  try {
    return buildStructureSignature(toStructure(c));
  } catch {
    return undefined;
  }
}

export function toTextStyleInfo(s: TextStyle): TextStyleInfo {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    remote: s.remote,
    fontFamily: s.fontName.family,
    fontStyle: s.fontName.style,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: s.lineHeight.unit, value: s.lineHeight.value },
    letterSpacing: { unit: s.letterSpacing.unit, value: s.letterSpacing.value },
  };
}

export function toPaintStyleInfo(s: PaintStyle): PaintStyleInfo {
  const visible = s.paints.filter((p) => p.visible !== false);
  const info: PaintStyleInfo = { id: s.id, key: s.key, name: s.name, remote: s.remote };
  if (visible.length === 1 && visible[0].type === 'SOLID') {
    const p = readPaint(visible[0]);
    info.color = p.color;
    info.boundVariableId = p.boundVariableId;
  }
  return info;
}
