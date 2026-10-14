# Project Health Checkpoint

## Verified in This Coding Session (2026-10-14 improvement pass)

All commands below pass with zero failures:

- `npm run check` — static health: project files, lockfile parity, strict
  TypeScript, import targets, generation gate, lifecycle eviction, settlement
  spacing, tar archive integrity, **world-layer registry DAG + invalidation
  closures**, **cadastre cache-key fingerprinting**.
- `npm run smoke` — executes the full **seven-layer** pipeline (geography →
  resources → biosphere → habitable zones → population → routes → cadastre)
  with content hashes proving the frozen layers are never modified, exercises
  cadastre cache invalidation, and round-trips a checkpoint containing every
  layer — including a v1-checkpoint backward-compatibility read.
- `npm run verify` — full multi-size-class, multi-detail-level CLI verifier:
  ALL LAYERS VERIFIED, 0 violations after finetune everywhere.
- `npm run seeds` — **golden-seed harness** (62 locked seeds): all pass, and
  every previously-passing seed keeps a byte-identical cartographic output
  hash. A fresh 200-seed sweep measures ~98% Tier-1 pass rate (baseline
  before this pass: ~65%).
- `npm run build` — production single-file build.

## Seed-Robustness Pass (2026-10-14, same session)

Measured baseline: only ~65% of random seeds passed the Tier-1 verifier; the
dominant failure was *"landmass touches the 2D antimeridian seam"* (present in
every failing seed), plus suture-merged continents dropping below the required
three, seas swallowed by coastline growth, near-circular continent blobs, and
rare ring overlaps/polar overshoots. Root causes found and fixed in
`src/world/tier1-finetune.ts`:

- **Seam picker now returns clearance** (`chooseOceanSeamMeasured`). Dense
  planets blanket every meridian, so no ocean-only antimeridian exists; the
  picker was silently returning the least-bad longitude with land on it.
- **`ringsIntersectGlobe` blind spot** (pre-existing bug): it tested only the
  nearest longitude image, missing overlaps between two landmasses whose
  wrapping tails collide. Now tests the three images around the reference
  centroid. This is also why the STEP A suture had left overlapping continents
  un-merged.
- **Conditional repairs**, each firing only on its own verifier failure so
  passing planets stay byte-identical: `openSeamCorridor` (monotone
  one-sided coastline pullback opens a strait at the antimeridian, with
  translate/drop fallbacks), `ensureThreeContinents` (promotes the largest
  well-shaped islands after continent-merging sutures), `separateOverlappingLands`
  (squeeze/translate/latitude-shift ladder, run before and after the seam pass),
  `repairContinentBlobs` (area-preserving stretch; post-seam variants never
  close the opened strait), `repairPolarOvershoot` (minimal y-compression or
  clamp for rings past a pole), `relocateSeasOnLand` (moves swallowed sea
  basins to the nearest open water, ring kept inside polar bounds).

Residual known failures (~2% of random seeds, all pre-existing conditions):
a five-continent suture chain can merge into a supercontinent wider than the
globe (no meridian can be seam-clean), and a blob continent boxed between
neighbours on both sides can be impossible to stretch.

## Route-Layer Audit & Water-Discipline Pass (2026-10-14, same session)

User-reported symptom: a road visibly running *inside* a river. Audit of
`src/world/routes/` confirmed the suspicion and found the route finetuner
never inspected geometry at all. Fixed in `route-pathfinder.ts`,
`route-generate.ts`, `route-verifier.ts` (+ additive river/lake queries in
`bio/bio-env.ts`):

- **River crossings now cost, scaled by river size.** The old cost grid gave
  river cells the *cheapest* terrain (×0.65 valley discount applied at
  `freshKm ≤ 4`, largest in the channel), so A* happily rode down the middle
  of rivers and crossed them anywhere for free. Now the channel pays a
  per-cell toll that scales with Strahler order (fording a headwater ≈ ×2,
  bridging an order-5 trunk ≈ ×20), while the *valley band beside* the river
  keeps the favourable ×0.7. Because the toll is paid per cell, paths cross
  at the narrowest going and near-perpendicular, and never follow a big
  river — exactly the requested behaviour at grid resolution.
- **Bridge counts are real.** `bridgesCount` was a crude "river-adjacent
  cells ÷ 3" estimate; it is now the number of contiguous channel runs along
  the final smoothed polyline. Same for mountain passes and (new)
  `lakeCrossings`.
- **Lakes are no longer roads.** `onLand` comes from the land mask, so lake
  interiors were walkable land (and even counted as bridges). Lake cells are
  now impassable; only when no detour exists does a second A* attempt allow
  a costly causeway/ferry, reported as `lakeCrossings`.
