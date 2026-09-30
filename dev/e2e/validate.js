// @host 45:2
// Full validation on the test page: detection, node identity, navigation, determinism,
// hidden-layer denominator. Returns the raw AuditResult too, for replaying in the real UI.
const page = await figma.getNodeByIdAsync('45:2');
await figma.setCurrentPageAsync(page);
const ds = DSD.configs.dsdTest();
const config = { ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: ds };
const audit = async (cfg) => (await DSD.performAudit(page.children, cfg, { scope: 'page', page, total: DSD.countLayers(page.children, cfg.includeHidden), deadline: Date.now() + 60000 })).result;

const hex = (p) => '#' + [p.color.r, p.color.g, p.color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const FIELD = { 'Padding top': 'paddingTop', 'Padding right': 'paddingRight', 'Padding bottom': 'paddingBottom', 'Padding left': 'paddingLeft', Gap: 'itemSpacing',
  'Corner radius': 'cornerRadius', 'Top-left radius': 'topLeftRadius', 'Top-right radius': 'topRightRadius', 'Bottom-right radius': 'bottomRightRadius', 'Bottom-left radius': 'bottomLeftRadius' };
// Read the offending property straight from the Figma node and compare with what the audit reported.
function offenceOnNode(issue, n) {
  const code = issue.ruleId;
  if (code.startsWith('color/raw-matches-token') || code.startsWith('color/near-token')) {
    const paints = issue.property.startsWith('Stroke') ? n.strokes : n.fills;
    if (paints === figma.mixed) return 'mixed';
    const p = paints.find((x) => x.type === 'SOLID' && x.visible !== false);
    return !!p && !p.boundVariables?.color && hex(p) === issue.currentValue;
  }
  if (code.startsWith('spacing/off-scale') || code.startsWith('radius/off-scale')) {
    // Grouped findings ("Padding", affects Top/Right/…) are checked side by side on the node.
    const SIDE = { Top: 'paddingTop', Right: 'paddingRight', Bottom: 'paddingBottom', Left: 'paddingLeft',
      'Top-left': 'topLeftRadius', 'Top-right': 'topRightRadius', 'Bottom-right': 'bottomRightRadius', 'Bottom-left': 'bottomLeftRadius' };
    const fields = issue.affects ? issue.affects.map((a) => SIDE[a]) : [FIELD[issue.property]];
    return fields.every((f) => `${n[f]}px` === issue.currentValue);
  }
  if (code === 'color/unmapped') {
    const p = n.fills.find((x) => x.type === 'SOLID' && x.visible !== false);
    return !!p && !p.boundVariables?.color && hex(p) === issue.currentValue;
  }
  if (code === 'component/detached') return n.type === 'FRAME' && !!n.detachedInfo;
  if (code === 'typography/local-matches-style' || code === 'typography/no-style') return n.type === 'TEXT' && n.textStyleId === '';
  if (code === 'typography/unapproved-style') return n.type === 'TEXT' && !!n.textStyleId;
  return 'not-verifiable';
}

const result = await audit(config);
const findings = [];
for (const issue of result.issues) {
  const n = await figma.getNodeByIdAsync(issue.nodeId);
  figma.viewport.center = { x: 100000, y: 100000 }; figma.viewport.zoom = 0.1;
  const nav = await DSD.goToNode(issue.nodeId);
  const sel = figma.currentPage.selection.map((s) => s.id);
  const bb = n.absoluteBoundingBox, vb = figma.viewport.bounds, c = figma.viewport.center;
  findings.push({
    ruleId: issue.ruleId, sev: issue.severity, nodeId: issue.nodeId, name: issue.nodeName, prop: issue.property, cur: issue.currentValue, exp: issue.expectedValue,
    identity: { exists: !!n && !n.removed, nameMatches: n?.name === issue.nodeName, offenceOnNode: offenceOnNode(issue, n) },
    goTo: { ok: nav.ok, selectedExact: sel.length === 1 && sel[0] === issue.nodeId,
      inView: bb.x >= vb.x - 1 && bb.y >= vb.y - 1 && bb.x + bb.width <= vb.x + vb.width + 1 && bb.y + bb.height <= vb.y + vb.height + 1,
      centred: Math.abs(c.x - (bb.x + bb.width / 2)) < 2 && Math.abs(c.y - (bb.y + bb.height / 2)) < 2, zoom: Math.round(figma.viewport.zoom * 10) / 10 },
  });
}

const again = [await audit(config), await audit(config)];
const withHidden = await audit({ ...config, includeHidden: true });
const idsOf = (r) => r.issues.map((i) => i.id).join('\n');
const cmp = result.compliance;
return {
  scanned: result.scannedNodeCount, skipped: result.skippedNodeCount, failed: result.failedNodeCount,
  compliance: cmp,
  independentScore: Math.floor(((cmp.passed + 0.5 * cmp.warned) / cmp.opportunities) * 100),
  errorsVsIssues: { errorFindings: result.issues.filter((i) => i.severity === 'error').length, erroredChecks: cmp.errored,
    warningFindings: result.issues.filter((i) => i.severity === 'warning').length, warnedChecks: cmp.warned },
  deterministic: again.every((r) => idsOf(r) === idsOf(result) && r.compliance.score === cmp.score && r.compliance.opportunities === cmp.opportunities),
  hidden: { opportunitiesExcluded: cmp.opportunities, opportunitiesIncluded: withHidden.compliance.opportunities,
    hiddenFindingsWhenIncluded: withHidden.issues.filter((i) => i.nodeId === '48:10').map((i) => i.ruleId),
    hiddenFindingsWhenExcluded: result.issues.filter((i) => i.nodeId === '48:10').length },
  findings,
};
