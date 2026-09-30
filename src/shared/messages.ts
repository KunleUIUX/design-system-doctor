import type { AssetIdentity } from './designSystem';
import type { AuditCategory, AuditConfig, AuditResult, DesignSystemConfig } from './types';

export type AuditScope = 'page' | 'selection';

export interface DiscoveredCollection extends AssetIdentity {
  variableCount: number;
  colorCount: number;
}

export interface SourceCounts {
  library: number;
  local: number;
}

/**
 * What this file can see that could count as the design system: local assets, plus library
 * assets used on the current page (Figma exposes library assets to a file only once they're used).
 */
export interface Discovery {
  collections: DiscoveredCollection[];
  textStyles: AssetIdentity[];
  paintStyles: SourceCounts;
  components: AssetIdentity[];
  /** Library-first suggestion. Never saved until the designer confirms. */
  suggested: DesignSystemConfig;
}

export type AuditPhase = 'counting' | 'reading' | 'resolving' | 'checking';

export type UiToMain =
  | { type: 'init' }
  | { type: 'run-audit'; scope: AuditScope; confirmedLarge?: boolean }
  | { type: 'cancel-audit' }
  | { type: 'go-to-node'; nodeId: string }
  | { type: 'get-discovery' }
  | { type: 'check-freshness' }
  | { type: 'save-config'; config: AuditConfig };

export type AuditErrorKind = 'cannot-start' | 'timeout' | 'cancelled' | 'no-design-system' | 'empty-selection';

export type MainToUi =
  | {
      type: 'init-state';
      config: AuditConfig;
      pageName: string;
      selectionCount: number;
      lastAudit: AuditResult | null;
      /** Library-only design system last saved on this device, offered for files with none yet. */
      portable: DesignSystemConfig | null;
    }
  | { type: 'last-audit'; result: AuditResult | null }
  | { type: 'selection-changed'; pageName: string; selectionCount: number }
  | { type: 'audit-confirm-large'; layerCount: number; scope: AuditScope }
  | {
      type: 'audit-progress';
      phase: AuditPhase;
      scanned: number;
      total: number;
      categoriesDone: AuditCategory[];
    }
  | { type: 'audit-result'; result: AuditResult; ruleErrorCount: number }
  | { type: 'audit-error'; kind: AuditErrorKind; message: string }
  | { type: 'navigate-result'; nodeId: string; ok: boolean; message?: string; pageName?: string }
  | { type: 'discovery'; discovery: Discovery }
  /**
   * Whether the saved/shown audit still matches the design: `current` (same fingerprint),
   * `changed` (layers, referenced styles/variables or settings differ) or `unverified`
   * (too large to re-read cheaply, or couldn't be checked).
   */
  | { type: 'audit-freshness'; auditId: string; pageId: string; state: 'current' | 'changed' | 'unverified' }
  /** `session`: the file is read-only, so settings last until the plugin closes. */
  | { type: 'config-saved'; config: AuditConfig; savedTo: 'file' | 'session' };
