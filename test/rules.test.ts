import { describe, expect, it } from 'vitest';
import { colorRule } from '../src/engine/rules/color';
import { detachedComponentRule, duplicateComponentRule } from '../src/engine/rules/components';
import { radiusRule, spacingRule } from '../src/engine/rules/scale';
import { typographyRule } from '../src/engine/rules/typography';
import { buildStructureSignature } from '../src/engine/signature';
import type { AuditRule } from '../src/engine/rules/types';
import type { NodeSnapshot } from '../src/shared/types';
import {
  BODY_MEDIUM,
  HEADING,
  LOCAL_BODY,
  auditConfig,
  colorVar,
  ctx,
  data,
  hex,
  node,
  segment,
  solid,
} from './fixtures';

const run = (rule: AuditRule, n: NodeSnapshot, c = ctx()) => (rule.appliesTo(n, c) ? rule.evaluate(n, c) : []);
const codes = (checks: { finding?: { code: string } }[]) => checks.map((c) => c.finding?.code ?? 'pass');

describe('typography', () => {
  it('passes text using an approved style', () => {
    expect(codes(run(typographyRule, node({ type: 'TEXT', text: [segment({ textStyleId: BODY_MEDIUM.id })] })))).toEqual(['pass']);
  });

  it('flags a style from outside the design system and suggests the matching approved one', () => {
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment({ textStyleId: LOCAL_BODY.id, fontSize: 15 })] }));
    expect(check.finding?.code).toBe('unapproved-style');
    expect(check.finding?.severity).toBe('error');
    expect(check.finding?.currentValue).toBe('Body 15 (local)');
    expect(check.finding?.expectedValue).toContain('Body / Medium');
  });

  it('flags local styling that exactly matches an approved style as an error', () => {
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment()] }));
    expect(check.finding?.code).toBe('local-matches-style');
    expect(check.finding?.severity).toBe('error');
    expect(check.finding?.expectedValue).toBe('Body / Medium');
  });

  it('treats 0px and 0% letter-spacing as equal', () => {
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment({ letterSpacing: { unit: 'PIXELS', value: 0 } })] }));
    expect(check.finding?.code).toBe('local-matches-style');
  });

  it('only warns when unstyled text matches nothing, with the closest style as a hint', () => {
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment({ fontSize: 17 })] }));
    expect(check.finding?.code).toBe('no-style');
    expect(check.finding?.severity).toBe('warning');
    expect(check.finding?.expectedValue).toContain('Body / Medium');
  });

  it('does not suggest an unrelated style for a one-off (validation case: italic 11/14 footnote)', () => {
    // Previously "closest: Heading / L" style hints were produced for any text; see resolver.findCloseTextStyle.
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment({ fontStyle: 'Italic', fontSize: 11, lineHeight: { unit: 'PIXELS', value: 14 } })] }));
    expect(check.finding).toMatchObject({ code: 'no-style', severity: 'warning', expectedValue: 'An approved text style' });
    expect(check.finding?.rationale).toContain('legitimate one-off');
  });

  it('suggests a style only when it is genuinely close (same family and weight, ≤2px)', () => {
    const near = run(typographyRule, node({ type: 'TEXT', text: [segment({ fontSize: 15, lineHeight: { unit: 'PIXELS', value: 22 } })] }));
    expect(near[0].finding?.expectedValue).toBe('An approved text style (closest: Body / Medium)');
    const far = run(typographyRule, node({ type: 'TEXT', text: [segment({ fontSize: 20 })] }));
    expect(far[0].finding?.expectedValue).toBe('An approved text style');
  });

  it('checks every run of mixed text separately', () => {
    const checks = run(
      typographyRule,
      node({
        type: 'TEXT',
        text: [segment({ characters: 'Total', textStyleId: HEADING.id }), segment({ characters: '$20', fontSize: 15 })],
      }),
    );
    expect(codes(checks)).toEqual(['pass', 'no-style']);
    expect(checks[1].property).toBe('Text style · “$20”');
  });

  it('reports an unreadable style as not verifiable instead of guessing or passing', () => {
    const [check] = run(typographyRule, node({ type: 'TEXT', text: [segment({ textStyleId: 'S:missing' })] }));
    expect(check.finding).toMatchObject({ code: 'not-verifiable', severity: 'unverifiable' });
  });

  describe('when some individually approved styles can’t be read in this file', () => {
    // BODY_MEDIUM (k-body) and HEADING (k-heading) are readable in data(); "Caption" and "Overline" aren't.
    const lib = (key: string, name: string) => ({ source: 'library' as const, key, name });
    const BODY = lib('k-body', 'Body / Medium');
    const HEAD = lib('k-heading', 'Heading / L');
    const CAPTION = lib('k-caption', 'Caption');
    const OVERLINE = lib('k-overline', 'Overline');
    const picked = (...items: ReturnType<typeof lib>[]) =>
      ctx(data(), auditConfig({ textStyles: { library: false, local: false, items } }));
    const text = (seg = segment()) => node({ type: 'TEXT', text: [seg] });

    it('1. all approved styles readable: normal comparison', () => {
      const c = picked(BODY, HEAD);
      expect(c.resolver.unresolvedTextStyles()).toEqual([]);
      expect(codes(run(typographyRule, text(), c))).toEqual(['local-matches-style']);
      expect(run(typographyRule, text(segment({ fontSize: 17 })), c)[0].finding).toMatchObject({ code: 'no-style', severity: 'warning' });
    });

    it('2. an unavailable style that can’t change the result leaves it as is', () => {
      const c = picked(BODY, CAPTION);
      // Applied readable styles decide on their own, approved or not.
      expect(codes(run(typographyRule, text(segment({ textStyleId: BODY_MEDIUM.id })), c))).toEqual(['pass']);
      expect(codes(run(typographyRule, text(segment({ textStyleId: HEADING.id })), c))).toEqual(['unapproved-style']);
      // An exact match with a readable approved style is certain regardless of Caption.
      expect(run(typographyRule, text(), c)[0].finding).toMatchObject({ code: 'local-matches-style', severity: 'error', expectedValue: 'Body / Medium' });
    });

    it('3. unstyled text an unavailable style could match is not verifiable, naming that style', () => {
      const [check] = run(typographyRule, text(segment({ fontSize: 12, lineHeight: { unit: 'PIXELS', value: 16 } })), picked(BODY, CAPTION));
      expect(check.finding).toMatchObject({
        code: 'not-verifiable',
        severity: 'unverifiable',
        message: 'Text style unavailable',
        expectedLabel: 'Approved style',
        expectedValue: 'Caption',
      });
      expect(check.finding?.rationale).toContain('“Caption” isn’t available in this file');
    });

    it('3. with several unavailable styles it doesn’t guess which one applies', () => {
      const [check] = run(typographyRule, text(segment({ fontSize: 12 })), picked(BODY, CAPTION, OVERLINE));
      expect(check.finding).toMatchObject({ severity: 'unverifiable', expectedValue: 'One or more approved typography sources aren’t available in this file.' });
      expect(check.finding?.rationale).not.toMatch(/Caption|Overline/);
    });

    it('3. when no approved style is readable, unstyled text is not verifiable instead of silently skipped', () => {
      expect(run(typographyRule, text(), picked(CAPTION))[0].finding).toMatchObject({ severity: 'unverifiable', expectedValue: 'Caption' });
    });

    it('3. an applied style Figma can’t read uses the unavailable-style wording and names nothing it can’t know', () => {
      const [check] = run(typographyRule, text(segment({ textStyleId: 'S:missing' })), picked(BODY, CAPTION));
      expect(check.finding).toMatchObject({
        severity: 'unverifiable',
        message: 'Text style unavailable',
        expectedLabel: 'Approved style',
        expectedValue: 'One or more approved typography sources aren’t available in this file.',
        rationale:
          'This text uses a library style that Figma hasn’t made available in this file, so Design System Doctor can’t fully compare it against the approved typography sources.',
      });
    });

    it('4. a genuine one-off stays a warning when every approved style could be compared', () => {
      const oneOff = text(segment({ fontStyle: 'Italic', fontSize: 11, lineHeight: { unit: 'PIXELS', value: 14 } }));
      expect(run(typographyRule, oneOff, picked(BODY, HEAD))[0].finding).toMatchObject({ code: 'no-style', severity: 'warning', expectedValue: 'An approved text style' });
      // "All library text styles" has nothing individually unavailable, so it keeps the warning too.
      expect(run(typographyRule, oneOff)[0].finding).toMatchObject({ code: 'no-style', severity: 'warning' });
    });
  });

  it('does not judge unstyled text when the design system has no approved text styles', () => {
    const c = ctx(data(), auditConfig({ textStyles: { library: false, local: false, items: [] } }));
    expect(run(typographyRule, node({ type: 'TEXT', text: [segment()] }), c)).toEqual([]);
  });

  it('skips text inside instances unless the designer overrode it', () => {
    const inherited = node({ type: 'TEXT', insideInstance: true, instanceOverrides: [], text: [segment()] });
    const overridden = node({ type: 'TEXT', insideInstance: true, instanceOverrides: ['fontSize'], text: [segment()] });
    expect(run(typographyRule, inherited)).toEqual([]);
    expect(codes(run(typographyRule, overridden))).toEqual(['local-matches-style']);
  });
});

