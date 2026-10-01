import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  matchesRef,
  parseScale,
  refFor,
  sameRef,
  validateDesignSystem,
  type AssetIdentity,
  type AssetRef,
} from '../../shared/designSystem';
import type { Discovery } from '../../shared/messages';
import { countItems, describeSource, type DesignSystemReference } from '../../shared/reference';
import { RULE_CATALOG } from '../../shared/ruleCatalog';
import type { AuditConfig, DesignSystemConfig, SourceSelection } from '../../shared/types';
import { Footer, Header, plural } from './common';

interface Props {
  config: AuditConfig;
  discovery: Discovery | null;
  /** Starting point when the file has no design system yet (e.g. one reused from another file). */
  initial?: DesignSystemConfig | null;
  onSave: (config: AuditConfig) => void;
  onCancel?: () => void;
  /**
   * Editing a design system captured from its own file: its contents come from that file, so they
   * are summarised rather than listed asset by asset.
   */
  captured?: DesignSystemReference | null;
  /** `new`: creating a design system from this page. `edit`: the selected one's settings. */
  mode: 'edit' | 'new';
}

/** The five checks everyone sees; finer ones live under Advanced. */
const MAIN_IDS = ['typography', 'color', 'component', 'spacing', 'radius'];
const MAIN_CHECKS = RULE_CATALOG.filter((r) => MAIN_IDS.includes(r.id));
const FINE_CHECKS = RULE_CATALOG.filter((r) => !MAIN_IDS.includes(r.id));

interface Row {
  ref: AssetRef;
  name: string;
  fromLibrary: boolean;
  /** Seen in this file. Selected-but-unseen rows stay listed so they can be reviewed or removed. */
  found: boolean;
  meta?: string;
}

/** Discovered assets plus any selected ones this file can't see, library first. */
function rowsFor(found: AssetIdentity[], selected: AssetRef[], meta?: (a: AssetIdentity) => string | undefined): Row[] {
  const rows: Row[] = found.map((a) => ({ ref: refFor(a), name: a.name, fromLibrary: a.remote, found: true, meta: meta?.(a) }));
  for (const ref of selected) {
    if (!found.some((a) => matchesRef(ref, a))) rows.push({ ref, name: ref.name, fromLibrary: ref.source === 'library', found: false });
  }
  return rows.sort((a, b) => Number(b.fromLibrary) - Number(a.fromLibrary) || a.name.localeCompare(b.name));
}

const toggleRef = (refs: AssetRef[], ref: AssetRef, on: boolean) => (on ? [...refs.filter((r) => !sameRef(r, ref)), ref] : refs.filter((r) => !sameRef(r, ref)));

