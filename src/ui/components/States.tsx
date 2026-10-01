import type { AuditErrorKind } from '../../shared/messages';
import { Footer, Header } from './common';

/** First run in a file: ask which design system the page was designed with. */
export function NoDesignSystem({ savedCount, onChoose }: { savedCount: number; onChoose: () => void }) {
  return (
    <div class="screen">
      <Header title="Design System Doctor" />
      <main class="body center-col">
        <h2 class="title">Which design system did you use?</h2>
        <p class="muted">Choose it once, and Doctor checks your pages against it.</p>
      </main>
      <Footer>
        <button class="btn primary full" onClick={onChoose}>{savedCount ? 'Choose a design system' : 'Add a design system'}</button>
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
