// Browser-only stand-in for the Figma main thread, for developing the UI without Figma.
// Runs the real audit engine over fixture snapshots. Not part of the plugin bundle.

import { evaluateNodes } from '../src/engine/orchestrator';
import type { MainToUi, UiToMain } from '../src/shared/messages';
import {
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_RADIUS_SCALE,
  DEFAULT_SPACING_SCALE,
  type AuditConfig,
  type DesignSystemConfig,
  type DesignSystemData,
  type NodeSnapshot,
} from '../src/shared/types';

const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });
const lh = (v: number) => ({ unit: 'PIXELS' as const, value: v });
const ls0 = { unit: 'PERCENT' as const, value: 0 };

const data: DesignSystemData = {
  collections: [{ id: 'C:acme', key: 'k', name: 'Acme tokens', remote: true, defaultModeId: 'M:1', variableCount: 3 }],
  variables: [
    { id: 'V:brand', key: 'v1', name: 'color/brand/primary', collectionId: 'C:acme', remote: true, resolvedType: 'COLOR', valuesByMode: { 'M:1': hex('#635BFF') } },
    { id: 'V:text', key: 'v2', name: 'color/text/primary', collectionId: 'C:acme', remote: true, resolvedType: 'COLOR', valuesByMode: { 'M:1': hex('#1A1A1A') } },
    { id: 'V:surface', key: 'v3', name: 'color/surface/default', collectionId: 'C:acme', remote: true, resolvedType: 'COLOR', valuesByMode: { 'M:1': hex('#FFFFFF') } },
  ],
  textStyles: [
    { id: 'S:body', key: 's1', name: 'Body / Medium', remote: true, fontFamily: 'Inter', fontStyle: 'Medium', fontSize: 16, lineHeight: lh(24), letterSpacing: ls0 },
    { id: 'S:label', key: 's2', name: 'Label / Button', remote: true, fontFamily: 'Inter', fontStyle: 'Semi Bold', fontSize: 14, lineHeight: lh(20), letterSpacing: ls0 },
    { id: 'S:local15', key: '', name: 'Body 15', remote: false, fontFamily: 'Inter', fontStyle: 'Medium', fontSize: 15, lineHeight: lh(22), letterSpacing: ls0 },
  ],
  paintStyles: [],
  components: [{ id: 'CMP:btn', key: 'btn', name: 'Button / Primary', remote: true }],
};

const seg = (characters: string, extra: Partial<NonNullable<NodeSnapshot['text']>[number]>) => ({
  start: 0, end: characters.length, characters, textStyleId: '', fills: [{ type: 'SOLID' as const, visible: true, color: hex('#1A1A1A'), boundVariableId: 'V:text' }], fillStyleId: '',
  fontFamily: 'Inter', fontStyle: 'Medium', fontSize: 16, lineHeight: lh(24), letterSpacing: ls0, ...extra,
});
const base = { variableModes: {}, insideInstance: false };

const nodes: NodeSnapshot[] = [
  { ...base, id: '10:1', name: 'Checkout', type: 'FRAME', path: [], fills: [{ type: 'SOLID', visible: true, color: hex('#FFFFFF'), boundVariableId: 'V:surface' }],
    layout: { mode: 'VERTICAL', values: { itemSpacing: 24, paddingTop: 32, paddingLeft: 18, paddingRight: 18, paddingBottom: 32 }, boundVariables: {} } },
  { ...base, id: '10:2', name: 'Order summary title', type: 'TEXT', path: ['Checkout'], text: [seg('Order summary', { textStyleId: 'S:local15', fontSize: 15, lineHeight: lh(22) })] },
  { ...base, id: '10:3', name: 'Total label', type: 'TEXT', path: ['Checkout', 'Summary'], text: [seg('Total', {})] },
  { ...base, id: '10:4', name: 'Pay button', type: 'FRAME', path: ['Checkout', 'Footer'], detached: { type: 'library', componentKey: 'btn' },
    fills: [{ type: 'SOLID', visible: true, color: hex('#635BFF') }], radius: { values: { cornerRadius: 10 }, boundVariables: {}, width: 320, height: 48 },
    layout: { mode: 'HORIZONTAL', values: { paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }, boundVariables: {} } },
  { ...base, id: '10:5', name: 'Checkout button label', type: 'TEXT', path: ['Checkout', 'Footer', 'Pay button'], text: [seg('Pay $42.00', { fontStyle: 'Semi Bold', fontSize: 15, lineHeight: lh(20), fills: [{ type: 'SOLID', visible: true, color: hex('#FFFFFF') }] })] },
  { ...base, id: '10:6', name: 'Card', type: 'RECTANGLE', path: ['Checkout', 'Summary'], fills: [{ type: 'SOLID', visible: true, color: hex('#635BFE') }], radius: { values: { cornerRadius: 6 }, boundVariables: {}, width: 300, height: 120 } },
  { ...base, id: '10:8', name: 'Illustration blob', type: 'VECTOR', path: ['Checkout', 'Hero'], fills: [{ type: 'SOLID', visible: true, color: hex('#E4572E') }] },
  { ...base, id: '10:7', name: 'Apply coupon', type: 'INSTANCE', path: ['Checkout'], instance: { main: { id: 'CMP:btn', key: 'btn', name: 'Button / Primary', remote: true } }, instanceOverrides: [] },
];

