// The design-system definition: what the designer tells Doctor is authoritative, and how each
// source is identified so it survives saving, reopening and (where possible) moving between files.
//
// Identity rules (see docs/CONFIGURATION.md):
// - Library assets are identified by their library KEY. Keys are the same in every file that uses
//   the library. Their ids in a consuming file ("VariableID:<key>/1:4",
//   "VariableCollectionId:<key>/1:0", "S:<key>,1:26") are file-specific and are never stored.
// - Local assets only exist in one file; they are identified by their file id.

import type { DesignSystemConfig, SourceToggle } from './types';

export type AssetRef = { source: 'library'; key: string; name: string } | { source: 'local'; id: string; name: string };

/** Something Figma knows about in the current file, as seen by discovery or the audit. */
export interface AssetIdentity {
  id: string;
  key: string;
  name: string;
  remote: boolean;
}

export function refFor(asset: AssetIdentity): AssetRef {
  return asset.remote ? { source: 'library', key: asset.key, name: asset.name } : { source: 'local', id: asset.id, name: asset.name };
}

/** True when `ref` points at `asset` in this file. Library refs match by key, local refs by id. */
export function matchesRef(ref: AssetRef, asset: AssetIdentity): boolean {
  return ref.source === 'library' ? asset.remote && !!asset.key && asset.key === ref.key : !asset.remote && asset.id === ref.id;
}

export const sameRef = (a: AssetRef, b: AssetRef) =>
  a.source === b.source && (a.source === 'library' ? a.key === (b as typeof a).key : a.id === (b as { id: string }).id);

// ─── Migration from the v1 shape ────────────────────────────────────────────

interface DesignSystemConfigV1 {
  name: string;
  approvedCollectionIds: string[];
  textStyles: SourceToggle;
  paintStyles: SourceToggle;
  components: SourceToggle;
  spacingScale: number[];
  radiusScale: number[];
}

export function isV1(ds: unknown): ds is DesignSystemConfigV1 {
  return !!ds && typeof ds === 'object' && Array.isArray((ds as DesignSystemConfigV1).approvedCollectionIds);
}

/**
 * v1 stored consuming-file collection ids. They are turned into refs by looking each one up in
 * this file (`lookup`): library collections become key refs, local ones keep their id. An id that
 * can't be found is kept as a local ref so validation can tell the designer it no longer exists.
 */
export async function migrateDesignSystem(
  ds: DesignSystemConfig | DesignSystemConfigV1,
  lookup: (collectionId: string) => Promise<AssetIdentity | null>,
): Promise<DesignSystemConfig> {
  if (!isV1(ds)) return ds;
  const variableCollections: AssetRef[] = [];
  for (const id of ds.approvedCollectionIds) {
    const c = await lookup(id).catch(() => null);
    variableCollections.push(c ? refFor(c) : { source: 'local', id, name: 'Unknown collection' });
  }
  return {
    version: 2,
    name: ds.name,
    variableCollections,
    textStyles: { ...ds.textStyles, items: [] },
    paintStyles: ds.paintStyles,
    components: { ...ds.components, items: [] },
    spacingScale: ds.spacingScale,
    radiusScale: ds.radiusScale,
  };
}

// ─── Portability ─────────────────────────────────────────────────────────────

/**
 * The part of a design system that means the same thing in another file: library refs (by key),
 * "all library …" switches, scales and name. Local refs are dropped: their ids don't exist
 * elsewhere, and a same-looking id in another file would be a different asset.
 */
export function toPortable(ds: DesignSystemConfig): DesignSystemConfig {
  const lib = (refs: AssetRef[]) => refs.filter((r) => r.source === 'library');
  return {
    ...ds,
    variableCollections: lib(ds.variableCollections),
    textStyles: { ...ds.textStyles, local: false, items: lib(ds.textStyles.items) },
    paintStyles: { ...ds.paintStyles, local: false },
    components: { ...ds.components, local: false, items: lib(ds.components.items) },
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ScaleParse {
  values: number[];
  errors: string[];
}

/** Parses "0, 4, 8" into sorted numbers, with a specific message for each problem. */
export function parseScale(label: string, input: string): ScaleParse {
  const errors: string[] = [];
  const parts = input.split(/[\s,]+/).filter(Boolean);
  const values: number[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) errors.push(`${label} contains “${p}”, which isn’t a number.`);
    else if (n < 0) errors.push(`${label} contains a negative value: ${p}.`);
    else if (seen.has(n)) errors.push(`${label} contains duplicate value: ${n}.`);
    else {
      seen.add(n);
      values.push(n);
    }
  }
  return { values: values.sort((a, b) => a - b), errors };
}

export interface DiscoveredSources {
  collections: AssetIdentity[];
  textStyles: AssetIdentity[];
  components: AssetIdentity[];
}

export interface ValidationResult {
  /** Block saving. */
  errors: string[];
  /** Allowed, but the designer should know. */
  warnings: string[];
}

/**
 * Checks a design system against what this file can see. Local refs that don't exist are errors
 * (the asset is gone). Library refs that aren't found are warnings: the library may simply not be
 * used in this file yet, which the audit then reports as "Not verifiable" rather than guessing.
 */
export function validateDesignSystem(
  ds: DesignSystemConfig,
  scales: { spacing: ScaleParse; radius: ScaleParse },
  found: DiscoveredSources,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!ds.name.trim()) errors.push('Give the design system a name.');

  const anySource =
    ds.variableCollections.length > 0 ||
    ds.textStyles.library || ds.textStyles.local || ds.textStyles.items.length > 0 ||
    ds.components.library || ds.components.local || ds.components.items.length > 0 ||
    ds.paintStyles.library || ds.paintStyles.local || (ds.paintStyles.items?.length ?? 0) > 0;
  if (!anySource) errors.push('Choose at least one source: a variable collection, text styles or components.');

  const check = (refs: AssetRef[], available: AssetIdentity[], kind: string) => {
    for (const ref of refs) {
      if (available.some((a) => matchesRef(ref, a))) continue;
      if (ref.source === 'local') errors.push(`The ${kind} “${ref.name}” no longer exists in this file. Remove it or pick another.`);
      else warnings.push(`The library ${kind} “${ref.name}” isn’t used in this file yet, so Doctor can’t read it here. Checks that depend on it will show as “Not verifiable”.`);
    }
  };
  check(ds.variableCollections, found.collections, 'collection');
  check(ds.textStyles.items, found.textStyles, 'text style');
  check(ds.components.items, found.components, 'component');

  errors.push(...scales.spacing.errors, ...scales.radius.errors);
  if (!scales.spacing.errors.length && scales.spacing.values.length === 0) warnings.push('Spacing scale is empty, so spacing won’t be checked.');
  if (!scales.radius.errors.length && scales.radius.values.length === 0) warnings.push('Corner radius scale is empty, so corner radii won’t be checked.');
  return { errors, warnings };
}
