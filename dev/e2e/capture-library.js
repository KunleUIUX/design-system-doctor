// @host 0:1
// Design system references: capture the DSD Test Library from its OWN file with the real
// controller ("Save this file as a design system"), then audit the library page against it.
// Run in the DSD Test Library file. Copy the returned `reference` to
// dev/e2e/captured-dsd-test-library.generated.json for reference-lifecycle.js.
// Style publish status isn't readable in use_figma's host. These keys were proven published in
// Phase 4 (the consuming file reads them as library styles by these keys).
const PUBLISHED = __JSON(library-keys.json)__;
globalThis.__stylePublishStatus = (s) => (Object.values(PUBLISHED.styles).includes(s.key) ? 'CURRENT' : 'UNPUBLISHED');
const S = [], post = (m) => S.push(m), L = (t) => S.filter((m) => m.type === t).slice(-1)[0];
const dev = { library: [] };
const c = DSD.createController({ post, storage: DSD.memoryStorage(null, dev) });
await c.handle({ type: 'init' });
await c.handle({ type: 'capture-design-system' });
const ref = L('settings-saved')?.settings.designSystem;
// Inside the library's own file its assets are local but carry the published keys: all live.
await c.handle({ type: 'run-audit', scope: 'page' });
const r = L('audit-result')?.result;
return {
  captureFailed: L('capture-failed') ?? null,
  kind: ref?.source.kind,
  collections: ref?.variableCollections.map((x) => `${x.ref.source} ${x.ref.name} vars=${x.variables.length} modes=${x.modes.map((m) => m.name)}`),
  textStyles: ref?.textStyles.map((t) => `${t.ref.source} ${t.ref.name} · ${t.props.fontFamily} ${t.props.fontStyle} ${t.props.fontSize}`),
  components: ref?.components.map((x) => `${x.ref.source} ${x.ref.name}`),
  savedOnDevice: dev.library.map((x) => x.name),
  selfAudit: r && { score: r.compliance.score, checks: r.compliance.opportunities, coverage: r.coverage, issues: r.issues.map((i) => `${i.severity} ${i.ruleId} ${i.nodeId}`) },
  consoleErrors: __logged,
  reference: ref,
};
