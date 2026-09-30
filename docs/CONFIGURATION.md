# Design system configuration

How Design System Doctor knows what "the design system" is, how that choice is stored, and how it
behaves across files. Everything below was checked against real Figma files (see §8), not assumed.

## 1. The model

A design system is a **list of sources the designer approved**. Doctor never infers one: until
something is approved it shows "No design system configured". The configure screen pre-ticks a
*suggestion* from what the page uses, but nothing is saved until the designer presses Save.

```ts
// src/shared/types.ts, src/shared/designSystem.ts
type AssetRef =
  | { source: 'library'; key: string; name: string }   // published library asset
  | { source: 'local';   id: string;  name: string };  // asset defined in this file

interface DesignSystemConfig {
  version: 2;
  name: string;
  variableCollections: AssetRef[];                               // picked one by one
  textStyles:  { library: boolean; local: boolean; items: AssetRef[] };
  components:  { library: boolean; local: boolean; items: AssetRef[] };
  paintStyles: { library: boolean; local: boolean };
  spacingScale: number[];
  radiusScale:  number[];
}
```

* **Variable collections** are approved individually. A variable counts as approved when its
  collection is.
* **Text styles and components** can be approved as a whole source ("all library text styles",
  "all text styles made in this file") and/or item by item. An asset is approved if its source
  switch is on *or* it is listed in `items`.
* **Colour styles** are approved by source only (library / this file).
* **Scales** are plain numbers. Empty scale = that check is off (the UI warns).

`name` is only a label shown in results.

### Validation (before saving)

`validateDesignSystem` blocks Save on errors and shows warnings without blocking:

| Errors (Save disabled) | Warnings |
|---|---|
| No name | A picked library asset isn't used in this file yet (§5) |
| No source approved at all | Spacing or radius scale is empty |
| A picked *local* asset no longer exists in this file | |
| A scale entry isn't a number, is negative or is duplicated (names the entry) | |

### Migration from v1

v1 stored `approvedCollectionIds: string[]`. On load, `migrateDesignSystem` looks each id up and
converts it to a proper `AssetRef` (library → key, local → id). An id that can no longer be found
becomes a local ref named "Unknown collection", which validation then reports so the designer can
remove it. v1 source switches are kept; `items` start empty.

## 2. Local vs library identity

| | Stored as | Why |
|---|---|---|
| Asset made **in this file** | `{source:'local', id}` | Only meaningful in this file. There is no key until it is published. |
| Asset from a **published library** | `{source:'library', key}` | The key is the library's published identity and is the same in every file that uses it. |

Matching is done by `matchesRef` (`src/shared/designSystem.ts`): a library ref matches an asset
only if the asset is `remote` and has the same key; a local ref matches only a non-remote asset
with the same id. A local id never approves a library asset, and vice versa, even if names match.

Names are stored for display only and never used for matching.

## 3. Persistence

| What | Where | Scope |
|---|---|---|
| Settings (design system, disabled rules, options) | `figma.root` plugin data, key `dsd-config-v1` | This file, for everyone who opens it with the plugin |
| Last audit per page | page plugin data, key `dsd-last-audit-v1` (≤ 500 KB) | That page |
| Portable design system | `figma.clientStorage`, key `dsd-portable-design-system-v1` | This device/user, all files |

* Every save also writes a **portable copy** (`toPortable`): library refs, source switches for
  libraries, and the scales. Local refs and local switches are removed, because they would mean
  nothing in another file.
* When a file has no settings, the empty state offers **"Start from ‹name›"** using the portable
  copy. The designer still reviews and saves it; nothing is applied silently.
* Earlier builds fell back to a device-wide `clientStorage['dsd-config-v1']` when a file was
  read-only. That leaked one file's ids into every file, so it was removed and the key is no
  longer read.

## 4. "Not verifiable"

Some checks can't be evaluated in a given file. Doctor reports them as **Not verifiable**, a
separate severity that is **never scored and never counted as a pass**:

* a layer is bound to a variable Figma can't load here;
* text uses a style Figma can't load here;
* unstyled text doesn't exactly match any readable approved style, while one or more
  individually approved text styles can't be read here. Their values are unknown, so one of them
  might be the match. The finding names that style when exactly one is unavailable. Readable
  styles still decide everything they can: an applied style, or an exact match with a readable
  approved style, is reported normally. Whole-source approvals ("all library text styles") aren't
  affected, because Figma doesn't list library styles a file hasn't used;
* an instance's main component can't be read;
* a raw colour, when an approved collection can't be read in this file (Doctor can't tell
  whether the colour should have been one of its tokens).

When an approved source can't be read, results show a banner listing it ("library, not used here
yet" or "missing"), and the affected checks are marked Not verifiable. Doctor doesn't guess, and
it never gives a pass for something it couldn't check.

"To review" (unmapped colours) is also unscored, but means something different: the colour was
checked and no approved token is related to it.

## 5. Library assets appear only once used or imported

This is how Figma behaves, not a Doctor choice:

* A library collection, style or component is only visible to the plugin in a file where
  something from it is used (or has been imported).
* A remote collection's `variableIds` lists **only the variables imported into this file**, not
  the whole collection.

Consequences:

* Discovery lists only library assets that are already used in the file.
* A picked library asset that isn't used in this file is kept (it's still valid by key), shown
  as a warning, and reported as unresolved at audit time (§4).
* A raw colour equal to a library token that this file has never used can't be matched to it.

Doctor doesn't work around this with `importVariableByKeyAsync` / `teamLibrary`. Imports change
the file, and an audit must stay read-only.

## 6. View-only files

In a file the user can't edit, plugin data can't be written. Saving settings then returns
`savedTo: 'session'` and the UI says the settings last only until the plugin closes. The last
audit isn't persisted either. The portable copy is still updated, since that lives on the device.

## 7. Cross-file behaviour

* Settings don't travel with a design system. Each file has its own settings. The portable
  copy is how a design system gets reused in another file.
* A portable design system contains only library keys, so it resolves identically in any file
  that uses the same library.
* Local assets are never carried across. A local id from file A, if forced into file B, matches
  nothing in file B (verified: see below).

## 8. Verified behaviour (2026-09-30)

Library `DSD Test Library`, consumed by `DSD Library Consumer`
(Consumer 1) and `DSD Library Consumer 2`. Scenarios: `dev/e2e/config-consumer1.js`,
`config-consumer2.js`, `library.js`, `config-large.js`.

* **Consumer 1:**
  * Discovery listed the library collections, styles and component with their keys.
  * The configuration was built from them. Validation was clean, and the invalid case listed each error.
  * The configuration was saved and reopened unchanged, and the stored config contains no file ids.
  * Audit score 82 across 17 checks. It found the raw colour, the local text and the detached button, and "Go to layer" was exact for each.
* **Consumer 2** (no settings of its own):
  * It was offered the portable design system, and validation was clean.
  * It found the same three violations as Consumer 1: score 81 across 16 checks. There is one check fewer because this file's frame has no fill.
  * Instance approved by key, even though its main component has node id `1:52` here vs `1:13` in Consumer 1.
  * A local ref with Consumer 1's id `1:13` approved nothing and produced "Component not in design system".
* **3,601-layer page:**
  * 2.2–2.9 s through the controller with the v2 config: 2903 ms cold, 2208 ms warm, and 2517 ms in the library regression.
  * The earlier baseline was 2.2–2.7 s.
