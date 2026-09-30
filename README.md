# Design System Doctor

A Figma plugin that audits a page (or a selection) against a design system you configure. Each
finding shows the rule it broke, the current and expected values, why it matters, and a
**Go to layer** button that selects the layer and zooms to it.

Rules are deterministic, with no AI. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
design, the Figma API check, the scoring formula and the known limitations.

## Run it in Figma

```bash
npm install
npm run build
```

In the Figma desktop app: **Plugins → Development → Import plugin from manifest…** and pick
`manifest.json` from this folder. Then run **Design System Doctor** from the Development menu.

On first run it asks you to confirm which variable collections, styles and components make up your
design system. That choice is stored in the file, so everyone on the team who runs the plugin gets
the same setup.

## Develop

| Command | What it does |
|---|---|
| `npm run watch` | Rebuilds `dist/` on change (re-run the plugin in Figma to pick it up) |
| `npm test` | Engine, rule, scoring and snapshot tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check |

**UI without Figma:** after a build, serve the folder and open `dev/index.html`. It loads the real
`dist/ui.html` and replaces the main thread with the real audit engine running on fixture layers.

```bash
python3 -m http.server 5199
```

## Layout

```
src/code.ts            main thread: messages, audit run, navigation, config storage
src/figma/             the only code that reads Figma (single traversal → plain snapshots)
src/engine/            pure audit engine: resolver, rules, orchestrator, scoring
src/shared/            types and the UI ↔ main message protocol
src/ui/                Preact UI (compiled and inlined into dist/ui.html)
test/                  Vitest suites
dev/                   browser harness for UI work
```

### Adding a rule

1. Create `src/engine/rules/<name>.ts` that exports an `AuditRule`. Return one `Check` per
   property you examine; add a `finding` only when it fails.
2. Register it in `src/engine/rules/index.ts` and `src/shared/ruleCatalog.ts`.
3. Add tests in `test/rules.test.ts`.

## Real-Figma end-to-end check

`dev/e2e/` runs the plugin's production code (controller, audit, "Go to layer", storage, config
helpers) against real nodes in Figma files through the Figma MCP `use_figma` tool (no mocks):

```bash
node dev/e2e/build.mjs
```

`use_figma` accepts at most 50,000 characters, so the bundle is installed once per file and each
scenario stays small:

1. Run `dev/e2e/install-<host>.generated.js` in the target file. It stores the bundle in shared
   plugin data on the scenario's host page (the `// @host <nodeId>` line at the top of each
   scenario). Re-run it whenever the build prints a new checksum.
2. Run any `dev/e2e/<scenario>.generated.js`. It checks the installed bundle's checksum first.

| Scenario | File | Covers |
|---|---|---|
| `trust`, `validate`, `edge-cases`, `fix-and-reaudit` | Deign-Page, `DSD – core loop test` (host `45:2`) | accuracy, freshness, confidence, consolidation, edge cases, fix → re-audit |
| `library`, `config-consumer1`, `config-large` | DSD Library Consumer (host `1:15`) | published library assets, configuration flow, 3,601-layer timing |
| `config-consumer2` | DSD Library Consumer 2 (host `0:1`) | cross-file reuse by library key |
| `audit-and-navigate`, `reaudit` | Deign-Page | Phase-1 core loop (legacy) |

Scenarios never touch pages other than their test page. Library keys live in
`dev/e2e/library-keys.json` (public asset keys, no secrets).
