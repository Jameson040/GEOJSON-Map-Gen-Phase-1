# Project Health Checkpoint

## Verified in This Coding Session

- The baseline production Vite build succeeded before changes.
- The updated production Vite build also succeeded after the stability and backup changes.
- All source modules referenced by the existing application could be bundled at baseline.
- `package-lock.json` exists. `tsx` is now installed and locked so verifier scripts can be run without downloading an unpinned runner.

## Confirmed Problems Repaired

- Async generators use module-level ID counters. The workspace now serializes generation jobs synchronously and prevents React Strict Mode from starting the initial planet twice.
- Generation failures previously appeared only in console logs. Failures now display an actionable workspace message, preserve completed data, and release the generation lock in `finally`.
- Unloading a region previously left its biosphere, human layer, and cached geographic indexes resident. All dependent state and both raw/final indexes are now evicted together.
- Rerolls and whole-planet replacement now clear obsolete focus requests and cached views. Whole-planet generation requires explicit confirmation when regions exist.
- Canvas resize observers previously captured the initial draw callback. They now use the latest viewport/layers, avoid redundant backing-buffer resets, and cancel animation frames on unmount.
- Map zoom-control clicks no longer trigger map-selection or drag actions. Hidden biological/human overlays no longer leave stale hover cards.
- Region focus requests are scoped to their tab; setup forms now reload the saved parameters of the selected world/layer instead of silently keeping another region's settings.
- View-level error boundaries keep a failed map or sidebar from destroying the workspace or hiding the Backup toolbar. Async drawing errors are also surfaced without triggering an error-render loop.
- The geography visibility control was enabled but did nothing. It now controls display without changing generated geographic data.
- Equal-tier settlements with different spacing radii could be accepted by finetune and immediately rejected by the verifier. One symmetric rule now serves both.
- Capital reclassification previously ignored the new type's habitat/food prerequisites. Only compatible sites can be reclassified. Final human-layer checks reconcile late removals with the supporting hierarchy.
- The CLI verifier ignored failed Tier-1 checks in its final exit status. They now contribute to failures.
- Lower-layer immutability in the CLI audit is checked with content hashes, not just equal counts.
- Source and generated-work backup/restore paths have been added without altering geographic or biosphere generation algorithms.

## Not Yet Runtime-Verified Here

The current tool environment provides the production build but no arbitrary command runner or interactive browser. The new static health script, seeded smoke tests, full verifier, browser archive download, and restore interaction must be run locally using `BACKUP.md`. Do not infer that every procedural seed passes from a successful Vite build. Vite bundling is not a substitute for the strict TypeScript check.

The dependency install also reported two npm advisory findings (one low, one high). Their dependency paths and fixes have not been audited here. Run `npm audit` before using this checkpoint as a production release; avoid an automatic force-upgrade of the frozen foundation.

## Architectural Work Deferred

- Layer 3 still carries legacy fixed population. Your requested habitat-only layer and time-dependent, per-settlement population layer are pending, not implemented in this health checkpoint.
- Biogeographic source coverage and licensing should be reviewed before claiming an exhaustive edible-crop dataset or production-grade ecological realism.
- Long synchronous finetune stages can still block the main browser thread. Worker-based execution is future performance work, not a change to the frozen algorithms in this checkpoint.

The geographic and biosphere generator/rule/catalog files were not edited during this audit. Backup first, then change only the layer above those foundations.