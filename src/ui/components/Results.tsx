import { useState } from 'preact/hooks';
import { CATEGORY_LABELS, CATEGORY_ORDER, type AuditCategory, type AuditResult } from '../../shared/types';
import {
  AuditCounts,
  ConfidenceNote,
  Footer,
  Header,
  SeverityDot,
  StaleBanner,
  countBySeverity,
  formatWhen,
  plural,
  type FreshnessState,
} from './common';

interface Props {
  result: AuditResult;
  ruleErrorCount: number;
  resolvedCount: number;
  freshness: FreshnessState;
  onOpen: (category: AuditCategory) => void;
  onRerun: () => void;
  onHome: () => void;
}

export function Results({ result, ruleErrorCount, resolvedCount, freshness, onOpen, onRerun, onHome }: Props) {
  const [showFormula, setShowFormula] = useState(false);
  const totals = countBySeverity(result.issues);
  const { compliance } = result;
  const hiddenSkipped = result.skippedNodeCount - result.failedNodeCount;

  const groups = CATEGORY_ORDER.map((c) => ({ c, ...countBySeverity(result.issues.filter((i) => i.category === c)) })).filter(
    (g) => g.error + g.warning + g.review + g.unverifiable > 0,
  );

  return (
    <div class="screen">
      <Header title="Design audit" onBack={onHome} />
      <main class="body">
        <StaleBanner freshness={freshness} onRerun={onRerun} />
        <section class="score">
          <div class={`score-value ${compliance.score === 100 ? 'perfect' : ''}`}>
            {compliance.score === null ? '—' : `${compliance.score}%`}
          </div>
          <div class="muted">Design system compliance</div>
          <ConfidenceNote result={result} />
          <div class="score-meta">
            {result.scope === 'page' ? result.pageName : 'Selection'} · {result.designSystemName} · {formatWhen(result.completedAt)}
          </div>
          <AuditCounts result={result} />
          <button class="link small" onClick={() => setShowFormula(!showFormula)} aria-expanded={showFormula}>
            How is this calculated?
          </button>
          {showFormula && (
            <div class="explain">
              <p>{compliance.formula}</p>
              <p>A layer can have several checks (for example its fill, padding and corner radius), or none.</p>
              <p>Under 10 applicable checks the score is marked low confidence: it describes those few properties, not the page.</p>
            </div>
          )}
        </section>

        {result.unresolvedSources && result.unresolvedSources.length > 0 && (
          <div class="banner neutral" role="status">
            <strong>Some approved sources can’t be read in this file:</strong>{' '}
            {result.unresolvedSources.map((s) => `${s.name} (${s.source === 'library' ? 'library, not used here yet' : 'missing'})`).join(', ')}.
            {' '}Checks that depend on them are marked “Not verifiable” and don’t count toward the score.
          </div>
        )}
        {resolvedCount > 0 && (
          <div class="banner success" role="status">✓ {plural(resolvedCount, 'finding')} resolved since the last audit.</div>
        )}
        {result.failedNodeCount > 0 && (
          <div class="banner warning">
            <strong>Audit completed with limitations.</strong> {plural(result.failedNodeCount, 'layer')} could not be analysed. The
            compliance score is based only on the layers that were.
          </div>
        )}
        {ruleErrorCount > 0 && (
          <div class="banner warning">
            {plural(ruleErrorCount, 'check')} failed to run and {ruleErrorCount === 1 ? 'was' : 'were'} left out. See the console for details.
          </div>
        )}

        {compliance.score === null && totals.review === 0 && totals.unverifiable === 0 ? (
          <div class="empty">
            <p><strong>Nothing to score</strong></p>
            <p class="muted">No layers here use anything the enabled rules check, like text, fills, auto layout, corner radius or components.</p>
          </div>
        ) : groups.length === 0 ? (
          <div class="empty">
            <p class="success">✓ No violations found</p>
            <p class="muted">Every configured rule passed. This doesn’t review visual or functional quality.</p>
          </div>
        ) : (
          <>
            <div class="counts">
              <span><SeverityDot severity="error" /> {plural(totals.error, 'issue')}</span>
              <span><SeverityDot severity="warning" /> {plural(totals.warning, 'warning')}</span>
              {totals.unverifiable > 0 && (
                <span title="Checks Doctor couldn’t evaluate in this file. They’re never counted as passes.">
                  <SeverityDot severity="unverifiable" /> {totals.unverifiable} not verifiable
                </span>
              )}
              {totals.review > 0 && (
                <span title="Items the rules can’t judge, such as colours with no related token. They don’t affect the score.">
                  <SeverityDot severity="review" /> {totals.review} to review
                </span>
              )}
            </div>
            <h3 class="section-title">By category</h3>
            <ul class="list">
              {groups.map(({ c, error: e, warning: w, review: rv, unverifiable: nv }) => (
                <li key={c}>
                  <button class="row" onClick={() => onOpen(c)}>
                    <span>{CATEGORY_LABELS[c]}</span>
                    <span class="row-counts">
                      {e > 0 && <span class="count error">{plural(e, 'issue')}</span>}
                      {w > 0 && <span class="count warning">{plural(w, 'warning')}</span>}
                      {nv > 0 && <span class="count review">{nv} not verifiable</span>}
                      {rv > 0 && <span class="count review">{rv} to review</span>}
                      <span class="chevron" aria-hidden="true">›</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {hiddenSkipped > 0 && <p class="muted small">{plural(hiddenSkipped, 'hidden layer')} (and their contents) skipped.</p>}
      </main>
      <Footer>
        <button class="btn primary full" onClick={onRerun}>Re-run audit</button>
      </Footer>
    </div>
  );
}
