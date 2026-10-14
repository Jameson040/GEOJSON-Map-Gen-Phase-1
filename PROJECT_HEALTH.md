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
