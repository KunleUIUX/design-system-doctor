import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AuditErrorKind, AuditPhase, AuditScope, Discovery, MainToUi } from '../shared/messages';
import type { AuditCategory, AuditConfig, AuditResult, DesignSystemConfig } from '../shared/types';
import { send, useMainMessages } from './bridge';
import { CategoryView } from './components/CategoryView';
import { Configure } from './components/Configure';
import { Home } from './components/Home';
import { IssueDetail } from './components/IssueDetail';
import { Progress } from './components/Progress';
import { Results } from './components/Results';
import { ConfirmLarge, ErrorState, NoDesignSystem } from './components/States';
import type { FreshnessState } from './components/common';

export interface ProgressState {
  phase: AuditPhase;
  scanned: number;
  total: number;
  categoriesDone: AuditCategory[];
}

export interface NavStatus {
  nodeId: string;
  ok: boolean;
  message?: string;
}

type View =
  | { name: 'loading' }
  | { name: 'home' }
  | { name: 'configure' }
  | { name: 'confirm-large'; layerCount: number; scope: AuditScope }
  | { name: 'running' }
  | { name: 'results' }
  | { name: 'category'; category: AuditCategory }
  | { name: 'issue'; category: AuditCategory; issueId: string }
  | { name: 'error'; kind: AuditErrorKind; message: string };

