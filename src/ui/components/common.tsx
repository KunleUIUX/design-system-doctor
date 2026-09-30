import type { ComponentChildren } from 'preact';
import type { AuditResult, Severity } from '../../shared/types';

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ComponentChildren }) {
  return (
    <header class="header">
      {onBack && (
        <button class="icon-btn" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      )}
      <h1>{title}</h1>
      <div class="header-right">{right}</div>
    </header>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Issue', warning: 'Warning', review: 'Review', unverifiable: 'Not verifiable' };

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span class={`dot dot-${severity}`} aria-label={SEVERITY_LABEL[severity]} />;
}

export function countBySeverity(issues: { severity: Severity }[]) {
  const c = { error: 0, warning: 0, review: 0, unverifiable: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

/** Freshness of the result on screen, as last reported by the main thread. */
export type FreshnessState = 'checking' | 'current' | 'changed' | 'unverified';

/** Shown on every result screen when the design moved on after the audit. */
export function StaleBanner({ freshness, onRerun }: { freshness: FreshnessState; onRerun: () => void }) {
  if (freshness !== 'changed' && freshness !== 'unverified') return null;
  return (
    <div class={`banner ${freshness === 'changed' ? 'warning' : 'neutral'} stale`} role="status">
      <span>
        {freshness === 'changed'
          ? <><strong>Design has changed since this audit.</strong> These results may be out of date.</>
          : 'This page is too large to confirm the results are still current.'}
      </span>
      <button class="link" onClick={onRerun}>Re-run audit</button>
    </div>
  );
}

/** Score coverage, from the number of applicable checks. The score itself is never hidden. */
export function ConfidenceNote({ result }: { result: AuditResult }) {
  const { confidence, opportunities, score } = result.compliance;
  if (score === null || confidence === 'normal') return null;
  return confidence === 'low' ? (
    <p class="confidence low" title="Very few properties could be checked, so this score says little about the page as a whole.">
      Low confidence · {plural(opportunities, 'applicable check')}
    </p>
  ) : (
    <p class="confidence high">Broad coverage · {plural(opportunities, 'applicable check')}</p>
  );
}

export function Affects({ affects }: { affects?: string[] }) {
  if (!affects || affects.length < 2) return null;
  return <span class="affects">Affects: {affects.join(' · ')}</span>;
}

export function Footer({ children }: { children: ComponentChildren }) {
  return <footer class="footer">{children}</footer>;
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The three count lines, worded so "checks" can't be mistaken for "layers":
 *   428 layers scanned / 22 applicable checks / 11 passed · 4 warnings · 7 issues
 * Outcome counts are per check: a check with an error counts once, however it failed.
 */
export function AuditCounts({ result }: { result: AuditResult }) {
  const c = result.compliance;
  return (
    <div class="audit-counts">
      <div>{plural(result.scannedNodeCount, 'layer')} scanned</div>
      <div title="One check per property a rule examined on those layers: a text style, a fill, a padding value, a corner radius, a component link…">
        {plural(c.opportunities, 'applicable check')}
      </div>
      <div class="muted">
        {c.passed.toLocaleString()} passed · {plural(c.warned, 'warning')} · {plural(c.errored, 'issue')}
      </div>
    </div>
  );
}

export function formatWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
