import type { AuditCategory, AuditResult } from '../../shared/types';
import type { NavStatus } from '../App';
import { issuesIn } from './CategoryView';
import { savedReferenceLabel, splitSavedReference } from '../presentation';
import { Affects, Footer, Header, SEVERITY_LABEL, SeverityDot, StaleBanner, type FreshnessState } from './common';

interface Props {
  result: AuditResult;
  category: AuditCategory;
  issueId: string;
  navStatus: NavStatus | null;
  freshness: FreshnessState;
  onBack: () => void;
  onNavigate: (issueId: string) => void;
  onGoToLayer: (nodeId: string) => void;
  onIgnore: (nodeId: string) => void;
  onRerun: () => void;
}

export function IssueDetail({ result, category, issueId, navStatus, freshness, onBack, onNavigate, onGoToLayer, onIgnore, onRerun }: Props) {
  const issues = issuesIn(result, category);
  const index = issues.findIndex((i) => i.id === issueId);
  const issue = issues[index];
  if (!issue) return <div class="center muted">This item is no longer in the results.</div>;
  const status = navStatus?.nodeId === issue.nodeId ? navStatus : null;
  const sameNodeCount = result.issues.filter((i) => i.nodeId === issue.nodeId).length;

  const expected = splitSavedReference(issue.expectedValue);
  const why = splitSavedReference(issue.rationale);
  const saved = expected.saved || why.saved;

  return (
    <div class="screen">
      <Header
        title={`${index + 1} of ${issues.length}`}
        onBack={onBack}
        right={
          <>
            <button class="icon-btn" disabled={index === 0} onClick={() => onNavigate(issues[index - 1].id)} aria-label="Previous">‹</button>
            <button class="icon-btn" disabled={index === issues.length - 1} onClick={() => onNavigate(issues[index + 1].id)} aria-label="Next">›</button>
          </>
        }
      />
      <main class="body">
        <StaleBanner freshness={freshness} onRerun={onRerun} />
        <div class="detail-title">
          <SeverityDot severity={issue.severity} />
          <h2 class="title">{issue.message}</h2>
        </div>
        <p class="layer-name">{issue.nodeName}</p>
        {issue.nodePath.length > 0 && <p class="muted small path">{issue.nodePath.join(' / ')}</p>}

        <dl class="values">
          <dt>Rule</dt>
          <dd>{issue.ruleName}</dd>
          <dt>Severity</dt>
          <dd>{SEVERITY_LABEL[issue.severity]}{issue.severity === 'review' || issue.severity === 'unverifiable' ? ' (not scored)' : ''}</dd>
          <dt>Node ID</dt>
          <dd><code>{issue.nodeId}</code></dd>
          <dt>Property</dt>
          <dd>{issue.property}{issue.affects && <><br /><Affects affects={issue.affects} /></>}</dd>
          {issue.expectedLabel ? (
            <>
              <dt>Layer</dt>
              <dd>{issue.nodeName}</dd>
              <dt>{issue.expectedLabel}</dt>
              <dd><code>{expected.text}</code>{saved && <> <span class="saved-tag">{savedReferenceLabel(result)}</span></>}</dd>
            </>
          ) : (
            <>
              <dt>Current</dt>
              <dd><code>{issue.currentValue}</code></dd>
              <dt>Expected</dt>
              <dd><code>{expected.text}</code>{saved && <> <span class="saved-tag">{savedReferenceLabel(result)}</span></>}</dd>
            </>
          )}
        </dl>

        <h3 class="section-title">{issue.severity === 'unverifiable' ? 'Why it can’t be checked' : 'Why this matters'}</h3>
        <p>{why.text}</p>
        <h3 class="section-title">How to fix</h3>
        <p>{issue.suggestedAction}</p>

        {sameNodeCount > 1 && <p class="muted small">This layer has {sameNodeCount} findings in total.</p>}
        <p class="muted small">Rule id: <code>{issue.ruleId}</code></p>

        {status && <div class={`banner ${status.ok ? 'info' : 'warning'}`} role="status">{status.ok ? status.message ?? 'Layer selected in the canvas.' : status.message}</div>}
      </main>
      <Footer>
        <button class="btn primary full" onClick={() => onGoToLayer(issue.nodeId)}>Go to layer</button>
        <div class="row-between">
          <button class="link small" onClick={() => onIgnore(issue.nodeId)} title="Skip this layer in future audits">Ignore this layer</button>
          <button class="link small" onClick={onRerun}>Run audit again</button>
        </div>
      </Footer>
    </div>
  );
}
