// "Go to layer": select the exact node an issue points at and bring it into view.

export interface NavigateOutcome {
  ok: boolean;
  message?: string;
  /** Page switched to, when the node lived on another page. */
  pageName?: string;
}

export async function goToNode(nodeId: string): Promise<NavigateOutcome> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.removed || node.type === 'DOCUMENT' || node.type === 'PAGE') {
    return { ok: false, message: 'This layer no longer exists. Re-run the audit.' };
  }

  let page: BaseNode | null = node.parent;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (!page) return { ok: false, message: 'This layer is no longer on a page. Re-run the audit.' };

  let pageName: string | undefined;
  if (page.id !== figma.currentPage.id) {
    await figma.setCurrentPageAsync(page as PageNode);
    pageName = page.name;
  }

  const scene = node as SceneNode;
  figma.currentPage.selection = [scene];
  figma.viewport.scrollAndZoomIntoView([scene]);

  const hiddenAncestor = !scene.visible || hasHiddenAncestor(scene);
  return {
    ok: true,
    pageName,
    message: hiddenAncestor ? 'Selected, but this layer is hidden.' : pageName ? `Switched to page “${pageName}”.` : undefined,
  };
}

function hasHiddenAncestor(node: SceneNode): boolean {
  let p = node.parent;
  while (p && p.type !== 'PAGE') {
    if ('visible' in p && !p.visible) return true;
    p = p.parent;
  }
  return false;
}
