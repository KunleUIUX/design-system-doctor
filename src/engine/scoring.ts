import type { ScoreBreakdown, Severity } from '../shared/types';

export interface ScoredCheck {
  /** Opportunity key: one (node, property) pair. */
  key: string;
  severity?: Severity;
}

type Scored = Exclude<Severity, 'review' | 'unverifiable'> | 'pass';

export const SEVERITY_CREDIT: Record<Scored, number> = { pass: 1, warning: 0.5, error: 0 };

export const SCORE_FORMULA =
  'Each checked property scores 1 if it passes, 0.5 with a warning, 0 with an error. ' +
  'Compliance is the average across every checked property. Hidden and unreadable layers, items marked for review, and checks that couldn’t be verified are not counted.';

/**
 * Sample-size bands, not statistics: under LOW checks the score says little about the page as a
 * whole; from HIGH up it covers a substantial part of it.
 */
export const CONFIDENCE_THRESHOLDS = { low: 10, high: 100 } as const;

export function confidenceFor(opportunities: number): ScoreBreakdown['confidence'] {
  if (opportunities < CONFIDENCE_THRESHOLDS.low) return 'low';
  return opportunities >= CONFIDENCE_THRESHOLDS.high ? 'high' : 'normal';
}

/**
 * Deterministic compliance score. A property checked by several rules takes its worst result,
 * so one bad value can't be counted twice. No checked properties → no score (never a fake 100%).
 * `review` checks are ignored: they are neither passes nor violations.
 */
export function computeCompliance(checks: ScoredCheck[]): ScoreBreakdown {
  const worst = new Map<string, Scored>();
  const rank: Record<Scored, number> = { pass: 0, warning: 1, error: 2 };
  for (const c of checks) {
    if (c.severity === 'review' || c.severity === 'unverifiable') continue;
    const s: Scored = c.severity ?? 'pass';
    const prev = worst.get(c.key);
    if (!prev || rank[s] > rank[prev]) worst.set(c.key, s);
  }
  let credit = 0;
  let passed = 0, warned = 0, errored = 0;
  for (const s of worst.values()) {
    credit += SEVERITY_CREDIT[s];
    if (s === 'pass') passed++;
    else if (s === 'warning') warned++;
    else errored++;
  }
  const n = worst.size;
  return {
    // Floor so a page with any error never rounds up to 100%.
    score: n === 0 ? null : Math.floor((credit / n) * 100),
    opportunities: n,
    passed,
    warned,
    errored,
    formula: SCORE_FORMULA,
    confidence: confidenceFor(n),
  };
}