let config: AuditConfig = { ...DEFAULT_AUDIT_CONFIG };

// ?real=1 replays an AuditResult captured from a real Figma file (dev/fixtures/real-audit.json)
// and records every message the UI sends, so UI → node-id wiring can be checked against Figma.
const REAL = new URLSearchParams(location.search).has('real');
const sent: UiToMain[] = [];
(window as unknown as { __sent: UiToMain[] }).__sent = sent;
if (REAL) {
  config = {
    ...DEFAULT_AUDIT_CONFIG,
    designSystem: {
      version: 2, name: 'DSD Test', variableCollections: [{ source: 'local', id: 'VariableCollectionId:45:3', name: 'DSD Test Tokens' }],
      textStyles: { library: false, local: true, items: [] }, paintStyles: { library: false, local: false }, components: { library: false, local: true, items: [] },
      spacingScale: DEFAULT_SPACING_SCALE, radiusScale: DEFAULT_RADIUS_SCALE,
    },
  };
}
const frame = document.getElementById('plugin') as HTMLIFrameElement;
const post = (msg: MainToUi) => frame.contentWindow!.postMessage({ pluginMessage: msg }, '*');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cancelled = false;

function acmeSuggestion(): DesignSystemConfig {
  return {
    version: 2, name: 'Acme Design System', variableCollections: [{ source: 'library', key: 'k', name: 'Acme tokens' }],
    textStyles: { library: true, local: false, items: [] }, paintStyles: { library: false, local: false }, components: { library: true, local: false, items: [] },
    spacingScale: DEFAULT_SPACING_SCALE, radiusScale: DEFAULT_RADIUS_SCALE,
  };
}

async function handle(msg: UiToMain) {
  sent.push(msg);
  switch (msg.type) {
    case 'init': {
      const lastAudit = REAL ? await (await fetch('fixtures/real-audit.json')).json() : null;
      // ?portable=1 simulates a library design system saved in another file on this device.
      const portable = new URLSearchParams(location.search).has('portable') ? { ...acmeSuggestion(), name: 'Acme (from another file)' } : null;
      post({ type: 'init-state', config, pageName: REAL ? 'DSD – core loop test' : 'Checkout flow', selectionCount: 0, lastAudit, portable });
      // ?stale=1 simulates the main thread finding that the design changed after this audit.
      if (lastAudit) {
        await wait(300);
        const state = new URLSearchParams(location.search).has('stale') ? 'changed' : 'current';
        post({ type: 'audit-freshness', auditId: lastAudit.auditId, pageId: lastAudit.pageId, state });
      }
      break;
    }
    case 'get-discovery':
      await wait(300);
      post({
        type: 'discovery',
        discovery: {
          collections: [{ id: 'C:acme', key: 'k', name: 'Acme tokens', remote: true, variableCount: 3, colorCount: 3 }],
          textStyles: data.textStyles.map(({ id, key, name, remote }) => ({ id, key, name, remote })),
          paintStyles: { library: 0, local: 0 },
          components: data.components.map(({ id, key, name, remote }) => ({ id, key, name, remote })),
          suggested: acmeSuggestion(),
        },
      });
      break;
    case 'save-config':
      config = msg.config;
      post({ type: 'config-saved', config, savedTo: 'file' });
      break;
    case 'cancel-audit':
      cancelled = true;
      break;
    case 'go-to-node':
      post({ type: 'navigate-result', nodeId: msg.nodeId, ok: true });
      break;
    case 'run-audit': {
      cancelled = false;
      if (REAL) {
        // Re-run returns the real post-fix result captured from Figma.
        post({ type: 'audit-progress', phase: 'reading', scanned: 31, total: 31, categoriesDone: [] });
        const result = await (await fetch('fixtures/real-audit-after.json')).json();
        post({ type: 'audit-result', result, ruleErrorCount: 0 });
        return;
      }
      const total = 428;
      for (let s = 0; s <= total; s += 60) {
        if (cancelled) return post({ type: 'audit-error', kind: 'cancelled', message: '' });
        post({ type: 'audit-progress', phase: 'reading', scanned: s, total, categoriesDone: [] });
        await wait(80);
      }
      const started = new Date();
      const r = evaluateNodes(nodes, data, config);
      post({
        type: 'audit-result',
        ruleErrorCount: r.ruleErrors.length,
        result: {
          auditId: '1', scope: msg.scope, pageId: '0:1', pageName: 'Checkout flow', startedAt: started.toISOString(), completedAt: new Date().toISOString(),
          scannedNodeCount: total, skippedNodeCount: 3, failedNodeCount: 0, issues: r.issues, compliance: r.compliance,
          designSystemName: config.designSystem!.name,
          rootIds: nodes.map((n) => n.id),
          fingerprint: 'harness',
        },
      });
      if (new URLSearchParams(location.search).has('stale')) {
        await wait(600);
        post({ type: 'audit-freshness', auditId: '1', pageId: '0:1', state: 'changed' });
      }
    }
  }
}

window.addEventListener('message', (e) => {
  if (e.source === frame.contentWindow && e.data?.pluginMessage) handle(e.data.pluginMessage);
});
