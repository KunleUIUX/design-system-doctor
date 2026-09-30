# Design System Doctor — Technical Design

## 1. Repository assessment (2026-09-29)

The repository was empty, so there was no existing infrastructure to keep. Chosen stack:

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5 (strict) | Required by the brief; typings for the Plugin API |
| Figma typings | `@figma/plugin-typings` 1.139 | Every API below was checked against this file |
| Bundler | esbuild | One small dependency; builds main thread + UI in < 1 s |
| UI | Preact (JSX) | ~4 kB; component model without React's weight |
| Tests | Vitest | Fast, TS-native, no config |
| Package manager | npm | Already installed; nothing else required |

No backend, no database, no network access (`networkAccess: none`).

## 2. Layering

```
 UI (iframe, Preact)            src/ui/**           renders state, sends intents
        │  postMessage (typed, src/shared/messages.ts)
 Plugin controller (main)       src/code.ts         message routing, navigation, config I/O
        │
 Figma adapter                  src/figma/**        the ONLY code that touches `figma.*`
   ├─ snapshot.ts   SceneNode → NodeSnapshot (plain data), one traversal
   └─ designSystemData.ts  styles / variables / components → DesignSystemData
        │
 Audit engine (pure)            src/engine/**       no Figma globals, no DOM
   ├─ orchestrator.ts   run rules, dedupe, score
   ├─ resolver.ts       DesignSystemResolver ("is this approved? what matches?")
   ├─ rules/*.ts        one file per rule
   └─ scoring.ts        compliance formula (swappable)
```

**Key decision: rules run on snapshots, not live `SceneNode`s.** The adapter reads
each node once and produces a serialisable `NodeSnapshot` with styles, variables and
main components already resolved (the Plugin API calls for these are async, and
`dynamic-page` forbids the sync variants). Rules are then synchronous pure functions:

* testable with plain fixtures, no Figma mock;
* each property is read from Figma exactly once, however many rules look at it;
* async lookups are de-duplicated and batched (unique style/variable/component ids).

This is the one place the brief's suggested `evaluate(node: SceneNode)` signature was
adapted: rules take `evaluate(node: NodeSnapshot, ctx: AuditContext)`.

## 3. Figma API capability check

Verified in `node_modules/@figma/plugin-typings/plugin-api.d.ts` (manifest uses
`documentAccess: "dynamic-page"`, so the async variants are required).

| Need | API | Status / notes |
|---|---|---|
| Read nodes | `figma.currentPage.children`, `node.children` | ✅ manual stack traversal (single pass) |
| Text properties | `TextNode.getStyledTextSegments([...])` | ✅ gives `textStyleId`, `fontName`, `fontSize`, `lineHeight`, `letterSpacing`, `fills`, `fillStyleId`, `boundVariables` per run, handles mixed text |
| Styles | `figma.getStyleByIdAsync`, `getLocalTextStylesAsync`, `getLocalPaintStylesAsync` | ✅ `style.remote` tells library vs local |
| Variables | `figma.variables.getLocalVariablesAsync`, `getVariableByIdAsync`, `getLocalVariableCollectionsAsync`, `getVariableCollectionByIdAsync` | ✅ `valuesByMode` may hold aliases → resolved in the adapter (depth-limited) |
| Library variables not yet used in file | `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync` + `importVariableByKeyAsync` | ⚠️ needs `teamlibrary` permission and imports the variable. **Not used in v1** (see limitations) |
| Variable binding on node | `node.boundVariables`, `SolidPaint.boundVariables.color` | ✅ |
| Mode a node renders in | `node.resolvedVariableModes` | ✅ used so raw colours are compared to the token value in the *right* mode |
| Instances & main components | `InstanceNode.getMainComponentAsync()` | ✅ `remote`, `key`, `parent` (component set) |
| Instance overrides | `InstanceNode.overrides` → `{id, overriddenFields}[]` | ✅ lets us audit only overridden fields inside instances |
| Detached instances | `FrameNode.detachedInfo` → `{type:'local',componentId}` \| `{type:'library',componentKey}` | ✅ first-class API; no heuristics needed |
| Fills / strokes | `fills`, `strokes`, `fillStyleId`, `strokeStyleId` | ✅ may be `figma.mixed` on text → read per segment |
| Corner radius | `cornerRadius` (may be mixed), `topLeftRadius`… | ✅ |
| Layout spacing | `layoutMode`, `itemSpacing`, `counterAxisSpacing`, `padding*`, `gridRowGap`, `gridColumnGap`, `primaryAxisAlignItems` | ✅ auto-layout only |
| Select node | `figma.currentPage.selection = [node]` | ✅ |
| Focus viewport | `figma.viewport.scrollAndZoomIntoView([node])` | ✅ |
| Node on another page | `figma.setCurrentPageAsync(page)` | ✅ |
| Persist config | `figma.root.setPluginData` / `figma.clientStorage` | ✅ file-level config travels with the file; falls back to clientStorage when the file is read-only |

