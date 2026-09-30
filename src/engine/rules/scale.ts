import type { NodeSnapshot, RadiusField, SpacingField } from '../../shared/types';
import type { DesignSystemResolver, ScaleCheck } from '../resolver';
import { isOwnValue, type AuditRule, type Check, type Finding } from './types';
import { notVerifiable } from './unverifiable';

const SPACING_LABELS: Record<SpacingField, string> = {
  itemSpacing: 'Gap',
  counterAxisSpacing: 'Row gap (wrap)',
  paddingTop: 'Padding top',
  paddingRight: 'Padding right',
  paddingBottom: 'Padding bottom',
  paddingLeft: 'Padding left',
  gridRowGap: 'Grid row gap',
  gridColumnGap: 'Grid column gap',
};

const RADIUS_LABELS: Record<RadiusField, string> = {
  cornerRadius: 'Corner radius',
  topLeftRadius: 'Top-left radius',
  topRightRadius: 'Top-right radius',
  bottomRightRadius: 'Bottom-right radius',
  bottomLeftRadius: 'Bottom-left radius',
};

const PADDING_SIDES: Partial<Record<SpacingField, string>> = { paddingTop: 'Top', paddingRight: 'Right', paddingBottom: 'Bottom', paddingLeft: 'Left' };
const CORNERS: Partial<Record<RadiusField, string>> = { topLeftRadius: 'Top-left', topRightRadius: 'Top-right', bottomRightRadius: 'Bottom-right', bottomLeftRadius: 'Bottom-left' };

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function suggestion(check: ScaleCheck): string {
  const opts = [check.lower, check.upper].filter((v): v is number => v !== undefined).map(px);
  return opts.length ? opts.join(' or ') : 'A value from the scale';
}

/** One value on a node: a single field, or several sides/corners that share value and binding. */
interface Unit {
  property: string;
  affects?: string[];
  value: number;
  bound?: string;
}

/**
 * Groups sides (padding) or corners (radius) that share a value and variable binding, so one
 * mistake such as 18px padding on every side is one check and one finding, not four. Other
 * fields stay separate because they mean different things (gap vs padding).
 */
function toUnits<F extends string>(
  fields: F[],
  values: Partial<Record<F, number>>,
  bound: Partial<Record<F, string>>,
  labels: Record<F, string>,
  groupable: Partial<Record<F, string>>,
  groupName: string,
): Unit[] {
  const keyOf = (f: F) => `${values[f]}|${bound[f] ?? ''}`;
  const members = new Map<string, F[]>();
  for (const f of fields) if (f in groupable) members.set(keyOf(f), [...(members.get(keyOf(f)) ?? []), f]);

  const units: Unit[] = [];
  for (const f of fields) {
    const group = f in groupable ? members.get(keyOf(f))! : [f];
    if (group[0] !== f) continue; // emitted with the group's first field, keeping field order
    const value = values[f]!;
    if (group.length === 1) {
      units.push({ property: labels[f], value, bound: bound[f] });
      continue;
    }
    const names = group.map((g) => groupable[g]!);
    const all = group.length === Object.keys(groupable).length;
    units.push({
      property: all ? groupName : `${groupName} (${names.map((n) => n.toLowerCase()).join(', ')})`,
      affects: names,
      value,
      bound: bound[f],
    });
  }
  return units;
}

interface ScaleRuleSpec {
  kind: 'Spacing' | 'Radius';
  check: (value: number, node: NodeSnapshot, resolver: DesignSystemResolver) => ScaleCheck;
  offScale: (unit: Unit, result: ScaleCheck, resolver: DesignSystemResolver) => Finding;
}

