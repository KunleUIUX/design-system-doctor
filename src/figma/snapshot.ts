// Reads Figma nodes into plain NodeSnapshots in a single traversal.
// This file and designSystemData.ts are the only places that read the document.

import { buildStructureSignature, type StructureNode } from '../engine/signature';
import type {
  LayoutSnapshot,
  MainComponentRef,
  NodeSnapshot,
  PaintSnapshot,
  RadiusField,
  RadiusSnapshot,
  SpacingField,
  TextSegmentSnapshot,
} from '../shared/types';

/** Types whose own properties are audited. Groups, sections and sets are traversed only. */
const AUDITED_TYPES = new Set([
  'FRAME', 'COMPONENT', 'INSTANCE', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'TEXT', 'BOOLEAN_OPERATION',
]);
const RADIUS_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'RECTANGLE']);

export interface TraversalOptions {
  includeHidden: boolean;
  /** Called every YIELD_EVERY nodes; return false to cancel. */
  onProgress: (scanned: number) => boolean;
  deadline: number;
}

export interface TraversalResult {
  nodes: NodeSnapshot[];
  scanned: number;
  hiddenSkipped: number;
  failed: number;
  /** Main components of instances, keyed by component id, for the resolver. */
  mainComponents: Map<string, ComponentNode>;
}

export class AuditCancelled extends Error {}
export class AuditTimedOut extends Error {}

const YIELD_EVERY = 250;
const yieldToFigma = () => new Promise<void>((r) => setTimeout(r, 0));

interface Frame {
  node: SceneNode;
  path: string[];
  /** Override maps of enclosing instances (outermost first). */
  overrides: Map<string, string[]>[];
  insideInstance: boolean;
}

/** Cheap pre-count used for progress and the large-page prompt. */
export function countLayers(roots: readonly SceneNode[], includeHidden: boolean): number {
  let count = 0;
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (!includeHidden && !n.visible) continue;
    count++;
    if ('children' in n) for (const c of n.children) stack.push(c);
  }
  return count;
}

export async function snapshotTree(roots: readonly SceneNode[], opts: TraversalOptions): Promise<TraversalResult> {
  const nodes: NodeSnapshot[] = [];
  const instances: { node: InstanceNode; snap: NodeSnapshot }[] = [];
  let scanned = 0, hiddenSkipped = 0, failed = 0;

  // Reverse so the pop order matches layer order (top of the page first).
  const stack: Frame[] = [...roots].reverse().map((node) => ({ node, path: [], overrides: [], insideInstance: false }));

  while (stack.length) {
    const { node, path, overrides, insideInstance } = stack.pop()!;
    if (!opts.includeHidden && !node.visible) {
      hiddenSkipped++;
      continue;
    }
    scanned++;
    if (scanned % YIELD_EVERY === 0) {
      if (Date.now() > opts.deadline) throw new AuditTimedOut();
      await yieldToFigma();
      if (!opts.onProgress(scanned)) throw new AuditCancelled();
    }

    let ownOverrides = overrides;
    try {
      if (node.type === 'INSTANCE') {
        const map = new Map<string, string[]>();
        for (const o of node.overrides) map.set(o.id, o.overriddenFields as string[]);
        ownOverrides = [...overrides, map];
      }
      if (AUDITED_TYPES.has(node.type)) {
        const snap = readNode(node, path, ownOverrides, insideInstance);
        nodes.push(snap);
        if (node.type === 'INSTANCE') instances.push({ node, snap });
      }
    } catch (e) {
      failed++;
      console.warn('[Design System Doctor] could not read', node.id, e);
    }

    if ('children' in node) {
      const childPath = [...path, node.name];
      const childInside = insideInstance || node.type === 'INSTANCE';
      // Read `children` once: every access builds a fresh array of node wrappers (~26 ms for a
      // 3,600-child frame), so indexing it inside the loop made wide frames O(n²).
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], path: childPath, overrides: ownOverrides, insideInstance: childInside });
      }
    }
  }

  const mainComponents = await resolveMainComponents(instances, opts);
  return { nodes, scanned, hiddenSkipped, failed, mainComponents };
}

function readNode(node: SceneNode, path: string[], overrides: Map<string, string[]>[], insideInstance: boolean): NodeSnapshot {
  const snap: NodeSnapshot = { id: node.id, name: node.name, type: node.type, path, insideInstance, variableModes: {} };

  if (overrides.length) {
    const fields = new Set<string>();
    for (const map of overrides) for (const f of map.get(node.id) ?? []) fields.add(f);
    snap.instanceOverrides = [...fields];
  }

  let hasSolidPaint = false;
  if (node.type === 'TEXT') {
    snap.text = readText(node);
    hasSolidPaint = snap.text.some((s) => s.fills.some((p) => p.type === 'SOLID'));
  } else if ('fills' in node && node.fills !== figma.mixed) {
    snap.fills = node.fills.map(readPaint);
    snap.fillStyleId = typeof node.fillStyleId === 'string' ? node.fillStyleId : '';
    hasSolidPaint = snap.fills.some((p) => p.type === 'SOLID');
  }
  if ('strokes' in node && node.strokes.length) {
    snap.strokes = node.strokes.map(readPaint);
    snap.strokeStyleId = node.strokeStyleId;
    hasSolidPaint = hasSolidPaint || snap.strokes.some((p) => p.type === 'SOLID');
  }
  // Only needed to pick the right token mode for colours; skip the lookup otherwise.
  if (hasSolidPaint) snap.variableModes = { ...node.resolvedVariableModes };

  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') && node.layoutMode !== 'NONE') {
    snap.layout = readLayout(node);
  }
  if (RADIUS_TYPES.has(node.type)) snap.radius = readRadius(node as RectangleNode | FrameNode);

  if (node.type === 'FRAME' && node.detachedInfo) {
    const d = node.detachedInfo;
    snap.detached = d.type === 'local' ? { type: 'local', componentId: d.componentId } : { type: 'library', componentKey: d.componentKey };
  }
  if (node.type === 'INSTANCE') snap.instance = { main: null }; // filled in by resolveMainComponents
  if (node.type === 'COMPONENT') {
    const inSet = node.parent?.type === 'COMPONENT_SET';
    snap.component = {
      key: node.key,
      structureSignature: buildStructureSignature(toStructure(node)),
      width: node.width,
      height: node.height,
      setId: inSet ? node.parent!.id : undefined,
      setName: inSet ? node.parent!.name : undefined,
    };
  }
  return snap;
}

