import { describe, expect, it } from 'vitest';
import { afterSelect, auditedName, homeStatus, referenceSummary, savedReferenceLabel, splitSavedReference } from '../src/ui/presentation';
import type { AuditIssue, CoverageCount, ReferenceCoverage } from '../src/shared/types';

const count = (c: Partial<CoverageCount> = {}): CoverageCount => ({ total: 0, live: 0, captured: 0, unavailable: 0, ...c });
const coverage = (over: Partial<ReferenceCoverage> = {}): ReferenceCoverage => ({
  sourceKind: 'library-file', capturedAt: '2026-10-02T09:00:00.000Z',
  textStyles: count(), tokens: count(), paintStyles: count(), components: count(), ...over,
});
const issue = (severity: AuditIssue['severity']) => ({ severity }) as AuditIssue;

describe('saved reference tag', () => {
  it('takes the internal marker out of the value and reports that a saved reference was used', () => {
    expect(splitSavedReference('color/text/primary (captured)')).toEqual({ text: 'color/text/primary', saved: true });
    expect(splitSavedReference('One of: Body (captured), Caption (captured)')).toEqual({ text: 'One of: Body, Caption', saved: true });
    expect(splitSavedReference('color/brand/primary')).toEqual({ text: 'color/brand/primary', saved: false });
  });

  it('labels it with the saved date', () => {
    expect(savedReferenceLabel({ coverage: coverage() })).toBe('Saved reference · 2 Oct 2026');
    expect(savedReferenceLabel({})).toBe('Saved reference');
  });
});

describe('home status', () => {
  const acme = { id: 'ds-acme', name: 'Acme' };
  it('is Ready unless the last audit with this design system had checks it couldn’t do', () => {
    expect(homeStatus(acme, null)).toBe('Ready');
    expect(homeStatus(acme, { designSystemId: 'ds-acme', designSystemName: 'Acme', issues: [issue('error')] })).toBe('Ready');
    expect(homeStatus(acme, { designSystemId: 'ds-acme', designSystemName: 'Acme', issues: [issue('unverifiable')] })).toBe('Some checks may be unavailable');
    expect(homeStatus(acme, { designSystemId: 'ds-rayna', designSystemName: 'Rayna UI', issues: [issue('unverifiable')] })).toBe('Ready');
  });

  it('still recognises the audit after the design system is renamed, and older results by name', () => {
    const renamed = { id: 'ds-acme', name: 'Acme Design System' };
    expect(homeStatus(renamed, { designSystemId: 'ds-acme', designSystemName: 'Acme', issues: [issue('unverifiable')] })).toBe('Some checks may be unavailable');
    expect(homeStatus(acme, { designSystemName: 'Acme', issues: [issue('unverifiable')] })).toBe('Some checks may be unavailable');
  });
});

describe('checked against', () => {
  it('shows the current name of a renamed design system, and the audited name otherwise', () => {
    const result = { designSystemId: 'ds-rayna', designSystemName: 'Rayna UI' };
    expect(auditedName(result, { id: 'ds-rayna', name: 'Rayna Design System' })).toBe('Rayna Design System');
    expect(auditedName(result, { id: 'ds-m3', name: 'Material 3' })).toBe('Rayna UI'); // a different system is selected now
    expect(auditedName(result, null)).toBe('Rayna UI');
    expect(auditedName({ designSystemName: 'Rayna UI' }, { id: 'ds-rayna', name: 'Rayna Design System' })).toBe('Rayna UI'); // older result: no id
  });
});

describe('edit settings for another saved system', () => {
  it('opens the settings only once that exact system is the selected one', () => {
    expect(afterSelect('ds-m3', 'ds-m3')).toBe('edit');
    expect(afterSelect('ds-m3', 'ds-rayna')).toBe('home'); // a different system got selected: never edit the wrong one
    expect(afterSelect('ds-m3', undefined)).toBe('home');
    expect(afterSelect(null, 'ds-m3')).toBe('home'); // plain selection
  });
});

describe('results: what was checked against', () => {
  it('says nothing extra when everything was read in the file', () => {
    const s = referenceSummary({ issues: [issue('error')], coverage: coverage({ textStyles: count({ total: 2, live: 2 }) }) });
    expect(s.kind).toBe('full');
  });

  it('notes a saved reference, with the date and a plain breakdown', () => {
    const s = referenceSummary({ issues: [], coverage: coverage({ textStyles: count({ total: 3, live: 1, captured: 2 }) }) });
    expect(s).toMatchObject({ kind: 'saved', savedOn: '2 Oct 2026', details: [{ label: 'Text styles', parts: ['1 checked in this file', '2 from the saved reference'] }] });
  });

  it('is partial when some checks were Not verifiable, and names what was missing', () => {
    const s = referenceSummary({
      issues: [issue('unverifiable')],
      coverage: coverage({ sourceKind: 'in-use', capturedAt: undefined, textStyles: count({ total: 2, unavailable: 2 }) }),
      unresolvedSources: [{ source: 'library', key: 'k', name: 'Caption' }],
    });
    expect(s).toMatchObject({ kind: 'partial', missing: ['Caption'], details: [{ label: 'Text styles', parts: ['2 couldn’t be checked here'] }] });
    expect(JSON.stringify(s)).not.toMatch(/captured|coverage|unavailable|approved source/i);
  });
});
