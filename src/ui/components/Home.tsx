import type { AuditScope } from '../../shared/messages';
import type { AuditResult, PluginSettings } from '../../shared/types';
import { homeStatus } from '../presentation';
import { ConfidenceNote, Footer, Header, SeverityDot, countBySeverity, formatWhen, plural, type FreshnessState } from './common';

interface Props {
  settings: PluginSettings;
  pageName: string;
  selectionCount: number;
  scope: AuditScope;
  onScope: (s: AuditScope) => void;
  onRun: (scope: AuditScope) => void;
  /** Choose a different design system. */
  onChange: () => void;
  lastResult: AuditResult | null;
  freshness: FreshnessState;
  onShowResults: () => void;
  /** The file is view-only: settings can't be stored in it. */
  sessionOnly?: boolean;
}

/** Select what to check → design system → run audit. One primary action. */
export function Home({ settings, pageName, selectionCount, scope, onScope, onRun, onChange, lastResult, freshness, onShowResults, sessionOnly }: Props) {
  const ds = settings.designSystem!;
  const effectiveScope = scope === 'selection' && selectionCount === 0 ? 'page' : scope;
  const status = homeStatus(ds, lastResult);
  return (
    <div class="screen">
      <Header title="Design System Doctor" />
      <main class="body">
        <section class="ds-card" aria-label="Design system">
          <div class="ds-card-text">
            <span class="label">Design system</span>
            <strong class="ds-card-name">{ds.name}</strong>
            <span class={`ds-card-status small ${status === 'Ready' ? 'ok' : 'partial'}`}>{status}</span>
          </div>
          <button class="link" onClick={onChange}>Change</button>
        </section>
        {sessionOnly && <p class="muted small">This file is view-only, so these settings last until you close the plugin.</p>}

        <div class="field" role="radiogroup" aria-label="What to check">
          <span class="label">What to check</span>
          <div class="segmented">
            <button role="radio" aria-checked={effectiveScope === 'page'} class={effectiveScope === 'page' ? 'on' : ''} onClick={() => onScope('page')} title={pageName}>
              This page
            </button>
            <button role="radio" aria-checked={effectiveScope === 'selection'} class={effectiveScope === 'selection' ? 'on' : ''}
              disabled={selectionCount === 0} onClick={() => onScope('selection')}
              title={selectionCount ? undefined : 'Select layers in the canvas first'}>
              {selectionCount ? `Selection (${plural(selectionCount, 'layer')})` : 'Selection'}
            </button>
          </div>
        </div>

        {lastResult && (
          <section class="field" aria-labelledby="last-audit-label">
            <span class="label" id="last-audit-label">Last audit</span>
            <LastAudit result={lastResult} freshness={freshness} onView={onShowResults} />
          </section>
        )}
      </main>
      <Footer>
        <button class="btn primary full" onClick={() => onRun(effectiveScope)}>{lastResult ? 'Run audit again' : 'Run audit'}</button>
      </Footer>
    </div>
  );
}

function LastAudit({ result, freshness, onView }: { result: AuditResult; freshness: FreshnessState; onView: () => void }) {
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
      <button class="btn secondary full" onClick={onView}>View results</button>
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
      return <p class="freshness changed small" role="status"><strong>Design has changed since this audit.</strong> Run the audit again to update it.</p>;
    case 'unverified':
      return <p class="freshness muted small">Can’t confirm this is current (large page). Re-run to be sure.</p>;
  }
}
