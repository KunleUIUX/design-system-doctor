// @host 1:15
// Design system references, end to end in DSD Library Consumer, with the real controller:
//   1. migrated: older selection-based settings load as a reference and audit as before
//   2. switch to the design system captured in the library file (capture-library.js), and audit a
//      lone raw colour equal to a library token. The audited layer uses no tokens, so no token
//      data is read live: only the captured values can match it (with the migrated settings it
//      is "Not verifiable")
//   3. create a second design system from this page and switch to it: nothing captured leaks in
//   4. switch back: the captured reference is restored exactly, with the same result
// A temporary rectangle is created on the test page and always removed.
const CAPTURED = __JSON(captured-dsd-test-library.generated.json)__;
const S = [], post = (m) => S.push(m), L = (t) => S.filter((m) => m.type === t).slice(-1)[0], N = (id) => figma.getNodeByIdAsync(id);
let temp = null;
try {
  await figma.setCurrentPageAsync(await N('1:15'));
  (await N('1:18')).fills = [{ type: 'SOLID', color: { r: 0x63 / 255, g: 0x5b / 255, b: 1 } }];
  const K = (key, name) => ({ source: 'library', key, name }), none = { library: false, local: false };
  const legacyDs = { version: 2, name: 'Acme (production)', variableCollections: [K('5cf0ef50ff4b4fa46fb026dd0b0b3c857a2ebdb2', 'Acme Colors'), K('e2cb7862ed001f685edca2b427155603a9fa6a0b', 'Acme Spacing')],
    textStyles: { ...none, items: [K('89001002361e7522ad693673283d5061204acb43', 'Acme / Body'), K('46db04649156f45b2c6aa789b0ddc9a27c01f973', 'Acme / Button label')] }, paintStyles: none,
    components: { ...none, items: [K('3ab72fbe2d5efade7745efe3c265e6fdd9024203', 'Acme / Button')] }, spacingScale: [0, 4, 8, 12, 16, 24, 32], radiusScale: [0, 4, 8, 12, 16, 999] };
  const dev = { library: [CAPTURED] };
  const c = DSD.createController({ post, storage: DSD.memoryStorage({ ...DSD.DEFAULT_AUDIT_CONFIG, designSystem: legacyDs }, dev) });
  const audit = async (nodes) => {
    figma.currentPage.selection = nodes;
    await c.handle({ type: 'run-audit', scope: 'selection' });
    const r = L('audit-result').result;
    return { score: r.compliance.score, checks: r.compliance.opportunities, coverage: r.coverage, issues: r.issues.map((i) => `${i.severity} ${i.ruleId} ${i.nodeId} → ${i.expectedValue}`) };
  };
  const frame = await N('1:16');

  // 1. Migrated settings
  await c.handle({ type: 'init' });
  const migrated = L('init-state').settings.designSystem;
  const m = await audit([frame]);

  // A captured colour token (whether this file has imported it is reported, not required).
  const bound = await figma.variables.getVariableByIdAsync((await N('1:17')).fills[0].boundVariables.color.id);
  const liveCol = await figma.variables.getVariableCollectionByIdAsync(bound.variableCollectionId);
  const imported = new Set((await Promise.all(liveCol.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)))).map((v) => v.key));
  const colors = CAPTURED.variableCollections.find((x) => x.ref.key === liveCol.key);
  const token = colors.variables.find((v) => v.ref.name === 'color/text/primary');
  const value = token.valuesByMode[colors.defaultModeId];
  temp = figma.createRectangle();
  temp.name = 'DSD temp · captured token check';
  temp.resize(40, 40);
  temp.x = frame.x + frame.width + 200;
  temp.y = frame.y;
  temp.fills = [{ type: 'SOLID', color: { r: value.r, g: value.g, b: value.b } }];
  const tMigrated = await audit([temp]);

  // 2. Switch to the captured design system
  await c.handle({ type: 'switch-design-system', id: CAPTURED.id });
  const afterSwitch = L('settings-saved').settings.designSystem;
  const tCaptured = await audit([temp]);
  const fCaptured = await audit([frame]);

  // 3. A second design system, created from what this page uses
  await c.handle({ type: 'get-discovery' });
  const second = DSD.reference.referenceFromSelection({ ...L('discovery').discovery.suggested, name: 'Consumer page set' }, 'in-use');
  await c.handle({ type: 'save-settings', settings: { ...L('settings-saved').settings, designSystem: second } });
  const active2 = L('settings-saved').settings.designSystem;
  const json2 = JSON.stringify(active2);
  const tSecond = await audit([temp]);

  // 4. Switch back
  await c.handle({ type: 'switch-design-system', id: CAPTURED.id });
  const back = L('settings-saved').settings.designSystem;
  const tBack = await audit([temp]);

  return {
    migrated: { kind: migrated.source.kind, name: migrated.name, sameSelection: JSON.stringify(DSD.reference.toSelection(migrated)) === JSON.stringify(legacyDs), frame: m, tempRawColour: tMigrated },
    capturedToken: { name: token.ref.name, importedInThisFile: imported.has(token.ref.key) },
    switched: { sameAsCaptured: JSON.stringify(afterSwitch) === JSON.stringify(CAPTURED), tempRawColour: tCaptured, frame: fCaptured },
    second: { name: active2.name, kind: active2.source.kind, temp: tSecond,
      leaks: { capturedTokenKey: json2.includes(token.ref.key), capturedValues: /"(props|variables|capturedAt)"/.test(json2), captureId: json2.includes(CAPTURED.id) } },
    back: { restoredExactly: JSON.stringify(back) === JSON.stringify(CAPTURED), sameResultAsBefore: JSON.stringify(tBack.issues) === JSON.stringify(tCaptured.issues) },
    savedOnDevice: dev.library.map((x) => `${x.name} (${x.source.kind})`),
    errorsPosted: S.filter((x) => x.type === 'audit-error' || x.type === 'capture-failed'),
    consoleErrors: __logged,
  };
} finally {
  if (temp && !temp.removed) temp.remove();
}
