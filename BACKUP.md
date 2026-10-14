# Back Up Before Continuing

Two different things need preserving:

- Project source: the generators, rules, UI, scripts, configuration, and dependency lock.
- Generated work: the current planet, completed geographic regions, resource layers, biospheres, habitable zones, population models, trade routes, cadastral surveys, seeds, reports, and open tabs.

Saving source alone does not save a running browser's world. Reloading the application does not automatically restore an in-memory workspace.

## From the Application

Open **Backup** in the top toolbar.

1. **Download Project Source** downloads a tar.gz archive (plain tar when gzip is unsupported). It includes the current text source, configuration, lockfile, documentation, and `world-checkpoint.json` when a planet is available.
2. **Save Generated World** downloads the generated-work checkpoint as a separate JSON file — **all seven layers**: geography, resources, biosphere, habitable zones, population, routes and cadastre, plus the resource filter config and view state. Keep this file even if you also keep the source archive.
3. **Restore a World Checkpoint** accepts that JSON and restores saved data directly. No geographic or biosphere generator is rerun. Malformed files and dangling layer dependencies (including resources, routes or cadastres referencing missing regions) are rejected before state is replaced. Checkpoints saved by the older v1 format (before resources/routes/cadastres were included) still restore — those layers simply arrive empty.

Wait for generation to finish first. Existing failed scientific-verifier reports are preserved, not rewritten as passes. The archive includes a manifest with byte sizes and SHA-256 hashes when Web Crypto is available.

If the generated workspace is structurally invalid, source export still works. Its manifest explicitly records that world data could not be included; the app does not silently claim that broken state was safely backed up.

The browser archive currently covers text source files. If future versions add binary assets, use the filesystem backup below to include those assets too. Environment secrets and `.git` history are not included.

## From the Project Directory

Before changing architecture, run:

```sh
npm run check
npm run smoke
npm run verify
npm run backup
```

`check` validates project files, imports, strict TypeScript, lifecycle helpers, the archive writer, the world-layer registry (dependency DAG and invalidation closures) and the cadastre cache-key fingerprinting. `smoke` executes the full sequential seven-layer pipeline, fingerprints lower-layer contents, proves cadastre cache invalidation, and round-trips a generated checkpoint — including a v1-format compatibility read. `verify` exercises available size classes and higher layers. Any failure exits non-zero.

The backup script creates a new folder under `backups/`, copying original source bytes and writing a checksum manifest. It does not regenerate a world or modify the working project. Copy an exported world JSON into your backup folder separately.

To restore source, extract the browser archive or copy the filesystem backup into a clean directory, then run:

```sh
npm ci
npm run build
npm run dev
```

Restore the world JSON through the app's Backup dialog. Keep `package-lock.json`; `node_modules/` and `dist/` can be recreated.

## Architecture Notes

The world is a stack of seven frozen layers (L1 Geography → L7 Cadastre). Each layer is generated only from the layers beneath it, never modifies them, and is invalidated — through the registry-driven world store — whenever one of its inputs is regenerated. Optional inputs (resources for habitable zones and routes, population for cadastre roof scaling) do not evict their consumers; they mark them **stale** in the Layers panel instead. Regenerating population evicts cadastres because roof footprints scale with occupancy.

Layer 5 population is time-dependent and per-zone by design: zones carry structure only (no headcounts), and occupancy is a re-runnable, scrubbable model on top. Do not bake headcounts back into Layer 4.
