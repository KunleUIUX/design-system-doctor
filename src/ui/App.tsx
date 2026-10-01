import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AuditErrorKind, AuditPhase, AuditScope, Discovery, MainToUi } from '../shared/messages';
import { applySelection, hasCapturedValues, referenceFromSelection, toSelection, type DesignSystemReference } from '../shared/reference';
import type { AuditCategory, AuditConfig, AuditResult, PluginSettings } from '../shared/types';
import { send, useMainMessages } from './bridge';
import { CategoryView } from './components/CategoryView';
import { Configure } from './components/Configure';
import { Home } from './components/Home';
import { IssueDetail } from './components/IssueDetail';
import { Progress } from './components/Progress';
import { Results } from './components/Results';
import { ConfirmLarge, ErrorState, NoDesignSystem } from './components/States';
import { SwitchDesignSystem } from './components/SwitchDesignSystem';
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
  /** `edit` changes the active design system; `new` creates one from this page and replaces it. */
  | { name: 'configure'; mode: 'edit' | 'new' }
  | { name: 'switch' }
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
  /** Stored settings: the selected design system as a whole reference, plus audit options. */
  const [settings, setSettings] = useState<PluginSettings | null>(null);
  /** Design systems saved on this device. */
  const [library, setLibrary] = useState<DesignSystemReference[]>([]);
  const [capture, setCapture] = useState<{ busy: boolean; message?: string }>({ busy: false });
  const [pageName, setPageName] = useState('');
  const [selectionCount, setSelectionCount] = useState(0);
  const [scope, setScope] = useState<AuditScope>('page');
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [ruleErrorCount, setRuleErrorCount] = useState(0);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [navStatus, setNavStatus] = useState<NavStatus | null>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
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
        setSettings(msg.settings);
        setLibrary(msg.library);
        setPageName(msg.pageName);
        setSelectionCount(msg.selectionCount);
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
      case 'settings-saved':
        setSettings(msg.settings);
        setLibrary(msg.library);
        setSessionOnly(msg.savedTo === 'session');
        // A design system was chosen or captured: back to the start, ready to audit.
        if (viewRef.current.name === 'switch') {
          setCapture({ busy: false });
          setView({ name: 'home' });
        }
        break;
      case 'capture-failed':
        setCapture({ busy: false, message: msg.message });
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

  const openConfigure = (mode: 'edit' | 'new') => {
    setDiscovery(null);
    send({ type: 'get-discovery' });
    setView({ name: 'configure', mode });
  };

  const saveSettings = (next: PluginSettings) => {
    send({ type: 'save-settings', settings: next });
    setSettings(next);
  };

  /** The settings screen edits the selection shape; turn it back into a whole design system. */
  const saveConfigure = (mode: 'edit' | 'new', next: AuditConfig) => {
    if (!settings || !next.designSystem) return;
    const { designSystem: selection, ...options } = next;
    const designSystem =
      mode === 'edit' && settings.designSystem
        ? applySelection(settings.designSystem, selection)
        : referenceFromSelection(selection, 'in-use'); // new: nothing from the previous design system is kept
    saveSettings({ ...options, designSystem });
    setView({ name: 'home' });
  };

  const captureFile = () => {
    setCapture({ busy: true });
    send({ type: 'capture-design-system' });
  };

  const goToLayer = (nodeId: string) => {
    setNavStatus(null);
    send({ type: 'go-to-node', nodeId });
  };

  const ignoreNode = (nodeId: string) => {
    if (!settings || !result) return;
    saveSettings({ ...settings, ignoredNodeIds: [...new Set([...settings.ignoredNodeIds, nodeId])] });
    // Hide it immediately; the score is recalculated on the next run.
    setResult({ ...result, issues: result.issues.filter((i) => i.nodeId !== nodeId) });
    setFreshness('changed'); // settings changed, so the score shown is no longer what a run would give
    setView({ name: 'results' });
  };

  if (!settings || view.name === 'loading') return <div class="center muted">Loading…</div>;

  const switchScreen = (
    <SwitchDesignSystem
      library={library}
      activeId={settings.designSystem?.id ?? null}
      capture={capture}
      onUse={(id) => send({ type: 'switch-design-system', id })}
      onCreateFromPage={() => openConfigure('new')}
      onCapture={captureFile}
      onBack={() => {
        setCapture({ busy: false });
        setView({ name: 'home' });
      }}
    />
  );

  if (!settings.designSystem && view.name !== 'configure') {
    if (view.name === 'switch') return switchScreen;
    return (
      <NoDesignSystem
        discovery={discovery}
        savedCount={library.length}
        onMount={() => send({ type: 'get-discovery' })}
        onChoose={() => setView({ name: 'switch' })}
        onCreateFromPage={() => openConfigure('new')}
      />
    );
  }
  /** The engine-facing view of the settings, which the settings screen edits. */
  const config: AuditConfig = { ...settings, designSystem: settings.designSystem ? toSelection(settings.designSystem) : null };

  switch (view.name) {
    case 'home':
      return (
        <Home
          settings={settings}
          pageName={pageName}
          selectionCount={selectionCount}
          scope={scope}
          onScope={setScope}
          onRun={(s) => run(s)}
          onEdit={() => openConfigure('edit')}
          onSwitch={() => {
            setCapture({ busy: false });
            setView({ name: 'switch' });
          }}
          sessionOnly={sessionOnly}
          lastResult={result}
          freshness={freshness}
          onShowResults={() => {
            setResolvedCount(0);
            setView({ name: 'results' });
          }}
        />
      );
    case 'switch':
      return switchScreen;
    case 'configure': {
      const editing = view.mode === 'edit' && !!settings.designSystem;
      return (
        <Configure
          key={view.mode}
          // A new design system starts from this page's suggestion, never from the current one.
          config={editing ? config : { ...config, designSystem: null }}
          discovery={discovery}
          captured={editing && settings.designSystem && hasCapturedValues(settings.designSystem) ? settings.designSystem : null}
          onSave={(next) => saveConfigure(view.mode, next)}
          onCancel={settings.designSystem ? () => setView({ name: 'home' }) : () => setView({ name: 'switch' })}
        />
      );
    }
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
