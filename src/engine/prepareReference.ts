// Selected design system → the existing engine's inputs.
//
//   DesignSystemReference ─┐
//                          ├─► prepareReference ─► { designSystem (approvals), data, coverage } ─► resolver → rules
//   live DesignSystemData ─┘
//
// For every asset the design system lists:
//   1. readable in this file      → use the live asset (live always wins);
//   2. not readable, but captured → add the captured values to the data, named "… (captured)" so
//                                   any finding that relies on them says so;
//   3. neither                    → leave it out; the resolver reports it as unresolved and the
//                                   existing rules mark dependent checks "Not verifiable".
// Nothing is guessed: captured values are only matched by published key, and captured colour
// values are only applied in the mode they were captured in (matched by mode name).

import { matchesRef, refFor, type AssetIdentity, type AssetRef } from '../shared/designSystem';
import { hasCapturedValues, toSelection, type DesignSystemReference, type ReferenceCollection } from '../shared/reference';
import type {
  CollectionInfo,
  CoverageCount,
  DesignSystemConfig,
  DesignSystemData,
  ReferenceCoverage,
  VariableInfo,
} from '../shared/types';

/** Ids of assets added from captured values; never real Figma ids. */
export const CAPTURED_ID_PREFIX = 'captured:';
export const capturedName = (name: string) => `${name} (captured)`;

export interface PreparedReference {
  /** Approvals for the resolver, in the shape it already understands. */
  designSystem: DesignSystemConfig;
  /** Live data plus captured fallbacks. */
  data: DesignSystemData;
  coverage: ReferenceCoverage;
}

/**
 * The live asset a reference entry points at. Library entries match by key; inside the library's
 * own file the same asset is local but carries the same published key, so it matches too (keys
 * are unique, so a local asset in any other file can't collide).
 */
function findLive<T extends AssetIdentity>(ref: AssetRef, live: T[]): { asset: T; ref: AssetRef } | null {
  const direct = live.find((a) => matchesRef(ref, a));
  if (direct) return { asset: direct, ref };
  if (ref.source !== 'library') return null;
  const own = live.find((a) => !a.remote && !!a.key && a.key === ref.key);
  return own ? { asset: own, ref: refFor(own) } : null;
}

const counter = (): CoverageCount => ({ total: 0, live: 0, captured: 0, unavailable: 0 });

export function prepareReference(reference: DesignSystemReference, live: DesignSystemData): PreparedReference {
  const selection = toSelection(reference);
  const data: DesignSystemData = {
    collections: [...live.collections],
    variables: [...live.variables],
    textStyles: [...live.textStyles],
    paintStyles: [...live.paintStyles],
    components: [...live.components],
  };
  const captured = hasCapturedValues(reference);
  const coverage: ReferenceCoverage = {
    sourceKind: reference.source.kind,
    ...(reference.capturedAt ? { capturedAt: reference.capturedAt } : {}),
    textStyles: counter(),
    tokens: counter(),
    paintStyles: counter(),
    components: counter(),
  };

  // ── Text styles ─────────────────────────────────────────────────────────
  const textItems = reference.textStyles.map(({ ref, props }) => {
    coverage.textStyles.total++;
    const found = findLive(ref, live.textStyles);
    if (found) {
      coverage.textStyles.live++;
      return found.ref;
    }
    if (captured && props && ref.source === 'library') {
      data.textStyles.push({ id: `${CAPTURED_ID_PREFIX}${ref.key}`, key: ref.key, name: capturedName(ref.name), remote: true, ...props });
      coverage.textStyles.captured++;
    } else coverage.textStyles.unavailable++;
    return ref;
  });

  // ── Tokens (variable collections) ───────────────────────────────────────
  const collectionItems = reference.variableCollections.map((entry) => {
    coverage.tokens.total++;
    const found = findLive(entry.ref, live.collections);
    if (found) {
      coverage.tokens.live++;
      if (captured) supplementLiveCollection(entry, found.asset, data);
      return found.ref;
    }
    if (captured && entry.ref.source === 'library' && entry.variables?.length) {
      addCapturedCollection(entry, entry.ref.key, data);
      coverage.tokens.captured++;
    } else coverage.tokens.unavailable++;
    return entry.ref;
  });

  // ── Colour styles ───────────────────────────────────────────────────────
  // Rules only look up colour styles that are applied, which are live when readable, so captured
  // colours aren't used for these in this phase.
  const paintItems = reference.paintStyles.map(({ ref }) => {
    coverage.paintStyles.total++;
    const found = findLive(ref, live.paintStyles);
    if (found) coverage.paintStyles.live++;
    else coverage.paintStyles.unavailable++;
    return found ? found.ref : ref;
  });

  // ── Components ──────────────────────────────────────────────────────────
  // Approval is by key, so it never needs captured data; a captured name lets a detached library
  // component be named when no live instance of it is in scope.
  const componentItems = reference.components.map(({ ref }) => {
    coverage.components.total++;
    const found = findLive(ref, live.components);
    if (found) {
      coverage.components.live++;
      return found.ref;
    }
    if (captured && ref.source === 'library') {
      data.components.push({ id: `${CAPTURED_ID_PREFIX}${ref.key}`, key: ref.key, name: capturedName(ref.name), remote: true });
      coverage.components.captured++;
    } else coverage.components.unavailable++;
    return ref;
  });

  return {
    designSystem: {
      ...selection,
      variableCollections: collectionItems,
      textStyles: { ...selection.textStyles, items: textItems },
      paintStyles: reference.paintStyles.length ? { ...selection.paintStyles, items: paintItems } : selection.paintStyles,
      components: { ...selection.components, items: componentItems },
    },
    data,
    coverage,
  };
}