describe('colour', () => {
  it('passes a fill bound to an approved variable', () => {
    expect(codes(run(colorRule, node({ fills: [solid('#635BFF', { boundVariableId: 'V:brand' })] })))).toEqual(['pass']);
  });

  it('flags a raw colour that equals an approved variable', () => {
    const [check] = run(colorRule, node({ fills: [solid('#635BFF')] }));
    expect(check.finding).toMatchObject({
      code: 'raw-matches-token',
      severity: 'error',
      currentValue: '#635BFF',
      expectedValue: 'color/brand/primary',
    });
  });

  it('compares against the variable value in the mode the node renders in', () => {
    const dark = node({ fills: [solid('#8A84FF')], variableModes: { 'C:ds': 'M:dark' } });
    const light = node({ fills: [solid('#8A84FF')] });
    expect(run(colorRule, dark)[0].finding?.code).toBe('raw-matches-token');
    expect(run(colorRule, light)[0].finding?.severity).toBe('review'); // matches no token in light mode
  });

  it('marks an unrelated raw colour for review instead of flagging or passing it', () => {
    // Not a violation, but not evidence of design-system use either (validation case: #E4572E).
    const [check] = run(colorRule, node({ fills: [solid('#E4572E')] }));
    expect(check.finding).toMatchObject({ code: 'unmapped', severity: 'review', currentValue: '#E4572E' });
  });

  it('does not mark colours for review when no colour tokens are approved', () => {
    const c = ctx(data(), auditConfig({ variableCollections: [] }));
    expect(run(colorRule, node({ fills: [solid('#E4572E')] }), c)).toEqual([]);
  });

  it('warns on a near-miss of a token', () => {
    const [check] = run(colorRule, node({ fills: [solid('#635BFE')] }));
    expect(check.finding?.code).toBe('near-token');
    expect(check.finding?.severity).toBe('warning');
  });

  it('lists every candidate when several approved variables match', () => {
    const d = data({ variables: [colorVar('V:a', 'color/bg/brand', '#635BFF'), colorVar('V:b', 'color/border/brand', '#635BFF')] });
    const [check] = run(colorRule, node({ fills: [solid('#635BFF')] }), ctx(d));
    expect(check.finding?.expectedValue).toBe('One of: color/bg/brand, color/border/brand');
  });

  it('checks nothing when no colour variables are approved', () => {
    const c = ctx(data(), auditConfig({ variableCollections: [] }));
    expect(run(colorRule, node({ fills: [solid('#635BFF')] }), c)).toEqual([]);
  });

  it('warns about a variable from an unapproved collection', () => {
    const [check] = run(colorRule, node({ fills: [solid('#FF0000', { boundVariableId: 'V:local' })] }));
    expect(check.finding?.code).toBe('unapproved-variable');
  });

  it('flags a non-approved colour style whose colour is an approved token', () => {
    const d = data({ paintStyles: [{ id: 'P:1', key: '', name: 'Purple', remote: false, color: hex('#635BFF') }] });
    const [check] = run(colorRule, node({ fills: [solid('#635BFF')], fillStyleId: 'P:1' }), ctx(d));
    expect(check.finding?.code).toBe('style-instead-of-variable');
  });

  it('ignores hidden and non-solid paints', () => {
    expect(run(colorRule, node({ fills: [solid('#635BFF', { visible: false }), { type: 'OTHER', visible: true }] }))).toEqual([]);
  });

  it('checks text fills per run and strokes separately', () => {
    const checks = run(
      colorRule,
      node({ type: 'TEXT', text: [segment({ fills: [solid('#111111')] })], strokes: [solid('#635BFF', { boundVariableId: 'V:brand' })] }),
    );
    expect(checks.map((c) => [c.property, c.finding?.code ?? 'pass'])).toEqual([
      ['Text fill', 'raw-matches-token'],
      ['Stroke', 'pass'],
    ]);
  });
});