export function Configure({ config, discovery, initial, onSave, onCancel, captured, mode }: Props) {
  const [ds, setDs] = useState<DesignSystemConfig | null>(config.designSystem ?? initial ?? null);
  const [spacing, setSpacing] = useState((config.designSystem ?? initial)?.spacingScale.join(', ') ?? '');
  const [radius, setRadius] = useState((config.designSystem ?? initial)?.radiusScale.join(', ') ?? '');
  const [disabled, setDisabled] = useState(config.disabledRules);
  const [includeHidden, setIncludeHidden] = useState(config.includeHidden);
  const [ignored, setIgnored] = useState(config.ignoredNodeIds);

  // First-time setup starts from the discovery suggestion; nothing is saved until confirmed.
  useEffect(() => {
    if (!ds && discovery) {
      setDs(discovery.suggested);
      setSpacing(discovery.suggested.spacingScale.join(', '));
      setRadius(discovery.suggested.radiusScale.join(', '));
    }
  }, [discovery]);

  const scales = useMemo(
    () => ({ spacing: parseScale('Spacing scale', spacing), radius: parseScale('Corner radius scale', radius) }),
    [spacing, radius],
  );

  if (!ds) {
    return (
      <div class="screen">
        <Header title={mode === 'new' ? 'Create from this page' : 'Edit settings'} onBack={onCancel} />
        <main class="body"><p class="muted" aria-live="polite">Looking at what this page uses…</p></main>
      </div>
    );
  }

  // Asset checks need discovery; until it arrives only settings like scales are validated.
  const validation = validateDesignSystem(
    ds,
    scales,
    discovery ?? { collections: [], textStyles: [], components: [] },
  );
  if (!discovery) {
    validation.errors = validation.errors.filter((e) => !e.includes('no longer exists'));
    validation.warnings = validation.warnings.filter((w) => !w.includes('isn’t used in this file'));
  }
  // Captured library assets don't need to be used here: their values were captured.
  if (captured) validation.warnings = validation.warnings.filter((w) => !w.includes('isn’t used in this file'));
  const counts = captured ? countItems(captured) : null;

  const toggleRule = (id: string, on: boolean) => setDisabled(on ? disabled.filter((d) => d !== id) : [...disabled, id]);

  const setSelection = (key: 'textStyles' | 'components', patch: Partial<SourceSelection>) => setDs({ ...ds, [key]: { ...ds[key], ...patch } });

  const save = () => {
    if (validation.errors.length) return;
    onSave({
      ...config,
      designSystem: { ...ds, name: ds.name.trim(), spacingScale: scales.spacing.values, radiusScale: scales.radius.values },
      disabledRules: disabled,
      includeHidden,
      ignoredNodeIds: ignored,
    });
  };

  const collectionRows = rowsFor(discovery?.collections ?? [], ds.variableCollections, (a) => {
    const c = discovery?.collections.find((x) => x.id === a.id);
    return c ? (c.colorCount ? plural(c.colorCount, 'colour') : plural(c.variableCount, 'variable')) : undefined;
  });

  return (
    <div class="screen">
      <Header title={mode === 'new' ? 'Create from this page' : 'Edit settings'} onBack={onCancel} />
      <main class="body configure">
        {mode === 'new' ? (
          <p class="muted">
            Doctor starts from the styles, variables and components already used on this page. Give it a name, check the
            scales, and save. You can fine-tune what’s included under Advanced.
          </p>
        ) : captured ? (
          <p class="muted small">
            {describeSource(captured)}. To update it, open that library file in Figma and choose “Save a library as a design
            system” there. This design system is updated in place.
          </p>
        ) : null}
        <label class="field">
          <span class="label">Name</span>
          <input value={ds.name} onInput={(e) => setDs({ ...ds, name: (e.target as HTMLInputElement).value })} />
        </label>

        <h3 class="section-title">Spacing and corner radius</h3>
        <label class="field">
          <span class="label">Spacing (px)</span>
          <input value={spacing} onInput={(e) => setSpacing((e.target as HTMLInputElement).value)} aria-invalid={scales.spacing.errors.length > 0} />
          <span class="muted small">Gaps and padding in auto layout must use one of these values.</span>
        </label>
        <label class="field">
          <span class="label">Corner radius (px)</span>
          <input value={radius} onInput={(e) => setRadius((e.target as HTMLInputElement).value)} aria-invalid={scales.radius.errors.length > 0} />
          <span class="muted small">Include a large value such as 999 to allow fully rounded shapes.</span>
        </label>

        <h3 class="section-title">Checks</h3>
        <div class="source">
          {MAIN_CHECKS.map((r) => (
            <label class="check" key={r.id} title={r.description}>
              <input type="checkbox" checked={!disabled.includes(r.id)} onChange={(e) => toggleRule(r.id, (e.target as HTMLInputElement).checked)} />
              <span>{r.name} <span class="muted small">· {r.description}</span></span>
            </label>
          ))}
          <label class="check">
            <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden((e.target as HTMLInputElement).checked)} />
            Check hidden layers
          </label>
        </div>

        {ignored.length > 0 && (
          <div class="row-between">
            <span class="muted">{plural(ignored.length, 'ignored layer')} in this file</span>
            <button class="link" onClick={() => setIgnored([])}>Clear</button>
          </div>
        )}

        <details class="advanced">
          <summary>Advanced</summary>
          <p class="muted small">What this design system includes, item by item. Most people never need to change this.</p>

        <SourceSection title="Variables" hint="The variable collections your team uses as tokens. Every variable in a chosen collection counts as approved.">
          {counts && <p class="small">{plural(counts.collections, 'collection')} · {plural(counts.variables, 'variable')} captured</p>}
          {!counts && !discovery && <p class="muted small">Loading…</p>}
          {!counts && discovery && collectionRows.length === 0 && <p class="muted small">No variable collections are used on this page or made in this file.</p>}
          {!counts && collectionRows.map((row) => (
            <AssetRow
              key={JSON.stringify(row.ref)}
              row={row}
              checked={ds.variableCollections.some((r) => sameRef(r, row.ref))}
              onToggle={(on) => setDs({ ...ds, variableCollections: toggleRef(ds.variableCollections, row.ref, on) })}
            />
          ))}
        </SourceSection>

        <SelectionSection
          title="Typography"
          noun="text styles"
          hint="Choose which text styles are approved."
          selection={ds.textStyles}
          found={discovery?.textStyles}
          capturedCount={counts?.textStyles}
          onChange={(patch) => setSelection('textStyles', patch)}
        />

        <SourceSection title="Colour styles" hint="Tokens are preferred. Approve colour styles only if your team still uses them.">
          {counts && <p class="small">{plural(counts.paintStyles, 'colour style')} captured</p>}
          <SwitchRow
            label={counts ? 'Also accept colour styles from any other library' : 'Colour styles from your libraries'}
            checked={ds.paintStyles.library}
            onChange={(v) => setDs({ ...ds, paintStyles: { ...ds.paintStyles, library: v } })}
          />
          <SwitchRow
            label="Colour styles made in this file"
            checked={ds.paintStyles.local}
            onChange={(v) => setDs({ ...ds, paintStyles: { ...ds.paintStyles, local: v } })}
          />
        </SourceSection>

        <SelectionSection
          title="Components"
          noun="components"
          hint="Choose which components are approved. Instances of anything else are flagged."
          selection={ds.components}
          found={discovery?.components}
          capturedCount={counts?.components}
          onChange={(patch) => setSelection('components', patch)}
        />

          <SourceSection title="Other checks" hint="Finer checks that are off by default in some teams.">
            {FINE_CHECKS.map((r) => (
              <label class="check" key={r.id} title={r.description}>
                <input type="checkbox" checked={!disabled.includes(r.id)} onChange={(e) => toggleRule(r.id, (e.target as HTMLInputElement).checked)} />
                <span>{r.name} <span class="muted small">· {r.description}</span></span>
              </label>
            ))}
          </SourceSection>
        </details>

        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div class="validation">
            {validation.errors.length > 0 && (
              <ul class="validation-errors" role="alert">
                {validation.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {validation.warnings.length > 0 && (
              <ul class="validation-warnings">
                {validation.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </main>
      <Footer>
        <button class="btn primary full" disabled={validation.errors.length > 0} onClick={save}>{mode === 'new' ? 'Save design system' : 'Save'}</button>
      </Footer>
    </div>
  );
}

function SourceSection({ title, hint, children }: { title: string; hint: string; children: preact.ComponentChildren }) {
  return (
    <section class="source">
      <h4 class="source-title">{title}</h4>
      <p class="muted small source-hint">{hint}</p>
      {children}
    </section>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>
        {label}
        {hint && <span class="muted small"> · {hint}</span>}
      </span>
    </label>
  );
}

function AssetRow({ row, checked, onToggle, coveredBy }: { row: Row; checked: boolean; onToggle: (on: boolean) => void; coveredBy?: string }) {
  return (
    <label class={`check asset-row ${row.found ? '' : 'not-found'}`} title={coveredBy}>
      <input type="checkbox" checked={checked || !!coveredBy} disabled={!!coveredBy} onChange={(e) => onToggle((e.target as HTMLInputElement).checked)} />
      <span class="asset-name">{row.name}</span>
      <span class={`origin ${row.fromLibrary ? 'library' : 'local'}`}>{row.fromLibrary ? 'Library' : 'This file'}</span>
      {row.found ? row.meta && <span class="muted small">{row.meta}</span> : (
        <span class="muted small">{row.fromLibrary ? 'Not used in this file' : 'Missing'}</span>
      )}
    </label>
  );
}

/** Text styles and components: "everything from …" switches plus individual picks. */
function SelectionSection(props: {
  title: string;
  noun: string;
  hint: string;
  selection: SourceSelection;
  found: AssetIdentity[] | undefined;
  /** Set for a captured design system: its items are summarised, not listed. */
  capturedCount?: number;
  onChange: (patch: Partial<SourceSelection>) => void;
}) {
  const { selection, found, onChange, noun, capturedCount } = props;
  if (capturedCount !== undefined) {
    return (
      <SourceSection title={props.title} hint={props.hint}>
        <p class="small">{plural(capturedCount, noun.replace(/s$/, ''))} captured</p>
        <SwitchRow
          label={`Also accept ${noun} from any other library`}
          hint="off: only this design system counts"
          checked={selection.library}
          onChange={(v) => onChange({ library: v })}
        />
      </SourceSection>
    );
  }
  const rows = rowsFor(found ?? [], selection.items);
  return (
    <SourceSection title={props.title} hint={props.hint}>
      <SwitchRow
        label={`All ${noun} from your libraries`}
        hint="includes ones not listed here"
        checked={selection.library}
        onChange={(v) => onChange({ library: v })}
      />
      <SwitchRow label={`All ${noun} made in this file`} checked={selection.local} onChange={(v) => onChange({ local: v })} />
      {!found && <p class="muted small">Loading…</p>}
      {found && rows.length === 0 && <p class="muted small">No {noun} are used on this page or made in this file.</p>}
      {rows.length > 0 && <p class="muted small list-caption">Or choose individual {noun}:</p>}
      {rows.map((row) => {
        const covered = row.fromLibrary ? selection.library : selection.local;
        return (
          <AssetRow
            key={JSON.stringify(row.ref)}
            row={row}
            checked={selection.items.some((r) => sameRef(r, row.ref))}
            coveredBy={covered ? `Included by “All ${noun} ${row.fromLibrary ? 'from your libraries' : 'made in this file'}”` : undefined}
            onToggle={(on) => onChange({ items: toggleRef(selection.items, row.ref, on) })}
          />
        );
      })}
    </SourceSection>
  );
}
