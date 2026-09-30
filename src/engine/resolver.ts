import { colorsEqual, deltaE } from './color';
import { matchesRef, type AssetRef } from '../shared/designSystem';
import type {
  ComponentInfo,
  DesignSystemConfig,
  DesignSystemData,
  MainComponentRef,
  PaintStyleInfo,
  RGBA,
  TextProps,
  SourceSelection,
  TextStyleInfo,
  VariableInfo,
} from '../shared/types';

/** Max font-size difference (px) for a style to be suggested as "closest". */
export const CLOSE_TEXT_SIZE = 2;

export interface ScaleCheck {
  ok: boolean;
  lower?: number;
  upper?: number;
}

/**
 * Answers "is this approved?" and "what approved thing matches this value?".
 * Built once per audit; all lookups are map-backed.
 */
export class DesignSystemResolver {
  private readonly variables = new Map<string, VariableInfo>();
  private readonly collectionDefaultMode = new Map<string, string>();
  private readonly approvedCollections: Set<string>;
  private readonly textStyles = new Map<string, TextStyleInfo>();
  private readonly paintStyles = new Map<string, PaintStyleInfo>();
  private readonly componentsByKey = new Map<string, ComponentInfo>();
  private readonly approvedColorVariables: VariableInfo[];
  private readonly approvedTextStyles: TextStyleInfo[];
  private readonly spacing: number[];
  private readonly radius: number[];
  /** Approved sources this file can't read (library not used here yet, or local asset gone). */
  readonly unresolved: AssetRef[];

  constructor(readonly data: DesignSystemData, readonly config: DesignSystemConfig) {
    for (const c of data.collections) this.collectionDefaultMode.set(c.id, c.defaultModeId);
    for (const v of data.variables) this.variables.set(v.id, v);
    for (const s of data.textStyles) this.textStyles.set(s.id, s);
    for (const s of data.paintStyles) this.paintStyles.set(s.id, s);
    for (const c of data.components) if (c.key) this.componentsByKey.set(c.key, c);

    // Refs → this file's collection ids. Library refs match by key, so the same saved config
    // resolves correctly in any file that uses the library.
    this.approvedCollections = new Set(
      data.collections.filter((c) => config.variableCollections.some((r) => matchesRef(r, c))).map((c) => c.id),
    );
    this.unresolved = [
      ...config.variableCollections.filter((r) => !data.collections.some((c) => matchesRef(r, c))),
      ...config.textStyles.items.filter((r) => !data.textStyles.some((s) => matchesRef(r, s))),
    ];
    this.approvedColorVariables = data.variables.filter(
      (v) => v.resolvedType === 'COLOR' && this.approvedCollections.has(v.collectionId),
    );
    this.approvedTextStyles = data.textStyles.filter((s) => this.isTextStyleApproved(s.id));
    this.spacing = [...new Set(config.spacingScale)].sort((a, b) => a - b);
    this.radius = [...new Set(config.radiusScale)].sort((a, b) => a - b);
  }

  // ── Variables ────────────────────────────────────────────────────────────

  getVariable(id: string): VariableInfo | undefined {
    return this.variables.get(id);
  }

  isVariableApproved(id: string): boolean {
    const v = this.variables.get(id);
    return !!v && this.approvedCollections.has(v.collectionId);
  }

  hasApprovedColorVariables(): boolean {
    return this.approvedColorVariables.length > 0;
  }

  /** Approved collections whose tokens can't be read here, so token matching is incomplete. */
  unresolvedCollections(): AssetRef[] {
    return this.config.variableCollections.filter((r) => !this.data.collections.some((c) => matchesRef(r, c)));
  }

  private colorIn(v: VariableInfo, modes: Record<string, string>): RGBA | null {
    const modeId = modes[v.collectionId] ?? this.collectionDefaultMode.get(v.collectionId);
    const value = modeId ? v.valuesByMode[modeId] : undefined;
    return value && typeof value === 'object' ? (value as RGBA) : null;
  }

  /** Approved colour variables whose value, in the mode the node renders in, equals `color`. */
  findColorVariables(color: RGBA, modes: Record<string, string>): VariableInfo[] {
    return this.approvedColorVariables.filter((v) => {
      const c = this.colorIn(v, modes);
      return !!c && colorsEqual(c, color);
    });
  }

