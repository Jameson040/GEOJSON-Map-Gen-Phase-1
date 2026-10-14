# Terra Ex Nihilo — Procedural GeoJSON World Generator

*Terra Ex Nihilo* ("earth from nothing") synthesises a complete, scientifically
verifiable fantasy planet and exports it as real **GeoJSON** (EPSG:4326) that
opens directly in QGIS, Mapbox or geopandas. It runs entirely in the browser as
a single-file React + Vite + TypeScript + Tailwind application — no server, no
account, no network after load.

```
npm ci          # install from the lockfile
npm run dev     # develop at http://localhost:5173
npm run build   # produce dist/index.html (single file, ~2.1 MB)
npm run preview # serve the production build
```

## How the world is made

**Tier 1 — planetary macro.** Tectonic plates, continents, island arcs, ocean
basins, trenches and polar caps. A few hundred features, always instant. A
post-generation shape finetune reshapes the raw blobs toward real-world
archetypes (cordillera, shield, arc sliver…) and picks an ocean seam so
nothing crosses the exported antimeridian.

**Tier 2 — regional detail, per landmass, on demand.** Every landmass is
classified into a **size compartment** (islet → supercontinent). That single
classification decides which feature families exist and at what km scale:
ranges, peaks, volcanoes, rivers with Strahler order, lakes, biomes. Work is
apportioned across a compartment grid so a supercontinent never stalls the
UI behind one giant loop.

**The seven-layer world stack.** On top of the frozen geography, each layer is
generated only from the layers beneath it and never modifies them:

| # | Layer | What it adds |
|---|---|---|
| L1 | Geography | Coastlines, relief, hydrology, biomes (Tier 1 + Tier 2) |
| L2 | Geological Resources | Metals, clays, stone, salts, fuels, gems, fantasy veins |
| L3 | Biosphere | Crops, livestock, game, fisheries, timber (FAO EcoCrop set) |
| L4 | Habitable Zones | Settlement *sites* — structure and capacity, never headcounts |
| L5 | Population | Time-dependent occupancy per zone (eras 1B → 8B), scrubbable |
| L6 | Roads & Trade Routes | Terrain-aware A* highways, market roads, passes, sea lanes |
| L7 | Cadastre & Roofs | Streets, parcels, cottage roofs — generated lazily on deep zoom |

Every layer follows the same **adversarial pattern**: a deliberately
unconstrained *generator* scatters chaos, a rule-based *finetune* repairs it
against the frozen layers beneath, and a *verifier* proves the result — the
UI can toggle between Raw and Finetuned to see exactly what the rules fixed.

## Verifying and backing up

The pipeline is deterministic per seed and fully scriptable:

```sh
npm run check      # static project health (files, strict TS, imports, gate, registry, cache keys)
npm run smoke      # + executes the full seven-layer pipeline once and round-trips a checkpoint
npm run verify     # CLI world verifier: every land-size class × detail levels × layers
npm run backup     # filesystem backup of the source tree with checksums
```

Any failure exits non-zero — these are the same invariants the app enforces
at runtime. See `BACKUP.md` for the full backup/restore story (browser source
archive + world checkpoint JSON with deep structural validation; restore never
regenerates frozen layers).

## Saving and exporting your world

- **Backup → Save Generated World** writes a checkpoint of *all seven layers*
  plus the view state; **Restore** reloads it byte-identically (v1 checkpoints
  from before L2/L6/L7 were checkpointed still restore).
- The **GeoJSON** button exports the planet macro (planet tab) or the **full
  world bundle** of the active region: every layer in one FeatureCollection,
  each feature tagged with `properties.layer`, roofs capped at 25,000 features
  (configurable via `exportRegionWorldGeoJSON`).

## Architecture map

```
src/
  world/                 the frozen generation core (strictly verified)
    tier1-planet / tier1-finetune / tier2-region / finetune-stage / verifier
    size-classes          the land-size compartment system
    layers.ts             the world-layer REGISTRY (single source of truth)
    resources/ bio/ human/ population/ routes/ cadastre/   layer generators
    canvas-renderer + themes + artistic-cartography        the map itself
  workspace/
    world-store.ts        owns the seven layer maps; registry-driven invalidation
    checkpoint.ts         save/restore with structural validation
    generation-gate.ts    serialises generation jobs
    archive.ts            browser-side source tarball
  components/             the UI (map viewer, modals, sidebar, backup)
scripts/                  check-project / verify-world / create-backup (CLI twins)
```

Adding a layer means adding a generator folder and **one registry entry** in
`src/world/layers.ts` — gating, invalidation, staleness badges, checkpointing
and the Layers panel all follow the registry.

## Project documents

- `PROJECT_ANALYSIS.md` — the audited findings and the improvement roadmap
- `PROJECT_HEALTH.md` — what has been verified, repaired, and deferred
- `BACKUP.md` — how to back up and restore source and generated worlds
