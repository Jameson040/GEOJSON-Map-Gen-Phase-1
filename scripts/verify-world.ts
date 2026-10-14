// ---------------------------------------------------------------------------
// Standalone CLI World Verifier Script
// Run via: npx vite-node scripts/verify-world.ts [seed]
//
//  1. Generates the Tier-1 planet and runs the macro verifier.
//  2. Picks one landmass from EVERY land-size compartment present (islet →
//     supercontinent) and runs Tier-2 + Finetune at several detail levels.
//  3. Prints raw vs. finetuned violations for all 11 checks, including the
//     size-class conformance check, and exits non-zero on any failure.
// ---------------------------------------------------------------------------

import { generatePlanetMacro } from "../src/world/tier1-planet";
import { generateRegionDetail } from "../src/world/tier2-region";
import { verifyPlanetMacro } from "../src/world/verifier";
import { finetunePlanetShapes, ARCHETYPE_INFO } from "../src/world/tier1-finetune";
import { generateBioLayer } from "../src/world/bio/bio-generate";
import { generateHumanLayer } from "../src/world/human/human-generate";
import { generatePopulationLayer } from "../src/world/population/population-generate";
import { SIZE_CLASS_ORDER, SIZE_PROFILES, formatArea } from "../src/world/size-classes";
import type { RegionDetailLevel } from "../src/world/types";
import { createHash } from "node:crypto";

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  const seed = process.argv[2] ?? "terra-novus";
  console.log("=================================================================");
  console.log(" TERRA EX NIHILO — SIZE-COMPARTMENTALISED VERIFIER");
  console.log(`  seed: ${seed}`);
  console.log("=================================================================\n");

  const rawMacro = await generatePlanetMacro({
    seed,
    continentCount: 5,
    oceanLevel: 1,
    tectonicActivity: 1,
    islandDensity: 1,
    polarIceExtent: 1,
  });
  const rawReport = verifyPlanetMacro(rawMacro);
  const macro = finetunePlanetShapes(rawMacro);
  const macroReport = verifyPlanetMacro(macro);

  console.log(
    `[TIER 1] raw ${rawReport.passedChecks}/${rawReport.totalChecks} (${rawReport.totalViolations} violations) → shape-finetuned ${macroReport.passedChecks}/${macroReport.totalChecks} ${macroReport.passedAll ? "PASS" : "FAIL"}`
  );
  for (const c of macroReport.checks) console.log(`   ${c.passed ? "✓" : "✗"} ${c.title}: ${c.details}`);
  const sh = macro.shape!;
  console.log(
    `\n[SHAPE FINETUNE] ${sh.reshaped} reshaped · ${sh.softened} softened · ${sh.keptRaw} kept raw · ${sh.sutured} sutured · ${sh.accreted} accreted (${sh.elapsedMs} ms)`
  );
  for (const r of sh.records.filter((x) => x.kind === "continent" && x.archetype !== "none")) {
    console.log(
      `   ${r.name.padEnd(24)} ${ARCHETYPE_INFO[r.archetype as keyof typeof ARCHETYPE_INFO].label.padEnd(15)} ${r.status.padEnd(9)} aspect ${r.aspectBefore}→${r.aspectAfter}  solidity ${r.solidityBefore}→${r.solidityAfter}  shift ${r.centroidShiftKm} km`
    );
  }

  console.log("\n[SIZE COMPARTMENTS ON THIS PLANET]");
  for (const id of SIZE_CLASS_ORDER) {
    console.log(`   ${SIZE_PROFILES[id].label.padEnd(15)} ${String(macro.stats.sizeClassCounts[id]).padStart(3)} landmasses`);
  }
  console.log("");

  let failures = macroReport.checks.filter((check) => !check.passed).length;
  const levels: RegionDetailLevel[] = ["standard", "ultra"];

  for (const id of SIZE_CLASS_ORDER) {
    const regDesc = macro.regions.find((r) => r.sizeClass === id);
    if (!regDesc) continue;
    const P = SIZE_PROFILES[id];

    for (const level of levels) {
      const reg = await generateRegionDetail(regDesc, {
        detailLevel: level,
        riverDensity: 1,
        reliefIntensity: 1,
        moisture: 1,
        glaciation: 1,
      });
      const s = reg.stats;
      const ft = reg.finetune;
      const before = reg.verificationBefore;
      const after = reg.verificationAfter;

      console.log(`-----------------------------------------------------------------`);
      console.log(
        `[${P.label.toUpperCase()}] "${regDesc.name}" ${formatArea(regDesc.areaKm2)} (√A=${regDesc.linearScaleKm} km) | ${level.toUpperCase()}`
      );
      console.log(
        `  compartments=${reg.compartments.length}  features ${ft.rawFeatureCount}→${ft.finalFeatureCount}  ${s.generationTimeMs}ms`
      );
      console.log(
        `  ranges=${s.mountainRanges} peaks=${s.peaks} volc=${s.volcanoes} riverSeg=${s.riverSegments} (trunks ${s.rivers}) lakes=${s.lakes} biomes=${s.biomes}`
      );
      console.log(
        `  highest=${s.highestPeak.elevation}m (cap ${P.relief.maxElevation}) longest=${s.longestRiver.lengthKm}km largestLake=${s.largestLake.areaKm2}km²`
      );
      console.log(
        `  verifier: raw ${before.totalViolations} violations → finetuned ${after.totalViolations}  ${after.passedAll ? "ALL PASS ✓" : "FAIL ✗"}`
      );
      for (const c of after.checks) {
        if (!c.passed) {
          failures++;
          console.log(`   ✗ ${c.title}`);
          for (const v of c.sampleViolations) console.log(`       ! ${v}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // LAYER 2 — Biosphere: generate + finetune + verify on two region classes.
  // The geographic layer must come out byte-identical in feature count.
  // ---------------------------------------------------------------------
  console.log(`\n[LAYER 2 — FLORA & FAUNA]`);
  const bioTargets = [
    macro.regions.find((r) => r.sizeClass === "continent") ?? macro.regions[0],
    macro.regions.find((r) => r.sizeClass === "large_island") ?? macro.regions.find((r) => r.sizeClass === "small_island"),
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));

  for (const desc of bioTargets) {
    const region = await generateRegionDetail(desc, {
      detailLevel: "standard",
      riverDensity: 1,
      reliefIntensity: 1,
      moisture: 1,
      glaciation: 1,
    });
    const geoCount = region.features.length;
    const geographyBefore = fingerprint(region);
    const bio = await generateBioLayer(region, { richness: 1, wildShare: 1 });
    const r = bio.report;
    console.log(
      `  [${desc.sizeClass.toUpperCase()}] ${desc.name}: raw ${r.rawCount} → kept ${r.keptAsIs} + moved ${r.relocated} + added ${r.added} − dropped ${r.dropped} = ${r.finalCount} pops (${r.speciesPresent} species, ${r.elapsedMs} ms)`
    );
    console.log(
      `    verify: raw ${bio.verifyBefore.totalViolations}v → finetuned ${bio.verifyAfter.totalViolations}v  ${bio.verifyAfter.passedAll ? "ALL PASS ✓" : "FAIL ✗"} | geography untouched: ${region.features.length === geoCount}`
    );
    for (const c of bio.verifyAfter.checks) {
      if (!c.passed) {
        failures++;
        console.log(`     ✗ ${c.title}`);
        for (const v of c.sampleViolations) console.log(`         ! ${v}`);
      }
    }
    if (fingerprint(region) !== geographyBefore) {
      failures++;
      console.error("Geographic content changed during biosphere generation");
    }

    // ---- LAYER 3 — Habitable Zones (structure only, no population) --------
    const bioCount = bio.populations.length;
    const biosphereBefore = fingerprint(bio);
    const human = await generateHumanLayer(region, bio, { density: 1, urbanisation: 0.4 });
    const h = human.report;
    console.log(
      `    [L3] raw ${h.rawCount} → kept ${h.keptAsIs} + moved ${h.relocated} + added ${h.added} − dropped ${h.dropped} (${h.demotions} demotions) = ${h.finalCount} habitable zones, structural cap ${human.stats.totalCapacity.toLocaleString()} (${h.elapsedMs} ms)`
    );
    console.log(
      `         tiers n${human.stats.byTier.nomadic} h${human.stats.byTier.hamlet} v${human.stats.byTier.village} t${human.stats.byTier.town} c${human.stats.byTier.city} m${human.stats.byTier.metropolis} · best ${human.stats.bestSite?.name ?? "—"} (${human.stats.bestSite?.type ?? "—"}, cap ${human.stats.bestSite?.capacity ?? 0}) · habitation ${human.stats.byHabitation.lived_now}/${human.stats.byHabitation.ancient_pulse}/${human.stats.byHabitation.potential}`
    );
    console.log(
      `         verify: raw ${human.verifyBefore.totalViolations}v → finetuned ${human.verifyAfter.totalViolations}v  ${human.verifyAfter.passedAll ? "ALL PASS ✓" : "FAIL ✗"} | geo untouched: ${region.features.length === geoCount} · bio untouched: ${bio.populations.length === bioCount}`
    );
    // No settlement may carry a population — population is Layer 4.
    if (human.settlements.some((s) => (s as unknown as Record<string, unknown>).population !== undefined)) {
      failures++;
      console.error("Population leaked into the habitable-zones layer (population must be Layer 4)");
    }
    for (const c of human.verifyAfter.checks) {
      if (!c.passed) {
        failures++;
        console.log(`     ✗ ${c.title}`);
        for (const v of c.sampleViolations) console.log(`         ! ${v}`);
      }
    }
    if (fingerprint(region) !== geographyBefore || fingerprint(bio) !== biosphereBefore) {
      failures++;
      console.error("Lower-layer content changed during human-layer generation");
    }

    // ---- LAYER 4 — Time-dependent Population on top of the frozen zones ----
    const noZones = human.settlements.length === 0;
    void noZones;
    const zonesBefore = fingerprint(human);
    const population = await generatePopulationLayer(region, bio, human, { era: "current", year: 2026, targetScale: 1, customSeed: undefined });
    const stocked = [...population.model.values()].filter((p) => p.occupancy > 0).length;
    console.log(
      `    [L4] current · ${population.report.finalOccupancy.toLocaleString()} actual people on ${stocked}/${population.report.zonesModelled} zones · ${population.report.foodShortageZones} hunger zones · revived ${population.report.revived} (${population.report.elapsedMs} ms)`
    );
    console.log(
      `         verify: raw ${population.verifyBefore.totalViolations}v → finetuned ${population.verifyAfter.totalViolations}v  ${population.verifyAfter.passedAll ? "ALL PASS ✓" : "FAIL ✗"} | zones untouched: ${fingerprint(human) === zonesBefore} · bio untouched: ${fingerprint(bio) === biosphereBefore}`
    );
    for (const c of population.verifyAfter.checks) {
      if (!c.passed) {
        failures++;
        console.log(`     ✗ ${c.title}`);
        for (const v of c.sampleViolations) console.log(`         ! ${v}`);
      }
    }
    // a population model may never write into its zones — L3 stays structure-only
    if (fingerprint(human) !== zonesBefore) {
      failures++;
      console.error("Zone content changed during population-layer generation");
    }
    // Layer 4 values are time structure, but values must never exceed an extreme bound
    if ([...population.model.values()].some((p) => p.occupancy > 60_000_000)) {
      failures++;
      console.error("An occupancy exceeds the absolute plausibility bound — population ran away");
    }
  }

  console.log(`\n${failures === 0 ? "ALL LAYERS VERIFIED ✓" : `${failures} FAILED CHECKS ✗`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
