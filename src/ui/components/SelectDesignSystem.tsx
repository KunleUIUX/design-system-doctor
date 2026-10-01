import { useState } from 'preact/hooks';
import { describeSource, type DesignSystemReference } from '../../shared/reference';
import { Header } from './common';

interface Props {
  library: DesignSystemReference[];
  activeId: string | null;
  /** Saving a library in progress, or why it couldn't be saved. */
  capture: { busy: boolean; message?: string };
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onSaveLibrary: () => void;
  onCreateFromPage: () => void;
  onBack?: () => void;
}

/** Choosing the design system a page was designed with, as one complete system. */
export function SelectDesignSystem({ library, activeId, capture, onSelect, onEdit, onRename, onRemove, onSaveLibrary, onCreateFromPage, onBack }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const close = () => {
    setMenuFor(null);
    setRenaming(null);
    setRemoving(null);
  };

  return (
    <div class="screen">
      <Header title="Design system" onBack={onBack} />
      <main class="body">
        <h3 class="section-title">Your design systems</h3>
        {library.length === 0 ? (
          <p class="muted">You haven’t saved a design system yet. Add one below.</p>
        ) : (
          <ul class="list ds-list">
            {library.map((r) => {
              const active = r.id === activeId;
              return (
                <li key={r.id} class={`ds-item ${active ? 'active' : ''}`}>
                  <div class="ds-row">
                    <button class="ds-select" aria-pressed={active} onClick={() => (close(), onSelect(r.id))}>
                      <span class="ds-check" aria-hidden="true">{active ? '✓' : ''}</span>
                      <span class="ds-text">
                        <strong>{r.name}</strong>
                        <span class="muted small">{describeSource(r)}</span>
                      </span>
                    </button>
                    <button class="icon-btn" aria-label={`More actions for ${r.name}`} aria-expanded={menuFor === r.id}
                      onClick={() => (menuFor === r.id ? close() : (close(), setMenuFor(r.id)))}>⋯</button>
                  </div>

                  {menuFor === r.id && !renaming && !removing && (
                    <div class="ds-menu" role="menu">
                      <button role="menuitem" onClick={() => (close(), onEdit(r.id))}>Edit settings</button>
                      <button role="menuitem" onClick={() => setRenaming({ id: r.id, draft: r.name })}>Rename</button>
                      <button role="menuitem" class="danger" onClick={() => setRemoving(r.id)}>Remove</button>
                    </div>
                  )}

                  {renaming?.id === r.id && (
                    <form class="ds-inline" onSubmit={(e) => {
                      e.preventDefault();
                      if (renaming.draft.trim()) onRename(r.id, renaming.draft.trim());
                      close();
                    }}>
                      <input aria-label="Design system name" value={renaming.draft} autoFocus
                        onInput={(e) => setRenaming({ id: r.id, draft: (e.target as HTMLInputElement).value })} />
                      <button class="btn primary small-btn" type="submit" disabled={!renaming.draft.trim()}>Save</button>
                      <button class="link small" type="button" onClick={close}>Cancel</button>
                    </form>
                  )}

                  {removing === r.id && (
                    <div class="ds-inline" role="alertdialog" aria-label={`Remove ${r.name}`}>
                      <span class="small">
                        Remove “{r.name}” from your design systems?{active ? ' It’s selected for this file, so you’ll choose another.' : ''}
                      </span>
                      <button class="btn secondary small-btn danger" onClick={() => (close(), onRemove(r.id))}>Remove</button>
                      <button class="link small" onClick={close}>Cancel</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <h3 class="section-title">Add a design system</h3>
        <button class="add-option" disabled={capture.busy} onClick={onSaveLibrary}>
          <strong>{capture.busy ? 'Saving…' : 'Save a library as a design system'}</strong>
          <span class="muted small">Open your design system’s library file in Figma, run Doctor there, and save it.</span>
        </button>
        <button class="add-option" disabled={capture.busy} onClick={onCreateFromPage}>
          <strong>Create from this page</strong>
          <span class="muted small">Use the styles, variables and components already used on this page as a starting reference.</span>
        </button>
        {capture.message && <div class="banner warning" role="alert">{capture.message}</div>}
      </main>
    </div>
  );
}
