import { useEffect } from 'preact/hooks';
import type { AuditErrorKind, Discovery } from '../../shared/messages';
import { Footer, Header, plural } from './common';

export function NoDesignSystem({
  discovery,
  savedCount,
  onMount,
  onChoose,
  onCreateFromPage,
}: {
  discovery: Discovery | null;
  /** Design systems saved on this device that can be selected here. */
  savedCount: number;
  onMount: () => void;
  onChoose: () => void;
  onCreateFromPage: () => void;
}) {
  useEffect(onMount, []);
  const found = discovery && [
    discovery.collections.length ? plural(discovery.collections.length, 'token collection') : '',
    discovery.textStyles.length ? plural(discovery.textStyles.length, 'text style') : '',
    discovery.paintStyles.library + discovery.paintStyles.local ? plural(discovery.paintStyles.library + discovery.paintStyles.local, 'colour style') : '',
    discovery.components.length ? plural(discovery.components.length, 'component') : '',
  ].filter(Boolean);

  return (
    <div class="screen">
      <Header title="Design System Doctor" />
      <main class="body center-col">
        <h2 class="title">Which design system did you use?</h2>
        <p class="muted">Doctor checks this page against the design system you choose.</p>
        {!discovery ? (
          <p class="muted small">Looking for styles, variables and components…</p>
        ) : found && found.length ? (
          <p class="muted small">This page uses {found.join(', ')}.</p>
        ) : (
          <p class="muted small">This page doesn’t use any styles, variables or components yet.</p>
        )}
      </main>
      <Footer>
        <button class="btn primary full" onClick={onChoose}>
          {savedCount ? `Choose a design system (${savedCount} saved)` : 'Choose or capture a design system'}
        </button>
        <button class="btn secondary full" onClick={onCreateFromPage}>Create from this page</button>
      </Footer>
    </div>
  );
}

export function ConfirmLarge(props: {
  layerCount: number;
  canUseSelection: boolean;
  onContinue: () => void;
  onSelection: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="screen">
      <Header title="Large page" onBack={props.onCancel} />
      <main class="body center-col">
        <h2 class="title">This page contains {props.layerCount.toLocaleString()} layers.</h2>
        <p class="muted">The audit may take longer than usual. Figma stays usable, and you can cancel at any time.</p>
      </main>
      <Footer>
        <button class="btn primary full" onClick={props.onContinue}>Continue</button>
        {props.canUseSelection && <button class="btn secondary full" onClick={props.onSelection}>Audit selection instead</button>}
      </Footer>
    </div>
  );
}

const ERROR_TITLES: Record<AuditErrorKind, string> = {
  'cannot-start': 'Audit couldn’t start.',
  timeout: 'Audit couldn’t finish.',
  cancelled: 'Audit cancelled.',
  'no-design-system': 'No design system configured.',
  'empty-selection': 'Nothing selected.',
};

export function ErrorState(props: { kind: AuditErrorKind; message: string; onRetry: () => void; onHome: () => void; onSelection?: () => void }) {
  return (
    <div class="screen">
      <Header title="Design System Doctor" onBack={props.onHome} />
      <main class="body center-col" role="alert">
        <h2 class="title">{ERROR_TITLES[props.kind]}</h2>
        <p class="muted">{props.message}</p>
      </main>
      <Footer>
        {props.kind === 'empty-selection' ? (
          <button class="btn primary full" onClick={props.onHome}>Back</button>
        ) : (
          <button class="btn primary full" onClick={props.onRetry}>Retry</button>
        )}
        {props.kind === 'timeout' && props.onSelection && (
          <button class="btn secondary full" onClick={props.onSelection}>Audit selection instead</button>
        )}
      </Footer>
    </div>
  );
}
