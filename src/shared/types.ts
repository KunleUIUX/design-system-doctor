import type { AssetRef } from './designSystem';

// Plain-data model shared by the Figma adapter, the audit engine and the UI.
// Nothing in here may reference `figma.*` or the DOM.

/**
 * error/warning are violations and lower the score. `review` marks something the rules can't
 * judge (e.g. a colour with no related token): shown for a designer to decide, never scored.
 * `unverifiable` means a check couldn't be evaluated in this file (e.g. an approved library
 * collection isn't readable here): never scored, and never reported as a pass.
 */
export type Severity = 'error' | 'warning' | 'review' | 'unverifiable';

export type AuditCategory = 'typography' | 'color' | 'components' | 'spacing' | 'radius';

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  typography: 'Typography',
  color: 'Colours',
  components: 'Components',
  spacing: 'Spacing',
  radius: 'Corner radius',
};

export const CATEGORY_ORDER: AuditCategory[] = ['typography', 'color', 'components', 'spacing', 'radius'];

// ─── Snapshots (what the adapter reads from Figma) ──────────────────────────

export interface RGBA {
  r: number; // 0..1
  g: number;
  b: number;
  a: number;
}

export interface PaintSnapshot {
  /** Only SOLID paints carry a colour; others are recorded so we can count/skip them. */
  type: 'SOLID' | 'OTHER';
  visible: boolean;
  color?: RGBA; // colour × paint opacity in `a`
  boundVariableId?: string;
}

