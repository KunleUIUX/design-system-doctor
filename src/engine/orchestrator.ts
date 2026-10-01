import type { AssetRef } from '../shared/designSystem';
import type { AuditCategory, AuditConfig, AuditIssue, DesignSystemData, NodeSnapshot, ScoreBreakdown } from '../shared/types';
import { DesignSystemResolver } from './resolver';
import { ALL_RULES } from './rules';
import type { AuditContext, AuditRule, Check } from './rules/types';
import { computeCompliance, type ScoredCheck } from './scoring';

export interface EvaluationResult {
  issues: AuditIssue[];
  compliance: ScoreBreakdown;
  /** Approved sources this file couldn't read. */
  unresolvedSources: AssetRef[];
  /** Rule crashes are isolated per node and reported, never swallowed. */
  ruleErrors: { ruleId: string; nodeId: string; message: string }[];
  /** Scored checks per category (the same checks the score counts), so a category that was checked and fully passed can be shown. */
  checksByCategory: Partial<Record<AuditCategory, number>>;
}

export function isRuleEnabled(ruleId: string, disabled: string[]): boolean {
  // "color" disables the whole rule, "color/near-token" disables one finding type.
  return !disabled.some((d) => ruleId === d || ruleId.startsWith(d + '/'));
}

const SEVERITY_ORDER = { error: 0, warning: 1, unverifiable: 2, review: 3 };

/**
 * Runs every enabled rule over pre-read node snapshots. Pure: no Figma access, so it can be
 * unit-tested with fixtures and re-run cheaply.
 */
export function evaluateNodes(
  nodes: NodeSnapshot[],
  data: DesignSystemData,
  config: AuditConfig,
  rules: AuditRule[] = ALL_RULES,
  onRuleDone?: (rule: AuditRule) => void,
): EvaluationResult {
  if (!config.designSystem) throw new Error('No design system configured');
  const ctx: AuditContext = { resolver: new DesignSystemResolver(data, config.designSystem), config };
  const ignored = new Set(config.ignoredNodeIds);
  const auditable = nodes.filter((n) => !ignored.has(n.id));

  const scored: ScoredCheck[] = [];
  const checkedKeys = new Map<AuditCategory, Set<string>>();
  const issues = new Map<string, AuditIssue>();
  const ruleErrors: EvaluationResult['ruleErrors'] = [];

  const record = (rule: AuditRule, node: NodeSnapshot, check: Check) => {
    const f = check.finding;
    const ruleId = f ? `${rule.id}/${f.code}` : rule.id;
    if (f && !isRuleEnabled(ruleId, config.disabledRules)) return;
    const key = `${node.id}|${check.property}`;
    // Review and not-verifiable items are shown but never scored: neither passes nor violations.
    if (f?.severity !== 'review' && f?.severity !== 'unverifiable') {
      scored.push({ key, severity: f?.severity });
      if (!checkedKeys.has(rule.category)) checkedKeys.set(rule.category, new Set());
      checkedKeys.get(rule.category)!.add(key);
    }
    if (!f) return;
    const id = `${ruleId}|${key}`;
    if (issues.has(id)) return; // dedupe identical findings
    issues.set(id, {
      id,
      ruleId,
      ruleName: rule.codes[f.code] ?? rule.name,
      category: rule.category,
      severity: f.severity,
      nodeId: node.id,
      nodeName: node.name,
      nodePath: node.path,
      property: check.property,
      ...(check.affects && check.affects.length > 1 ? { affects: check.affects } : {}),
      message: f.message,
      currentValue: f.currentValue,
      expectedValue: f.expectedValue,
      ...(f.expectedLabel ? { expectedLabel: f.expectedLabel } : {}),
      rationale: f.rationale,
      suggestedAction: f.suggestedAction,
    });
  };

  for (const rule of rules) {
    if (!isRuleEnabled(rule.id, config.disabledRules)) continue;
    for (const node of auditable) {
      try {
        if (!rule.appliesTo(node, ctx)) continue;
        for (const check of rule.evaluate(node, ctx)) record(rule, node, check);
      } catch (e) {
        ruleErrors.push({ ruleId: rule.id, nodeId: node.id, message: String(e) });
      }
    }
    if (rule.evaluatePage) {
      try {
        for (const check of rule.evaluatePage(auditable, ctx)) record(rule, check.node, check);
      } catch (e) {
        ruleErrors.push({ ruleId: rule.id, nodeId: '', message: String(e) });
      }
    }
    onRuleDone?.(rule);
  }

  const sorted = [...issues.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.nodePath.join('/').localeCompare(b.nodePath.join('/')),
  );
  const checksByCategory: Partial<Record<AuditCategory, number>> = {};
  for (const [category, keys] of checkedKeys) checksByCategory[category] = keys.size;
  return { issues: sorted, compliance: computeCompliance(scored), ruleErrors, unresolvedSources: ctx.resolver.unresolved, checksByCategory };
}
