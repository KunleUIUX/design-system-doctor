// @host 45:2
const page = await figma.getNodeByIdAsync('45:2');
await figma.setCurrentPageAsync(page);
const config = { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: DSD.configs.dsdTest() };
const roots = page.children;
const total = DSD.countLayers(roots, false);
const { result, ruleErrorCount } = await DSD.performAudit(roots, config, { scope: 'page', page, total, deadline: Date.now() + 60000 });

const nav = [];
let i = 0;
for (const issue of result.issues) {
  const source = await figma.getNodeByIdAsync(issue.nodeId);
  // Start somewhere else so a pass proves navigation moved the view.
  if (i++ === 0) { await figma.setCurrentPageAsync(figma.root.children[0]); }
  else { figma.viewport.center = { x: 100000, y: 100000 }; figma.viewport.zoom = 0.1; }
  const pageBefore = figma.currentPage.name;
  const outcome = await DSD.goToNode(issue.nodeId);
  const sel = figma.currentPage.selection.map((n) => n.id);
  const bb = source && source.absoluteBoundingBox;
  const vb = figma.viewport.bounds, c = figma.viewport.center;
  const tol = 1;
  nav.push({
    nodeId: issue.nodeId,
    ruleId: issue.ruleId,
    nodeExists: !!source && !source.removed,
    nameMatches: !!source && source.name === issue.nodeName,
    outcome,
    pageBefore,
    pageAfter: figma.currentPage.name,
    selectedIds: sel,
    selectionIsSourceNode: sel.length === 1 && sel[0] === issue.nodeId,
    nodeInViewport: !!bb && bb.x >= vb.x - tol && bb.y >= vb.y - tol && bb.x + bb.width <= vb.x + vb.width + tol && bb.y + bb.height <= vb.y + vb.height + tol,
    viewportCentredOnNode: !!bb && Math.abs(c.x - (bb.x + bb.width / 2)) < 2 && Math.abs(c.y - (bb.y + bb.height / 2)) < 2,
    zoom: Math.round(figma.viewport.zoom * 100) / 100,
  });
}
return {
  audit: { scanned: result.scannedNodeCount, skipped: result.skippedNodeCount, failed: result.failedNodeCount, ruleErrorCount, compliance: result.compliance },
  issues: result.issues.map((x) => ({ id: x.id, ruleId: x.ruleId, severity: x.severity, nodeId: x.nodeId, nodeName: x.nodeName, property: x.property, current: x.currentValue, expected: x.expectedValue })),
  nav,
};
