// The audit pipeline against live Figma nodes: read → resolve → evaluate → result.
// Shared by the plugin (src/plugin/controller.ts) and the real-file checks (dev/figma-e2e.ts).

import { auditFingerprint } from '../engine/fingerprint';
import { evaluateNodes } from '../engine/orchestrator';
import { ALL_RULES } from '../engine/rules';
import type { AuditPhase, AuditScope } from '../shared/messages';
import { prepareReference } from '../engine/prepareReference';
import { isReference, migrateToReference, type DesignSystemReference } from '../shared/reference';
import type { AuditCategory, AuditConfig, AuditResult, DesignSystemConfig, DesignSystemData, PluginSettings, ReferenceCoverage } from '../shared/types';
import { loadDesignSystemData } from './designSystemData';
import { AuditCancelled, AuditTimedOut, countLayers, snapshotTree, type TraversalResult } from './snapshot';

export interface AuditHooks {
  scope: AuditScope;
  page: PageNode;
  /** Layer count from countLayers, for progress. */
  total: number;
  deadline: number;
  onProgress?: (phase: AuditPhase, scanned: number, total: number, categoriesDone: AuditCategory[]) => void;
  isCancelled?: () => boolean;
}

const PROGRESS_INTERVAL_MS = 100;

/**
 * Settings as stored (a design system reference), or the older selection shape that real-file
 * checks and old callers still pass. Either way the audit runs against a reference.
 */
export type AuditSettings = PluginSettings | (Omit<AuditConfig, 'designSystem'> & { designSystem: DesignSystemConfig | DesignSystemReference | null });

function referenceOf(settings: AuditSettings): DesignSystemReference | null {
  const ds = settings.designSystem;
  if (!ds) return null;
  return isReference(ds) ? ds : migrateToReference(ds);
}

/**
 * Everything the rules look at: layer snapshots, plus the selected design system prepared against
 * what this file can read (live, else captured, else unavailable), as the engine's existing inputs.
 */
async function readInputs(
  roots: readonly SceneNode[],
  settings: AuditSettings,
  hooks: Pick<AuditHooks, 'total' | 'deadline' | 'onProgress' | 'isCancelled'>,
): Promise<{ traversal: TraversalResult; data: DesignSystemData; config: AuditConfig; coverage: ReferenceCoverage; reference: DesignSystemReference }> {
  const reference = referenceOf(settings);
  if (!reference) throw new Error('No design system configured');
  const progress = hooks.onProgress ?? (() => {});
  const cancelled = hooks.isCancelled ?? (() => false);
  let lastProgress = 0;

  figma.skipInvisibleInstanceChildren = !settings.includeHidden;
  const traversal = await snapshotTree(roots, {
    includeHidden: settings.includeHidden,
    deadline: hooks.deadline,
    onProgress: (scanned) => {
      const now = Date.now();
      if (now - lastProgress > PROGRESS_INTERVAL_MS) {
        lastProgress = now;
        progress('reading', scanned, hooks.total, []);
      }
      return !cancelled();
    },
  });
  progress('resolving', traversal.scanned, hooks.total, []);

  const live = await loadDesignSystemData(traversal.nodes, traversal.mainComponents, reference.variableCollections.map((c) => c.ref));
  if (cancelled()) throw new AuditCancelled();
  if (Date.now() > hooks.deadline) throw new AuditTimedOut();
  const prepared = prepareReference(reference, live);
  const { designSystem: _stored, ...options } = settings;
  const config: AuditConfig = { ...options, designSystem: prepared.designSystem };
  return { traversal, data: prepared.data, config, coverage: prepared.coverage, reference };
}

export async function performAudit(
  roots: readonly SceneNode[],
  settings: AuditSettings,
  hooks: AuditHooks,
): Promise<{ result: AuditResult; ruleErrorCount: number }> {
  if (!settings.designSystem) throw new Error('No design system configured');
  const startedAt = new Date();
  const progress = hooks.onProgress ?? (() => {});
  const { traversal, data, config, coverage, reference } = await readInputs(roots, settings, hooks);

  const done = new Set<string>();
  const categories = [...new Set(ALL_RULES.map((r) => r.category))];
  const evaluation = evaluateNodes(traversal.nodes, data, config, ALL_RULES, (rule) => {
    done.add(rule.id);
    const categoriesDone = categories.filter((c) => ALL_RULES.filter((r) => r.category === c).every((r) => done.has(r.id)));
    progress('checking', traversal.scanned, hooks.total, categoriesDone);
  });
  for (const e of evaluation.ruleErrors) console.warn('[Design System Doctor] rule error', e);

  return {
    ruleErrorCount: evaluation.ruleErrors.length,
    result: {
      auditId: `${startedAt.getTime()}`,
      scope: hooks.scope,
      pageId: hooks.page.id,
      pageName: hooks.page.name,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      scannedNodeCount: traversal.scanned,
      skippedNodeCount: traversal.hiddenSkipped + traversal.failed,
      failedNodeCount: traversal.failed,
      issues: evaluation.issues,
      compliance: evaluation.compliance,
      designSystemName: reference.name,
      designSystemId: reference.id,
      unresolvedSources: evaluation.unresolvedSources,
      coverage,
      checksByCategory: evaluation.checksByCategory,
      rootIds: roots.map((r) => r.id),
      fingerprint: auditFingerprint(traversal.nodes, data, config),
    },
  };
}

export type Freshness = 'current' | 'changed' | 'unverified';

/** Above this, re-reading the page just to compare would cost about as much as re-auditing. */
export const FRESHNESS_MAX_LAYERS = 3000;
const FRESHNESS_BUDGET_MS = 20_000;

/**
 * Is a saved result still what an audit would report now? Re-reads exactly what the audit reads
 * (layers, referenced styles/variables/components, config) and compares fingerprints. No rules run.
 */
export async function checkFreshness(result: AuditResult, settings: AuditSettings, page: PageNode): Promise<Freshness> {
  if (!result.fingerprint || result.pageId !== page.id || !settings.designSystem) return 'unverified';
  let roots: SceneNode[];
  if (result.scope === 'page') roots = [...page.children];
  else {
    const found = await Promise.all(result.rootIds.map((id) => figma.getNodeByIdAsync(id)));
    if (found.some((n) => !n || n.removed)) return 'changed'; // an audited layer was deleted
    roots = found as SceneNode[];
  }
  const total = countLayers(roots, settings.includeHidden);
  if (total > FRESHNESS_MAX_LAYERS) return 'unverified';
  try {
    const { traversal, data, config } = await readInputs(roots, settings, { total, deadline: Date.now() + FRESHNESS_BUDGET_MS });
    if (auditFingerprint(traversal.nodes, data, config) === result.fingerprint) return 'current';
    // Saved before the design system's name was left out of the fingerprint.
    const legacy = auditFingerprint(traversal.nodes, data, config, { designSystemName: result.designSystemName });
    return legacy === result.fingerprint ? 'current' : 'changed';
  } catch {
    return 'unverified';
  }
}
