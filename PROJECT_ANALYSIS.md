# Terra Ex Nihilo — Project Analysis & Improvement Plan

*Analysis session: 2026-10-14 · branch `arena/a57d80ee-geojson-map-gen-phase-1` · based on commit `a72b73c`*

> **Implementation status (same session, later pass):** the P0 roadmap below is **fully implemented**, together with the P1 registry/store, full-world export, staleness badges and CI. See §9 for what shipped, what was verified, and what is deliberately still deferred (P2 realism items and worker migration).

---

## 1. Executive Summary

**Terra Ex Nihilo** is a procedural GeoJSON world generator built as a single-file React 19 + Vite 7 + TypeScript (strict) + Tailwind 4 canvas application. It synthesises a planet in two geographic tiers, then stacks seven semantic layers on top (geography → resources → biosphere → habitable zones → population → routes → cadastre), each following an *adversarial* pattern: unconstrained creative generation → rule-based finetune → scientific verification with raw-vs-final comparison.

**The project is in healthy shape.** In this session all three verification paths pass:

| Check | Command | Result |
|---|---|---|
| Static health | `npx tsx scripts/check-project.ts` | All PASS (one stale message, see §5.3) |
| Smoke pipeline + checkpoint round-trip | `npx tsx scripts/check-project.ts --smoke terra-novus` | PASS |
| Full multi-layer verification | `npx tsx scripts/verify-world.ts terra-novus` | **ALL LAYERS VERIFIED ✓** (0 violations after finetune on every size class & detail level) |
| Production build | `npm run build` | PASS — 2,153 kB single-file HTML (565 kB gzip) |

The findings below are therefore **not** "the app is broken" — they are targeted gaps between what the architecture *promises* (a 7-layer frozen world stack with checkpointing, JIT deep-zoom, and GeoJSON export) and what it currently *delivers*. The most important ones:

