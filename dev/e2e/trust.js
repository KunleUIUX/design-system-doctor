// @host 45:2
// Phase 3 checks on real nodes, driven through the real plugin controller (handle()).
const sent = [];
const ds = DSD.configs.dsdTest();
const ctl = DSD.createController({ post: (m) => sent.push(m), storage: DSD.memoryStorage({ ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds }) });
const last = (t) => sent.filter((m) => m.type === t).slice(-1)[0];
const node = (id) => figma.getNodeByIdAsync(id);
const page = await node('45:2');
await figma.setCurrentPageAsync(page);

// Restore the planted violations (fixed in the previous phase).
(await node('45:482')).fills = [{ type: 'SOLID', color: { r: 0x63 / 255, g: 0x5b / 255, b: 0xff / 255 } }];
(await node('45:483')).set({ paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18 });

await ctl.handle({ type: 'init' });
await ctl.handle({ type: 'run-audit', scope: 'page' });
const r1 = last('audit-result').result;
const f = (pred) => r1.issues.filter(pred).map((i) => ({ rule: i.ruleId, node: i.nodeId, prop: i.property, affects: i.affects, cur: i.currentValue, exp: i.expectedValue }));

// Go to layer through the real handler: one finding per category.
const nav = {};
for (const cat of ['typography', 'color', 'components', 'spacing', 'radius']) {
  const issue = r1.issues.find((i) => i.category === cat && i.severity !== 'review');
  figma.viewport.center = { x: 100000, y: 100000 }; figma.viewport.zoom = 0.1;
  await ctl.handle({ type: 'go-to-node', nodeId: issue.nodeId });
  const res = last('navigate-result');
  const n = await node(issue.nodeId), sel = figma.currentPage.selection, bb = n.absoluteBoundingBox, vb = figma.viewport.bounds, c = figma.viewport.center;
  nav[cat] = { nodeId: issue.nodeId, handlerOk: res.ok && res.nodeId === issue.nodeId, selectedExact: sel.length === 1 && sel[0].id === issue.nodeId,
    inView: bb.x >= vb.x - 1 && bb.y >= vb.y - 1 && bb.x + bb.width <= vb.x + vb.width + 1 && bb.y + bb.height <= vb.y + vb.height + 1,
    centred: Math.abs(c.x - (bb.x + bb.width / 2)) < 2 && Math.abs(c.y - (bb.y + bb.height / 2)) < 2 };
}

// Freshness through the real handler.
const fresh = async () => (await ctl.handle({ type: 'check-freshness' }), last('audit-freshness').state);
const freshness = { untouched: await fresh() };
const badge = await node('45:490'); badge.x += 1; badge.x -= 1; const cfr = await node('48:3'); const oldX = cfr.x; cfr.x = oldX + 40;
freshness.afterMoveOnly = await fresh();
cfr.x = oldX;
const pay = await node('45:482');
pay.fills = [figma.variables.setBoundVariableForPaint(pay.fills[0], 'color', await figma.variables.getVariableByIdAsync('VariableID:45:4'))];
freshness.afterFix = await fresh();
await ctl.handle({ type: 'run-audit', scope: 'page' });
const r2 = last('audit-result').result;
freshness.afterReaudit = await fresh();
const textVar = await figma.variables.getVariableByIdAsync('VariableID:45:5');
const mode = Object.keys(textVar.valuesByMode)[0], oldVal = textVar.valuesByMode[mode];
textVar.setValueForMode(mode, { r: 0.2, g: 0.2, b: 0.2, a: 1 });
freshness.afterTokenValueChange = await fresh();
textVar.setValueForMode(mode, oldVal);
freshness.afterTokenRevert = await fresh();

// Low confidence and large-page performance (selection scope on the edge page).
const edge = await node('50:3');
await figma.setCurrentPageAsync(edge);
figma.currentPage.selection = [await node('50:4')];
await ctl.handle({ type: 'run-audit', scope: 'selection' });
const lowR = last('audit-result').result;
figma.currentPage.selection = [await node('50:17')];
const t0 = Date.now();
await ctl.handle({ type: 'run-audit', scope: 'selection', confirmedLarge: true });
const bigMs = Date.now() - t0, bigR = last('audit-result').result;

return {
  r1: { count: r1.issues.length, score: r1.compliance.score, checks: r1.compliance.opportunities, confidence: r1.compliance.confidence, sev: r1.issues.reduce((a, i) => ((a[i.severity] = (a[i.severity] || 0) + 1), a), {}) },
  spacingFindings: f((i) => i.category === 'spacing'),
  radiusFindings: f((i) => i.category === 'radius'),
  reviewItems: f((i) => i.severity === 'review'),
  oneOffText: f((i) => i.nodeId === '48:5'),
  nav,
  freshness,
  r2: { count: r2.issues.length, score: r2.compliance.score, payStillListed: r2.issues.some((i) => i.nodeId === '45:482' && i.severity !== 'review') },
  lowConfidence: { score: lowR.compliance.score, checks: lowR.compliance.opportunities, confidence: lowR.compliance.confidence, review: lowR.issues.filter((i) => i.severity === 'review').length },
  large: { ms: bigMs, scanned: bigR.scannedNodeCount, checks: bigR.compliance.opportunities, confidence: bigR.compliance.confidence, errors: bigR.compliance.errored },
  errorsPosted: sent.filter((m) => m.type === 'audit-error'),
  mutatedNodeIds: ['45:482', '45:483', '48:3 (moved and restored)', 'VariableID:45:5 (changed and restored)'],
};
