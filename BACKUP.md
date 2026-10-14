# Back Up Before Continuing

Two different things need preserving:

- Project source: the generators, rules, UI, scripts, configuration, and dependency lock.
- Generated work: the current planet, completed geographic regions, biospheres, human results, seeds, reports, and open tabs.

Saving source alone does not save a running browser's world. Reloading the application does not automatically restore an in-memory workspace.

## From the Application

Open **Backup** in the top toolbar.

1. **Download Project Source** downloads a tar.gz archive (plain tar when gzip is unsupported). It includes the current text source, configuration, lockfile, documentation, and `world-checkpoint.json` when a planet is available.
2. **Save Generated World** downloads the generated-work checkpoint as a separate JSON file. Keep this file even if you also keep the source archive.
3. **Restore a World Checkpoint** accepts that JSON and restores saved data directly. No geographic or biosphere generator is rerun. Malformed files and dangling layer dependencies are rejected before state is replaced.

Wait for generation to finish first. Existing failed scientific-verifier reports are preserved, not rewritten as passes. The archive includes a manifest with byte sizes and SHA-256 hashes when Web Crypto is available.

If the generated workspace is structurally invalid, source export still works. Its manifest explicitly records that world data could not be included; the app does not silently claim that broken state was safely backed up.

The browser archive currently covers text source files. If future versions add binary assets, use the filesystem backup below to include those assets too. Environment secrets and `.git` history are not included.

## From the Project Directory

Before changing architecture, run:

```sh
npx tsx scripts/check-project.ts
npx tsx scripts/check-project.ts --smoke terra-novus
npx tsx scripts/verify-world.ts terra-novus
node scripts/create-backup.mjs
```

The static health check validates project files, imports, TypeScript, lifecycle helpers, the archive writer, and settlement spacing. The smoke check executes one sequential three-layer pipeline, fingerprints lower-layer contents, and round-trips a generated checkpoint. The full verifier exercises available size classes and higher layers. Any failure exits non-zero.

The backup script creates a new folder under `backups/`, copying original source bytes and writing a checksum manifest. It does not regenerate a world or modify the working project. Copy an exported world JSON into your backup folder separately.

To restore source, extract the browser archive or copy the filesystem backup into a clean directory, then run:

```sh
npm ci
npm run build
npm run dev
```

Restore the world JSON through the app's Backup dialog. Keep `package-lock.json`; `node_modules/` and `dist/` can be recreated.

## Population Architecture Is Pending

This checkpoint deliberately retains the existing Layer-3 settlement schema, including its legacy fixed population values. It is not a new population model.

The next architecture should separate habitable-site structure from actual settlements/occupancy, with time-dependent population generated and finetuned per site or settlement. Do not treat the current world population total as that future model.