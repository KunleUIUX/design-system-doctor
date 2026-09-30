import type { AuditScope } from '../../shared/messages';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../shared/types';
import type { ProgressState } from '../App';
import { Footer, Header, plural } from './common';

/** Reading layers dominates the run, so it owns most of the bar. */
function percent(p: ProgressState | null): number {
  if (!p) return 0;
  switch (p.phase) {
    case 'counting':
      return 2;
    case 'reading':
      return p.total ? Math.round(5 + (p.scanned / p.total) * 75) : 5;
    case 'resolving':
      return 82;
    case 'checking':
      return Math.round(85 + (p.categoriesDone.length / CATEGORY_ORDER.length) * 15);
  }
}

export function Progress({ progress, scope, onCancel }: { progress: ProgressState | null; scope: AuditScope; onCancel: () => void }) {
  const pct = percent(progress);
  const status =
    !progress || progress.phase === 'counting'
      ? 'Counting layers…'
      : progress.phase === 'resolving'
        ? 'Loading styles, variables and components…'
        : `Checking ${plural(progress.total, 'layer')}`;
  return (
    <div class="screen">
      <Header title="Design System Doctor" />
      <main class="body">
        <h2 class="title">Auditing {scope === 'page' ? 'page' : 'selection'}…</h2>
        <p class="muted" aria-live="polite">{status}</p>
        <div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div class="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <ul class="checklist">
          {CATEGORY_ORDER.map((c) => {
            const done = progress?.categoriesDone.includes(c);
            return (
              <li key={c} class={done ? 'done' : ''}>
                <span>{CATEGORY_LABELS[c]}</span>
                <span aria-label={done ? 'done' : 'pending'}>{done ? '✓' : '…'}</span>
              </li>
            );
          })}
        </ul>
      </main>
      <Footer>
        <button class="btn secondary full" onClick={onCancel}>Cancel</button>
      </Footer>
    </div>
  );
}