describe('components', () => {
  const libMain = { id: 'C:1', key: 'btn', name: 'Button / Primary', remote: true };

  it('passes an instance of an approved library component', () => {
    expect(codes(run(detachedComponentRule, node({ type: 'INSTANCE', instance: { main: libMain } })))).toEqual(['pass']);
  });

  it('flags a detached instance and names the source component when known', () => {
    const c = ctx(data({ components: [libMain] }));
    const [check] = run(detachedComponentRule, node({ detached: { type: 'library', componentKey: 'btn' } }), c);
    expect(check.finding).toMatchObject({ code: 'detached', severity: 'error', expectedValue: 'Instance of Button / Primary' });
  });

  it('says so when the detached source name is unavailable', () => {
    const [check] = run(detachedComponentRule, node({ detached: { type: 'library', componentKey: 'zzz' } }));
    expect(check.finding?.expectedValue).toContain('name unavailable');
  });

  it('does not re-check nested instances inherited from a main component', () => {
    expect(run(detachedComponentRule, node({ type: 'INSTANCE', insideInstance: true, instance: { main: libMain } }))).toEqual([]);
  });

  it('warns about instances of non-approved local components', () => {
    const [check] = run(detachedComponentRule, node({ type: 'INSTANCE', instance: { main: { ...libMain, remote: false } } }));
    expect(check.finding?.code).toBe('unapproved-source');
    expect(check.finding?.severity).toBe('warning');
  });

  const sig = buildStructureSignature({
    type: 'COMPONENT',
    layoutMode: 'HORIZONTAL',
    children: [{ type: 'INSTANCE' }, { type: 'TEXT' }],
  });
  const comp = (name: string, extra: Partial<NonNullable<NodeSnapshot['component']>> = {}) =>
    node({ type: 'COMPONENT', name, component: { key: '', structureSignature: sig, width: 120, height: 40, ...extra } });

  it('warns about structurally identical components', () => {
    const nodes = [comp('Pay button'), comp('Checkout CTA')];
    const checks = duplicateComponentRule.evaluatePage!(nodes, ctx());
    expect(checks.map((c) => c.finding?.code)).toEqual(['possible-duplicate', 'possible-duplicate']);
    expect(checks[0].finding?.severity).toBe('warning');
  });

  it('does not treat variants of one component set as duplicates', () => {
    const checks = duplicateComponentRule.evaluatePage!([comp('A', { setId: 'set' }), comp('B', { setId: 'set' })], ctx());
    expect(checks.every((c) => !c.finding)).toBe(true);
  });

  it('does not match components of different sizes', () => {
    const checks = duplicateComponentRule.evaluatePage!([comp('A'), comp('B', { width: 200 })], ctx());
    expect(checks.every((c) => !c.finding)).toBe(true);
  });

  it('points at the library component when a local one duplicates it', () => {
    const d = data({ components: [{ ...libMain, structureSignature: sig, width: 120, height: 40 }] });
    const [check] = duplicateComponentRule.evaluatePage!([comp('My button')], ctx(d));
    expect(check.finding?.expectedValue).toBe('Button / Primary (library)');
  });
});