### Limitations (documented, deliberately not guessed around)

1. **Library tokens only count once Figma knows about them.** Library variables, text styles and
   components are discovered when they are used somewhere on the audited page (or already
   imported into the file). A raw colour can't be matched to a library token that the file has
   never referenced. Pulling whole libraries in via `teamLibrary` + `importVariableByKeyAsync` is
   possible but changes the file, so it is left for a later, explicit user action.
2. **Detached-from-library names.** `detachedInfo` gives a library component *key*, not a name.
   We show the name when the same component is used elsewhere on the page, otherwise
   "Library component (name unavailable)".
3. **Spacing on non-auto-layout frames** is not audited. Absolute positions don't express
   intended spacing reliably, so auditing them would produce false positives.
4. **Gradients, images, effects and strokes weights** are not audited in v1.
5. **Inside instances**, only fields the designer has overridden are audited. Everything else is
   inherited from the main component, which is audited where it lives.
6. **Duplicate components** is a structural-similarity *warning*, never an error. It compares
   component trees (types, layout, size) and cannot prove two components mean the same thing.

## 4. Design system definition (no fabrication)

A design system is a **user-approved set of sources**, stored per file:

* variable collections (local or library, picked individually),
* text styles and components: whole sources (library / this file) and/or individual items,
* colour styles: library and/or local,
* spacing scale and radius scale (numbers).

Library assets are referenced by **published key**, local ones by **id** (§9). Until at least one
source is approved, the plugin shows **"No design system configured"** and lists what it found.
The configure screen *suggests* sources (pre-ticked) but nothing is saved until the designer
confirms. Full model, validation, persistence and cross-file behaviour: `docs/CONFIGURATION.md`.

## 5. Rules (v1)