1. **A stale-cache correctness bug in the L7 cadastre JIT engine** (§5.1.1) — regenerating layers can show old village geometry at deep zoom.
2. **The world checkpoint covers only 4 of 7 layers** (§5.1.2) — resources, routes and cadastres are silently lost on save/restore.
3. **The hand-written invalidation matrix in `App.tsx` is drifting from the declarative layer registry** (§5.2.1) — the root cause of finding 1.
4. **Layer numbering is inconsistent across UI, code comments, and the registry** (§5.3.1) — user-facing confusion.
5. **Dependency & script hygiene is behind the base framework** (§5.3.4) — unused native dep, dev tool in `dependencies`, no npm scripts for the verification workflow, no README. (Bundle size, measured, is *not* a problem: the 2.15 MB single file is dominated by the app's own ~26.7k lines + React + icon set; the full `@turf/turf` closure costs only ~44 kB / 2%.)

---

## 2. What the Project Is — Verified Mental Model

### 2.1 The two-tier geographic core

```
PlanetConfig (seed, sliders)
        │
        ▼
┌─────────────────────────── TIER 1 (tier1-planet.ts) ───────────────────────────┐
│ Tectonic plates → continents (sector-placed craton + lobes) → islands (arc /    │
│ hotspot) → seas, trenches, polar caps.  Few hundred features total.             │
│ Handoff contract: RegionDescriptor (outline, bbox, climate, plate, convergent   │
│ edges, sizeClass, regionSeed, detailBudget)                                    │
└────────────────────────────────────────────────────────────────────────────────┘
        │  finetunePlanetShapes (tier1-finetune.ts): real-world archetypes
        │  (wedge/cordillera/lobed/shield/arc_sliver/block_island), antimeridian
        │  seam selection, suture/accretion — raw features kept for comparison
        ▼
┌─────────────────────────── TIER 2 (tier2-region.ts) ───────────────────────────┐
│ Per landmass, on demand, in its own tab. EVERYTHING is driven by the land-size  │
│ compartment (islet → supercontinent, size-classes.ts): feature families, km     │
│ scales, counts, max Strahler order, elevation ceilings, mask resolution.        │
│ LandMask rasterises the inherited outline; CompartmentGrid apportions scatter   │
│ features by land share per block. Deterministic child seed per region.          │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 The seven-layer world stack (layers.ts)

| # | Layer | Generator | Depends on | Pattern |
|---|---|---|---|---|
| L1 | Geography | tier1 + tier2 | — | generate → finetune-stage → verifier (11 checks) |
| L2 | Geological resources | resource-generate | L1 | rule-based placement (mountains→ores, rivers→clays…) + filter config |
| L3 | Biosphere | bio-generate | L1 | deliberately chaotic scatter → bio-finetune relocates/drops by habitat → verifier |
| L4 | Habitable zones | human-generate | L3 (+L2 optional) | chaotic candidates → human-finetune (habitat/food/hierarchy discipline) → verifier |
| L5 | Population | population-generate | L4 + L3 | per-zone occupancy curves (phases, eras, food/water) → finetune → verifier |
| L6 | Roads & trade routes | route-generate | L4 (+L2 optional) | terrain-aware A* on a 100×100 cost grid, corridor relaxation → verifier |
| L7 | Cadastre & roofs | cadastre-generate (JIT) | L4 (+L5 optional) | lazy per-settlement street/parcel/roof synthesis, cached, verified |

Key design invariant, enforced by verifiers with content fingerprints: **a layer never writes to the layers beneath it.** Regenerating a lower layer evicts every layer above it for that region.

### 2.3 Workspace lifecycle (App.tsx, 1,688 lines)

- **`GenerationGate`** serialises all generation jobs (required because frozen generators use module-level `uid` counters); failures surface as a dismissible workflow banner and release the lock in `finally`.
- **Per-region `Map<string, LayerResult>` state** for each layer; invalidation on regeneration is hand-written per callback.
- **Tabs** (planet + one per region); spatial grids memoised per tab with an `evictRegionIndexes` helper; `RecoveryBoundary` error boundaries around map and sidebar.
- **Full cascade** (`runFullCascade`): one button drives L1→L7 sequentially, reusing existing layers where present.
- **Backup** (BackupModal + workspace/checkpoint.ts): browser-side source tarball (with SHA-256 manifest) + world-checkpoint JSON with deep structural validation; restore never regenerates. CLI twins: `scripts/check-project.ts`, `scripts/verify-world.ts`, `scripts/create-backup.mjs`.
- **Rendering**: custom canvas renderer (no map library), 5 themes (gidding/atlas/topo/antique/satellite), LOD via `lodMinZoom`, artistic cartography pass (hillside mountains, groves, banners), JIT cadastre at deep zoom.
- **Coordinates**: one equirectangular space, 7200×3600 units ≈ Earth; export projects to EPSG:4326 lon/lat for QGIS/Mapbox/geopandas.

---

## 3. Logic & Workflow Assessment — What Works Well

1. **The adversarial generate→finetune→verify pattern is genuinely effective.** The verifier output shows raw worlds arriving with 1,500–8,400 violations and finetune converging to **0** on every size class and detail level tested. Keeping raw features next to finetuned ones (UI toggle) is an excellent explainability device.
2. **Size-class compartmentalization is the project's best architectural idea.** One table (`size-classes.ts`) deciding budgets, scales, and caps per landmass class prevents both "islet with Alpine ranges" and "supercontinent with three hills" failures, and the verifier checks conformance.
3. **Determinism is taken seriously**: every layer derives its RNG from a documented seed chain (`planet seed → regionSeed → layer seed → config`), which is what makes the CLI verifier, checkpoint round-trip, and reproducible rerolls possible.
4. **The workflow hardening listed in PROJECT_HEALTH.md is real** — the gate, the `finally`-released locks, error boundaries, scoped focus requests, and symmetric spacing rules are all present in the code and pass their checks.
5. **CLI verification parity**: `verify-world.ts` exercises every size class at two detail levels plus L3–L5 with content-hash immutability proof — this is more verification discipline than most procedural-generation projects ever get.

---

## 4. Verified Runtime Evidence (this session)

```
npx tsx scripts/check-project.ts                     → 7 PASS, 1 stale PENDING message
npx tsx scripts/check-project.ts --smoke terra-novus → PASS (incl. checkpoint round-trip)
npx tsx scripts/verify-world.ts terra-novus          → ALL LAYERS VERIFIED ✓
   e.g. [CONTINENT] Fjorderland 11.85M km² STANDARD: features 4751→2963,
        verifier raw 1526 violations → finetuned 0; L3 170 zones; L4 31.4M people,
        geo/bio untouched (SHA-256 fingerprint equality)
npm run build                                         → dist/index.html 2,153 kB (gzip 565 kB)
```

Notable timing from the CLI run: human-layer finetune on a continent took **~2.8 s** of blocking compute — see §5.2.2 (main-thread).

---

## 5. Findings

### 5.1 Correctness bugs (act first)

#### 5.1.1 Cadastre JIT cache is never invalidated — stale villages at deep zoom
`src/world/cadastre/cadastre-cache.ts:23` keys the cache as `` `${regionId}::${settlement.id}` `` and **`clearCadastreCache()` has zero call sites** in the entire codebase. Two consequences:

- **Stale geometry after re-generation.** The frozen generators reset their `uid` counters on every run (`human-generate.ts`: `uid = 0; nid = () => "set_" + ++uid`), so a re-generated human layer produces settlement IDs `set_1, set_2, …` **identical to the previous run's**. The map viewer's JIT path (`MapViewer.tsx:273`) and the batch L7 generator both hit the cache first — so after re-rolling a region (or re-running bio → human), zooming into "set_1" renders the **old** village's streets and roofs at the new settlement's location.
- **Stale scaling after a population re-run.** Roofs scale with `population.occupancy` (`cadastre-generate.ts:124`), but `runPop` (App.tsx) neither evicts `cadastreLayers` nor clears the module cache, so scrubbing to a new era/year leaves roof footprints sized for the previous era.
- **Unbounded memory.** Unloading or regenerating a region never evicts its cached cadastres.

**Fix (small, safe):** call `clearCadastreCache(regionId)` in `runRegionFor`, `runHuman`, `unloadRegion`, and `restoreWorkspaceCheckpoint`; include a population fingerprint (e.g. `pop?.yearProduced` or a hash of era+year+seed) in the cache key; evict `cadastreLayers` in `runPop` (or at least mark it stale in the UI).

#### 5.1.2 World checkpoint covers only 5 of 7 layers
`WorkspaceCheckpoint` (workspace/checkpoint.ts:34-46) serialises macro, regions, biosphere, humans, populations and view — **not** `resourceLayers`, `routeLayers`, `cadastreLayers`, nor their visibility toggles or the resource filter config. A user who runs the full cascade and clicks "Save Generated World" loses three layers on restore, silently. The layer registry (`layers.ts`) already models all seven — the checkpoint is behind the architecture.

**Fix:** extend `CheckpointInput`/`inspectCheckpoint` for the three missing layer types (they are plain data — `ResourceLayerResult`, `RouteLayerResult`, `CadastreLayerResult` are already JSON-safe except cadastre's internal Maps, which can be serialised the same way `populations` already is), bump `CHECKPOINT_VERSION` with a backward-compatible reader, and extend `view.visibility`.

#### 5.1.3 `runFullCascade` is internally inconsistent
Steps 1–4 and 6 reuse existing layers (`let x = layers.get(id); if (!x) …`), but **Step 5 always regenerates population** (App.tsx:668) — even when a population already exists. The button is also mislabelled: "⚡ Cascade All (L1→L4)" and tooltip "down to L4 Demographics" while the code actually runs L1→L7. Decide the semantics (fresh-everything vs. fill-missing) and make both the reuse checks and the label match.

#### 5.1.4 Upstream re-runs leave optional consumers silently stale
`runResource` invalidates nothing. But L4 (human) and L6 (routes) consume resources as *optional enrichment* at generation time. Re-running resources with a different filter (e.g. excluding fantasy veins) leaves existing settlements/routes built against the old deposit set, with no warning. Either document "frozen-at-generation semantics" in the UI, or — better — use the existing `generatedAt` timestamps to show a **"stale input" badge** on layers whose upstream inputs changed after they were generated. The data for this already exists.

### 5.2 Architectural risks

#### 5.2.1 The invalidation matrix is hand-written and drifting from the registry
`App.tsx` repeats a `withoutRegion(...)` cascade in `runMacro`, `runRegionFor`, `runBio`, `runHuman`, `unloadRegion`, and `restoreWorkspaceCheckpoint` — each slightly different, each a place to forget one layer (§5.1.1 is exactly this failure mode: `runHuman` evicts the cadastre *state* but not the cadastre *cache*; `runPop` evicts neither). Meanwhile `layers.ts` already declares the dependency graph (`dependsOn`).

**Recommendation — the single highest-leverage refactor:** make the registry executable. One helper, e.g.

```ts
// workspace/lifecycle.ts
export function invalidateFrom(
  stores: LayerStores, regionId: string, fromLayer: WorldLayerId
): LayerStores { /* walk WORLD_LAYERS top-down, drop layer + caches */ }
```

driven by `WORLD_LAYERS`, plus (optionally) a `useWorldStore` reducer so the ~7 hand-rolled `Map` states become one state object with one transition path. This deletes ~150 lines of `App.tsx`, makes forgetting an eviction impossible, and gives checkpointing one serialisation point.

#### 5.2.2 All generation runs on the main thread
Stages yield with `setTimeout(0)` between steps, but individual stages block: human finetune ≈ 2.8 s per continent (measured), ULTRA tier-2 ≈ 0.35 s, bio finetune ≈ 0.16 s — and the UI canvas freezes during each. Every generator is a pure function of `(region, config) → result`, and progress callbacks are already plumbed: this is a textbook **Web Worker** migration. The single-file Vite build supports workers (`new Worker(new URL(...), { type: "module" })`). PROJECT_HEALTH.md already lists this as deferred work — it should be next after the P0 fixes, because "long stage = frozen map" is the most felt UX defect at ULTRA detail.

#### 5.2.3 Module-level `uid` counters are a standing hazard
The gate works around them, but ID collisions across layers/regions are only prevented by convention (IDs like `bio_1` exist in *every* region). §5.1.1 shows the first real casualty. Cheapest robust fix without touching the frozen algorithms: derive IDs at the boundary (e.g. wrap results and rewrite `id` → `` `${regionId}:${id}` `` in the store), or seed-scoped counters (``${regionSeed}:bio:17``).

#### 5.2.4 Route pathfinder resolution is fixed at 100×100
`RoutePathfinder` bakes a 100×100 cost grid over the region bbox regardless of scale. On a supercontinent (√area ≈ 5,900 km) that is ~59 km per cell — mountain passes, river-ford choices and coastal contours below that scale are invisible to A*; on an islet it is wastefully fine. Scale the grid with `linearScaleKm` (e.g. 64–256 cells clamped), or reuse the Tier-2 `LandMask` resolution which is already size-class aware.

#### 5.2.5 Bundle composition — measured, and not a problem
`tier1-finetune.ts` imports the whole `@turf/turf` monolith but uses only `polygon`, `union`, `featureCollection`. **Measured in this session**: stubbing turf out entirely shrank the single-file build from 2,153 kB to 2,109 kB — the full turf closure costs **~44 kB (2%)**, because Vite tree-shakes the monolith effectively. The 2.15 MB (565 kB gzip) output is instead dominated by the application's own ~26.7k lines plus React 19 and the icon set — i.e. it is the *single-file build mode* (`vite-plugin-singlefile`) inlining the entire app, which is a deliberate offline-distribution tradeoff, not library bloat. Narrowing the turf import to `@turf/union` + `@turf/helpers` is still worthwhile for dependency-audit hygiene, but treat it as housekeeping, not a performance win. If first-load time ever matters more than the single-file property, the real levers are lazy-loading the L7 cadastre + artistic-cartography modules and the setup modals — not the libraries.

### 5.3 Consistency & documentation issues

#### 5.3.1 Layer numbering disagrees with the canonical registry
`layers.ts` is canonical: geo **L1**, resources **L2**, bio **L3**, human **L4**, population **L5**, routes **L6**, cadastre **L7**. But:

- UI (App.tsx): human button labelled "**L3**" (:1325), population "**L4**" (:1333), the human tooltip calls bio "**L2**" (:1322), cascade button "**L1→L4**" (:1257) — while the cadastre/routes tooltips correctly say "L4 first" for human.
- Code comments: `bio-generate.ts` says "LAYER 2 GENERATION", `human-generate.ts` "LAYER 3", `population-generate.ts` "LAYER 4", `route-generate.ts` "LAYER 6" (correct), `layers.ts` "L4 Settlements / L5 Population".

One pass replacing every hard-coded "L*n*" in strings/titles with `LAYER_BY_ID[id].short` (and `index`) from the registry eliminates the entire class.

#### 5.3.2 Stale "population pending" messaging
`scripts/check-project.ts:207` still prints "PENDING Population must move to a time-dependent, per-settlement layer" — but L5 population is implemented, verified by this very script's smoke test, and exercised by `verify-world.ts`. Same for the "Population Architecture Is Pending" sections in `PROJECT_HEALTH.md`/`BACKUP.md`. These docs now understate the project and will mislead contributors.

#### 5.3.3 No README
The repo's front door is `BACKUP.md` (a warning) and `PROJECT_HEALTH.md` (an audit). There is no README with quickstart, the layer table, the seed/verifier story, or screenshots. For a project whose core value is a *reproducible pipeline*, the README should lead with: `npm ci → npm run dev → npm run verify`.

#### 5.3.4 Dependency hygiene (base-framework alignment)
- `@resvg/resvg-js` is in `dependencies` and **never imported** — a native SVG rasteriser with no place in a browser bundle; remove it.
- `tsx` is a CLI dev tool — belongs in `devDependencies` (it's only needed to run the scripts).
- `package.json` `name` is still the template's `"react-vite-tailwind"`; rename to the project.
- No npm scripts wrap the documented backup/verify workflow (BACKUP.md says "run `npx tsx …`" four times). Add:
  ```json
  "scripts": {
    "check":  "tsx scripts/check-project.ts",
    "smoke":  "tsx scripts/check-project.ts --smoke terra-novus",
    "verify": "tsx scripts/verify-world.ts",
    "backup": "node scripts/create-backup.mjs"
  }
  ```

### 5.4 Output-quality opportunities (the "desired output" side)

#### 5.4.1 GeoJSON export stops at L1
The project is named *GeoJSON-Map-Gen*, and `export-geojson.ts` currently exports only the planet macro or one region's geography. Six layers of rich, GeoJSON-shaped data (deposits are points, bio populations are points+radius, settlements are points, routes are linestrings, cadastre streets/parcels/roofs are lines/polygons) never reach the export button. `layers.ts` even ships `buildMasterLedger()` for exactly this and it is only used for the stats panel.

**Recommendation:** add a world/region export bundle — one FeatureCollection per layer (or one collection with `properties.layer`), reusing the existing lon/lat projection, with the ledger as top-level `metadata`. This is the highest user-value item after the P0 bug fixes and requires no new geometry code.

#### 5.4.2 Latitude is not accounted for in the km scale
`KM_PER_UNIT ≈ 5.566 km` is the *equatorial* scale and is applied uniformly: at 60° N/S, true east-west km per unit is halved (cos φ). All area/length figures (biome sizes, river lengths, supply radii, deposit spacing) are therefore progressively inflated toward the poles by up to ~2×. Two options: (a) document it as a known simplification; (b) apply `cos(lat)` scaling in `kmToUnits`/`unitsToKm` for x-components (the map is a cylinder, so this is exact for x and a good approximation for areas). Given the project's "scientific verifier" identity, (b) is worth doing, with verifier thresholds re-baselined.

#### 5.4.3 The L5 verifier has no adversarial bite
Every other layer's raw model produces hundreds of violations; population reports "raw **0v** → finetuned 0v" in every run, because `modelZone()` already respects era blocks and caps. Either make raw generation genuinely unconstrained (as the other layers do) or add checks that raw *does* violate (era ramp, hunger flags) — otherwise the before/after toggle teaches nothing for L5. Related: `waterShortage()` ignores its `year` parameter (`void year`) and is a region-wide boolean (any river OR reed OR staple ⇒ no shortage) — a per-zone water model would sharpen both finetune and verifier.

#### 5.4.4 `layers.ts` surfaces only the first cadastre's verification
`layerStatuses()` picks `cadastres.values().next().value?.verificationAfter` — an arbitrary settlement's report stands in for the whole layer. Aggregate (e.g. `every(c => c.verificationAfter.passedAll)`, as `worldTotals` already does elsewhere).

### 5.5 Testing & CI gaps

- **No unit tests.** The pure-function core (`geom.ts`, `size-classes.ts`, verifier predicates, finetune invariants, checkpoint inspect) is eminently testable, and the deterministic seeding makes **golden-seed tests** trivial (`expect(verify(seed)).toMatchSnapshot()` style).
- **No CI.** The verification scripts exist and are fast (`verify-world.ts` ≈ 8 s per seed) — a GitHub Actions workflow running `check`, `smoke`, `verify` across 3–4 seeds on push would have caught every regression listed in PROJECT_HEALTH.md automatically.
- **No lint/format config** for a strict-TS codebase (consider `eslint` + `prettier`, or at minimum `tsc --noEmit` in CI, which `check-project.ts` already wraps).

---

## 6. Prioritised Roadmap

### P0 — Correctness & quick wins (≈ 1–2 days, no algorithm changes)
| # | Item | Effort | Risk |
|---|---|---|---|
| 1 | Cadastre cache invalidation + population-aware cache key (§5.1.1) | S | none |
| 2 | Extend checkpoint to all 7 layers + visibility/config (§5.1.2) | M | low (version-gate the reader) |
| 3 | Unify layer numbering via `LAYER_BY_ID` (§5.3.1), fix cascade label/reuse (§5.1.3) | S | none |
| 4 | Narrow `import * as turf` to `@turf/union` + `@turf/helpers` — only `polygon`, `union`, `featureCollection` are used; hygiene, not size (measured: turf closure ≈ 44 kB / 2% of bundle) | S | low |
| 5 | Add npm scripts; remove `@resvg/resvg-js`; move `tsx` to devDeps; rename package (§5.3.4) | S | none |
| 6 | Refresh stale population docs + `check-project.ts` message; add README (§5.3.2/3) | S | none |

*Expected outcome: save/restore round-trips the entire 7-layer world; deep zoom never shows stale villages; UI vocabulary matches the registry; the dependency tree carries no unused native module; the documented verification workflow is one `npm run` away.*

### P1 — Architecture (the structural follow-ups)
1. **Executable layer registry** — one `invalidateFrom()` driven by `WORLD_LAYERS`; optionally a single `useWorldStore` reducer (§5.2.1). This is the enabling refactor for everything else.
2. **Web Worker generation** — move `generate*` calls off the main thread; progress events and the gate already exist as the message protocol (§5.2.2).
3. **Boundary-scoped IDs** (§5.2.3) so the gate becomes a convenience rather than a correctness requirement.
4. **Full-world GeoJSON export bundle** per layer with the master ledger as metadata (§5.4.1).
5. **Staleness badges** using existing `generatedAt` timestamps (§5.1.4).

### P2 — Output realism (touching the "frozen" generators, so: backup + golden tests first)
1. Cos-latitude km correction + verifier re-baselining (§5.4.2).
2. Route pathfinder grid scaled by `linearScaleKm` (§5.2.4).
3. Per-zone water model; give the L5 verifier adversarial bite (§5.4.3).
4. Aggregate cadastre verification status (§5.4.4).

### P3 — Engineering culture
1. Vitest unit tests for pure core + golden-seed snapshots (§5.5).
2. GitHub Actions: `check` + `smoke` + `verify` on 3–4 seeds, plus `npm run build` (§5.5).
3. ESLint/Prettier; consider splitting `App.tsx` (1,688 lines) along the layer-store seams created in P1.

---

## 7. Acceptance Criteria (how to know each fix worked)

- **P0-1:** run cascade → re-roll region → deep-zoom a village → geometry differs from before the re-roll; `clearCadastreCache` has call sites in `runRegionFor`/`runHuman`/`unloadRegion`/restore; re-run population with a new era → roof count/area changes.
- **P0-2:** run cascade → save checkpoint → hard reload → restore → all seven layer badges populated identically; old v1 checkpoint files still restore (with a warning about missing layers).
- **P0-3:** grep the UI for hard-coded `L1…L7` strings — zero hits outside `layers.ts`.
- **P0-4:** `npx tsx scripts/verify-world.ts` still ALL PASS after the turf import narrowing (behaviour identical); `npm run build` output size unchanged within ~50 kB (the single-file size is dominated by the app's own code, which is expected for the offline single-file mode).
- **P1-1:** deleting any layer's eviction code still passes a new check-project test that regenerates each layer in turn and asserts every dependent layer is gone.
- **P1-2:** during an ULTRA cascade, the map stays interactive (requestAnimationFrame budget maintained); generation progress still streams.
- **P2-1:** a polar region's exported biome areas match their verifier-reported km² within tolerance when re-measured in QGIS.

---

## 8. Closing Assessment

The project's core bet — *frozen lower layers + adversarial finetune + a verifier that proves the finetune worked + size-class-driven scaling* — is sound, unusually well-executed, and fully verified end-to-end today. The weaknesses are all at the **seams**: the workspace layer that orchestrates the frozen core (invalidation, caching, checkpointing) has drifted behind the registry that describes it, and the export/output surface covers only the first layer of a seven-layer world. Fixing the seams (P0/P1) requires no changes to the verified generator algorithms — exactly the constraint the project's own documentation imposes — and every recommendation above respects it.

---

## 9. Implementation Status (2026-10-14 improvement pass)

### Shipped and verified

| Roadmap item | Status | Evidence |
|---|---|---|
| **P0-1** Cadastre cache invalidation + population/config-aware key | ✅ done | `cadastre-cache.ts` keys fingerprint `regionId::settlementId::population::config`; `clearCadastreCache` is called on geo/human regeneration, population re-runs, region unload, planet reset and checkpoint restore; smoke test proves region-scoped clearing and that a changed population model never hits a stale entry |
| **P0-2** Checkpoint covers all 7 layers | ✅ done | Checkpoint **v2** serialises resources, routes, cadastres, resource filter config and their visibility flags, with full structural validation incl. dangling-parent rejection; **v1 files still restore** (verified by a compatibility read in the smoke test); byte-exact round-trip asserted per layer |
| **P0-3** Layer numbering unified | ✅ done | Registry (resources L2, bio L3, zones L4, population L5, routes L6, cadastre L7) now consistent across the ribbon (derived from `LAYER_BY_ID`), all modals, hover cards, generator-file comments, checkpoint messages and the CLI; the cascade button says L1→L7 and every step — including population — now reuses existing layers |
| **P0-4** Turf import narrowed | ✅ done | `@turf/turf` → `@turf/union` + `@turf/helpers` (direct deps); generated output proven **byte-identical** across three seeds by SHA-256 before/after |
| **P0-5** Package hygiene | ✅ done | Unused `@resvg/resvg-js` removed, `tsx` → devDependencies, package renamed `terra-ex-nihilo@0.1.0`, npm scripts `check`/`smoke`/`verify`/`backup` added (143 packages dropped from the tree) |
| **P0-6** Docs refreshed | ✅ done | README.md written; PROJECT_HEALTH.md and BACKUP.md rewritten to match reality (population layer implemented, v2 checkpoints, npm scripts); stale "PENDING population" health message replaced |
| **P1-1** Executable layer registry | ✅ done | `WORLD_LAYERS` gained `readsFrom` (soft inputs → staleness) and `refreshesFrom` (optional inputs that must evict); `layerConsumers()` computes the hard invalidation closure; the new `useWorldLayers` store owns all seven maps and every eviction flows through it. Three latent leaks fixed as a side effect: planet reset kept stale routes/cadastres, unload never evicted the cadastre cache, population re-runs never refreshed cadastres |
| **P1-4** Full-world GeoJSON export | ✅ done | `exportRegionWorldGeoJSON` emits every layer in one FeatureCollection (`properties.layer` tagging, L5 occupancy joined onto zone features, roofs capped at 25,000, cadastre rings closed per the GeoJSON spec — the validator caught that parcels are stored as open rings); wired to the region export button |
| **P1-5** Staleness badges | ✅ done | `layerStatuses()` computes per-layer staleness from `generatedAt` over `dependsOn ∪ readsFrom ∪ refreshesFrom`; Layers panel shows an amber `stale` chip naming the newer inputs; region-list strips mark stale layers with ↻ |
| **P2-4** Cadastre verification aggregation | ✅ done | L7 status now merges all settlements' reports by check id (counts summed, pass requires all) instead of surfacing one arbitrary settlement |
| **P3-2** CI | ✅ done | `.github/workflows/ci.yml`: npm ci → check → smoke → verify (two seeds) → build, Node 22 |
| **P3-1** Tests (adapted) | ✅ done via the existing harness | Instead of introducing Vitest, `scripts/check-project.ts` grew two new static checks (registry DAG + invalidation closures; cadastre cache-key fingerprinting) and the smoke test grew the seven-layer pipeline, cache-invalidation semantics, per-layer checkpoint round-trip, orphan rejection and v1 compatibility. Every regression fixed in this pass is now locked in by a failing-red test path |
| **P3-1b** Golden-seed harness + Tier-1 robustness | ✅ done | `scripts/golden-seeds.ts` + `npm run seeds` (wired into CI): a 62-seed locked corpus where every previously-passing seed must stay **byte-identical** (SHA-256 over features/rawFeatures/regions/plates/stats/shape records) and previously-failing seeds may only improve. Tier-1 random-seed pass rate raised **~65% → 100% on the corpus, ~98% on a fresh 200-seed sweep** via conditional finetune repairs (antimeridian strait opening, continent promotion after suture merges, overlap separation incl. a `ringsIntersectGlobe` multi-image fix, blob stretch, polar clamp, sea relocation) — each repair fires only on its own verifier failure, so passing planets are untouched |

Verification after the full pass: `npm run check` ✅ · `npm run smoke` ✅ · `npm run verify` (terra-novus **and** meridian-3) ✅ ALL LAYERS VERIFIED · `npm run build` ✅ (2.12 MB single file).
Verification after the seed-robustness pass: additionally `npm run seeds` ✅ 62/62 with zero golden-hash drift, and `npm run verify` on repaired seeds (m7ss3oop, xps7tq2s) ✅ ALL LAYERS VERIFIED.

### Deliberately deferred (unchanged recommendations)

- **P1-2 Web Worker generation** — the generators are pure and worker-ready, but the migration needs interactive browser verification (worker + single-file build + StrictMode) that this environment cannot provide. The P1-1 store refactor was designed so generation calls are now isolated in small callbacks, making the later swap mechanical.
- **P1-3 Boundary-scoped IDs** — the cache-key fingerprint and store-driven clearing remove the known correctness hazard; globally-unique IDs remain hardening work.
- **P2-1 cos-latitude km correction, P2-2 route-grid scaling, P2-3 per-zone water model / L5 adversarial raw** — these change generated content and verifier baselines and must be done behind golden-seed tests, per the project's own frozen-foundation rule.

### Noted during implementation

- The seed `aeolus-9` fails the Tier-1 "Landmasses Simple & Disjoint" check — **pre-existing** (fails identically on the untouched baseline commit; verified by stashing the pass). This matches PROJECT_HEALTH.md's warning that not every seed passes; CI uses `terra-novus` + `meridian-3`.
