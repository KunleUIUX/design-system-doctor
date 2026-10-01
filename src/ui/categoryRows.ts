import { CATEGORY_ORDER, type AuditCategory, type AuditResult } from '../shared/types';

export interface CategoryRow {
  category: AuditCategory;
  error: number;
  warning: number;
  review: number;
  unverifiable: number;
  /** Scored checks in this category; 0 on results saved before this was recorded. */
  checks: number;
  /** Checked, and nothing to report: every check passed. */
  allPassed: boolean;
}

/**
 * Rows for the results screen: every category with findings (as before), plus categories that
 * were checked and fully passed, so "nothing listed" can't be mistaken for "not checked".
 */
export function categoryRows(result: Pick<AuditResult, 'issues' | 'checksByCategory'>): CategoryRow[] {
  return CATEGORY_ORDER.map((category) => {
    const row = { category, error: 0, warning: 0, review: 0, unverifiable: 0, checks: result.checksByCategory?.[category] ?? 0 };
    for (const i of result.issues) if (i.category === category) row[i.severity]++;
    const findings = row.error + row.warning + row.review + row.unverifiable;
    return { ...row, allPassed: findings === 0 && row.checks > 0 };
  }).filter((r) => r.allPassed || r.error + r.warning + r.review + r.unverifiable > 0);
}

export const allPassedLabel = (checks: number) => (checks === 1 ? 'The 1 check passed' : `All ${checks} checks passed`);
