import type { AuditScope } from '../../shared/messages';
import type { AuditConfig, AuditResult } from '../../shared/types';
import { ConfidenceNote, Footer, Header, SeverityDot, countBySeverity, formatWhen, plural, type FreshnessState } from './common';

interface Props {
  config: AuditConfig;
  pageName: string;
  selectionCount: number;
  scope: AuditScope;
  onScope: (s: AuditScope) => void;
  onRun: (scope: AuditScope) => void;
  onConfigure: () => void;
  lastResult: AuditResult | null;
  freshness: FreshnessState;
  onShowResults: () => void;
  /** The file is view-only: settings can't be stored in it. */
  sessionOnly?: boolean;
}

export function Home({ config, pageName, selectionCount, scope, onScope, onRun, onConfigure, lastResult, freshness, onShowResults, sessionOnly }: Props) {
  const effectiveScope = scope === 'selection' && selectionCount === 0 ? 'page' : scope;
  return (
    <div class="screen">
      <Header title="Design System Doctor" />
      <main class="body">
        <label class="field">
          <span class="label">Scope</span>
          <select value={effectiveScope} onChange={(e) => onScope((e.target as HTMLSelectElement).value as AuditScope)}>
            <option value="page">Current page · {pageName}</option>
            <option value="selection" disabled={selectionCount === 0}>
              {selectionCount ? `Selection · ${plural(selectionCount, 'layer')}` : 'Selection (select layers first)'}
            </option>
          </select>
        </label>

        <div class="field">
          <span class="label">Design system</span>
          <div class="row-between boxed">
            <span>{config.designSystem!.name}</span>
            <button class="link" onClick={onConfigure}>Edit</button>
          </div>
          {sessionOnly && <span class="muted small">This file is view-only, so these settings last until you close the plugin.</span>}
        </div>

        <section class="field" aria-labelledby="last-audit-label">
          <span class="label" id="last-audit-label">Last audit</span>
          {lastResult ? <LastAudit result={lastResult} freshness={freshness} onView={onShowResults} onRun={() => onRun(lastResult.scope)} /> : (
            <p class="last-audit empty-card muted">No audit yet for this page. Run one to see how it measures up.</p>
          )}
        </section>
      </main>
      <Footer>
        <button class="btn primary full" onClick={() => onRun(effectiveScope)}>Run design audit</button>
      </Footer>
    </div>
  );
}

function LastAudit({ result, freshness, onView, onRun }: { result: AuditResult; freshness: FreshnessState; onView: () => void; onRun: () => void }) {
  const counts = countBySeverity(result.issues);
  const score = result.compliance.score;
  const stale = freshness === 'changed';
  return (
    <div class={`last-audit ${stale ? 'is-stale' : ''}`}>
      <div class="last-audit-top">
        <div>
          <div class={`last-audit-score ${score === 100 && !stale ? 'perfect' : ''}`}>{score === null ? '—' : `${score}%`}</div>
          <div class="muted small">compliance</div>
        </div>
        <div class="last-audit-counts">
          <span><SeverityDot severity="error" /> {plural(counts.error, 'issue')}</span>
          <span><SeverityDot severity="warning" /> {plural(counts.warning, 'warning')}</span>
          {counts.unverifiable > 0 && <span><SeverityDot severity="unverifiable" /> {counts.unverifiable} not verifiable</span>}
          {counts.review > 0 && <span><SeverityDot severity="review" /> {counts.review} to review</span>}
        </div>
      </div>
      <ConfidenceNote result={result} />
      <div class="last-audit-meta muted small">
        <span>{plural(result.scannedNodeCount, 'layer')} scanned</span>
        <span title={new Date(result.completedAt).toLocaleString()}>
          {result.scope === 'selection' ? 'Selection' : result.pageName} · {formatWhen(result.completedAt)}
        </span>
      </div>
      <FreshnessLine freshness={freshness} />
      {stale ? (
        <div class="last-audit-actions">
          <button class="btn primary full" onClick={onRun}>Run audit</button>
          <button class="link small" onClick={onView}>View old results</button>
        </div>
      ) : (
        <button class="btn secondary full" onClick={onView}>View audit</button>
      )}
    </div>
  );
}

function FreshnessLine({ freshness }: { freshness: FreshnessState }) {
  switch (freshness) {
    case 'checking':
      return <p class="freshness muted small" aria-live="polite">Checking whether the design has changed…</p>;
    case 'current':
      return <p class="freshness ok small">✓ Matches the current design</p>;
    case 'changed':
      return <p class="freshness changed small" role="status"><strong>Design has changed since this audit</strong></p>;
    case 'unverified':
      return <p class="freshness muted small">Can’t confirm this is current (large page). Re-run to be sure.</p>;
  }
}
