// The two design systems the real-file scenarios audit against, in the current (v2) shape.
// Kept in one place so every scenario tests the same thing.
import type { AssetRef } from '../../src/shared/designSystem';
import { DEFAULT_RADIUS_SCALE, DEFAULT_SPACING_SCALE, type DesignSystemConfig } from '../../src/shared/types';

const lib = (key: string, name: string): AssetRef => ({ source: 'library', key, name });

export const refs = {
  /** Local collection in Deign-Page ("DSD – core loop test"). */
  dsdTestTokens: { source: 'local', id: 'VariableCollectionId:45:3', name: 'DSD Test Tokens' } as AssetRef,
  acmeColors: lib('5cf0ef50ff4b4fa46fb026dd0b0b3c857a2ebdb2', 'Acme Colors'),
  acmeSpacing: lib('e2cb7862ed001f685edca2b427155603a9fa6a0b', 'Acme Spacing'),
};

/** Local design system on the Deign-Page test page: everything made in that file is approved. */
export function dsdTest(over: Partial<DesignSystemConfig> = {}): DesignSystemConfig {
  return {
    version: 2,
    name: 'DSD Test',
    variableCollections: [refs.dsdTestTokens],
    textStyles: { library: false, local: true, items: [] },
    paintStyles: { library: false, local: false },
    components: { library: false, local: true, items: [] },
    spacingScale: DEFAULT_SPACING_SCALE,
    radiusScale: DEFAULT_RADIUS_SCALE,
    ...over,
  };
}

/** The published Acme library as consumed by the consumer files. */
export function acme(over: Partial<DesignSystemConfig> = {}): DesignSystemConfig {
  return {
    version: 2,
    name: 'Acme (library)',
    variableCollections: [refs.acmeColors, refs.acmeSpacing],
    textStyles: { library: true, local: false, items: [] },
    paintStyles: { library: true, local: false },
    components: { library: true, local: false, items: [] },
    spacingScale: DEFAULT_SPACING_SCALE,
    radiusScale: DEFAULT_RADIUS_SCALE,
    ...over,
  };
}
