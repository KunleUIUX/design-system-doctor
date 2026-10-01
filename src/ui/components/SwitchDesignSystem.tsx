import { countItems, describeSource, type DesignSystemReference } from '../../shared/reference';
import { Footer, Header, plural } from './common';

interface Props {
  library: DesignSystemReference[];
  activeId: string | null;
  /** Capture in progress or its outcome. */
  capture: { busy: boolean; message?: string };
  onUse: (id: string) => void;
  onCreateFromPage: () => void;
  onCapture: () => void;
  onBack?: () => void;
}

/** Choose the design system as a whole. Switching replaces the previous one completely. */
export function SwitchDesignSystem({ library, activeId, capture, onUse, onCreateFromPage, onCapture, onBack }: Props) {
  return (
    <div class="screen">
      <Header title="Choose design system" onBack={onBack} />
      <main class="body">
        <p class="muted">Pick the design system this page was designed with. Doctor checks the page against it.</p>
        {library.length === 0 ? (
          <p class="muted small">No design systems saved on this device yet.</p>
        ) : (
          <ul class="list ds-list">
            {library.map((r) => {
              const n = countItems(r);
              const parts = [
                n.textStyles ? plural(n.textStyles, 'text style') : '',
                n.collections ? plural(n.collections, 'token collection') : '',
                n.paintStyles ? plural(n.paintStyles, 'colour style') : '',
                n.components ? plural(n.components, 'component') : '',
              ].filter(Boolean);
              const active = r.id === activeId;
              return (
                <li key={r.id} class="ds-item">
                  <div class="ds-text">
                    <strong>{r.name}</strong>
                    <span class="muted small">{describeSource(r)}</span>
                    {parts.length > 0 && <span class="muted small">{parts.join(' · ')}</span>}
                  </div>
                  {active ? <span class="badge">In use</span> : <button class="btn secondary small-btn" onClick={() => onUse(r.id)}>Use</button>}
                </li>
              );
            })}
          </ul>
        )}

        <h3 class="section-title">Add a design system</h3>
        <p class="muted small">
          <strong>Save this file as a design system</strong> when this is the design system’s own (library) file. Doctor captures
          every style, variable and component, so other files can be checked against all of them.
        </p>
        <p class="muted small">
          <strong>Create from this page</strong> uses the styles, tokens and components this page uses. It only knows those.
        </p>
        {capture.message && <div class="banner warning" role="alert">{capture.message}</div>}
      </main>
      <Footer>
        <button class="btn primary full" disabled={capture.busy} onClick={onCapture}>
          {capture.busy ? 'Capturing…' : 'Save this file as a design system'}
        </button>
        <button class="btn secondary full" disabled={capture.busy} onClick={onCreateFromPage}>Create from this page</button>
      </Footer>
    </div>
  );
}
