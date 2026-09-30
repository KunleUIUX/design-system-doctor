/** Minimal tree shape used to fingerprint component structure. */
export interface StructureNode {
  type: string;
  layoutMode?: string;
  children?: StructureNode[];
}

const LAYOUT_CODE: Record<string, string> = { HORIZONTAL: 'h', VERTICAL: 'v', GRID: 'g' };
const MAX_NODES = 200;

/**
 * Deterministic fingerprint of a layer tree: node types, auto-layout direction and child order.
 * Names, text content and colours are excluded on purpose; they differ between true duplicates.
 * Example: `COMPONENT.h(TEXT,INSTANCE)`.
 */
export function buildStructureSignature(root: StructureNode): string {
  let budget = MAX_NODES;
  const walk = (n: StructureNode): string => {
    budget--;
    const layout = n.layoutMode ? LAYOUT_CODE[n.layoutMode] ?? '' : '';
    const kids = budget > 0 && n.children?.length ? `(${n.children.map(walk).join(',')})` : '';
    return `${n.type}${layout ? '.' + layout : ''}${kids}`;
  };
  return walk(root);
}

export function countSignatureNodes(sig: string): number {
  return (sig.match(/[A-Z_]{2,}/g) ?? []).length;
}