export function App() {
  const [view, setViewState] = useState<View>({ name: 'loading' });
  const viewRef = useRef<View>(view);
  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
  };
  const [config, setConfig] = useState<AuditConfig | null>(null);
  const [pageName, setPageName] = useState('');
  const [selectionCount, setSelectionCount] = useState(0);
  const [scope, setScope] = useState<AuditScope>('page');
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [ruleErrorCount, setRuleErrorCount] = useState(0);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [navStatus, setNavStatus] = useState<NavStatus | null>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  /** Library-only design system saved in another file on this device. */
  const [portable, setPortable] = useState<DesignSystemConfig | null>(null);
  const [configureFrom, setConfigureFrom] = useState<DesignSystemConfig | null>(null);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [freshness, setFreshness] = useState<FreshnessState>('current');
  /** The audit whose freshness reports we accept; reports for any other audit are ignored. */
  const shownAuditId = useRef<string | null>(null);
  const show = (r: AuditResult | null, state: FreshnessState) => {
    shownAuditId.current = r?.auditId ?? null;
    setResult(r);
    setFreshness(state);
  };

  /** Where a re-run started, so the designer lands back where they were. */
  const rerunFrom = useRef<{ category?: AuditCategory; previous: AuditResult | null }>({ previous: null });

  const onMessage = useCallback((msg: MainToUi) => {
    switch (msg.type) {
      case 'init-state':
        setConfig(msg.config);
        setPageName(msg.pageName);
        setSelectionCount(msg.selectionCount);
        setPortable(msg.portable);
        show(msg.lastAudit, msg.lastAudit ? 'checking' : 'current');
        setView({ name: 'home' });
        break;
      case 'last-audit':
        // Page changed. Only refresh the entry-screen summary; never swap out results the
        // designer is reading (Go to layer can switch pages).
        if (viewRef.current.name === 'home') {
          show(msg.result, msg.result ? 'checking' : 'current');
          setRuleErrorCount(0);
        }
        break;
      case 'selection-changed':
        setPageName(msg.pageName);
        setSelectionCount(msg.selectionCount);
        break;
      case 'audit-confirm-large':
        setView({ name: 'confirm-large', layerCount: msg.layerCount, scope: msg.scope });
        break;
      case 'audit-progress':
        setProgress(msg);
        break;
      case 'audit-result': {
        const { previous, category } = rerunFrom.current;
        const comparable = previous && previous.pageId === msg.result.pageId && previous.scope === msg.result.scope;
        const nowIds = new Set(msg.result.issues.map((i) => i.id));
        setResolvedCount(comparable ? previous.issues.filter((i) => !nowIds.has(i.id)).length : 0);
        show(msg.result, 'current');
        setRuleErrorCount(msg.ruleErrorCount);
        setNavStatus(null);
        const stillHasFindings = category && msg.result.issues.some((i) => i.category === category);
        setView(stillHasFindings ? { name: 'category', category } : { name: 'results' });
        break;
      }
      case 'audit-error':
        setView(msg.kind === 'cancelled' ? { name: 'home' } : { name: 'error', kind: msg.kind, message: msg.message });
        break;
      case 'audit-freshness':
        if (msg.auditId === shownAuditId.current) setFreshness(msg.state);
        break;
      case 'navigate-result':
        setNavStatus(msg);
        break;
      case 'discovery':
        setDiscovery(msg.discovery);
        break;
      case 'config-saved':
        setConfig(msg.config);
        setSessionOnly(msg.savedTo === 'session');
        break;
    }
  }, []);
  useMainMessages(onMessage);

  useEffect(() => send({ type: 'init' }), []);

  const run = (s: AuditScope = scope, confirmedLarge = false) => {
    const v = viewRef.current;
    rerunFrom.current = {
      previous: result,
      category: v.name === 'category' || v.name === 'issue' ? v.category : undefined,
    };
    setScope(s);
    setProgress(null);
    setView({ name: 'running' });
    send({ type: 'run-audit', scope: s, confirmedLarge });
  };

  const openConfigure = (from: DesignSystemConfig | null = null) => {
    setConfigureFrom(from);
    setDiscovery(null);
    send({ type: 'get-discovery' });
    setView({ name: 'configure' });
  };

  const saveConfig = (next: AuditConfig) => {
    send({ type: 'save-config', config: next });
    setConfig(next);
    setView({ name: 'home' });
  };

  const goToLayer = (nodeId: string) => {
    setNavStatus(null);
    send({ type: 'go-to-node', nodeId });
  };

  const ignoreNode = (nodeId: string) => {
    if (!config || !result) return;
    const next = { ...config, ignoredNodeIds: [...new Set([...config.ignoredNodeIds, nodeId])] };
    send({ type: 'save-config', config: next });
    setConfig(next);
    // Hide it immediately; the score is recalculated on the next run.
    setResult({ ...result, issues: result.issues.filter((i) => i.nodeId !== nodeId) });
    setFreshness('changed'); // settings changed, so the score shown is no longer what a run would give
    setView({ name: 'results' });
  };

  if (!config || view.name === 'loading') return <div class="center muted">Loading…</div>;

  if (!config.designSystem && view.name !== 'configure') {
    return (
      <NoDesignSystem
        discovery={discovery}
        portable={portable}
        onMount={() => send({ type: 'get-discovery' })}
        onConfigure={() => openConfigure()}
        onUsePortable={() => openConfigure(portable)}
      />
    );
  }

  switch (view.name) {
    case 'home':
      return (
        <Home
          config={config}
          pageName={pageName}
          selectionCount={selectionCount}
          scope={scope}
          onScope={setScope}
          onRun={(s) => run(s)}
          onConfigure={() => openConfigure()}
          sessionOnly={sessionOnly}
          lastResult={result}
          freshness={freshness}
          onShowResults={() => {
            setResolvedCount(0);
            setView({ name: 'results' });
          }}
        />
      );
    case 'configure':
      return (
        <Configure
          config={config}
          discovery={discovery}
          initial={configureFrom}
          onSave={saveConfig}
          onCancel={config.designSystem ? () => setView({ name: 'home' }) : undefined}
        />
      );
    case 'confirm-large':
      return (
        <ConfirmLarge
          layerCount={view.layerCount}
          canUseSelection={selectionCount > 0 && view.scope === 'page'}
          onContinue={() => run(view.scope, true)}
          onSelection={() => run('selection')}
          onCancel={() => setView({ name: 'home' })}
        />
      );
    case 'running':
      return <Progress progress={progress} scope={scope} onCancel={() => send({ type: 'cancel-audit' })} />;
    case 'error':
      return (
        <ErrorState
          kind={view.kind}
          message={view.message}
          onRetry={() => run()}
          onHome={() => setView({ name: 'home' })}
          onSelection={selectionCount > 0 ? () => run('selection') : undefined}
        />
      );
  }

  if (!result) return null;

  switch (view.name) {
    case 'results':
      return (
        <Results
          result={result}
          ruleErrorCount={ruleErrorCount}
          resolvedCount={resolvedCount}
          freshness={freshness}
          onOpen={(category) => setView({ name: 'category', category })}
          onRerun={() => run(result.scope)}
          onHome={() => setView({ name: 'home' })}
        />
      );
    case 'category':
      return (
        <CategoryView
          result={result}
          category={view.category}
          navStatus={navStatus}
          resolvedCount={resolvedCount}
          freshness={freshness}
          onBack={() => setView({ name: 'results' })}
          onOpen={(issueId) => {
            setNavStatus(null);
            setView({ name: 'issue', category: view.category, issueId });
          }}
          onGoToLayer={goToLayer}
          onRerun={() => run(result.scope)}
        />
      );
    case 'issue':
      return (
        <IssueDetail
          result={result}
          category={view.category}
          issueId={view.issueId}
          navStatus={navStatus}
          freshness={freshness}
          onBack={() => setView({ name: 'category', category: view.category })}
          onNavigate={(issueId) => {
            setNavStatus(null);
            setView({ name: 'issue', category: view.category, issueId });
          }}
          onGoToLayer={goToLayer}
          onIgnore={ignoreNode}
          onRerun={() => run(result.scope)}
        />
      );
  }
}
