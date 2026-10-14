import type { GeneratedRegion, MapFeature, Pt } from "../types";
import type { ResourceDepositNode, ResourceFilterConfig } from "./resource-types";
import { getActiveResources } from "./resource-filter";
import { makeRng, range, type RNG } from "../rng";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// GEOLOGICAL RESOURCE GENERATOR (Generator half of adversarial pair)
//
// Samples candidate ore lodes, clay beds, stone quarries, evaporite basins,
// fuel seeps, and fantasy mineral fractures based on real geological rules.
// ---------------------------------------------------------------------------

let depositCounter = 0;

function samplePointInBBox(rng: RNG, f: MapFeature, padFraction = 0.1): Pt {
  const b = f.bbox;
  const padX = (b.maxX - b.minX) * padFraction;
  const padY = (b.maxY - b.minY) * padFraction;
  return [
    range(rng, b.minX + padX, b.maxX - padX),
    range(rng, b.minY + padY, b.maxY - padY),
  ];
}

function samplePolyline(rng: RNG, coords: Pt[]): Pt {
  if (coords.length <= 1) return coords[0] ?? [0, 0];
  const segIdx = Math.floor(rng() * (coords.length - 1));
  const t = rng();
  const a = coords[segIdx];
  const b = coords[segIdx + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function generateRawDeposits(
  geo: GeneratedRegion,
  config: ResourceFilterConfig
): ResourceDepositNode[] {
  depositCounter = 0;
  const seedString = `${geo.descriptor.regionSeed}::resources::${config.customSeed ?? config.preset}`;
  const rng = makeRng(seedString);

  const activeResources = getActiveResources(config);
  const landAreaMkm2 = Math.max(0.01, geo.descriptor.areaKm2 / 1_000_000);
  const mult = config.abundanceMultiplier;

  // Index features by type for rapid geological queries
  const mountains = geo.features.filter((f) => f.properties.featureType === "mountain_range" || f.properties.featureType === "mountain");
  const plateaus = geo.features.filter((f) => f.properties.featureType === "plateau");
  const rivers = geo.features.filter((f) => f.properties.featureType === "river");
  const wetlands = geo.features.filter((f) => f.properties.featureType === "wetland");
  const deserts = geo.features.filter((f) => f.properties.featureType === "desert");
  const volcanoes = geo.features.filter((f) => f.properties.featureType === "volcano" || f.properties.isActiveVolcano);
  const allLand = geo.features.filter((f) => f.properties.featureType === "continent" || f.properties.featureType === "island" || f.properties.tier === 1);

  const deposits: ResourceDepositNode[] = [];

  for (const res of activeResources) {
    // Base target quota based on rarity per million km²
    let basePerMkm2 = 1.0;
    switch (res.rarity) {
      case "abundant": basePerMkm2 = 4.5; break;
      case "common": basePerMkm2 = 2.8; break;
      case "uncommon": basePerMkm2 = 1.5; break;
      case "rare": basePerMkm2 = 0.7; break;
      case "mythic": basePerMkm2 = 0.25; break;
    }

    // Scale by land area and abundance multiplier
    let targetCount = Math.max(0, Math.round(basePerMkm2 * Math.sqrt(landAreaMkm2) * mult));

    // Guarantee at least 1-2 essential building stones/clays/irons if terrain exists
    if (["potters-clay", "granite", "limestone", "iron-hematite", "copper"].includes(res.id)) {
      targetCount = Math.max(1, targetCount);
    }
    // Rare/mythic chance roll if targetCount is 0 on smaller regions
    if (targetCount === 0 && (res.rarity === "rare" || res.rarity === "mythic")) {
      if (rng() < (res.rarity === "mythic" ? 0.35 : 0.65) * mult) {
        targetCount = 1;
      }
    }

    if (targetCount <= 0) continue;

    // Sample candidate locations for this resource
    for (let c = 0; c < targetCount; c++) {
      let candidatePt: Pt | null = null;
      let geoContext = "Terrestrial deposit";

      // 1. Volcanic specific
      if (res.geologicalRules.volcanicOnly && volcanoes.length > 0) {
        const v = volcanoes[Math.floor(rng() * volcanoes.length)];
        const vp = v.geometry.coordinates as Pt;
        const jiggle = kmToUnits(range(rng, 5, 25));
        const ang = rng() * Math.PI * 2;
        candidatePt = [vp[0] + jiggle * Math.cos(ang), vp[1] + jiggle * Math.sin(ang)];
        geoContext = `Fumarole slopes of ${v.properties.name}`;
      }
      // 2. Wetland / Bog specific
      else if (res.geologicalRules.wetlandOnly && wetlands.length > 0) {
        const w = wetlands[Math.floor(rng() * wetlands.length)];
        candidatePt = samplePointInBBox(rng, w, 0.15);
        geoContext = `Peat basin of ${w.properties.name}`;
      }
      // 3. High mountain / Plutonic
      else if (res.geologicalRules.featureTypes?.includes("mountain_range") && mountains.length > 0) {
        const m = mountains[Math.floor(rng() * mountains.length)];
        candidatePt = samplePointInBBox(rng, m, 0.12);
        geoContext = `Orogenic fold belt of ${m.properties.name}`;
      }
      // 4. Riparian / River valley
      else if (res.geologicalRules.riverProximityKm && rivers.length > 0) {
        const r = rivers[Math.floor(rng() * rivers.length)];
        const coords = r.geometry.coordinates as Pt[];
        if (coords.length > 1) {
          const onRiver = samplePolyline(rng, coords);
          const offsetKm = range(rng, 1, res.geologicalRules.riverProximityKm);
          const ang = rng() * Math.PI * 2;
          candidatePt = [
            onRiver[0] + kmToUnits(offsetKm) * Math.cos(ang),
            onRiver[1] + kmToUnits(offsetKm) * Math.sin(ang),
          ];
          geoContext = `Alluvial terraces along ${r.properties.name}`;
        }
      }
      // 5. Arid / Desert basin
      else if (res.geologicalRules.aridOnly && deserts.length > 0) {
        const d = deserts[Math.floor(rng() * deserts.length)];
        candidatePt = samplePointInBBox(rng, d, 0.2);
        geoContext = `Evaporite salt flats of ${d.properties.name}`;
      }
      // 6. Plateau / Sedimentary basin
      else if (plateaus.length > 0 && rng() < 0.4) {
        const pl = plateaus[Math.floor(rng() * plateaus.length)];
        candidatePt = samplePointInBBox(rng, pl, 0.15);
        geoContext = `Tableland strata of ${pl.properties.name}`;
      }
      // 7. General landmass fallback
      else if (allLand.length > 0) {
        const land = allLand[Math.floor(rng() * allLand.length)];
        candidatePt = samplePointInBBox(rng, land, 0.15);
        geoContext = `Bedrock formation of ${geo.descriptor.name}`;
      }

      if (!candidatePt) continue;

      const abundanceRoll = rng();
      const abundance: 1 | 2 | 3 = abundanceRoll > 0.75 ? 3 : abundanceRoll > 0.35 ? 2 : 1;
      const radiusKm = abundance === 3 ? range(rng, 18, 32) : abundance === 2 ? range(rng, 12, 22) : range(rng, 8, 15);

      const yieldLabels: Record<1 | 2 | 3, string> = {
        1: "Minor outcrop / prospect",
        2: "Rich seam / active quarry",
        3: "Mother lode / inexhaustible basin",
      };

      deposits.push({
        id: `res_${++depositCounter}`,
        resourceId: res.id,
        name: res.name,
        glyph: res.glyph,
        category: res.category,
        domain: res.domain,
        point: candidatePt,
        abundance,
        radiusUnits: kmToUnits(radiusKm),
        yieldEstimate: yieldLabels[abundance],
        geologicalContext: geoContext,
        compartmentId: 0,
      });
    }
  }

  return deposits;
}
