import type { AssetIdentity } from './designSystem';
import type { DesignSystemReference } from './reference';
import type { AuditCategory, AuditResult, DesignSystemConfig, PluginSettings } from './types';

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
  /** What this page uses, listed explicitly. Never saved until the designer confirms. */
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
  /** Save edits to the active design system and audit options. */
  | { type: 'save-settings'; settings: PluginSettings }
  /** Replace the active design system with a saved one. Nothing from the previous one is kept. */
  | { type: 'switch-design-system'; id: string }
  /** Capture this file's styles, variables and components as a design system, and select it. */
  | { type: 'capture-design-system' }
  /** Saved design systems list only: rename one (the selected one keeps its id and stays selected). */
  | { type: 'rename-design-system'; id: string; name: string }
  /** Saved design systems list only: remove one. Removing the selected one leaves none selected. */
  | { type: 'remove-design-system'; id: string };

export type AuditErrorKind = 'cannot-start' | 'timeout' | 'cancelled' | 'no-design-system' | 'empty-selection';

export type MainToUi =
  | {
      type: 'init-state';
      settings: PluginSettings;
      /** Design systems saved on this device, selectable as a whole. */
      library: DesignSystemReference[];
      pageName: string;
      selectionCount: number;
      lastAudit: AuditResult | null;
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
  /** `session`: the file can't store them (read-only), so settings last until the plugin closes. */
  | { type: 'settings-saved'; settings: PluginSettings; library: DesignSystemReference[]; savedTo: 'file' | 'session' }
  | { type: 'capture-failed'; message: string }
  /** The saved list changed (rename/remove) without choosing a design system. */
  | { type: 'library-updated'; settings: PluginSettings; library: DesignSystemReference[] };
