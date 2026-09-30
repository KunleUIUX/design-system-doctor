import type { NodeSnapshot, PaintSnapshot } from '../../shared/types';
import { formatColor } from '../color';
import type { DesignSystemResolver } from '../resolver';
import { isOwnValue, listNames, type AuditContext, type AuditRule, type Check, type Finding } from './types';
import { names, notVerifiable } from './unverifiable';

interface PaintGroup {
  label: string; // "Fill", "Stroke", "Text fill · “Pay”"
  paints: PaintSnapshot[];
  styleId: string;
}

function paintGroups(node: NodeSnapshot): PaintGroup[] {
  const groups: PaintGroup[] = [];
  if (node.text) {
    if (isOwnValue(node, ['fills', 'fillStyleId', 'styledTextSegments'])) {
      for (const seg of node.text) {
        groups.push({
          label: node.text.length > 1 ? `Text fill · “${seg.characters}”` : 'Text fill',
          paints: seg.fills,
          styleId: seg.fillStyleId,
        });
      }
    }
  } else if (node.fills && isOwnValue(node, ['fills', 'fillStyleId'])) {
    groups.push({ label: 'Fill', paints: node.fills, styleId: node.fillStyleId ?? '' });
  }
  if (node.strokes && isOwnValue(node, ['strokes', 'strokeStyleId'])) {
    groups.push({ label: 'Stroke', paints: node.strokes, styleId: node.strokeStyleId ?? '' });
  }
  return groups;
}

function variableNames(ids: { name: string }[]): string {
  return ids.length === 1 ? ids[0].name : `One of: ${listNames(ids.map((v) => v.name))}`;
}

function checkStyle(styleId: string, node: NodeSnapshot, resolver: DesignSystemResolver): Finding | undefined | null {
  const style = resolver.getPaintStyle(styleId);
  if (!style) return null;
  if (resolver.isPaintStyleApproved(styleId)) return undefined;
  if (style.boundVariableId && resolver.isVariableApproved(style.boundVariableId)) return undefined;
  if (!style.color) return null; // Multi-paint or gradient style: not audited in v1.

  const matches = resolver.findColorVariables(style.color, node.variableModes);
  if (matches.length > 0) {
    return {
      code: 'style-instead-of-variable',
      severity: 'error',
      message: 'Colour style used where a variable exists',
      currentValue: `${style.name} (${formatColor(style.color)})`,
      expectedValue: variableNames(matches),
      rationale: `The colour style “${style.name}” isn’t part of the design system, but its colour equals an approved variable.`,
      suggestedAction: 'Replace the style with the approved colour variable.',
    };
  }
  if (!resolver.hasApprovedColorVariables()) return null;
  return {
    code: 'unapproved-style',
    severity: 'warning',
    message: 'Colour style not in design system',
    currentValue: `${style.name} (${formatColor(style.color)})`,
    expectedValue: 'An approved colour variable',
    rationale: `“${style.name}” isn’t an approved colour source and doesn’t match any approved colour token.`,
    suggestedAction: 'Use an approved colour variable, or approve this style’s source in settings.',
  };
}

