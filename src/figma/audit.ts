// The audit pipeline against live Figma nodes: read → resolve → evaluate → result.
// Shared by the plugin (src/plugin/controller.ts) and the real-file checks (dev/figma-e2e.ts).

import { auditFingerprint } from '../engine/fingerprint';
import { evaluateNodes } from '../engine/orchestrator';
import { ALL_RULES } from '../engine/rules';
import type { AuditPhase, AuditScope } from '../shared/messages';
import type { AuditCategory, AuditConfig, AuditResult, DesignSystemData } from '../shared/types';
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

/** Everything the rules look at: layer snapshots plus the design-system data they reference. */
async function readInputs(
  roots: readonly SceneNode[],
  config: AuditConfig,
  hooks: Pick<AuditHooks, 'total' | 'deadline' | 'onProgress' | 'isCancelled'>,
): Promise<{ traversal: TraversalResult; data: DesignSystemData }> {
  const progress = hooks.onProgress ?? (() => {});
  const cancelled = hooks.isCancelled ?? (() => false);
  let lastProgress = 0;

  figma.skipInvisibleInstanceChildren = !config.includeHidden;
  const traversal = await snapshotTree(roots, {
    includeHidden: config.includeHidden,
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

  const data = await loadDesignSystemData(traversal.nodes, traversal.mainComponents, config.designSystem?.variableCollections ?? []);
  if (cancelled()) throw new AuditCancelled();
  if (Date.now() > hooks.deadline) throw new AuditTimedOut();
  return { traversal, data };
}

export async function performAudit(
  roots: readonly SceneNode[],
  config: AuditConfig,
  hooks: AuditHooks,
): Promise<{ result: AuditResult; ruleErrorCount: number }> {
  if (!config.designSystem) throw new Error('No design system configured');
  const startedAt = new Date();
  const progress = hooks.onProgress ?? (() => {});
  const { traversal, data } = await readInputs(roots, config, hooks);

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
      designSystemName: config.designSystem.name,
      unresolvedSources: evaluation.unresolvedSources,
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
export async function checkFreshness(result: AuditResult, config: AuditConfig, page: PageNode): Promise<Freshness> {
  if (!result.fingerprint || result.pageId !== page.id || !config.designSystem) return 'unverified';
  let roots: SceneNode[];
  if (result.scope === 'page') roots = [...page.children];
  else {
    const found = await Promise.all(result.rootIds.map((id) => figma.getNodeByIdAsync(id)));
    if (found.some((n) => !n || n.removed)) return 'changed'; // an audited layer was deleted
    roots = found as SceneNode[];
  }
  const total = countLayers(roots, config.includeHidden);
  if (total > FRESHNESS_MAX_LAYERS) return 'unverified';
  try {
    const { traversal, data } = await readInputs(roots, config, { total, deadline: Date.now() + FRESHNESS_BUDGET_MS });
    return auditFingerprint(traversal.nodes, data, config) === result.fingerprint ? 'current' : 'changed';
  } catch {
    return 'unverified';
  }
}
