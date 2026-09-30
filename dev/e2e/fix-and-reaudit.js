// @host 45:2
// Fix two real violations the way a designer would, re-audit, and diff against the audit before.
const page = await figma.getNodeByIdAsync('45:2');
await figma.setCurrentPageAsync(page);
const ds = DSD.configs.dsdTest();
const config = { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds };
const audit = async () => (await DSD.performAudit(page.children, config, { scope: 'page', page, total: DSD.countLayers(page.children, false), deadline: Date.now() + 60000 })).result;

// Re-runnable: put both planted violations back before measuring.
(await figma.getNodeByIdAsync('45:482')).fills = [{ type: 'SOLID', color: { r: 0x63 / 255, g: 0x5b / 255, b: 1 } }];
(await figma.getNodeByIdAsync('45:483')).set({ paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18 });
const before = await audit();
const brand = await figma.variables.getVariableByIdAsync('VariableID:45:4');
const pay = await figma.getNodeByIdAsync('45:482');
pay.fills = [figma.variables.setBoundVariableForPaint(pay.fills[0], 'color', brand)];
const card = await figma.getNodeByIdAsync('45:483');
card.set({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 });
const after = await audit();

const key = (i) => JSON.stringify([i.id, i.nodeId, i.nodeName, i.severity, i.property, i.currentValue, i.expectedValue, i.rationale]);
const afterIds = new Set(after.issues.map((i) => i.id));
const beforeIds = new Set(before.issues.map((i) => i.id));
const resolved = before.issues.filter((i) => !afterIds.has(i.id));
const remainingBefore = before.issues.filter((i) => afterIds.has(i.id));
const remainingAfterById = new Map(after.issues.map((i) => [i.id, i]));
const remainingNav = [];
for (const i of after.issues) {
  const nav = await DSD.goToNode(i.nodeId);
  remainingNav.push(nav.ok && figma.currentPage.selection.length === 1 && figma.currentPage.selection[0].id === i.nodeId);
}
return {
  before: { count: before.issues.length, score: before.compliance.score, checks: before.compliance.opportunities, passed: before.compliance.passed, warned: before.compliance.warned, errored: before.compliance.errored },
  after: { count: after.issues.length, score: after.compliance.score, checks: after.compliance.opportunities, passed: after.compliance.passed, warned: after.compliance.warned, errored: after.compliance.errored },
  expectedAfterScore: Math.floor(((after.compliance.passed + 0.5 * after.compliance.warned) / after.compliance.opportunities) * 100),
  resolved: resolved.map((i) => `${i.ruleId} ${i.nodeId} ${i.property}`),
  newIssues: after.issues.filter((i) => !beforeIds.has(i.id)).map((i) => i.id),
  otherIssuesUnchanged: remainingBefore.every((i) => key(i) === key(remainingAfterById.get(i.id))),
  remainingNavigateExact: remainingNav.every(Boolean) && remainingNav.length === after.issues.length,
  nodeState: { payFillBound: pay.fills[0].boundVariables?.color?.id, cardPadding: [card.paddingTop, card.paddingRight, card.paddingBottom, card.paddingLeft] },
  mutatedNodeIds: ['45:482', '45:483'],
  afterResult: after,
};