- **Far cities relay through wayside settlements.** City pairs 350–700 km
  apart were simply never connected. They now join via the best intermediate
  hub (shortest detour, both legs ≤ 350 km, detour ≤ 55% overhead).
- **Seizure of `Math.random()` in the A* fallback** — a seeded-determinism
  violation. The fallback arc is now derived from the region seed. Verified:
  18/18 seeds regenerate byte-identical route layers (bar timing fields).
- **Sea lanes snap to water.** Ports live on land cells; lanes now embark at
  the nearest navigable cell (≤ 3 cells) and inland "ports" get no lane.
- **Sinuosity guard.** Valley-chasing could wind a road to sinuosity 8.9;
  over 4.0 the path is re-found on a relaxed cost surface, with a
  near-straight arc as last resort.
- **Verifier now checks what its header always claimed.** Added
  `route_land_sea` (roads on land, lanes at sea, port approaches excepted)
  and `route_water_discipline` (no route may run along a river channel or
  span a wide lake). Both run before and after finetuning.

Validation: check/smoke/verify all green, golden seeds 62/62 (Tier-1
byte-identical), build OK, and an 18-seed sweep (6 known + 12 fresh) with
zero verifier violations, zero river-riding (max consecutive channel sample
run = 1), and real bridge counts (46–133 per region).

## Route-Look Pass 2 (2026-10-14, same session — "roads are straight lines")

User follow-up: roads rendered as ruler-straight spokes, line styles had no
legend, and settlement icons appeared to change position across zoom levels.
Diagnosis via new pathfinder telemetry (surfaced in `RouteFinetuneReport`:
`fallbackArcs` / `causewayRoutes` / `ferryRoutes` / `straightened`):

- **Median route sinuosity was 1.00** — not fallback arcs (those were rare)
  but the A* itself beelining, because the cost surface is uniform (flat 1.0
  grassland) between features and waypoints were downsampled every 2nd cell.
  Fixed with **seeded per-cell micro-terrain noise** (±15%, deterministic
  hash of cell + region seed — no RNG state, verified byte-identical across
  regenerations) and **full waypoint fidelity**. Long-haul (≥100 km) roads
  now wind at median sinuosity 1.26–1.40 with 15–27 points each; only
  genuinely featureless corridors stay straight.
- **Pathfinding grid raised 100×100 → 180×180** (~33 km cells on a
  supercontinent, ~7 km on islands): river tolls, valley bands and mountain
  avoidance now resolve at twice the linear detail. Iteration cap scales
  with cell count.
- **Water-separated settlement pairs** used to fall back to a straight
  overwater arc (no land path exists when the sea is impassable). Land
  routes now try three policies: no water → lake causeway (toll 9) → sea
  ferry hop (toll 14) — the network connects at the narrowest crossing
  instead of drawing fantasy bridges. Fallback arcs: 0 across test seeds.
- **Sinuosity retry preserves mountains**: the relaxed re-run compresses
  only costs below 8, so straightening a winding road can never route it
  through a range; last-resort arc only above 4.9 (verifier caps 5.0).
- **Sea-lane verifier exclusion scales** (`min(40 km, 20% of lane length)`)
  so short harbour hops still expose open-water samples to check; land
  routes may show ≤ 3 consecutive at-sea samples (a ferry/bridge hop) but
  fail if they sail.
- **Map legend added** (`src/components/MapLegend.tsx`): collapsible
  bottom-left panel naming every line style (King's Highway solid, arterial
  solid, byway dashed, mountain pass red-dashed, sea lane dotted — colours
  mirrored from both renderer palettes) and settlement marker shapes.

On "icons change places when zooming": they do not move — all layers share
one world→screen transform. What changes is *which* things are drawn:
settlements and rivers are LOD-gated (`lodMinZoom` / `lodZoom`, so more
villages and tributaries appear as you zoom in), labels switch anchoring at
cadastre zoom (≥ 45×), and drawn river width grows with zoom — a city a few
km from a river can therefore look "on" it at one zoom and clear of it at
another. Roads are computed on the **full frozen geography** (every river
vertex, range/lake polygon and biome patch via `BioEnvReader`), never on
the LOD-filtered set the canvas happens to show.

## Confirmed Problems Repaired in This Pass

- **Cadastre JIT cache staleness (correctness bug):** the cache key was
  `regionId::settlementId` only, and `clearCadastreCache` had no callers.
  Because the frozen generators restart their ID counters, re-rolling a
  region served the previous generation's village geometry at deep zoom, and
  re-running the population left roofs scaled for the old era. The key now
  fingerprints the population model and the cadastre config, and the world
  store clears the cache whenever geography or habitable zones are
  regenerated, population is re-run, a region is unloaded, or a checkpoint is
  restored. The smoke test locks this in.