  /** Closest approved colour variable within `maxDelta`, excluding exact matches. */
  findNearColorVariable(color: RGBA, modes: Record<string, string>, maxDelta: number): { variable: VariableInfo; delta: number } | null {
    let best: { variable: VariableInfo; delta: number } | null = null;
    for (const v of this.approvedColorVariables) {
      const c = this.colorIn(v, modes);
      if (!c || colorsEqual(c, color)) continue;
      const d = deltaE(c, color);
      if (d <= maxDelta && (!best || d < best.delta)) best = { variable: v, delta: d };
    }
    return best;
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  getTextStyle(id: string): TextStyleInfo | undefined {
    return this.textStyles.get(id);
  }

  isTextStyleApproved(id: string): boolean {
    const s = this.textStyles.get(id);
    return !!s && approvedBy(this.config.textStyles, s);
  }

  hasApprovedTextStyles(): boolean {
    return this.approvedTextStyles.length > 0;
  }

  /**
   * Individually approved text styles this file can't read (usually a library style the file
   * hasn't used yet). Their values are unknown, so unstyled text can't be ruled out against them.
   * Whole-source approvals ("all library text styles") can't be listed here: Figma only exposes
   * library styles once a file uses them.
   */
  unresolvedTextStyles(): AssetRef[] {
    return this.config.textStyles.items.filter((r) => !this.data.textStyles.some((s) => matchesRef(r, s)));
  }

  /** Approved text styles whose font, size, line-height and letter-spacing all equal `props`. */
  findTextStylesMatching(props: TextProps): TextStyleInfo[] {
    return this.approvedTextStyles.filter((s) => textPropsEqual(s, props));
  }

  /**
   * An approved style close enough to suggest: same family and weight/style, font size within
   * CLOSE_TEXT_SIZE px. Returns null otherwise: suggesting e.g. a semibold button label for an
   * italic footnote (the old "always something" behaviour) points designers the wrong way.
   */
  findCloseTextStyle(props: TextProps): TextStyleInfo | null {
    let best: TextStyleInfo | null = null;
    for (const s of this.approvedTextStyles) {
      if (s.fontFamily !== props.fontFamily || s.fontStyle !== props.fontStyle) continue;
      const d = Math.abs(s.fontSize - props.fontSize);
      if (d <= CLOSE_TEXT_SIZE && (!best || d < Math.abs(best.fontSize - props.fontSize))) best = s;
    }
    return best;
  }

  getPaintStyle(id: string): PaintStyleInfo | undefined {
    return this.paintStyles.get(id);
  }

  isPaintStyleApproved(id: string): boolean {
    const s = this.paintStyles.get(id);
    if (!s) return false;
    return s.remote ? this.config.paintStyles.library : this.config.paintStyles.local;
  }

  // ── Components ───────────────────────────────────────────────────────────

  isComponentApproved(main: MainComponentRef): boolean {
    return approvedBy(this.config.components, main);
  }

  /** Whether any component source is configured at all (otherwise component sources aren't judged). */
  hasComponentSources(): boolean {
    const c = this.config.components;
    return c.library || c.local || c.items.length > 0;
  }

  componentNameForKey(key: string): string | undefined {
    return this.componentsByKey.get(key)?.name;
  }

  componentName(id: string): string | undefined {
    return this.data.components.find((c) => c.id === id)?.name;
  }

  // ── Scales ───────────────────────────────────────────────────────────────

  checkSpacing(value: number): ScaleCheck {
    return checkScale(value, this.spacing);
  }

  checkRadius(value: number, width: number, height: number): ScaleCheck {
    const r = Math.round(value * 100) / 100;
    // Any radius that fully rounds the shape renders identically to the scale's "full" value.
    const full = this.radius.find((v) => v >= 100);
    if (full !== undefined && r >= Math.min(width, height) / 2 && Math.min(width, height) > 0) return { ok: true };
    return checkScale(r, this.radius);
  }

  get spacingScale(): readonly number[] {
    return this.spacing;
  }
  get radiusScale(): readonly number[] {
    return this.radius;
  }
}

/** Approved by an "everything from libraries/this file" switch, or listed individually. */
function approvedBy(sel: SourceSelection, asset: { id: string; key: string; name: string; remote: boolean }): boolean {
  if (asset.remote ? sel.library : sel.local) return true;
  return sel.items.some((r) => matchesRef(r, asset));
}

export function textPropsEqual(a: TextProps, b: TextProps): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontStyle === b.fontStyle &&
    approx(a.fontSize, b.fontSize) &&
    a.lineHeight.unit === b.lineHeight.unit &&
    (a.lineHeight.unit === 'AUTO' || approx(a.lineHeight.value ?? 0, b.lineHeight.value ?? 0)) &&
    letterSpacingEqual(a.letterSpacing, b.letterSpacing)
  );
}

function letterSpacingEqual(a: TextProps['letterSpacing'], b: TextProps['letterSpacing']): boolean {
  // 0px and 0% are the same thing; otherwise units must agree.
  if (approx(a.value, 0) && approx(b.value, 0)) return true;
  return a.unit === b.unit && approx(a.value, b.value);
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function checkScale(value: number, scale: number[]): ScaleCheck {
  if (scale.some((s) => approx(s, value))) return { ok: true };
  let lower: number | undefined;
  let upper: number | undefined;
  for (const s of scale) {
    if (s < value) lower = s;
    else if (upper === undefined) upper = s;
  }
  return { ok: false, lower, upper };
}
