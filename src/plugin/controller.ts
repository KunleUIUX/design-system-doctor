// The plugin's main-thread behaviour: handles UI messages, runs audits, navigates, stores results
// and keeps the UI told whether a saved result still matches the design. `post` and storage are
// injected so the exact same handler runs in the plugin and in the real-file checks.

import { AuditCancelled, AuditTimedOut, countLayers } from '../figma/snapshot';
import { checkFreshness, performAudit, type Freshness } from '../figma/audit';
import { goToNode } from '../figma/navigate';
import type { AuditPhase, AuditScope, MainToUi, UiToMain } from '../shared/messages';
import { DEFAULT_SETTINGS, DEFAULT_SPACING_SCALE, DEFAULT_RADIUS_SCALE, type AuditCategory, type AuditResult, type PluginSettings } from '../shared/types';
import { migrateDesignSystem } from '../shared/designSystem';
import { isReference, migrateToReference, type DesignSystemReference } from '../shared/reference';
import { captureCurrentFile } from '../figma/capture';
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
  let settings: PluginSettings = DEFAULT_SETTINGS;
  let library: DesignSystemReference[] = [];
  let running = false;
  let cancelRequested = false;
  const watchedPages = new Set<string>();
  let changeTimer: ReturnType<typeof setTimeout> | undefined;

  /** v1 stored consuming-file collection ids; they become refs. */
  const lookupCollection = async (id: string) => {
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    return c && { id: c.id, key: c.key, name: c.name, remote: c.remote };
  };

  /**
   * Saved settings → current shape. Older selection-based settings (v1/v2) become a design system
   * reference that behaves exactly as before. Nothing is written until the designer saves.
   */
  async function loadSettings(): Promise<PluginSettings> {
    const current = await storage.loadSettings();
    if (current) return { ...DEFAULT_SETTINGS, ...current };
    const legacy = await storage.loadLegacyConfig();
    if (!legacy) return DEFAULT_SETTINGS;
    const { designSystem: old, ...options } = { ...DEFAULT_SETTINGS, ...legacy };
    if (!old) return { ...options, designSystem: null };
    const v2 = await migrateDesignSystem(old as never, lookupCollection);
    return { ...options, designSystem: migrateToReference(v2) };
  }

  /** Device list; the older single device copy is migrated into it once. */
  async function loadLibrary(): Promise<DesignSystemReference[]> {
    const list = (await storage.loadLibrary()).filter(isReference);
    if (list.length) return list;
    const portable = await storage.loadLegacyPortable();
    return portable ? [migrateToReference(await migrateDesignSystem(portable as never, lookupCollection))] : [];
  }

  /** Keep the device list in step with the selected design system (same id = same design system). */
  async function remember(ref: DesignSystemReference) {
    library = [ref, ...library.filter((r) => r.id !== ref.id)];
    await storage.saveLibrary(library);
  }

  async function commit(next: PluginSettings) {
    settings = next;
    const savedTo = await storage.saveSettings(settings);
    if (settings.designSystem) await remember(settings.designSystem);
    post({ type: 'settings-saved', settings, library, savedTo });
    // The design system and options are part of the fingerprint: a saved result may no longer apply.
    await reportFreshness(figma.currentPage);
  }

  const selectionState = () => ({ pageName: figma.currentPage.name, selectionCount: figma.currentPage.selection.length });

  // ── Freshness ────────────────────────────────────────────────────────────

  async function reportFreshness(page: PageNode) {
    const result = storage.loadLastAudit(page);
    if (!result) return;
    let state: Freshness;
    try {
      state = await checkFreshness(result, settings, page);
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
    if (!settings.designSystem) {
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
      const total = countLayers(roots, settings.includeHidden);
      if (total > LARGE_PAGE_LAYERS && !confirmedLarge) {
        post({ type: 'audit-confirm-large', layerCount: total, scope });
        return;
      }
      const { result, ruleErrorCount } = await performAudit(roots, settings, {
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
          settings = await loadSettings();
          library = await loadLibrary();
          const lastAudit = storage.loadLastAudit(figma.currentPage);
          post({ type: 'init-state', settings, library, ...selectionState(), lastAudit });
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
          post({ type: 'discovery', discovery: await discover(undefined) });
          break;
        case 'save-settings':
          await commit(msg.settings);
          break;
        case 'switch-design-system': {
          const chosen = library.find((r) => r.id === msg.id);
          if (!chosen) break;
          // Replaced as a whole: nothing from the previous design system is carried over.
          await commit({ ...settings, designSystem: JSON.parse(JSON.stringify(chosen)) });
          break;
        }
        case 'capture-design-system': {
          try {
            const scales = settings.designSystem ?? { spacingScale: DEFAULT_SPACING_SCALE, radiusScale: DEFAULT_RADIUS_SCALE };
            const captured = await captureCurrentFile({ spacingScale: scales.spacingScale, radiusScale: scales.radiusScale });
            const total = captured.textStyles.length + captured.paintStyles.length + captured.variableCollections.length + captured.components.length;
            if (!total) {
              post({ type: 'capture-failed', message: 'This file has no styles, variables or components of its own to capture. Open the design system’s library file and capture it there.' });
              break;
            }
            // Saving the same library again updates that design system (same id, name and settings).
            const previous = library.find((r) => r.source.kind === 'library-file' && !!r.source.fileName && r.source.fileName === captured.source.fileName);
            const next = previous
              ? { ...captured, id: previous.id, name: previous.name, spacingScale: previous.spacingScale, radiusScale: previous.radiusScale, alsoAccept: previous.alsoAccept }
              : captured;
            await commit({ ...settings, designSystem: next });
          } catch (e) {
            console.error('[Design System Doctor] capture failed', e);
            post({ type: 'capture-failed', message: 'Couldn’t read this file’s styles, variables and components.' });
          }
          break;
        }
        case 'rename-design-system': {
          const name = msg.name.trim();
          if (!name || !library.some((r) => r.id === msg.id)) break;
          library = library.map((r) => (r.id === msg.id ? { ...r, name } : r));
          await storage.saveLibrary(library);
          if (settings.designSystem?.id === msg.id) {
            settings = { ...settings, designSystem: { ...settings.designSystem, name } };
            await storage.saveSettings(settings);
          }
          post({ type: 'library-updated', settings, library });
          break;
        }
        case 'remove-design-system': {
          library = library.filter((r) => r.id !== msg.id);
          await storage.saveLibrary(library);
          if (settings.designSystem?.id === msg.id) {
            settings = { ...settings, designSystem: null };
            await storage.saveSettings(settings);
          }
          post({ type: 'library-updated', settings, library });
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
    setSettings: (next: PluginSettings) => void (settings = next),
  };
}

export type Controller = ReturnType<typeof createController>;
export type { AuditResult };
