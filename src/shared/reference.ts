// The design system as ONE reference: the standard a page is audited against.
//
// A designer selects a design system as a whole ("Rayna UI", "Acme DS"); they don't rebuild it
// from individual assets. The reference lists what the design system contains and, when it was
// captured in the library's own file, the values of each asset. Live data from the audited file
// always wins; captured values are only a fallback, and are labelled as such. See
// src/engine/prepareReference.ts for how a reference becomes the engine's inputs.
//
// Identity follows src/shared/designSystem.ts: library assets by published key, local ones by id.

import { sameRef, type AssetRef } from './designSystem';
import type { DesignSystemConfig, RGBA, SourceToggle, TextProps } from './types';

export type ReferenceSourceKind =
  /** Captured in the design system's own (library) file: complete, with values. */
  | 'library-file'
  /** Captured from a file whose assets aren't published: local ids, only meaningful in that file. */
  | 'file-local'
  /** Built from the assets a page uses: partial, no captured values. */
  | 'in-use'
  /** Converted from the older selection-based settings: behaves exactly as before. */
  | 'migrated';

export type CapturedValue = RGBA | number | string | boolean | null;

export interface ReferenceVariable {
  ref: AssetRef;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  /** Library mode id → resolved value (aliases followed when captured). */
  valuesByMode: Record<string, CapturedValue>;
}

export interface ReferenceCollection {
  ref: AssetRef;
  defaultModeId?: string;
  modes?: { id: string; name: string }[];
  /** Captured variables. Absent when only the collection itself was selected. */
  variables?: ReferenceVariable[];
}

export interface DesignSystemReference {
  schema: 1;
  id: string;
  name: string;
  source: { kind: ReferenceSourceKind; fileName?: string };
  /** When values were captured (ISO). Captured findings are labelled with it. */
  capturedAt?: string;
  variableCollections: ReferenceCollection[];
  textStyles: { ref: AssetRef; props?: TextProps }[];
  paintStyles: { ref: AssetRef; color?: RGBA }[];
  components: { ref: AssetRef }[];
  spacingScale: number[];
  radiusScale: number[];
  /**
   * Also approve ANY asset from these origins, beyond those listed. Off for design systems created
   * now (the selected design system is the reference); kept from older settings so they behave
   * exactly as before.
   */
  alsoAccept: { textStyles: SourceToggle; paintStyles: SourceToggle; components: SourceToggle };
}

const NONE: SourceToggle = { library: false, local: false };

export function isReference(x: unknown): x is DesignSystemReference {
  return !!x && typeof x === 'object' && (x as DesignSystemReference).schema === 1 && Array.isArray((x as DesignSystemReference).textStyles);
}

export function newReferenceId(): string {
  return `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Captured values exist, so assets this file can't read can still be compared. */
export const hasCapturedValues = (r: DesignSystemReference) => r.source.kind === 'library-file' || r.source.kind === 'file-local';

// ─── Selection (the settings screen's shape) ⇄ reference ────────────────────

/**
 * The reference as the older selection shape the settings screen edits and the resolver approves
 * against. For a migrated reference this reproduces the original settings exactly, key order
 * included (the audit fingerprint is computed from it).
 */
export function toSelection(r: DesignSystemReference): DesignSystemConfig {
  return {
    version: 2,
    name: r.name,
    variableCollections: r.variableCollections.map((c) => c.ref),
    textStyles: { library: r.alsoAccept.textStyles.library, local: r.alsoAccept.textStyles.local, items: r.textStyles.map((t) => t.ref) },
    paintStyles: r.paintStyles.length
      ? { library: r.alsoAccept.paintStyles.library, local: r.alsoAccept.paintStyles.local, items: r.paintStyles.map((p) => p.ref) }
      : { library: r.alsoAccept.paintStyles.library, local: r.alsoAccept.paintStyles.local },
    components: { library: r.alsoAccept.components.library, local: r.alsoAccept.components.local, items: r.components.map((c) => c.ref) },
    spacingScale: r.spacingScale,
    radiusScale: r.radiusScale,
  };
}

/** A NEW design system from a selection (e.g. "create from what this page uses"). Nothing is carried over. */
export function referenceFromSelection(sel: DesignSystemConfig, kind: ReferenceSourceKind, id = newReferenceId()): DesignSystemReference {
  return {
    schema: 1,
    id,
    name: sel.name,
    source: { kind },
    variableCollections: sel.variableCollections.map((ref) => ({ ref })),
    textStyles: sel.textStyles.items.map((ref) => ({ ref })),
    paintStyles: (sel.paintStyles.items ?? []).map((ref) => ({ ref })),
    components: sel.components.items.map((ref) => ({ ref })),
    spacingScale: sel.spacingScale,
    radiusScale: sel.radiusScale,
    alsoAccept: {
      textStyles: { library: sel.textStyles.library, local: sel.textStyles.local },
      paintStyles: { library: sel.paintStyles.library, local: sel.paintStyles.local },
      components: { library: sel.components.library, local: sel.components.local },
    },
  };
}

/**
 * EDIT the active design system with what the settings screen saved. Same id and source; items
 * kept keep their captured values, removed ones are dropped, added ones have none.
 */
export function applySelection(r: DesignSystemReference, sel: DesignSystemConfig): DesignSystemReference {
  const keep = <T extends { ref: AssetRef }>(existing: T[], refs: AssetRef[]): T[] =>
    refs.map((ref) => existing.find((e) => sameRef(e.ref, ref)) ?? ({ ref } as T));
  const next = referenceFromSelection(sel, r.source.kind, r.id);
  return {
    ...next,
    source: r.source,
    ...(r.capturedAt ? { capturedAt: r.capturedAt } : {}),
    variableCollections: keep(r.variableCollections, sel.variableCollections),
    textStyles: keep(r.textStyles, sel.textStyles.items),
    paintStyles: keep(r.paintStyles, sel.paintStyles.items ?? r.paintStyles.map((p) => p.ref)),
    components: keep(r.components, sel.components.items),
  };
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Older selection-based settings → a reference that behaves identically: same listed items, same
 * "all from your libraries / this file" switches (kept as alsoAccept), same scales. The id is
 * derived from the content, so reopening a file never creates a second copy.
 */
export function migrateToReference(ds: DesignSystemConfig): DesignSystemReference {
  return referenceFromSelection(ds, 'migrated', `migrated-${hash(JSON.stringify(ds))}`);
}

export const emptyAlsoAccept = () => ({ textStyles: { ...NONE }, paintStyles: { ...NONE }, components: { ...NONE } });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2 Oct 2026", the same in every locale. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Where a design system came from, in the user's words (no capture/reference/key terminology). */
export function describeSource(r: DesignSystemReference): string {
  const day = r.capturedAt ? ` · ${formatDay(r.capturedAt)}` : '';
  switch (r.source.kind) {
    case 'library-file': return `Saved from ${r.source.fileName ?? 'a library file'}${day}`;
    case 'file-local': return `Only works in ${r.source.fileName ?? 'the file it was saved from'}`;
    case 'in-use': return 'Created from a page';
    case 'migrated': return 'Saved settings';
  }
}

export function countItems(r: DesignSystemReference) {
  return {
    collections: r.variableCollections.length,
    variables: r.variableCollections.reduce((n, c) => n + (c.variables?.length ?? 0), 0),
    textStyles: r.textStyles.length,
    paintStyles: r.paintStyles.length,
    components: r.components.length,
  };
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