function evaluateUnits(units: Unit[], node: NodeSnapshot, resolver: DesignSystemResolver, spec: ScaleRuleSpec): Check[] {
  const checks: Check[] = [];
  for (const unit of units) {
    const base = { property: unit.property, affects: unit.affects };
    if (unit.bound) {
      const v = resolver.getVariable(unit.bound);
      if (!v) {
        checks.push({
          ...base,
          finding: notVerifiable(
            `${px(unit.value)} (bound variable can’t be read)`,
            'This value is bound to a variable Figma couldn’t load here, usually because its library isn’t available to this file.',
            'Check the library is enabled for this file, then re-run the audit.',
          ),
        });
        continue;
      }
      if (resolver.isVariableApproved(unit.bound)) checks.push(base);
      else
        checks.push({
          ...base,
          finding: {
            code: 'unapproved-variable',
            severity: 'warning',
            message: `${spec.kind} variable not in design system`,
            currentValue: `${v.name} (${px(unit.value)})`,
            expectedValue: `A ${spec.kind.toLowerCase()} variable from an approved collection`,
            rationale: `“${v.name}” comes from a collection that isn’t part of the configured design system.`,
            suggestedAction: `Bind to an approved ${spec.kind.toLowerCase()} variable.`,
          },
        });
      continue;
    }
    // Zero is always allowed and isn't a design decision worth scoring.
    if (unit.value === 0) continue;
    const result = spec.check(unit.value, node, resolver);
    checks.push(result.ok ? base : { ...base, finding: spec.offScale(unit, result, resolver) });
  }
  return checks;
}

export const spacingRule: AuditRule = {
  id: 'spacing',
  name: 'Spacing',
  category: 'spacing',
  defaultSeverity: 'error',
  description: 'Auto-layout gaps and padding should be on the spacing scale.',
  codes: {
    'off-scale': 'Spacing value outside the scale',
    'unapproved-variable': 'Spacing bound to a variable outside the design system',
    'not-verifiable': 'Spacing not verifiable in this file',
  },
  appliesTo: (node, { resolver }) => !!node.layout && resolver.spacingScale.length > 0,
  evaluate(node, { resolver }) {
    const { values, boundVariables } = node.layout!;
    const fields = (Object.keys(values) as SpacingField[]).filter((f) => isOwnValue(node, [f]));
    const units = toUnits(fields, values, boundVariables, SPACING_LABELS, PADDING_SIDES, 'Padding');
    return evaluateUnits(units, node, resolver, {
      kind: 'Spacing',
      check: (v, _n, r) => r.checkSpacing(v),
      offScale: (unit, result, r) => ({
        code: 'off-scale',
        severity: 'error',
        message: 'Spacing inconsistency',
        currentValue: px(unit.value),
        expectedValue: suggestion(result),
        rationale:
          `${px(unit.value)} isn’t on the spacing scale (${r.spacingScale.join(', ')}).` +
          (unit.affects ? ` It’s used on ${unit.affects.length} sides, so it’s one fix.` : '') +
          ' Off-scale spacing makes layouts drift apart.',
        suggestedAction: `Change ${unit.property.toLowerCase()} to the nearest scale value.`,
      }),
    });
  },
};

export const radiusRule: AuditRule = {
  id: 'radius',
  name: 'Corner radius',
  category: 'radius',
  defaultSeverity: 'warning',
  description: 'Corner radii should come from the approved set.',
  codes: {
    'off-scale': 'Corner radius outside the approved set',
    'unapproved-variable': 'Radius bound to a variable outside the design system',
    'not-verifiable': 'Radius not verifiable in this file',
  },
  appliesTo: (node, { resolver }) => !!node.radius && resolver.radiusScale.length > 0,
  evaluate(node, { resolver }) {
    const { values, boundVariables, width, height } = node.radius!;
    const fields = (Object.keys(values) as RadiusField[]).filter((f) => isOwnValue(node, [f, 'cornerRadius']));
    const units = toUnits(fields, values, boundVariables, RADIUS_LABELS, CORNERS, 'Corner radius');
    return evaluateUnits(units, node, resolver, {
      kind: 'Radius',
      check: (v) => resolver.checkRadius(v, width, height),
      offScale: (unit, result, r) => ({
        code: 'off-scale',
        severity: 'warning',
        message: 'Inconsistent corner radius',
        currentValue: px(unit.value),
        expectedValue: suggestion(result),
        rationale: `${px(unit.value)} isn’t in the approved radius set (${r.radiusScale.join(', ')}). Radii that fully round the shape count as the “full” value.`,
        suggestedAction: 'Use the nearest approved radius.',
      }),
    });
  },
};
