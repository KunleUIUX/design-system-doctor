// Plugin entry: wires Figma's UI channel and events to the controller.
// Behaviour lives in src/plugin/controller.ts; audit logic in src/engine; Figma reading in src/figma.

import { createController } from './plugin/controller';
import { pluginDataStorage } from './plugin/storage';
import type { MainToUi, UiToMain } from './shared/messages';

figma.showUI(__html__, { width: 380, height: 620, themeColors: true });

const controller = createController({
  post: (msg: MainToUi) => figma.ui.postMessage(msg),
  storage: pluginDataStorage,
});

figma.ui.onmessage = (msg: UiToMain) => controller.handle(msg);
figma.on('selectionchange', controller.onSelectionChange);
figma.on('currentpagechange', () => void controller.onPageChange());
// Text and colour style edits don't fire nodechange on the page; re-check on them too.
figma.on('stylechange', () => void controller.handle({ type: 'check-freshness' }));
