import { generatePlanetMacro } from "../src/world/tier1-planet";
import { finetunePlanetShapes } from "../src/world/tier1-finetune";
import { generateRegionDetail } from "../src/world/tier2-region";
import { generateBioLayer } from "../src/world/bio/bio-generate";
import { generateHumanLayer } from "../src/world/human/human-generate";
import { generateCadastre } from "../src/world/cadastre/cadastre-generate";
import type { SettlementMorphology } from "../src/world/cadastre/cadastre-types";

async function testUniversalCadastre() {
  console.log("--> Initializing world and region for Universal Cadastre test...");

  const macro = finetunePlanetShapes(
    await generatePlanetMacro({
      seed: "terra-novus",
      continentCount: 5,
      oceanLevel: 1,
      tectonicActivity: 1,
      islandDensity: 1,
      polarIceExtent: 1,
    })
  );

  const descriptor = macro.regions.find((r) => r.sizeClass === "large_island") ?? macro.regions[0];
  const geo = await generateRegionDetail(descriptor, {
    detailLevel: "standard",
    riverDensity: 1,
    reliefIntensity: 1,
    moisture: 1,
    glaciation: 1,
  });

  const bio = await generateBioLayer(geo, { richness: 1, wildShare: 1 });
  const human = await generateHumanLayer(geo, bio, { density: 0.5, urbanisation: 0.4 });
  console.log(`Region has ${human.settlements.length} settlements.\n`);

  const archetypes: SettlementMorphology[] = [
    "walled_concentric",
    "linear_ribbon",
    "waterfront_port",
    "crossroads_market",
  ];

  const sampleSettlement = human.settlements.find((s) => s.tier === "city") || human.settlements[0];
  const hamletSettlement = human.settlements.find((s) => s.tier === "hamlet") || human.settlements[1];

  for (const arch of archetypes) {
    const target = arch === "linear_ribbon" ? hamletSettlement : sampleSettlement;
    const cadastre = generateCadastre(geo, target, undefined, {
      forceMorphology: arch,
      enableDefensiveWalls: true,
    });

    console.log(`=== Archetype: ${arch.toUpperCase()} (${target.name}, tier: ${target.tier}) ===`);
    console.log(`  - Morphology resolved: ${cadastre.morphology}`);
    console.log(`  - Buildings count: ${cadastre.buildings.length}`);
    console.log(`  - Streets count: ${cadastre.streets.length}`);
    console.log(`  - Parcels count: ${cadastre.parcels.length}`);
    console.log(`  - Establishments synthesized: ${cadastre.establishments.length}`);
    if (cadastre.establishments.length > 0) {
      console.log(`    Sample: "${cadastre.establishments[0].name}" (${cadastre.establishments[0].trade})`);
      console.log(`    Proprietor: ${cadastre.establishments[0].proprietor} [${cadastre.establishments[0].socialClass}]`);
    }

    if (cadastre.defense) {
      console.log(`  - Defensive Enceinte (Watabou-Style):`);
      console.log(`    * Curtain wall segments: ${cadastre.defense.curtainWalls.length}`);
      console.log(`    * Bastion towers: ${cadastre.defense.towers.length}`);
      console.log(`    * Fortified gatehouses: ${cadastre.defense.gates.length}`);
    }

    if (cadastre.waterfront) {
      console.log(`  - Waterfront Feature (Chen-Style):`);
      console.log(`    * Quay street: ${cadastre.waterfront.quayStreetId}`);
      console.log(`    * Wooden piers / jetties: ${cadastre.waterfront.piers.length}`);
    }

    const stripCrofts = cadastre.parcels.filter((p) => p.landUse === "strip_croft");
    if (stripCrofts.length > 0) {
      console.log(`  - Strip crofts count (Runions-Style): ${stripCrofts.length}`);
    }

    console.log(`  - Verification Passed All: ${cadastre.verificationAfter.passedAll}`);
    if (!cadastre.verificationAfter.passedAll) {
      console.error("  FAILED CHECKS:", cadastre.verificationAfter.checks.filter(c => !c.passed));
      process.exit(1);
    }
    console.log();
  }

  // Also test natural auto-detection on all settlements
  console.log("--> Testing Context-Driven Auto-Detection across all region settlements...");
  let countWalled = 0, countRibbon = 0, countPort = 0, countCross = 0;
  for (const s of human.settlements) {
    const cad = generateCadastre(geo, s);
    if (cad.morphology === "walled_concentric") countWalled++;
    else if (cad.morphology === "linear_ribbon") countRibbon++;
    else if (cad.morphology === "waterfront_port") countPort++;
    else if (cad.morphology === "crossroads_market") countCross++;

    if (!cad.verificationAfter.passedAll) {
      console.error(`Auto test failed for ${s.name}:`, cad.verificationAfter.checks.filter(c => !c.passed));
      process.exit(1);
    }
  }

  console.log(`\nAuto-detection distribution across ${human.settlements.length} settlements:`);
  console.log(`  - Walled Concentric Cities/Towns: ${countWalled}`);
  console.log(`  - Linear Ribbon Hamlets/Roadsides: ${countRibbon}`);
  console.log(`  - Waterfront Ports/Quays: ${countPort}`);
  console.log(`  - Crossroads Market Greens: ${countCross}`);

  console.log("\nALL UNIVERSAL CADASTRE TESTS PASSED WITH 100% VERIFICATION!");
}

testUniversalCadastre().catch((err) => {
  console.error(err);
  process.exit(1);
});
