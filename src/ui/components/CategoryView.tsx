import { CATEGORY_LABELS, type AuditCategory, type AuditIssue, type AuditResult } from '../../shared/types';
import type { NavStatus } from '../App';
import { allPassedLabel } from '../categoryRows';
import { Affects, Footer, Header, SEVERITY_LABEL, SeverityDot, StaleBanner, plural, type FreshnessState } from './common';

export function issuesIn(result: AuditResult, category: AuditCategory): AuditIssue[] {
  return result.issues.filter((i) => i.category === category); // already errors first
}

interface Props {
  result: AuditResult;
  category: AuditCategory;
  navStatus: NavStatus | null;
  resolvedCount: number;
  freshness: FreshnessState;
  onBack: () => void;
  onOpen: (issueId: string) => void;
  onGoToLayer: (nodeId: string) => void;
  onRerun: () => void;
}

export function CategoryView({ result, category, navStatus, resolvedCount, freshness, onBack, onOpen, onGoToLayer, onRerun }: Props) {
  const issues = issuesIn(result, category);
  const checks = result.checksByCategory?.[category] ?? 0;
  return (
    <div class="screen">
      <Header title={`${CATEGORY_LABELS[category]} · ${issues.length}`} onBack={onBack} />
      <main class="body flush">
        <div class="inset-block"><StaleBanner freshness={freshness} onRerun={onRerun} /></div>
        {resolvedCount > 0 && (
          <div class="banner success inset" role="status">✓ {plural(resolvedCount, 'finding')} resolved since the last audit.</div>
        )}
        {issues.length === 0 ? (
          checks > 0 ? (
            <p class="success pad">✓ {allPassedLabel(checks)}.</p>
          ) : (
            <p class="muted pad">No findings left in this category.</p>
          )
        ) : (
          <ul class="list">
            {issues.map((i) => (
              <li key={i.id}>
                <FindingCard issue={i} navStatus={navStatus} onOpen={() => onOpen(i.id)} onGoToLayer={() => onGoToLayer(i.nodeId)} />
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer>
        <button class="btn primary full" onClick={onRerun}>Re-run audit</button>
      </Footer>
    </div>
  );
}

function FindingCard({ issue: i, navStatus, onOpen, onGoToLayer }: { issue: AuditIssue; navStatus: NavStatus | null; onOpen: () => void; onGoToLayer: () => void }) {
  const status = navStatus?.nodeId === i.nodeId ? navStatus : null;
  return (
    <article class={`finding finding-${i.severity}`} aria-label={`${SEVERITY_LABEL[i.severity]}: ${i.ruleName} on ${i.nodeName}`}>
      <button class="finding-main" onClick={onOpen} title="Show details">
        <span class="finding-head">
          <SeverityDot severity={i.severity} />
          <span class={`severity-label ${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span>
          <span class="finding-rule">{i.ruleName}</span>
        </span>
        {i.expectedLabel ? (
          <>
            <span class="finding-values">
              <span class="muted">Layer</span> <span>{i.nodeName}</span>
              <span class="muted">{i.expectedLabel}</span> <code>{i.expectedValue}</code>
            </span>
            <span class="finding-why"><span class="finding-why-label">Why it can’t be checked</span>{i.rationale}</span>
          </>
        ) : (
          <>
            <span class="finding-layer">
              {i.nodeName} <span class="muted">· {i.property}</span>
            </span>
            <Affects affects={i.affects} />
            <span class="finding-values">
              <span class="muted">Current</span> <code>{i.currentValue}</code>
              <span class="muted">Expected</span> <code>{i.expectedValue}</code>
            </span>
            <span class="finding-why">{i.rationale}</span>
          </>
        )}
      </button>
      <div class="finding-actions">
        <button class="btn secondary small-btn" onClick={onGoToLayer}>Go to layer</button>
        <code class="node-id" title="Figma node ID">{i.nodeId}</code>
      </div>
      {status && (
        <p class={`finding-status ${status.ok ? 'ok' : 'fail'}`} role="status">
          {status.ok ? status.message ?? 'Selected in the canvas.' : status.message}
        </p>
      )}
    </article>
  );
}