describe('spacing', () => {
  const layout = (values: Record<string, number>, boundVariables: Record<string, string> = {}) =>
    node({ layout: { mode: 'HORIZONTAL', values, boundVariables } });

  it('passes values on the scale and skips zero', () => {
    expect(codes(run(spacingRule, layout({ itemSpacing: 16, paddingTop: 0 })))).toEqual(['pass']);
  });

  it('flags off-scale values with the neighbouring scale steps', () => {
    const [check] = run(spacingRule, layout({ itemSpacing: 18 }));
    expect(check.finding).toMatchObject({ code: 'off-scale', severity: 'error', currentValue: '18px', expectedValue: '16px or 24px' });
  });

  it('flags negative gaps', () => {
    const [check] = run(spacingRule, layout({ itemSpacing: -4 }));
    expect(check.finding?.expectedValue).toBe('0px');
  });

  it('passes values bound to approved variables, warns on others', () => {
    const d = data({
      variables: [
        { id: 'V:s', key: 's', name: 'space/4', collectionId: 'C:ds', remote: true, resolvedType: 'FLOAT', valuesByMode: { 'M:light': 18 } },
        { id: 'V:x', key: 'x', name: 'gap', collectionId: 'C:local', remote: false, resolvedType: 'FLOAT', valuesByMode: { 'M:light': 18 } },
      ],
    });
    expect(codes(run(spacingRule, layout({ itemSpacing: 18, paddingLeft: 18 }, { itemSpacing: 'V:s', paddingLeft: 'V:x' }), ctx(d)))).toEqual([
      'pass',
      'unapproved-variable',
    ]);
  });

  it('reports one finding for the same off-scale padding on all four sides (validation case)', () => {
    const checks = run(spacingRule, layout({ paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18 }));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ property: 'Padding', affects: ['Top', 'Right', 'Bottom', 'Left'] });
    expect(checks[0].finding).toMatchObject({ code: 'off-scale', currentValue: '18px', expectedValue: '16px or 24px' });
  });

  it('groups only the sides that share a value, and keeps gap separate', () => {
    const checks = run(spacingRule, layout({ itemSpacing: 18, paddingTop: 18, paddingRight: 12, paddingBottom: 18, paddingLeft: 12 }));
    expect(checks.map((c) => [c.property, c.affects ?? null, c.finding?.code ?? 'pass'])).toEqual([
      ['Gap', null, 'off-scale'],
      ['Padding (top, bottom)', ['Top', 'Bottom'], 'off-scale'],
      ['Padding (right, left)', ['Right', 'Left'], 'pass'],
    ]);
  });

  it('does not group sides bound to different variables', () => {
    const d = data({ variables: [{ id: 'V:s', key: 's', name: 'space/4', collectionId: 'C:ds', remote: true, resolvedType: 'FLOAT', valuesByMode: { 'M:light': 16 } }] });
    const checks = run(spacingRule, layout({ paddingTop: 16, paddingBottom: 16 }, { paddingTop: 'V:s' }), ctx(d));
    expect(checks.map((c) => c.property)).toEqual(['Padding top', 'Padding bottom']);
  });

  it('uses the configured scale, not a hardcoded one', () => {
    const c = ctx(data(), auditConfig({ spacingScale: [0, 6, 18] }));
    expect(codes(run(spacingRule, layout({ itemSpacing: 18 }), c))).toEqual(['pass']);
  });
});

