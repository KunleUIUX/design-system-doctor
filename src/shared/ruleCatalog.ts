// Rule metadata for the settings UI, kept separate from rule logic so the UI bundle carries no
// audit code. test/ruleCatalog.test.ts keeps it in sync with src/engine/rules.

export interface RuleCatalogEntry {
  id: string;
  name: string;
  description: string;
}

export const RULE_CATALOG: RuleCatalogEntry[] = [
  { id: 'typography', name: 'Typography', description: 'Text should use approved text styles.' },
  { id: 'color', name: 'Colours', description: 'Colours should come from approved variables.' },
  { id: 'component', name: 'Components', description: 'Components should be used as instances of approved components.' },
  { id: 'component-duplicate', name: 'Duplicate components', description: 'Local components that are structurally identical to another component.' },
  { id: 'spacing', name: 'Spacing', description: 'Auto-layout gaps and padding should be on the spacing scale.' },
  { id: 'radius', name: 'Corner radius', description: 'Corner radii should come from the approved set.' },
];