function checkPaint(paint: PaintSnapshot, node: NodeSnapshot, ctx: AuditContext): Finding | undefined | null {
  const { resolver } = ctx;
  if (paint.type !== 'SOLID' || !paint.visible || !paint.color) return null;

  if (paint.boundVariableId) {
    const v = resolver.getVariable(paint.boundVariableId);
    if (!v)
      return notVerifiable(
        `${formatColor(paint.color)} (bound variable can’t be read)`,
        'This colour is bound to a variable Figma couldn’t load here, usually because its library isn’t available to this file.',
        'Check the library is enabled for this file, then re-run the audit.',
      );
    if (resolver.isVariableApproved(v.id)) return undefined;
    const matches = resolver.findColorVariables(paint.color, node.variableModes);
    return {
      code: 'unapproved-variable',
      severity: 'warning',
      message: 'Colour variable not in design system',
      currentValue: `${v.name} (${formatColor(paint.color)})`,
      expectedValue: matches.length ? variableNames(matches) : 'A variable from an approved collection',
      rationale: `“${v.name}” comes from a collection that isn’t part of the configured design system.`,
      suggestedAction: matches.length ? 'Swap to the approved variable with the same value.' : 'Use a variable from an approved collection.',
    };
  }

  const unresolved = resolver.unresolvedCollections();
  const color = paint.color;
  const cantCompare = () =>
    notVerifiable(
      formatColor(color),
      `Doctor can’t read the tokens in ${names(unresolved)} in this file (the library isn’t used here yet), so it can’t tell whether this raw colour should be one of them.`,
      'Use a token from that collection somewhere in this file, or check the colour by hand. It doesn’t affect the score.',
    );
  if (!resolver.hasApprovedColorVariables()) return unresolved.length ? cantCompare() : null;

  const matches = resolver.findColorVariables(paint.color, node.variableModes);
  if (matches.length > 0) {
    return {
      code: 'raw-matches-token',
      severity: 'error',
      message: 'Colour not linked to variable',
      currentValue: formatColor(paint.color),
      expectedValue: variableNames(matches),
      rationale:
        matches.length === 1
          ? `This colour equals the approved variable “${matches[0].name}” but is stored as a raw value, so it won’t follow theme or token changes.`
          : `This colour equals ${matches.length} approved variables but is stored as a raw value. Pick the one whose meaning fits this layer.`,
      suggestedAction: 'Link the colour to the variable.',
    };
  }

  const near = resolver.findNearColorVariable(paint.color, node.variableModes, ctx.config.nearColorThreshold);
  if (near) {
    return {
      code: 'near-token',
      severity: 'warning',
      message: 'Colour is almost a design token',
      currentValue: formatColor(paint.color),
      expectedValue: `${near.variable.name} (ΔE ${near.delta.toFixed(1)})`,
      rationale: 'This raw colour is visually almost identical to an approved token, which usually means a typo or an eyedropped value.',
      suggestedAction: `Link to ${near.variable.name} if that’s the intended colour.`,
    };
  }

  // Some approved tokens are unreadable here: "no match" can't be claimed.
  if (unresolved.length) return cantCompare();
  // Unrelated to any token: not a violation (brief §7) and not scored, but shown for review so
  // ad-hoc colours don't silently disappear from the audit.
  return {
    code: 'unmapped',
    severity: 'review',
    message: 'Unmapped colour',
    currentValue: formatColor(paint.color),
    expectedValue: 'No approved colour token matches',
    rationale: `${formatColor(paint.color)} isn’t associated with an approved design-system colour token. It may be intentional (an illustration, a one-off) or a colour that should become a token.`,
    suggestedAction: 'Map it to an existing token, propose a new token, or leave it if it’s deliberate. It doesn’t affect the compliance score.',
  };
}

export const colorRule: AuditRule = {
  id: 'color',
  name: 'Colours',
  category: 'color',
  defaultSeverity: 'error',
  description: 'Colours should come from approved variables.',
  codes: {
    'raw-matches-token': 'Raw colour equals an approved variable',
    'near-token': 'Raw colour is a near-miss of a token',
    'unapproved-variable': 'Bound to a variable outside the design system',
    'style-instead-of-variable': 'Colour style used where a variable exists',
    'unapproved-style': 'Colour style not in design system',
    unmapped: 'Unmapped colour',
    'not-verifiable': 'Colour not verifiable in this file',
  },
  appliesTo: (node) => !!(node.fills?.length || node.strokes?.length || node.text?.length),
  evaluate(node, ctx) {
    const checks: Check[] = [];
    for (const group of paintGroups(node)) {
      if (group.styleId) {
        const finding = checkStyle(group.styleId, node, ctx.resolver);
        if (finding !== null) checks.push({ property: group.label, finding });
        continue;
      }
      const visible = group.paints.filter((p) => p.visible && p.type === 'SOLID');
      visible.forEach((paint) => {
        const finding = checkPaint(paint, node, ctx);
        if (finding === null) return;
        const index = group.paints.indexOf(paint);
        const property = group.paints.length > 1 ? `${group.label} ${index + 1}` : group.label;
        checks.push({ property, finding });
      });
    }
    return checks;
  },
};