export function readPaint(p: Paint): PaintSnapshot {
  if (p.type !== 'SOLID') return { type: 'OTHER', visible: p.visible !== false };
  return {
    type: 'SOLID',
    visible: p.visible !== false,
    color: { r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 },
    boundVariableId: p.boundVariables?.color?.id,
  };
}

const PREVIEW_CHARS = 24;

function readText(node: TextNode): TextSegmentSnapshot[] {
  const segments = node.getStyledTextSegments([
    'textStyleId', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills', 'fillStyleId',
  ]);
  return segments.map((s) => {
    const chars = s.characters.replace(/\s+/g, ' ').trim();
    return {
      start: s.start,
      end: s.end,
      characters: chars.length > PREVIEW_CHARS ? chars.slice(0, PREVIEW_CHARS - 1) + '…' : chars,
      textStyleId: s.textStyleId ?? '',
      fills: s.fills.map(readPaint),
      fillStyleId: s.fillStyleId ?? '',
      fontFamily: s.fontName.family,
      fontStyle: s.fontName.style,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: s.lineHeight.unit, value: s.lineHeight.value },
      letterSpacing: { unit: s.letterSpacing.unit, value: s.letterSpacing.value },
    };
  });
}

function boundId(node: SceneNode, field: string): string | undefined {
  const bv = (node as SceneNode & { boundVariables?: Record<string, VariableAlias | VariableAlias[] | undefined> }).boundVariables;
  const alias = bv?.[field];
  return alias && !Array.isArray(alias) ? alias.id : undefined;
}

function readLayout(node: FrameNode | ComponentNode | InstanceNode): LayoutSnapshot {
  const fields: SpacingField[] = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
  if (node.layoutMode === 'GRID') {
    fields.push('gridRowGap', 'gridColumnGap');
  } else {
    const visibleChildren = node.children.filter((c) => c.visible && !('layoutPositioning' in c && c.layoutPositioning === 'ABSOLUTE'));
    // "Space between" computes the gap, and a gap between fewer than two children does nothing.
    if (node.primaryAxisAlignItems !== 'SPACE_BETWEEN' && visibleChildren.length > 1) fields.push('itemSpacing');
    if (node.layoutWrap === 'WRAP' && node.counterAxisSpacing !== null && node.counterAxisAlignContent !== 'SPACE_BETWEEN') {
      fields.push('counterAxisSpacing');
    }
  }
  const values: LayoutSnapshot['values'] = {};
  const boundVariables: LayoutSnapshot['boundVariables'] = {};
  for (const f of fields) {
    values[f] = (node as unknown as Record<SpacingField, number>)[f];
    const id = boundId(node, f);
    if (id) boundVariables[f] = id;
  }
  return { mode: node.layoutMode as LayoutSnapshot['mode'], values, boundVariables };
}

function readRadius(node: RectangleNode | FrameNode): RadiusSnapshot {
  const values: RadiusSnapshot['values'] = {};
  const boundVariables: RadiusSnapshot['boundVariables'] = {};
  const fields: RadiusField[] =
    node.cornerRadius === figma.mixed ? ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'] : ['cornerRadius'];
  for (const f of fields) {
    values[f] = (node as unknown as Record<RadiusField, number>)[f];
    // A uniform radius bound to a variable may be reported on the individual corners.
    const id = boundId(node, f) ?? (f === 'cornerRadius' ? boundId(node, 'topLeftRadius') : undefined);
    if (id) boundVariables[f] = id;
  }
  return { values, boundVariables, width: node.width, height: node.height };
}

export function toStructure(node: SceneNode): StructureNode {
  return {
    type: node.type,
    layoutMode: 'layoutMode' in node && node.layoutMode !== 'NONE' ? node.layoutMode : undefined,
    children: 'children' in node ? node.children.map(toStructure) : undefined,
  };
}

export function mainComponentRef(c: ComponentNode): MainComponentRef {
  const inSet = c.parent?.type === 'COMPONENT_SET';
  return { id: c.id, key: c.key, name: inSet ? `${c.parent!.name} / ${c.name}` : c.name, remote: c.remote };
}

const PARALLEL = 100;

async function resolveMainComponents(
  instances: { node: InstanceNode; snap: NodeSnapshot }[],
  opts: TraversalOptions,
): Promise<Map<string, ComponentNode>> {
  const mains = new Map<string, ComponentNode>();
  for (let i = 0; i < instances.length; i += PARALLEL) {
    if (Date.now() > opts.deadline) throw new AuditTimedOut();
    const batch = instances.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(({ node }) => node.getMainComponentAsync().catch(() => null)));
    results.forEach((main, j) => {
      if (!main) return;
      mains.set(main.id, main);
      batch[j].snap.instance = { main: mainComponentRef(main) };
    });
  }
  return mains;
}