- **Checkpoint covered only 4 of 7 layers:** resources, routes, cadastres and
  the resource filter config were silently dropped on save. Checkpoint format
  v2 serialises all seven layers plus their visibility flags; v1 files remain
  restorable (missing layers arrive empty). The validator rejects dangling
  layer parents for the new layers exactly as it does for the older ones.
- **Registry-driven invalidation:** the hand-written `withoutRegion` cascades
  in `App.tsx` were replaced by `useWorldLayers` (workspace/world-store.ts)
  driven by `layerConsumers()` in the layer registry. Three latent leaks the
  old matrix had are fixed as a side effect: a new planet previously kept
  stale routes/cadastres (region IDs restart per planet), unloading never
  evicted the cadastre cache, and population re-runs never refreshed
  cadastres.
- **Cascade semantics:** "Cascade All" reused existing layers for every step
  except population, which it always re-ran. All seven steps now reuse
  existing results, and the button is labelled L1→L7 as it actually runs.
- **Layer numbering unified:** the UI, modals, hover cards, generator-file
  comments and CLI labels now all follow the registry (resources L2, bio L3,
  habitable zones L4, population L5, routes L6, cadastre L7); the remaining
  hard-coded strings in the ribbon are derived from `LAYER_BY_ID`.
- **Staleness badges:** re-running an *optional* input (e.g. re-tuning the
  resource filter) no longer silently leaves consumers built on old data —
  the Layers panel and region strips mark such layers `stale` with the newer
  input named.
- **Full-world GeoJSON export:** the region export button now emits every
  generated layer in one FeatureCollection (features tagged
  `properties.layer`), with roofs capped and cadastre rings closed per the
  GeoJSON spec. Pure-geography export remains available via
  `exportRegionGeoJSON`.
- **Dependency hygiene:** the unused `@resvg/resvg-js` dependency was removed
  and `tsx` moved to devDependencies; the monolithic `@turf/turf` import was
  narrowed to `@turf/union` + `@turf/helpers` (output proven byte-identical
  across three seeds via SHA-256 before/after). The package is named
  `terra-ex-nihilo` and the verification workflow is exposed as npm scripts
  (`check` / `smoke` / `verify` / `backup`).
- **Cadastre verification aggregation:** the Layers panel previously showed
  one arbitrary settlement's verifier report for L7; reports are now merged
  across all surveyed settlements (counts summed, pass requires all).

## Earlier Repairs (previous audit, still in force)

Async generation is serialised through the workspace gate; failures surface
in the UI and release locks in `finally`; unloading evicts dependent state
and indexes; rerolls and planet replacement clear focus and caches; canvas
resize observers and zoom controls behave; region focus requests are
tab-scoped; error boundaries protect the workspace; equal-tier settlement
spacing is symmetric in finetune and verifier alike; capital reclassification
respects habitat prerequisites; the CLI verifier counts failed Tier-1 checks.

## Architectural Work Deferred

- **Web Worker generation** — long stages (human finetune ≈ 2.8 s per
  continent) still block the main thread between progress ticks. The
  generators are pure `(region, config) → result` functions with progress
  callbacks already plumbed, so a worker RPC is mechanical, but it has not
  been done in this pass and needs browser verification.
- **Boundary-scoped IDs** — module-level counters still require the
  generation gate; the cadastre cache fix removes the known correctness
  hazard, but globally-unique IDs (e.g. `${regionSeed}:set:17`) remain future
  hardening.
- **Cos-latitude km correction** — `KM_PER_UNIT` is the equatorial scale and
  east-west distances/areas are progressively inflated toward the poles
  (up to ~2×). Correcting it changes verifier baselines and generated data;
  it must be done behind golden-seed tests.
- **Route pathfinder resolution** — the A* cost grid is fixed at 100×100
  (~59 km/cell on a supercontinent). Scaling it with `linearScaleKm` changes
  route outputs and is deferred for the same reason.
- **Per-zone water model** — `waterShortage()` is still a region-wide
  boolean that ignores its `year` parameter, and the population layer's raw
  model verifies with 0 violations (no adversarial bite).
- Run `npm audit` before any production release; two advisories (one low,
  one high) were reported at install time and have not been audited here.

The geographic and biosphere generator/rule/catalog algorithms were not
edited during this pass (comments and layer numbering only). Back up first,
then change only the layer above those foundations.
