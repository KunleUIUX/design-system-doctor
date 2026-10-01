// User-facing presentation of design-system state, kept out of the components so it can be tested.
// Internal terms (captured / live / unavailable / coverage / references) never leave this module
// as text: the UI says "saved reference" and "couldn't be checked in this file".

import { formatDay } from '../shared/reference';
import type { AuditResult, CoverageCount } from '../shared/types';

/** Suffix prepareReference adds to the names of assets taken from a saved reference. */
const SAVED_SUFFIX = ' (captured)';

/** A finding value with the saved-reference marker taken out, and whether it was there. */
export function splitSavedReference(text: string): { text: string; saved: boolean } {
  if (!text.includes(SAVED_SUFFIX)) return { text, saved: false };
  return { text: text.split(SAVED_SUFFIX).join(''), saved: true };
}

/** "Saved reference · 2 Oct 2026" for the tag on findings that relied on a saved reference. */
export function savedReferenceLabel(result: Pick<AuditResult, 'coverage'>): string {
  const at = result.coverage?.capturedAt;
  return at ? `Saved reference · ${formatDay(at)}` : 'Saved reference';
}

const notVerifiableCount = (result: Pick<AuditResult, 'issues'>) => result.issues.filter((i) => i.severity === 'unverifiable').length;

type Audited = Pick<AuditResult, 'designSystemName' | 'designSystemId'>;
type Selected = { id: string; name: string } | null | undefined;

/** Was this audit run with the selected design system? By id when known, so a rename doesn't matter. */
export function auditedWith(result: Audited, selected: Selected): boolean {
  if (!selected) return false;
  return result.designSystemId ? result.designSystemId === selected.id : result.designSystemName === selected.name;
}

/** The name to show for the design system an audit was checked against: today's name if it's been renamed since. */
export function auditedName(result: Audited, selected: Selected): string {
  return selected && auditedWith(result, selected) ? selected.name : result.designSystemName;
}

/**
 * Where the design-system screen goes once a system has been selected: on to its settings when
 * "Edit settings" was chosen for exactly that system, otherwise home.
 */
export function afterSelect(pendingEditId: string | null, selectedId: string | undefined): 'edit' | 'home' {
  return pendingEditId !== null && pendingEditId === selectedId ? 'edit' : 'home';
}

/**
 * The one-word state shown under the design system on Home. Based on the last audit of this page
 * with this design system; without one there's nothing to say yet, so it's "Ready".
 */
export function homeStatus(selected: { id: string; name: string }, last: (Pick<AuditResult, 'issues'> & Audited) | null): 'Ready' | 'Some checks may be unavailable' {
  if (last && auditedWith(last, selected) && notVerifiableCount(last) > 0) return 'Some checks may be unavailable';
  return 'Ready';
}

export interface ReferenceDetailRow {
  label: string;
  parts: string[];
}

export interface ReferenceSummary {
  /** `partial`: some checks are Not verifiable. `saved`: a saved reference filled gaps. `full`: nothing to add. */
  kind: 'full' | 'saved' | 'partial';
  /** "Saved reference · 2 Oct 2026" date part, when one was used. */
  savedOn?: string;
  /** Category-level breakdown, behind "Details". */
  details: ReferenceDetailRow[];
  /** Names of listed items this file couldn't read at all. */
  missing: string[];
}

export function referenceSummary(result: Pick<AuditResult, 'issues' | 'coverage' | 'unresolvedSources'>): ReferenceSummary {
  const c = result.coverage;
  const rows: [string, CoverageCount | undefined][] = [
    ['Text styles', c?.textStyles],
    ['Variables', c?.tokens],
    ['Colour styles', c?.paintStyles],
    ['Components', c?.components],
  ];
  const details = rows
    .filter((r): r is [string, CoverageCount] => !!r[1] && r[1].total > 0)
    .map(([label, n]) => ({
      label,
      parts: [
        n.live ? `${n.live} checked in this file` : '',
        n.captured ? `${n.captured} from the saved reference` : '',
        n.unavailable ? `${n.unavailable} couldn’t be checked here` : '',
      ].filter(Boolean),
    }));
  const usedSaved = rows.some(([, n]) => (n?.captured ?? 0) > 0);
  const kind = notVerifiableCount(result) > 0 ? 'partial' : usedSaved ? 'saved' : 'full';
  return {
    kind,
    ...(usedSaved && c?.capturedAt ? { savedOn: formatDay(c.capturedAt) } : {}),
    details,
    missing: (result.unresolvedSources ?? []).map((s) => s.name),
  };
}
