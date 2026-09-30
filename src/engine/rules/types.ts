import type { AuditCategory, AuditConfig, NodeSnapshot, Severity } from '../../shared/types';
import type { DesignSystemResolver } from '../resolver';

export interface AuditContext {
  resolver: DesignSystemResolver;
  config: AuditConfig;
}

/** A violation found by one check. `code` becomes the second half of the issue's rule id. */
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  currentValue: string;
  expectedValue: string;
  /** Replaces the "Expected" label when that would be misleading (e.g. "Approved style" for a source that can't be read). The current value isn't shown then. */
  expectedLabel?: string;
  rationale: string;
  suggestedAction: string;
}

/**
 * One property a rule actually examined. Every check is one scoring opportunity, whether or not
 * it produced a finding, so the score and the issue list come from the same data.
 */
export interface Check {
  property: string;
  /** Properties this one check covers when they share a value (e.g. ['Top', 'Right', …]). */
  affects?: string[];
  finding?: Finding;
}

export interface NodeCheck extends Check {
  node: NodeSnapshot;
}

export interface AuditRule {
  id: string;
  name: string;
  category: AuditCategory;
  defaultSeverity: Severity;
  description: string;
  /** Finding codes this rule can emit, for configuration UI and docs. */
  codes: Record<string, string>;
  appliesTo(node: NodeSnapshot, ctx: AuditContext): boolean;
  evaluate(node: NodeSnapshot, ctx: AuditContext): Check[];
  /** Optional cross-node pass after all nodes are evaluated (e.g. duplicate detection). */
  evaluatePage?(nodes: NodeSnapshot[], ctx: AuditContext): NodeCheck[];
}

/** True when the node isn't inside/an instance, or when one of `fields` was overridden. */
export function isOwnValue(node: NodeSnapshot, fields: string[]): boolean {
  if (!node.instanceOverrides) return true;
  return fields.some((f) => node.instanceOverrides!.includes(f));
}

export function listNames(names: string[], max = 3): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}
