// What in this file could count as the design system, for the configure screen.

import { loadDesignSystemData } from '../figma/designSystemData';
import { snapshotTree } from '../figma/snapshot';
import { refFor, type AssetIdentity } from '../shared/designSystem';
import type { Discovery } from '../shared/messages';
import { DEFAULT_RADIUS_SCALE, DEFAULT_SPACING_SCALE } from '../shared/types';

const byOriginThenName = (a: AssetIdentity, b: AssetIdentity) => Number(b.remote) - Number(a.remote) || a.name.localeCompare(b.name);

export async function discover(currentName: string | undefined): Promise<Discovery> {
  figma.skipInvisibleInstanceChildren = true;
  const traversal = await snapshotTree(figma.currentPage.children, {
    includeHidden: false,
    deadline: Date.now() + 90_000,
    onProgress: () => true,
  });
  const data = await loadDesignSystemData(traversal.nodes, traversal.mainComponents, []);

  const collections = data.collections
    .map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      remote: c.remote,
      variableCount: c.variableCount,
      colorCount: data.variables.filter((v) => v.collectionId === c.id && v.resolvedType === 'COLOR').length,
    }))
    .sort(byOriginThenName);

  const textStyles = data.textStyles.map(({ id, key, name, remote }) => ({ id, key, name, remote })).sort(byOriginThenName);

  // Components: mains of instances on this page (library and local) plus components defined here.
  const components = new Map<string, AssetIdentity>();
  for (const c of data.components) components.set(`${c.remote}|${c.remote ? c.key : c.id}`, { id: c.id, key: c.key, name: c.name, remote: c.remote });
  for (const n of traversal.nodes) {
    if (n.type !== 'COMPONENT' || !n.component) continue;
    const name = n.component.setName ? `${n.component.setName} / ${n.name}` : n.name;
    components.set(`false|${n.id}`, { id: n.id, key: n.component.key, name, remote: false });
  }
  const componentList = [...components.values()].sort(byOriginThenName);

  const paintStyles = {
    library: data.paintStyles.filter((s) => s.remote).length,
    local: data.paintStyles.filter((s) => !s.remote).length,
  };

  // Library-first suggestion; local sources only when no library is in use at all.
  const hasLibrary =
    collections.some((c) => c.remote) || textStyles.some((s) => s.remote) || componentList.some((c) => c.remote) || paintStyles.library > 0;
  const suggest = (items: AssetIdentity[]) => ({
    library: items.some((i) => i.remote),
    local: !hasLibrary && items.some((i) => !i.remote),
    items: [],
  });
  return {
    collections,
    textStyles,
    paintStyles,
    components: componentList,
    suggested: {
      version: 2,
      name: currentName ?? 'My design system',
      variableCollections: collections.filter((c) => (hasLibrary ? c.remote : true)).map(refFor),
      textStyles: suggest(textStyles),
      paintStyles: { library: paintStyles.library > 0, local: !hasLibrary && paintStyles.local > 0 },
      components: suggest(componentList),
      spacingScale: DEFAULT_SPACING_SCALE,
      radiusScale: DEFAULT_RADIUS_SCALE,
    },
  };
}
