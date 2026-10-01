// "Save this file as a design system": capture a complete reference from the design system's own
// file, where every style, variable and component is local and readable.
//
// Published assets are recorded by their published key (how every other file sees them);
// unpublished ones by their id in this file. Values are captured so that files which can't read
// an asset can still be checked against it (src/engine/prepareReference.ts). Read-only: nothing in
// the file is changed or imported.

import { refFor, type AssetRef } from '../shared/designSystem';
import { newReferenceId, type CapturedValue, type DesignSystemReference, type ReferenceCollection } from '../shared/reference';
import type { RGBA } from '../shared/types';
import { isAlias, toPaintStyleInfo, toTextStyleInfo } from './designSystemData';
import { mainComponentRef } from './snapshot';

const MAX_ALIAS_DEPTH = 10;

interface Publishable {
  id: string;
  key: string;
  getPublishStatusAsync(): Promise<PublishStatus>;
}

/** Library ref when published (other files see it by key); local ref otherwise. */
async function refOf(asset: Publishable, name: string): Promise<AssetRef> {
  const status = await asset.getPublishStatusAsync().catch(() => 'UNPUBLISHED' as const);
  return status === 'UNPUBLISHED' ? { source: 'local', id: asset.id, name } : { source: 'library', key: asset.key, name };
}

export async function captureCurrentFile(opts: { spacingScale: number[]; radiusScale: number[] }): Promise<DesignSystemReference> {
  const [textStyles, paintStyles, collections, variables] = await Promise.all([
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]);
  // Components can live on any page; with dynamic page loading they must be loaded first.
  await figma.loadAllPagesAsync();
  const components = figma.root.findAllWithCriteria({ types: ['COMPONENT'] });

  const byId = new Map(variables.map((v) => [v.id, v]));
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  /** Aliases are followed in the target collection's default mode, as the audit does. */
  const resolve = async (value: VariableValue, depth: number): Promise<CapturedValue> => {
    if (isAlias(value)) {
      if (depth >= MAX_ALIAS_DEPTH) return null;
      const target = byId.get(value.id) ?? (await figma.variables.getVariableByIdAsync(value.id).catch(() => null));
      if (!target) return null;
      const col = collectionById.get(target.variableCollectionId) ?? (await figma.variables.getVariableCollectionByIdAsync(target.variableCollectionId).catch(() => null));
      const modeId = col?.defaultModeId ?? Object.keys(target.valuesByMode)[0];
      return resolve(target.valuesByMode[modeId], depth + 1);
    }
    if (typeof value === 'object' && value && 'r' in value) return { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 } as RGBA;
    return value as number | string | boolean;
  };

  const variableCollections: ReferenceCollection[] = await Promise.all(
    collections.map(async (c) => {
      const items = await Promise.all(
        variables
          .filter((v) => v.variableCollectionId === c.id)
          .map(async (v) => {
            const valuesByMode: Record<string, CapturedValue> = {};
            for (const [modeId, value] of Object.entries(v.valuesByMode)) valuesByMode[modeId] = await resolve(value, 0);
            return { ref: await refOf(v, v.name), resolvedType: v.resolvedType as 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN', valuesByMode };
          }),
      );
      return {
        ref: await refOf(c, c.name),
        defaultModeId: c.defaultModeId,
        modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })),
        variables: items,
      };
    }),
  );

  const text = await Promise.all(
    textStyles.map(async (s) => {
      const { id: _id, key: _key, name: _name, remote: _remote, ...props } = toTextStyleInfo(s);
      return { ref: await refOf(s, s.name), props };
    }),
  );
  const paint = await Promise.all(
    paintStyles.map(async (s) => {
      const info = toPaintStyleInfo(s);
      return { ref: await refOf(s, s.name), ...(info.color ? { color: info.color } : {}) };
    }),
  );
  const comps = await Promise.all(
    components.map(async (c) => {
      const named = mainComponentRef(c);
      return { ref: (await c.getPublishStatusAsync().catch(() => 'UNPUBLISHED')) === 'UNPUBLISHED' ? refFor(named) : ({ source: 'library', key: c.key, name: named.name } as AssetRef) };
    }),
  );

  const anyPublished = [...variableCollections.map((c) => c.ref), ...text.map((t) => t.ref), ...paint.map((p) => p.ref), ...comps.map((c) => c.ref)].some(
    (r) => r.source === 'library',
  );

  return {
    schema: 1,
    id: newReferenceId(),
    name: figma.root.name,
    source: { kind: anyPublished ? 'library-file' : 'file-local', fileName: figma.root.name },
    capturedAt: new Date().toISOString(),
    variableCollections,
    textStyles: text,
    paintStyles: paint,
    components: comps,
    spacingScale: opts.spacingScale,
    radiusScale: opts.radiusScale,
    alsoAccept: { textStyles: { library: false, local: false }, paintStyles: { library: false, local: false }, components: { library: false, local: false } },
  };
}
