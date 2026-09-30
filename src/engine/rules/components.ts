import { countSignatureNodes } from '../signature';
import { notVerifiable } from './unverifiable';
import type { AuditRule, NodeCheck } from './types';

export const detachedComponentRule: AuditRule = {
  id: 'component',
  name: 'Components',
  category: 'components',
  defaultSeverity: 'error',
  description: 'Components should be used as instances of approved components.',
  codes: {
    detached: 'Detached component',
    'unapproved-source': 'Component not in design system',
    'not-verifiable': 'Component not verifiable in this file',
  },
  appliesTo: (node) => !!node.detached || (!!node.instance && !node.insideInstance),
  evaluate(node, { resolver }) {
    if (node.detached) {
      const d = node.detached;
      const name =
        d.type === 'local' ? resolver.componentName(d.componentId) : resolver.componentNameForKey(d.componentKey);
      const source = name ?? (d.type === 'library' ? 'Library component (name unavailable)' : 'Local component (deleted or on another page)');
      return [
        {
          property: 'Component link',
          finding: {
            code: 'detached',
            severity: 'error',
            message: 'Detached component',
            currentValue: 'Detached instance (plain frame)',
            expectedValue: `Instance of ${source}`,
            rationale:
              'This frame was detached from its component, so it no longer receives fixes or updates made to the component.',
            suggestedAction: 'Replace it with a fresh instance of the component and re-apply any intended overrides.',
          },
        },
      ];
    }

    const main = node.instance!.main;
    if (!resolver.hasComponentSources()) return [];
    if (!main)
      return [
        {
          property: 'Component source',
          finding: notVerifiable(
            'Main component can’t be read',
            'Figma couldn’t load the component this instance comes from, so Doctor can’t tell whether it’s approved.',
            'Check the component’s library is available to this file, then re-run the audit.',
          ),
        },
      ];
    if (resolver.isComponentApproved(main)) return [{ property: 'Component source' }];
    return [
      {
        property: 'Component source',
        finding: {
          code: 'unapproved-source',
          severity: 'warning',
          message: 'Component not in design system',
          currentValue: `${main.name} (${main.remote ? 'library' : 'local'})`,
          expectedValue: 'An approved design-system component',
          rationale: main.remote
            ? 'This instance comes from a library component that isn’t among the approved components.'
            : 'This is an instance of a component made in this file that isn’t among the approved components.',
          suggestedAction: 'Swap to the equivalent design-system component, if there is one.',
        },
      },
    ];
  },
};

/** Minimum number of layers inside a component before structural equality means anything. */
const MIN_SIGNATURE_NODES = 3;
const SIZE_TOLERANCE = 1;

export const duplicateComponentRule: AuditRule = {
  id: 'component-duplicate',
  name: 'Duplicate components',
  category: 'components',
  defaultSeverity: 'warning',
  description: 'Local components that are structurally identical to another component.',
  codes: { 'possible-duplicate': 'Possible duplicate component' },
  appliesTo: () => false, // page-level only
  evaluate: () => [],
  evaluatePage(nodes, { resolver }) {
    const locals = nodes.filter((n) => n.component && signatureSize(n.component.structureSignature) >= MIN_SIGNATURE_NODES);
    const candidates: { id: string; name: string; sig: string; w: number; h: number; remote: boolean; setId?: string }[] = [
      ...locals.map((n) => ({
        id: n.id,
        name: n.component!.setName ? `${n.component!.setName} / ${n.name}` : n.name,
        sig: n.component!.structureSignature,
        w: n.component!.width,
        h: n.component!.height,
        remote: false,
        setId: n.component!.setId,
      })),
      ...resolver.data.components
        .filter((c) => c.remote && c.structureSignature && signatureSize(c.structureSignature) >= MIN_SIGNATURE_NODES)
        .map((c) => ({ id: c.id, name: c.name, sig: c.structureSignature!, w: c.width ?? 0, h: c.height ?? 0, remote: true, setId: c.setId })),
    ];

    const checks: NodeCheck[] = [];
    for (const node of locals) {
      const self = candidates.find((c) => c.id === node.id)!;
      const twins = candidates.filter(
        (c) =>
          c.id !== self.id &&
          c.sig === self.sig &&
          Math.abs(c.w - self.w) <= SIZE_TOLERANCE &&
          Math.abs(c.h - self.h) <= SIZE_TOLERANCE &&
          // Variants in one set are expected to share structure.
          !(self.setId && self.setId === c.setId),
      );
      if (!twins.length) {
        checks.push({ node, property: 'Uniqueness' });
        continue;
      }
      // Prefer pointing at a library component: that is the one to keep.
      const twin = twins.find((t) => t.remote) ?? twins[0];
      checks.push({
        node,
        property: 'Uniqueness',
        finding: {
          code: 'possible-duplicate',
          severity: 'warning',
          message: 'Possible duplicate component',
          currentValue: `${self.name} (${Math.round(self.w)}×${Math.round(self.h)})`,
          expectedValue: `${twin.name}${twin.remote ? ' (library)' : ''}`,
          rationale:
            `Same layer structure, layout and size as “${twin.name}”` +
            (twins.length > 1 ? ` and ${twins.length - 1} other component(s)` : '') +
            '. Structure alone can’t prove they mean the same thing, so check before merging.',
          suggestedAction: twin.remote
            ? 'If they’re the same, use the library component and delete this one.'
            : 'If they’re the same, keep one and swap instances of the other.',
        },
      });
    }
    return checks;
  },
};

function signatureSize(sig: string): number {
  return countSignatureNodes(sig);
}