describe('radius', () => {
  const r = (values: Record<string, number>, width = 100, height = 40) => node({ radius: { values, boundVariables: {}, width, height } });

  it('passes approved radii', () => {
    expect(codes(run(radiusRule, r({ cornerRadius: 8 })))).toEqual(['pass']);
  });

  it('warns (not errors) about off-scale radii', () => {
    const [check] = run(radiusRule, r({ cornerRadius: 6 }));
    expect(check.finding).toMatchObject({ code: 'off-scale', severity: 'warning', expectedValue: '4px or 8px' });
  });

  it('treats any fully rounded radius as the pill value', () => {
    expect(codes(run(radiusRule, r({ cornerRadius: 20 }, 100, 40)))).toEqual(['pass']);
    expect(codes(run(radiusRule, r({ cornerRadius: 100 }, 100, 40)))).toEqual(['pass']);
  });

  it('groups mixed corners that share a value', () => {
    const checks = run(radiusRule, r({ topLeftRadius: 6, topRightRadius: 6, bottomRightRadius: 8, bottomLeftRadius: 8 }));
    expect(checks.map((c) => [c.property, c.finding?.code ?? 'pass'])).toEqual([
      ['Corner radius (top-left, top-right)', 'off-scale'],
      ['Corner radius (bottom-right, bottom-left)', 'pass'],
    ]);
  });

  it('checks mixed corners individually', () => {
    expect(codes(run(radiusRule, r({ topLeftRadius: 8, topRightRadius: 6, bottomRightRadius: 0, bottomLeftRadius: 0 })))).toEqual([
      'pass',
      'off-scale',
    ]);
  });
});
