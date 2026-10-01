// @host 1:15
// Phase 2 smoke test in DSD Library Consumer, through the real controller: select a saved design
// system, audit, rename, create from this page, remove another, remove the selected one.
const CAPTURED = __JSON(captured-dsd-test-library.generated.json)__;
const S = [], post = (m) => S.push(m), L = (t) => S.filter((m) => m.type === t).slice(-1)[0], N = (id) => figma.getNodeByIdAsync(id);
await figma.setCurrentPageAsync(await N('1:15'));
(await N('1:18')).fills = [{ type: 'SOLID', color: { r: 0x63 / 255, g: 0x5b / 255, b: 1 } }];
const dev = { library: [{ ...CAPTURED, name: 'Acme' }] };
const c = DSD.createController({ post, storage: DSD.memoryStorage(null, dev) });
const frame = await N('1:16');
const audit = async () => {
  figma.currentPage.selection = [frame];
  await c.handle({ type: 'run-audit', scope: 'selection' });
  return L('audit-result')?.result;
};

await c.handle({ type: 'init' });
const onOpen = { selected: L('init-state').settings.designSystem, offered: L('init-state').library.map((r) => r.name) };

await c.handle({ type: 'switch-design-system', id: CAPTURED.id });
const r = await audit();
const nav = [];
for (const i of r.issues) {
  await c.handle({ type: 'go-to-node', nodeId: i.nodeId });
  const s = figma.currentPage.selection;
  nav.push(L('navigate-result').ok && s.length === 1 && s[0].id === i.nodeId);
}

const fresh = async () => (await c.handle({ type: 'check-freshness' }), L('audit-freshness')?.state);
const freshBefore = await fresh();
await c.handle({ type: 'rename-design-system', id: CAPTURED.id, name: 'Acme Design System' });
const renamed = L('library-updated');
const freshAfterRename = await fresh();
await c.handle({ type: 'save-settings', settings: { ...renamed.settings, designSystem: { ...renamed.settings.designSystem, spacingScale: [0, 8] } } });
const freshAfterScaleChange = L('audit-freshness')?.state;

await c.handle({ type: 'get-discovery' });
const page = DSD.reference.referenceFromSelection({ ...L('discovery').discovery.suggested, name: 'Consumer page set' }, 'in-use');
await c.handle({ type: 'save-settings', settings: { ...L('settings-saved').settings, designSystem: page } });

await c.handle({ type: 'remove-design-system', id: CAPTURED.id });
const removedOther = L('library-updated');
await c.handle({ type: 'remove-design-system', id: page.id });
const removedActive = L('library-updated');
S.length = 0;
await c.handle({ type: 'run-audit', scope: 'selection' });

return {
  onOpen: { selected: onOpen.selected, offered: onOpen.offered },
  audit: { score: r.compliance.score, checks: r.compliance.opportunities, issues: r.issues.map((i) => `${i.severity} ${i.ruleId} ${i.nodeId}`), goToExact: nav.every(Boolean) },
  freshness: { beforeRename: freshBefore, afterRename: freshAfterRename, afterScaleChange: freshAfterScaleChange },
  rename: { selectedName: renamed.settings.designSystem?.name, sameId: renamed.settings.designSystem?.id === CAPTURED.id, list: renamed.library.map((x) => x.name) },
  removeOther: { selected: removedOther.settings.designSystem?.name, list: removedOther.library.map((x) => x.name) },
  removeSelected: { selected: removedActive.settings.designSystem, list: removedActive.library.map((x) => x.name), auditAfter: S.find((m) => m.type === 'audit-error')?.kind },
  savedOnDevice: dev.library.map((x) => x.name),
  consoleErrors: __logged,
};
