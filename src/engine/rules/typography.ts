import type { TextProps, TextSegmentSnapshot } from '../../shared/types';
import { isOwnValue, listNames, type AuditRule, type Check, type Finding } from './types';
import { notVerifiable } from './unverifiable';
import type { DesignSystemResolver } from '../resolver';

const TEXT_FIELDS = ['textStyleId', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'styledTextSegments', 'characters'];

export function describeTextProps(p: TextProps): string {
  const lh =
    p.lineHeight.unit === 'AUTO' ? 'auto' : p.lineHeight.unit === 'PERCENT' ? `${round(p.lineHeight.value!)}%` : `${round(p.lineHeight.value!)}`;
  const ls = Math.abs(p.letterSpacing.value) < 0.01 ? '' : ` · ${round(p.letterSpacing.value)}${p.letterSpacing.unit === 'PERCENT' ? '%' : 'px'} tracking`;
  return `${p.fontFamily} ${p.fontStyle} ${round(p.fontSize)}/${lh}${ls}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

function expectedFor(props: TextProps, resolver: DesignSystemResolver): string {
  const matches = resolver.findTextStylesMatching(props);
  if (matches.length === 1) return matches[0].name;
  if (matches.length > 1) return `One of: ${listNames(matches.map((m) => m.name))}`;
  const nearest = resolver.findCloseTextStyle(props);
  return nearest ? `An approved text style (closest: ${nearest.name})` : 'An approved text style';
}

const SOURCES_UNAVAILABLE = 'One or more approved typography sources aren’t available in this file.';

/**
 * Not verifiable because approved typography can't be read here. Names the approved style only
 * when exactly one is unavailable; otherwise it doesn't guess which one applies.
 */
function styleUnavailable(currentValue: string, approved: string, rationale: string): Finding {
  return {
    ...notVerifiable(
      currentValue,
      rationale,
      'Make sure the library is enabled and its styles are used in this file, then re-run the audit. Until then, check this text by hand.',
    ),
    message: 'Text style unavailable',
    expectedLabel: 'Approved style',
    expectedValue: approved,
  };
}

function checkSegment(seg: TextSegmentSnapshot, resolver: DesignSystemResolver): Finding | undefined | null {
  const unavailable = resolver.unresolvedTextStyles();

  if (seg.textStyleId) {
    const style = resolver.getTextStyle(seg.textStyleId);
    if (!style)
      return styleUnavailable(
        'Text style can’t be read',
        // The applied style is unreadable, so which approved style (if any) it is can't be known.
        unavailable.length > 0 ? SOURCES_UNAVAILABLE : 'The applied text style can’t be identified in this file.',
        'This text uses a library style that Figma hasn’t made available in this file, so Design System Doctor can’t fully compare it against the approved typography sources.',
      );
    // A readable style decides this on its own; unavailable approved styles can't change the result.
    if (resolver.isTextStyleApproved(style.id)) return undefined;
    return {
      code: 'unapproved-style',
      severity: 'error',
      message: 'Text style not in design system',
      currentValue: `${style.name}${style.remote ? ' (library)' : ' (local)'}`,
      expectedValue: expectedFor(seg, resolver),
      rationale: `“${style.name}” isn’t one of the approved text styles, so this text won’t update when the design system changes.`,
      suggestedAction: 'Apply an approved text style from the design system.',
    };
  }

  // An exact match with a readable approved style is certain whatever the unavailable ones are.
  const matches = resolver.findTextStylesMatching(seg);
  if (matches.length > 0) {
    return {
      code: 'local-matches-style',
      severity: 'error',
      message: 'Text styled locally instead of with a text style',
      currentValue: `No style · ${describeTextProps(seg)}`,
      expectedValue: matches.length === 1 ? matches[0].name : `One of: ${listNames(matches.map((m) => m.name))}`,
      rationale:
        matches.length === 1
          ? `These values exactly match the approved style “${matches[0].name}”, but the style isn’t applied, so future changes to it won’t reach this text.`
          : 'These values exactly match several approved styles, but none is applied.',
      suggestedAction: 'Apply the matching text style.',
    };
  }

  // No readable approved style matches, but an unavailable one might: a "no style" warning (or
  // silently skipping when none are readable) would claim a comparison that wasn't possible.
  if (unavailable.length > 0) {
    const one = unavailable.length === 1 ? unavailable[0] : null;
    return styleUnavailable(
      `No style · ${describeTextProps(seg)}`,
      one ? one.name : SOURCES_UNAVAILABLE,
      one
        ? `This text has no text style, and the approved style “${one.name}” isn’t available in this file, so Design System Doctor can’t tell whether this text should use it.`
        : `This text has no text style, and ${unavailable.length} approved text styles aren’t available in this file, so Design System Doctor can’t fully compare it against the approved typography sources.`,
    );
  }

  if (!resolver.hasApprovedTextStyles()) return null; // Nothing to compare against.

  const nearest = resolver.findCloseTextStyle(seg);
  return {
    code: 'no-style',
    severity: 'warning',
    message: 'Text has no text style',
    currentValue: `No style · ${describeTextProps(seg)}`,
    expectedValue: nearest ? `An approved text style (closest: ${nearest.name})` : 'An approved text style',
    rationale: nearest
      ? `No approved style matches exactly; “${nearest.name}” is within a couple of pixels. This may be intentional, so it’s a warning rather than an error.`
      : 'No approved style is close to these values. It may be a legitimate one-off (legal text, a special heading) or a missing style, so it’s a warning rather than an error.',
    suggestedAction: nearest
      ? `Apply “${nearest.name}” if that’s what was intended, or add this combination to the design system.`
      : 'Apply an approved text style, add this combination to the design system, or ignore this layer if it’s a deliberate one-off.',
  };
}

export const typographyRule: AuditRule = {
  id: 'typography',
  name: 'Typography',
  category: 'typography',
  defaultSeverity: 'error',
  description: 'Text should use approved text styles.',
  codes: {
    'unapproved-style': 'Text style not in design system',
    'local-matches-style': 'Local styling matches an approved style',
    'no-style': 'Text has no text style',
    'not-verifiable': 'Text style unavailable',
  },
  appliesTo: (node) => !!node.text?.length && isOwnValue(node, TEXT_FIELDS),
  evaluate(node, { resolver }) {
    const segs = node.text!;
    const checks: Check[] = [];
    for (const seg of segs) {
      const finding = checkSegment(seg, resolver);
      if (finding === null) continue;
      checks.push({
        property: segs.length > 1 ? `Text style · “${seg.characters}”` : 'Text style',
        finding,
      });
    }
    return checks;
  },
};
