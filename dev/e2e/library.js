// @host 1:15
// Phase 4: published library assets consumed by another file, audited by the real controller.
const ds = DSD.configs.acme();
const sent = [];
const ctl = DSD.createController({ post: (m) => sent.push(m), storage: DSD.memoryStorage({ ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds }) });
const last = (t) => sent.filter((m) => m.type === t).slice(-1)[0];
const node = (id) => figma.getNodeByIdAsync(id);
const page = await node('1:15');
await figma.setCurrentPageAsync(page);
const frame = await node('1:16');
await ctl.handle({ type: 'init' });
figma.currentPage.selection = [frame];
await ctl.handle({ type: 'run-audit', scope: 'selection' });
const r = last('audit-result').result;
const hex = (p) => '#' + [p.color.r, p.color.g, p.color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

const findings = [];
for (const i of r.issues) {
  const n = await node(i.nodeId);
  const f = { rule: i.ruleId, sev: i.severity, node: i.nodeId, name: i.nodeName, prop: i.property, cur: i.currentValue, exp: i.expectedValue };
  // Identity: resolve the expected asset back to the published library by key.
  if (i.ruleId === 'color/raw-matches-token') {
    const lib = await figma.variables.importVariableByKeyAsync('f0cea0bc717049b9215fc4c503dac90559c8d579');
    f.identity = { offenceOnNode: !n.fills[0].boundVariables?.color && hex(n.fills[0]) === i.currentValue, expectedIsLibraryToken: lib.name === i.expectedValue && lib.remote };
  } else if (i.ruleId === 'typography/local-matches-style') {
    const lib = await figma.importStyleByKeyAsync('89001002361e7522ad693673283d5061204acb43');
    f.identity = { offenceOnNode: n.textStyleId === '', expectedIsLibraryStyle: lib.name === i.expectedValue && lib.remote };
  } else if (i.ruleId === 'component/detached') {
    f.identity = { detachedInfo: n.detachedInfo, expectedNamesLibraryComponent: i.expectedValue === 'Instance of Acme / Button' };
  }
  if (i.severity !== 'review') {
    figma.viewport.center = { x: 100000, y: 100000 }; figma.viewport.zoom = 0.1;
    await ctl.handle({ type: 'go-to-node', nodeId: i.nodeId });
    const res = last('navigate-result'), sel = figma.currentPage.selection, bb = n.absoluteBoundingBox, vb = figma.viewport.bounds, c = figma.viewport.center;
    f.goTo = res.ok && sel.length === 1 && sel[0].id === i.nodeId && bb.x >= vb.x - 1 && bb.x + bb.width <= vb.x + vb.width + 1 &&
      Math.abs(c.x - (bb.x + bb.width / 2)) < 2 && Math.abs(c.y - (bb.y + bb.height / 2)) < 2;
  }
  findings.push(f);
}
const flagged = new Set(r.issues.map((i) => i.nodeId));
const passes = { frameRemoteSpacingAndFill: !flagged.has('1:16'), brandRemoteVar: !flagged.has('1:17'), textRemoteStyle: !flagged.has('1:19'), remoteInstance: !flagged.has('1:21') };

// Library origin: when library sources aren't approved, the same assets must be reported as library.
const audit = async (roots, over) => (await DSD.performAudit(roots, { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: { ...ds, ...over } },
  { scope: 'selection', page, total: DSD.countLayers(roots, false), deadline: Date.now() + 60000 })).result.issues.map((i) => `${i.ruleId} ${i.nodeId} ${i.currentValue}`);
const origin = {
  spacingCollectionNotApproved: (await audit([frame], { variableCollections: [DSD.configs.refs.acmeColors] })).filter((s) => s.startsWith('spacing/')),
  libraryTextStylesNotApproved: (await audit([frame], { textStyles: { library: false, local: true, items: [] } })).filter((s) => s.startsWith('typography/')),
  libraryComponentsNotApproved: (await audit([frame], { components: { library: false, local: true, items: [] } })).filter((s) => s.startsWith('component/')),
  detachedAloneNameLookup: (await audit([await node('1:25')], {})).filter((s) => s.startsWith('component/')),
};
const expectedOfDetachedAlone = (await DSD.performAudit([await node('1:25')], { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds },
  { scope: 'selection', page, total: 3, deadline: Date.now() + 60000 })).result.issues.find((i) => i.ruleId === 'component/detached')?.expectedValue;

await ctl.handle({ type: 'check-freshness' });
const freshUntouched = last('audit-freshness').state;
const rawNode = await node('1:18');
rawNode.fills = [figma.variables.setBoundVariableForPaint(rawNode.fills[0], 'color', await figma.variables.importVariableByKeyAsync('f0cea0bc717049b9215fc4c503dac90559c8d579'))];
await ctl.handle({ type: 'check-freshness' });
const freshAfterFix = last('audit-freshness').state;
figma.currentPage.selection = [frame];
await ctl.handle({ type: 'run-audit', scope: 'selection' });
const r2 = last('audit-result').result;

figma.currentPage.selection = [await node('1:28')];
const t0 = Date.now();
await ctl.handle({ type: 'run-audit', scope: 'selection', confirmedLarge: true });
const ms = Date.now() - t0, big = last('audit-result').result;

return {
  compliance: r.compliance, findings, passes, origin, expectedOfDetachedAlone,
  freshness: { untouched: freshUntouched, afterFix: freshAfterFix },
  afterFix: { count: r2.issues.length, score: r2.compliance.score, rawStillFlagged: r2.issues.some((i) => i.nodeId === '1:18' && i.ruleId === 'color/raw-matches-token') },
  large: { ms, scanned: big.scannedNodeCount, checks: big.compliance.opportunities, errors: big.compliance.errored, score: big.compliance.score },
  errorsPosted: sent.filter((m) => m.type === 'audit-error'),
  mutatedNodeIds: ['1:18 (raw fill bound to remote brand token)'],
};
