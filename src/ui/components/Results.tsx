import { useState } from 'preact/hooks';
import { CATEGORY_LABELS, type AuditCategory, type AuditResult } from '../../shared/types';
import { categoryRows, type CategoryRow } from '../categoryRows';
import { referenceSummary } from '../presentation';
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
  /** The design system it was checked against, by its current name. */
  designSystemName: string;
  ruleErrorCount: number;
  resolvedCount: number;
  freshness: FreshnessState;
  onOpen: (category: AuditCategory) => void;
  onRerun: () => void;
  onHome: () => void;
}

export function Results({ result, designSystemName, ruleErrorCount, resolvedCount, freshness, onOpen, onRerun, onHome }: Props) {
  const [showFormula, setShowFormula] = useState(false);
  const totals = countBySeverity(result.issues);
  const { compliance } = result;
  const hiddenSkipped = result.skippedNodeCount - result.failedNodeCount;

  // Categories with findings, plus categories that were checked and fully passed.
  const rows = categoryRows(result);
  const hasFindings = rows.some((r) => !r.allPassed);

  return (
    <div class="screen">
      <Header title="Results" onBack={onHome} />
      <main class="body">
        <StaleBanner freshness={freshness} onRerun={onRerun} />
        <section class="score">
          <div class={`score-value ${compliance.score === 100 ? 'perfect' : ''}`}>
            {compliance.score === null ? '—' : `${compliance.score}%`}
          </div>
          <div class="muted">Design system compliance</div>
          <ConfidenceNote result={result} />
          <div class="score-meta">
            {result.scope === 'page' ? result.pageName : 'Selection'} · {formatWhen(result.completedAt)}
          </div>
          <p class="checked-against muted small">Checked against {designSystemName}</p>
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

        {resolvedCount > 0 && (
          <div class="banner success" role="status">✓ {plural(resolvedCount, 'finding')} resolved since the last audit.</div>
        )}
        <ReferenceNote result={result} designSystemName={designSystemName} />
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
        ) : !hasFindings ? (
          <>
            <div class="empty">
              <p class="success">✓ No violations found</p>
              <p class="muted">Every configured rule passed. This doesn’t review visual or functional quality.</p>
            </div>
            {rows.length > 0 && <CategoryList rows={rows} onOpen={onOpen} />}
          </>
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
            <CategoryList rows={rows} onOpen={onOpen} />
          </>
        )}

        {hiddenSkipped > 0 && <p class="muted small">{plural(hiddenSkipped, 'hidden layer')} (and their contents) skipped.</p>}
      </main>
      <Footer>
        <button class="btn primary full" onClick={onRerun}>Run audit again</button>
      </Footer>
    </div>
  );
}

function CategoryList({ rows, onOpen }: { rows: CategoryRow[]; onOpen: (category: AuditCategory) => void }) {
  return (
    <>
      <h3 class="section-title">By category</h3>
      <ul class="list">
        {rows.map(({ category: c, error: e, warning: w, review: rv, unverifiable: nv, checks, allPassed }) => (
          <li key={c}>
            <button class="row" onClick={() => onOpen(c)}>
              <span>{CATEGORY_LABELS[c]}</span>
              <span class="row-counts">
                {allPassed && <span class="count pass">✓ {checks} passed</span>}
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
  );
}

/**
 * What the audit could use of the selected design system, without internal terms. Nothing extra
 * when everything was read normally; a short note when a saved reference filled gaps; one neutral
 * banner when some checks couldn't be done. Category detail sits behind "Details".
 */
function ReferenceNote({ result, designSystemName }: { result: AuditResult; designSystemName: string }) {
  const [open, setOpen] = useState(false);
  const summary = referenceSummary(result);
  if (summary.kind === 'full') return null;
  const details = open && (
    <div class="reference-details small">
      <ul>
        {summary.details.map((d) => (
          <li key={d.label}><span>{d.label}</span><span class="muted">{d.parts.join(' · ')}</span></li>
        ))}
      </ul>
      {summary.missing.length > 0 && <p class="muted">Not available in this file: {summary.missing.join(', ')}.</p>}
      {summary.kind === 'partial' && (
        <p class="muted">
          To check these, make sure the design system’s library is enabled for this file (Assets → Libraries), or save the
          library as a design system from its own file.
        </p>
      )}
    </div>
  );
  const toggle = (
    <button class="link small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button>
  );
  if (summary.kind === 'partial') {
    return (
      <div class="banner neutral" role="status">
        <span>
          Some parts of {designSystemName} couldn’t be checked in this file. Those checks are marked Not verifiable and
          don’t affect the score.
        </span>
        {toggle}
        {details}
      </div>
    );
  }
  return (
    <div class="reference-note muted small">
      <span>Some checks used a saved reference{summary.savedOn ? ` from ${summary.savedOn}` : ''}.</span> {toggle}
      {details}
    </div>
  );
}