export interface LineHeightValue {
  unit: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

export interface TextProps {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: LineHeightValue;
  letterSpacing: { unit: 'PIXELS' | 'PERCENT'; value: number };
}

export interface TextSegmentSnapshot extends TextProps {
  start: number;
  end: number;
  characters: string; // truncated preview
  textStyleId: string; // '' when none
  fills: PaintSnapshot[];
  fillStyleId: string;
}

export type SpacingField =
  | 'itemSpacing'
  | 'counterAxisSpacing'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'gridRowGap'
  | 'gridColumnGap';

export type RadiusField = 'cornerRadius' | 'topLeftRadius' | 'topRightRadius' | 'bottomRightRadius' | 'bottomLeftRadius';

export interface LayoutSnapshot {
  mode: 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  /** Only fields that are meaningful for this layout are present. */
  values: Partial<Record<SpacingField, number>>;
  boundVariables: Partial<Record<SpacingField, string>>;
}

export interface RadiusSnapshot {
  /** Either a single uniform radius or four corners. */
  values: Partial<Record<RadiusField, number>>;
  boundVariables: Partial<Record<RadiusField, string>>;
  width: number;
  height: number;
}

export interface MainComponentRef {
  id: string;
  key: string;
  name: string; // "Set / Variant" when inside a component set
  remote: boolean;
}

export interface NodeSnapshot {
  id: string;
  name: string;
  type: string;
  /** Ancestor names, page excluded, for display ("Checkout / Footer / Pay button"). */
  path: string[];
  /** True for layers inside an instance (not the instance itself). */
  insideInstance: boolean;
  /**
   * Present on instances and on layers inside them: the fields the designer overrode. Everything
   * else is inherited from the main component and is audited there, not here.
   */
  instanceOverrides?: string[];
  fills?: PaintSnapshot[];
  fillStyleId?: string;
  strokes?: PaintSnapshot[];
  strokeStyleId?: string;
  text?: TextSegmentSnapshot[];
  layout?: LayoutSnapshot;
  radius?: RadiusSnapshot;
  instance?: { main: MainComponentRef | null };
  detached?: { type: 'local'; componentId: string } | { type: 'library'; componentKey: string };
  component?: { key: string; structureSignature: string; width: number; height: number; setId?: string; setName?: string };
  /** collectionId → modeId the node renders in. */
  variableModes: Record<string, string>;
}

// ─── Design-system data (everything Figma knows about) ─────────────────────

export interface VariableInfo {
  id: string;
  key: string;
  name: string;
  collectionId: string;
  remote: boolean;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  /** modeId → resolved value (aliases followed). COLOR → RGBA, FLOAT → number. */
  valuesByMode: Record<string, RGBA | number | string | boolean | null>;
}

export interface CollectionInfo {
  id: string;
  key: string;
  name: string;
  remote: boolean;
  defaultModeId: string;
  variableCount: number;
}

export interface TextStyleInfo extends TextProps {
  id: string;
  key: string;
  name: string;
  remote: boolean;
}

export interface PaintStyleInfo {
  id: string;
  key: string;
  name: string;
  remote: boolean;
  /** Present only when the style is a single visible solid paint. */
  color?: RGBA;
  boundVariableId?: string;
}

export interface ComponentInfo extends MainComponentRef {
  setId?: string;
  structureSignature?: string;
  width?: number;
  height?: number;
}

export interface DesignSystemData {
  collections: CollectionInfo[];
  variables: VariableInfo[];
  textStyles: TextStyleInfo[];
  paintStyles: PaintStyleInfo[];
  components: ComponentInfo[];
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface SourceToggle {
  library: boolean;
  local: boolean;
}

/**
 * `library`/`local` approve everything from that origin (including assets not listed yet);
 * `items` approves specific assets. See src/shared/designSystem.ts for identity rules.
 */
export interface SourceSelection extends SourceToggle {
  items: AssetRef[];
}

export interface DesignSystemConfig {
  version: 2;
  name: string;
  /** Approved token collections. Every variable in them is an approved token. */
  variableCollections: AssetRef[];
  textStyles: SourceSelection;
  paintStyles: SourceToggle;
  components: SourceSelection;
  spacingScale: number[];
  radiusScale: number[];
}

export interface AuditConfig {
  designSystem: DesignSystemConfig | null;
  disabledRules: string[];
  includeHidden: boolean;
  /** Node ids the designer chose to ignore. */
  ignoredNodeIds: string[];
  /** ΔE (CIE76) under which a raw colour counts as a near-miss of a token. */
  nearColorThreshold: number;
}

export const DEFAULT_SPACING_SCALE = [0, 4, 8, 12, 16, 24, 32, 40, 48, 64];
export const DEFAULT_RADIUS_SCALE = [0, 4, 8, 12, 16, 999];

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  designSystem: null,
  disabledRules: [],
  includeHidden: false,
  ignoredNodeIds: [],
  nearColorThreshold: 2,
};

// ─── Results ────────────────────────────────────────────────────────────────

export interface AuditIssue {
  id: string;
  ruleId: string;
  ruleName: string;
  category: AuditCategory;
  severity: Severity;
  nodeId: string;
  nodeName: string;
  nodePath: string[];
  /** Which property was checked, e.g. "Fill 1", "Padding left", "Text “Pay now”". */
  property: string;
  /** When one value covers several properties (e.g. all four paddings), the ones it affects. */
  affects?: string[];
  message: string;
  currentValue: string;
  expectedValue: string;
  rationale: string;
  suggestedAction: string;
}

export interface ScoreBreakdown {
  /** 0..100, or null when nothing was auditable. */
  score: number | null;
  opportunities: number;
  passed: number;
  errored: number;
  warned: number;
  formula: string;
  /** How much the score can be trusted, from the number of applicable checks. */
  confidence: 'low' | 'normal' | 'high';
}

export interface AuditResult {
  auditId: string;
  scope: 'page' | 'selection';
  pageId: string;
  pageName: string;
  startedAt: string;
  completedAt: string;
  scannedNodeCount: number;
  skippedNodeCount: number;
  /** Nodes that threw while being read; subset of skipped. */
  failedNodeCount: number;
  issues: AuditIssue[];
  compliance: ScoreBreakdown;
  designSystemName: string;
  /** Approved sources that couldn't be read in this file; checks depending on them are unverifiable. */
  unresolvedSources?: AssetRef[];
  /** Layers the audit started from (page children or the selection), for freshness checks. */
  rootIds: string[];
  /**
   * Hash of everything the result depends on: the audited layers' snapshots, the design-system
   * data and the audit config. Same fingerprint ⇒ re-running would give the same result.
   */
  fingerprint: string;
}
