// @host 45:2
const page = await figma.getNodeByIdAsync('45:2');
await figma.setCurrentPageAsync(page);
const config = { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: DSD.configs.dsdTest() };
const before = { score: 81, count: 8, ids: [
  'typography/local-matches-style|45:489|Text style', 'color/raw-matches-token|45:482|Fill', 'component/detached|45:487|Component link',
  'spacing/off-scale|45:483|Padding top', 'spacing/off-scale|45:483|Padding right', 'spacing/off-scale|45:483|Padding bottom',
  'spacing/off-scale|45:483|Padding left', 'radius/off-scale|45:490|Corner radius'] };
const roots = page.children;
const { result } = await DSD.performAudit(roots, config, { scope: 'page', page, total: DSD.countLayers(roots, false), deadline: Date.now() + 60000 });
const nowIds = result.issues.map((x) => x.id);
const nav = [];
for (const issue of result.issues) {
  figma.viewport.center = { x: 100000, y: 100000 }; figma.viewport.zoom = 0.1;
  const source = await figma.getNodeByIdAsync(issue.nodeId);
  const outcome = await DSD.goToNode(issue.nodeId);
  const sel = figma.currentPage.selection.map((n) => n.id);
  const bb = source.absoluteBoundingBox, vb = figma.viewport.bounds, c = figma.viewport.center;
  nav.push({ nodeId: issue.nodeId, ruleId: issue.ruleId, ok: outcome.ok, nameMatches: source.name === issue.nodeName,
    selectionIsSourceNode: sel.length === 1 && sel[0] === issue.nodeId,
    nodeInViewport: bb.x >= vb.x - 1 && bb.y >= vb.y - 1 && bb.x + bb.width <= vb.x + vb.width + 1 && bb.y + bb.height <= vb.y + vb.height + 1,
    viewportCentredOnNode: Math.abs(c.x - (bb.x + bb.width / 2)) < 2 && Math.abs(c.y - (bb.y + bb.height / 2)) < 2 });
}
return {
  compliance: result.compliance,
  countBefore: before.count, countAfter: result.issues.length,
  scoreBefore: before.score, scoreAfter: result.compliance.score,
  resolved: before.ids.filter((id) => !nowIds.includes(id)),
  newlyAppeared: nowIds.filter((id) => !before.ids.includes(id)),
  remaining: result.issues.map((x) => ({ id: x.id, nodeId: x.nodeId, nodeName: x.nodeName, current: x.currentValue, expected: x.expectedValue })),
  nav,
};