/** A captured-only collection: added whole, in its own captured default mode. */
function addCapturedCollection(entry: ReferenceCollection, key: string, data: DesignSystemData) {
  const id = `${CAPTURED_ID_PREFIX}${key}`;
  const defaultModeId = entry.defaultModeId ?? entry.modes?.[0]?.id ?? Object.keys(entry.variables?.[0]?.valuesByMode ?? {})[0] ?? '';
  const collection: CollectionInfo = {
    id,
    key,
    name: capturedName(entry.ref.name),
    remote: true,
    defaultModeId,
    variableCount: entry.variables!.length,
    ...(entry.modes ? { modes: entry.modes } : {}),
  };
  data.collections.push(collection);
  for (const v of entry.variables!) data.variables.push(capturedVariable(v, id, v.valuesByMode));
}

/**
 * A live collection only lists the variables this file has imported. Captured variables it lacks
 * are added, with values moved to this file's mode ids by mode NAME. Modes that can't be matched
 * by name are left out rather than guessed.
 */
function supplementLiveCollection(entry: ReferenceCollection, live: CollectionInfo, data: DesignSystemData) {
  if (!entry.variables?.length || !entry.modes?.length || !live.modes?.length) return;
  const modeMap = new Map<string, string>();
  for (const m of entry.modes) {
    const target = live.modes.find((l) => l.name === m.name);
    if (target) modeMap.set(m.id, target.id);
  }
  if (!modeMap.size) return;
  const present = new Set(data.variables.filter((v) => v.collectionId === live.id).map((v) => v.key));
  for (const v of entry.variables) {
    const key = v.ref.source === 'library' ? v.ref.key : '';
    if (!key || present.has(key)) continue;
    const values: VariableInfo['valuesByMode'] = {};
    for (const [modeId, value] of Object.entries(v.valuesByMode)) {
      const target = modeMap.get(modeId);
      if (target) values[target] = value;
    }
    if (Object.keys(values).length) data.variables.push(capturedVariable(v, live.id, values));
  }
}

function capturedVariable(v: NonNullable<ReferenceCollection['variables']>[number], collectionId: string, valuesByMode: VariableInfo['valuesByMode']): VariableInfo {
  const key = v.ref.source === 'library' ? v.ref.key : v.ref.id;
  return { id: `${CAPTURED_ID_PREFIX}${key}`, key, name: capturedName(v.ref.name), collectionId, remote: true, resolvedType: v.resolvedType, valuesByMode };
}
