// The plugin's main-thread behaviour: handles UI messages, runs audits, navigates, stores results
// and keeps the UI told whether a saved result still matches the design. `post` and storage are
// injected so the exact same handler runs in the plugin and in the real-file checks.

import { AuditCancelled, AuditTimedOut, countLayers } from '../figma/snapshot';
import { checkFreshness, performAudit, type Freshness } from '../figma/audit';
import { goToNode } from '../figma/navigate';
import type { AuditPhase, AuditScope, MainToUi, UiToMain } from '../shared/messages';
import { DEFAULT_AUDIT_CONFIG, type AuditCategory, type AuditConfig, type AuditResult } from '../shared/types';
import { migrateDesignSystem, toPortable } from '../shared/designSystem';
import { discover } from './discovery';
import type { PluginStorage } from './storage';

const LARGE_PAGE_LAYERS = 3000;
const AUDIT_BUDGET_MS = 90_000;
/** Wait for edits to settle before re-checking freshness. */
const CHANGE_DEBOUNCE_MS = 800;

export interface ControllerDeps {
  post: (msg: MainToUi) => void;
  storage: PluginStorage;
}

export function createController({ post, storage }: ControllerDeps) {
  let config: AuditConfig = DEFAULT_AUDIT_CONFIG;
  let running = false;
  let cancelRequested = false;
  const watchedPages = new Set<string>();
  let changeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Saved settings → current shape. v1 stored consuming-file collection ids; they become refs. */
  async function loadSettings(): Promise<AuditConfig> {
    const raw = await storage.loadConfig();
    if (!raw) return DEFAULT_AUDIT_CONFIG;
    const merged = { ...DEFAULT_AUDIT_CONFIG, ...raw } as AuditConfig;
    if (!merged.designSystem) return merged;
    const designSystem = await migrateDesignSystem(merged.designSystem, async (id) => {
      const c = await figma.variables.getVariableCollectionByIdAsync(id);
      return c && { id: c.id, key: c.key, name: c.name, remote: c.remote };
    });
    return { ...merged, designSystem };
  }

  const selectionState = () => ({ pageName: figma.currentPage.name, selectionCount: figma.currentPage.selection.length });

  // ── Freshness ────────────────────────────────────────────────────────────

  async function reportFreshness(page: PageNode) {
    const result = storage.loadLastAudit(page);
    if (!result) return;
    let state: Freshness;
    try {
      state = await checkFreshness(result, config, page);
    } catch {
      state = 'unverified';
    }
    post({ type: 'audit-freshness', auditId: result.auditId, pageId: page.id, state });
  }

  /** Re-check after edits on a page that has a saved audit (nodechange works with dynamic-page). */
  function watch(page: PageNode) {
    if (watchedPages.has(page.id)) return;
    try {
      page.on('nodechange', () => {
        if (running) return;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => void reportFreshness(page), CHANGE_DEBOUNCE_MS);
      });
      watchedPages.add(page.id);
    } catch {
      // Host without change events: freshness is still checked on open and on page switch.
    }
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  async function runAudit(scope: AuditScope, confirmedLarge: boolean) {
    if (running) return;
    if (!config.designSystem) {
      post({ type: 'audit-error', kind: 'no-design-system', message: 'No design system configured.' });
      return;
    }
    const roots = scope === 'page' ? figma.currentPage.children : figma.currentPage.selection;
    if (scope === 'selection' && roots.length === 0) {
      post({ type: 'audit-error', kind: 'empty-selection', message: 'Select one or more layers to audit, or audit the whole page.' });
      return;
    }

    running = true;
    cancelRequested = false;
    const page = figma.currentPage;
    const progress = (phase: AuditPhase, scanned: number, total: number, categoriesDone: AuditCategory[] = []) =>
      post({ type: 'audit-progress', phase, scanned, total, categoriesDone });

    try {
      progress('counting', 0, 0);
      const total = countLayers(roots, config.includeHidden);
      if (total > LARGE_PAGE_LAYERS && !confirmedLarge) {
        post({ type: 'audit-confirm-large', layerCount: total, scope });
        return;
      }
      const { result, ruleErrorCount } = await performAudit(roots, config, {
        scope,
        page,
        total,
        deadline: Date.now() + AUDIT_BUDGET_MS,
        onProgress: progress,
        isCancelled: () => cancelRequested,
      });
      storage.saveLastAudit(page, result);
      post({ type: 'audit-result', result, ruleErrorCount });
      watch(page);
    } catch (e) {
      if (e instanceof AuditCancelled) post({ type: 'audit-error', kind: 'cancelled', message: 'Audit cancelled.' });
      else if (e instanceof AuditTimedOut) post({ type: 'audit-error', kind: 'timeout', message: 'Try auditing a smaller frame or selection.' });
      else {
        console.error('[Design System Doctor] audit failed', e);
        post({ type: 'audit-error', kind: 'cannot-start', message: 'We couldn’t read this page.' });
      }
    } finally {
      running = false;
    }
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  async function handle(msg: UiToMain) {
    try {
      switch (msg.type) {
        case 'init': {
          config = await loadSettings();
          const lastAudit = storage.loadLastAudit(figma.currentPage);
          const portable = await storage.loadPortable();
          post({ type: 'init-state', config, ...selectionState(), lastAudit, portable });
          if (lastAudit) {
            watch(figma.currentPage);
            await reportFreshness(figma.currentPage);
          }
          break;
        }
        case 'run-audit':
          await runAudit(msg.scope, !!msg.confirmedLarge);
          break;
        case 'cancel-audit':
          cancelRequested = true;
          break;
        case 'go-to-node': {
          const outcome = await goToNode(msg.nodeId);
          post({ type: 'navigate-result', nodeId: msg.nodeId, ...outcome });
          break;
        }
        case 'check-freshness':
          await reportFreshness(figma.currentPage);
          break;
        case 'get-discovery':
          post({ type: 'discovery', discovery: await discover(config.designSystem?.name) });
          break;
        case 'save-config': {
          config = msg.config;
          const savedTo = await storage.saveConfig(config);
          // Offer the library part to other files; never their file-specific ids.
          if (config.designSystem) await storage.savePortable(toPortable(config.designSystem));
          post({ type: 'config-saved', config, savedTo });
          // Settings are part of the fingerprint: a saved result may no longer apply.
          await reportFreshness(figma.currentPage);
          break;
        }
      }
    } catch (e) {
      console.error('[Design System Doctor]', msg.type, e);
      if (msg.type === 'go-to-node') post({ type: 'navigate-result', nodeId: msg.nodeId, ok: false, message: 'Couldn’t select this layer.' });
      else post({ type: 'audit-error', kind: 'cannot-start', message: 'Something went wrong. Try again.' });
    }
  }

  async function onPageChange() {
    post({ type: 'selection-changed', ...selectionState() });
    const lastAudit = storage.loadLastAudit(figma.currentPage);
    post({ type: 'last-audit', result: lastAudit });
    if (lastAudit) {
      watch(figma.currentPage);
      await reportFreshness(figma.currentPage);
    }
  }

  return {
    handle,
    onPageChange,
    onSelectionChange: () => post({ type: 'selection-changed', ...selectionState() }),
    /** For the real-file checks: let a caller wait on a pending freshness re-check. */
    reportFreshness,
    setConfig: (next: AuditConfig) => void (config = next),
  };
}

export type Controller = ReturnType<typeof createController>;
export type { AuditResult };
