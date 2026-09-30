// @host 45:2
// Edge cases on real nodes: empty page, no DS primitives, only compliant, only violations,
// large page, repeated runs, and a node deleted after the audit.
const ds = DSD.configs.dsdTest();
const config = { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds };
const run = async (page, roots, scope) => {
  const t0 = Date.now();
  const { result } = await DSD.performAudit(roots, config, { scope, page, total: DSD.countLayers(roots, false), deadline: Date.now() + 90000 });
  return { ms: Date.now() - t0, scanned: result.scannedNodeCount, compliance: result.compliance, issues: result.issues.map((i) => `${i.ruleId} ${i.nodeId} ${i.property}`) };
};
const brief = (r) => ({ ms: r.ms, scanned: r.scanned, score: r.compliance.score, checks: r.compliance.opportunities, passed: r.compliance.passed, warned: r.compliance.warned, errored: r.compliance.errored, issues: r.issues });

const emptyPage = await figma.getNodeByIdAsync('50:2');
await figma.setCurrentPageAsync(emptyPage);
const empty = await run(emptyPage, emptyPage.children, 'page');

const edge = await figma.getNodeByIdAsync('50:3');
await figma.setCurrentPageAsync(edge);
const node = (id) => figma.getNodeByIdAsync(id);
const e1 = await run(edge, [await node('50:4')], 'selection');
const e2 = await run(edge, [await node('50:10')], 'selection');
const e3Runs = [];
for (let i = 0; i < 3; i++) e3Runs.push(await run(edge, [await node('50:14')], 'selection'));
const big = await node('50:17');
const largeCount = DSD.countLayers([big], false);
const large = await run(edge, [big], 'selection');

// Delete a flagged node after auditing, then try to navigate to it and re-audit.
// Re-runnable: plant a fresh violation in E3, audit it, delete it, then navigate and re-audit.
const e3 = await node('50:14');
const rect = figma.createRectangle(); rect.name = 'Raw brand (to delete)'; rect.resize(100, 40); rect.cornerRadius = 6;
rect.fills = [{ type: 'SOLID', color: { r: 0x63 / 255, g: 0x5b / 255, b: 1 } }]; e3.appendChild(rect);
const deletedId = rect.id;
const e3Before = await run(edge, [e3], 'selection');
rect.remove();
const navDeleted = await DSD.goToNode(deletedId);
const e3After = await run(edge, [await node('50:14')], 'selection');

return {
  empty: brief(empty),
  e1NoDsPrimitives: brief(e1),
  e2OnlyCompliant: brief(e2),
  e3OnlyViolations: brief(e3Runs[0]),
  e3Deterministic: e3Runs.every((r) => JSON.stringify(r.issues) === JSON.stringify(e3Runs[0].issues) && r.compliance.score === e3Runs[0].compliance.score),
  large: { layerCount: largeCount, overThreshold: largeCount > 3000, ms: large.ms, scanned: large.scanned, score: large.compliance.score, checks: large.compliance.opportunities,
    errored: large.compliance.errored, colourErrors: large.issues.filter((i) => i.startsWith('color/raw-matches-token')).length },
  deletedNode: { id: deletedId, reportedBeforeDelete: e3Before.issues.some((i) => i.includes(deletedId)), navigate: navDeleted,
    reauditIssues: e3After.issues, stillReportsDeleted: e3After.issues.some((i) => i.includes(deletedId)) },
  mutatedNodeIds: [`${deletedId} (created then removed)`],
};
