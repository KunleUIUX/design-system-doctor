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
import { SelectDesignSystem } from './components/SelectDesignSystem';
import { afterSelect, auditedName } from './presentation';
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
  | { name: 'select' }
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
        setScope(msg.selectionCount > 0 ? 'selection' : 'page');
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
        // What to check follows the canvas: a selection means "check these layers".
        setScope(msg.selectionCount > 0 ? 'selection' : 'page');
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
        // A design system was chosen or saved: back to the start, ready to audit (or on to its
        // settings, when "Edit settings" was chosen for a system that wasn't selected yet).
        if (viewRef.current.name === 'select') {
          setCapture({ busy: false });
          const next = afterSelect(editAfterSelect.current, msg.settings.designSystem?.id);
          editAfterSelect.current = null;
          if (next === 'edit') openConfigure('edit');
          else setView({ name: 'home' });
        }
        break;
      case 'library-updated':
        setSettings(msg.settings);
        setLibrary(msg.library);
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

  /**
   * Set when "Edit settings" picks a system that isn't selected yet: select it, then edit it. Holds
   * that system's id, so the edit screen only opens once it's the one selected.
   */
  const editAfterSelect = useRef<string | null>(null);
  const editSystem = (id: string) => {
    if (settings?.designSystem?.id === id) return openConfigure('edit');
    editAfterSelect.current = id;
    send({ type: 'switch-design-system', id });
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

  const selectScreen = (
    <SelectDesignSystem
      library={library}
      activeId={settings.designSystem?.id ?? null}
      capture={capture}
      onSelect={(id) => {
        editAfterSelect.current = null;
        if (id === settings.designSystem?.id) setView({ name: 'home' });
        else send({ type: 'switch-design-system', id });
      }}
      onEdit={editSystem}
      onRename={(id, name) => send({ type: 'rename-design-system', id, name })}
      onRemove={(id) => send({ type: 'remove-design-system', id })}
      onSaveLibrary={captureFile}
      onCreateFromPage={() => openConfigure('new')}
      onBack={settings.designSystem ? () => (setCapture({ busy: false }), setView({ name: 'home' })) : undefined}
    />
  );

  if (!settings.designSystem && view.name !== 'configure') {
    if (view.name === 'select') return selectScreen;
    return <NoDesignSystem savedCount={library.length} onChoose={() => setView({ name: 'select' })} />;
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
          onChange={() => {
            setCapture({ busy: false });
            setView({ name: 'select' });
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
    case 'select':
      return selectScreen;
    case 'configure': {
      const editing = view.mode === 'edit' && !!settings.designSystem;
      return (
        <Configure
          key={view.mode}
          mode={editing ? 'edit' : 'new'}
          // A new design system starts from this page's suggestion, never from the current one.
          config={editing ? config : { ...config, designSystem: null }}
          discovery={discovery}
          captured={editing && settings.designSystem && hasCapturedValues(settings.designSystem) ? settings.designSystem : null}
          onSave={(next) => saveConfigure(view.mode, next)}
          onCancel={() => setView({ name: editing ? 'home' : 'select' })}
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
          designSystemName={auditedName(result, settings.designSystem)}
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