| Rule id | Category | Severity | Fires when |
|---|---|---|---|
| `typography/unapproved-style` | Typography | error | Text run uses a text style that is not approved |
| `typography/local-matches-style` | Typography | error | Text run has no style but its font/size/line-height/letter-spacing exactly match an approved style |
| `typography/no-style` | Typography | warning | Text run has no style and no approved style matches (nearest shown as a hint) |
| `color/raw-matches-token` | Colour | error | Solid fill/stroke is a raw value exactly equal to an approved colour variable (in the node's mode) |
| `color/near-token` | Colour | warning | Raw colour is within ΔE ≤ 2 of an approved token but not equal (likely typo) |
| `color/unapproved-variable` | Colour | warning | Bound to a colour variable outside the approved collections |
| `color/style-instead-of-variable` | Colour | error | Uses a *non-approved* colour style whose colour equals an approved variable |
| `component/detached` | Components | error | `detachedInfo` is set |
| `component/unapproved-source` | Components | warning | Instance of a component outside the approved sources |
| `component/duplicate` | Components | warning | Two components have identical structure signatures and near-identical size |
| `spacing/off-scale` | Spacing | error | Auto-layout gap/padding not in the scale and not bound to a variable |
| `radius/off-scale` | Radius | warning | Corner radius not in the approved set (pill radii ≥ half the short side count as "full") |
| `color/unmapped` | Colour | review | Raw colour unrelated to any approved token (not near either). Shown, never scored |

**Consolidation.** Padding sides (and mixed corner radii) that share a value and variable binding
are one check and one finding, e.g. `Padding · Affects: Top · Right · Bottom · Left`. One 18px
mistake was previously four identical issues. Gap, row gap and grid gaps stay separate: they mean
different things.

**Severity `review`** (Phase 3 product decision). A third state for things the rules can't judge.
Today only unmapped colours use it. Review items appear in their category, with their own count
("N to review") and a hollow marker, and never enter the compliance score in either direction.

Colours with no matching or near-matching token are **not** flagged (brief §7) and are **not scored**:
they are neither a violation nor evidence of design-system use, so counting them as passes would
inflate the score of pages built from ad-hoc colours (found in real-file validation, 2026-09-30).

## 6. Compliance score

```
score = Σ credit / N          (shown as a percentage, rounded down)
N      = audited opportunities  (one per property a rule actually checked)
credit = 1 pass, 0.5 warning, 0 error      (worst finding per opportunity)
```

* **Opportunity** = one (node, property) pair a rule could actually judge, e.g. one text run's style, one
  solid fill, one padding side, one corner radius, one instance.
* **Skipped nodes** (hidden, unreadable, or errored) contribute no opportunities. The UI reports
  how many were skipped and says the score covers analysed layers only.
* **N = 0** → no score ("Nothing to score"), never a fake 100 %.
* Formula lives in `src/engine/scoring.ts`, so it can change without touching rules.
* **Confidence** (sample size, not statistics): under 10 applicable checks → *low confidence*,
  shown next to the score ("Low confidence · 1 applicable check"); 10–99 → normal; ≥ 100 →
  *broad coverage*. The score is always shown; the label explains how much it covers.
* **Review items** are excluded, like hidden layers.

## 6a. Stale results (freshness)

Every result stores a **fingerprint** (`src/engine/fingerprint.ts`): a hash of the layer snapshots
the rules read, the design-system data they reference (sorted by id) and the audit settings. Same
fingerprint ⇒ an audit now would give the same result. `checkFreshness` (`src/figma/audit.ts`)
re-reads exactly what the audit reads, without running rules, and compares:

* on plugin open and page switch (saved "Last audit"),
* ~0.8 s after edits on an audited page (`PageNode.on('nodechange')`, debounced),
* after text/colour style edits (`figma.on('stylechange')`) and settings changes.

States: `current`, `changed` ("Design has changed since this audit" + Run audit), `unverified`
(page > 3,000 layers or check failed: "Can't confirm this is current").

Deliberately **not** stale: moving, resizing or renaming nothing the rules read. Position isn't in
the snapshot, so moving a frame doesn't raise a false alarm (verified on real nodes).

Limitations: variable value edits fire no event while the plugin is open, so they are caught on
the next open/page switch/re-check, not live. Selection-scope audits are checked by their root ids;
a deleted root is reported as `changed`. Large pages (> 3,000 layers) are never re-read just to compare.

## 7. Performance

* **Regression guard:** `snapshotTree` reads each node's `children` exactly once. Figma builds a
  new wrapper array on every `.children` access (~26 ms for 3,600 children); indexing it inside
  the loop made wide frames O(n²) and timed out. `test/snapshot.test.ts` counts the reads.
* Real-file benchmark: 3,601 layers audited in ≈2.2 s (2.16 s Phase 2, 2.28 s Phase 3); 2.74 s on
  the remote-token frame (Phase 4). A read-only traversal proxy measured the same raw read cost in
  both files (868–1,056 ms vs 871–1,352 ms), so the difference is host variance, not added work.
* Remote resolution cost is pinned by `test/designSystemData.test.ts`: one API call per distinct
  variable/collection/style, independent of layer count.

* One traversal, iterative (no recursion limit), hidden subtrees skipped at the root.
* Async resolution collected into unique-id sets and resolved in parallel chunks, cached for
  the audit.
* Engine yields to the event loop every 250 nodes: progress messages (throttled to ~10/s)
  and cancellation checks happen there.
* Pages with more than 3,000 layers ask before auditing (offer "Audit selection instead").
* Hard budget of 90 s → "Audit couldn't finish" error.

## 8. Message protocol

Typed in `src/shared/messages.ts`. UI → main: `init`, `run-audit`, `cancel-audit`,
`go-to-node`, `get-discovery`, `save-config`, `check-freshness`. Main → UI: `init-state`,
`audit-progress`, `audit-confirm-large`, `audit-result`, `audit-error`, `navigate-result`,
`discovery`, `config-saved` (`savedTo: 'file' | 'session'`), `selection-changed`, `last-audit`,
`audit-freshness`. Results are sent once, as a single message.

## 9. Remote (library) assets and asset identity — validated 2026-09-30

Validated against a real published library (`DSD Test Library`, team "kunle's Design") consumed by
two separate files, `DSD Library Consumer` and `DSD Library Consumer 2`, through the real
controller (`dev/e2e/library.js`, `config-consumer1.js`, `config-consumer2.js`; keys in
`dev/e2e/library-keys.json`). Remote colour and spacing variables, remote text styles, a remote
component instance and a detached library instance all behave correctly. Raw values are matched
to remote tokens, library origin is reported ("(library)") and "Go to layer" is exact.

### Identity rules

* **Local assets are identified by id.** `VariableCollectionId:45:3`, `S:…`, node id `12:34`.
  These are only meaningful inside their own file.
* **Library assets are identified by published key.** The key is Figma's documented stable
  identity for a published asset and is what settings store (`{source:'library', key}`).
* Matching (`matchesRef`) never crosses the two: a library ref matches only a `remote` asset with
  that key; a local ref matches only a non-remote asset with that id. Names are display-only.

### What the ids of library assets look like in a consuming file (observed)

| Asset | Id in Consumer 1 | Id in Consumer 2 | Notes |
|---|---|---|---|
| Variable | `VariableID:<key>/1:4` | identical | id embeds the key and the library-side id |
| Collection | `VariableCollectionId:<key>/1:0` | identical | **`variableIds` lists only variables imported into that file** |
| Text style | `S:<key>,1:26` | identical | |
| Component (main of an instance) | node `1:13`, `parent: null` | node `1:52` | **component-specific: the node id differs per file**; `key` is the same |
| Detached instance | `detachedInfo: {type:'library', componentKey}` | same | key only, no id |

So variable, collection and style ids happened to be the same in both files, because they embed
the key. Component node ids were not. The earlier version of this section said all remote ids
were file-specific, which was wrong for variables and styles. Neither form of id is documented
as stable, though, so Doctor stores and matches library assets by **key only**. It never uses a
remote asset's id as its identity.

Cross-file result:

* Consumer 2 reused Consumer 1's portable design system (keys only) and found the same violations.
* Its instance was approved by key while its main component is node `1:52` rather than `1:13`.
* A local ref using Consumer 1's id `1:13` approved nothing in Consumer 2.

See `docs/CONFIGURATION.md` §8.

### API limitations (documented, not worked around)

1. **Only imported tokens are known.** A remote collection's `variableIds` grows as variables are
   used/imported in the file, and library assets only appear once used. A raw colour equal to a
   library token the file has never used can't be matched. An approved library collection that
   isn't readable in the file makes dependent checks **Not verifiable** (never a pass). Fixing
   this would need `teamLibrary` + `importVariableByKeyAsync`, which changes the file. An audit
   stays read-only.
2. **Detached library component names need a live instance in scope.** `detachedInfo` gives only
   the key. The name is resolved from an instance of the same component in the audited scope.
   Otherwise the finding says "Library component (name unavailable)". The only key lookup,
   `importComponentByKeyAsync`, imports (mutates) and needs the library to be reachable.
3. **No library-level identity.** Figma gives no stable id for "the Acme library" as a whole in
   a consuming file, so "all library text styles/components" means *any* library, and approving
   a specific library is done by picking its collections/items.
4. Reading `fills` on nodes bound to a remote variable costs ~55% more inside Figma (102 vs
   66 ms per 1,000 nodes). The plugin still reads each property once; see §7.

## 10. Verification tooling

* `test/`: unit tests, including the controller (`test/controller.test.ts`), with a fake Figma.
* `dev/e2e/*.js`: scenarios that run in real Figma files through the Figma MCP `use_figma`
  tool, which accepts at most 50,000 characters of code per call. `node dev/e2e/build.mjs`
  bundles the real production code (controller, audit, navigation, storage, config helpers) once.
  * `install-<host>.generated.js` stores the bundle in shared plugin data (`dsd_e2e`/`bundle`) on
    a host node, which is the test page named by each scenario's `// @host <nodeId>` line. Run
    it once per file, and again whenever the bundle changes.
  * `<scenario>.generated.js` is a short loader plus the scenario. It refuses to run unless the
    installed bundle has the expected length and checksum, so a stale install can't be tested
    by mistake.
* `dev/index.html?real=1`: the real UI replaying real results, recording messages it sends.
  `?portable=1` shows the "Start from …" empty state.
