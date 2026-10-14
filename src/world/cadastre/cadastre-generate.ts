import type { GeneratedRegion, Pt } from "../types";
import type { Settlement } from "../human/human-types";
import type { ZonePopulation } from "../population/population-types";
import type {
  BuildingFootprint,
  BuildingFunction,
  CadastreConfig,
  DefensiveEnceinte,
  DefensiveGatehouse,
  DefensiveTower,
  EstablishmentInfo,
  Parcel,
  RoofFacet,
  RoofMaterial,
  RoofType,
  SettlementCadastre,
  SettlementMorphology,
  StreetSegment,
  WaterfrontFeature,
  WaterfrontPier,
} from "./cadastre-types";
import { metersToUnits } from "./cadastre-types";
import {
  BUILDING_DIMENSIONS,
  ROOF_MATERIAL_PALETTES,
  resolveRoofMaterial,
  TIER_CADASTRE_PROFILES,
} from "./cadastre-catalog";
import { makeRng, range } from "../rng";
import { runCadastreFinetune } from "./cadastre-finetune";
import { verifyCadastre } from "./cadastre-verifier";
import { generateSettlementEstablishments } from "./cadastre-establishments";
import { dist } from "../geom";

// Compute sun exposure for a 2D slope vector perpendicular to ridge
// Sun is at azimuth 315° (from NW, vector [-0.707, -0.707])
export function computeSunExposure(slopeDirectionAngle: number, pitchDeg: number): number {
  const sunAzimuthRad = (315 * Math.PI) / 180; // 5.497 rad
  const sunElevationRad = (45 * Math.PI) / 180; // 0.785 rad

  // Sun unit vector [sx, sy, sz]
  const sx = Math.cos(sunElevationRad) * Math.sin(sunAzimuthRad);
  const sy = -Math.cos(sunElevationRad) * Math.cos(sunAzimuthRad);
  const sz = Math.sin(sunElevationRad);

  // Slope surface normal
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const nx = Math.sin(pitchRad) * Math.cos(slopeDirectionAngle);
  const ny = Math.sin(pitchRad) * Math.sin(slopeDirectionAngle);
  const nz = Math.cos(pitchRad);

  const dot = nx * sx + ny * sy + nz * sz;
  return Math.max(0.1, Math.min(1.0, 0.45 + dot * 0.55));
}

/** Helper: Generate parallel furrow lines across a farm field parcel */
export function generateCropFurrows(boundary: Pt[], spacingM = 4.5): [Pt, Pt][] {
  if (boundary.length < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of boundary) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spacingUnits = metersToUnits(spacingM);
  const furrows: [Pt, Pt][] = [];
  const widthUnits = maxX - minX;
  const heightUnits = maxY - minY;

  if (widthUnits >= heightUnits) {
    const steps = Math.floor(heightUnits / spacingUnits);
    for (let i = 1; i < steps; i++) {
      const y = minY + i * spacingUnits;
      furrows.push([[minX + metersToUnits(2), y], [maxX - metersToUnits(2), y]]);
    }
  } else {
    const steps = Math.floor(widthUnits / spacingUnits);
    for (let i = 1; i < steps; i++) {
      const x = minX + i * spacingUnits;
      furrows.push([[x, minY + metersToUnits(2)], [x, maxY - metersToUnits(2)]]);
    }
  }
  return furrows;
}

/** Helper: Generate post-and-rail wooden fences or stone estate walls */
export function generateEnclosureFences(boundary: Pt[], _gateOpeningM = 5.0): Pt[][] {
  if (boundary.length < 3) return [];
  const segments: Pt[][] = [];
  const n = boundary.length;
  for (let i = 1; i < n; i++) {
    const nextIdx = (i + 1) % n;
    segments.push([boundary[i], boundary[nextIdx]]);
  }
  return segments;
}

/** Detects proximity to natural water bodies (rivers, lakes, sea) */
export function detectNearbyWaterBody(
  geo: GeneratedRegion,
  center: Pt,
  searchRadiusUnits = 0.055 // ~300 meters
): { hasWater: boolean; tangentAngle: number; waterEdge: Pt } {
  for (const f of geo.features) {
    const fType = f.properties.featureType;
    if (fType === "river") {
      const coords = f.geometry.coordinates as unknown as Pt[];
      if (Array.isArray(coords)) {
        for (let i = 0; i < coords.length - 1; i++) {
          const d = dist(center, coords[i]);
          if (d <= searchRadiusUnits) {
            const dx = coords[i + 1][0] - coords[i][0];
            const dy = coords[i + 1][1] - coords[i][1];
            return { hasWater: true, tangentAngle: Math.atan2(dy, dx), waterEdge: coords[i] };
          }
        }
      }
    } else if (fType === "lake" || fType === "sea") {
      const rings = f.geometry.coordinates as unknown as Pt[][][];
      if (Array.isArray(rings) && rings[0]) {
        const ring = rings[0] as unknown as Pt[];
        for (let i = 0; i < ring.length - 1; i++) {
          const d = dist(center, ring[i]);
          if (d <= searchRadiusUnits) {
            const dx = ring[i + 1][0] - ring[i][0];
            const dy = ring[i + 1][1] - ring[i][1];
            return { hasWater: true, tangentAngle: Math.atan2(dy, dx), waterEdge: ring[i] };
          }
        }
      }
    }
  }
  return { hasWater: false, tangentAngle: 0, waterEdge: center };
}

/** Resolves settlement morphology based on tier, type, geography, or explicit config */
export function resolveSettlementMorphology(
  geo: GeneratedRegion,
  settlement: Settlement,
  config?: CadastreConfig
): SettlementMorphology {
  if (config?.forceMorphology) {
    return config.forceMorphology;
  }
  const water = detectNearbyWaterBody(geo, settlement.point);
  if (water.hasWater) {
    return "waterfront_port";
  }
  if (
    settlement.tier === "town" ||
    settlement.tier === "city" ||
    settlement.tier === "metropolis" ||
    settlement.type === "fortress_city"
  ) {
    return "walled_concentric";
  }
  if (settlement.tier === "hamlet" || settlement.tier === "nomadic") {
    return "linear_ribbon";
  }
  return "crossroads_market";
}

/**
 * UNIVERSAL SETTLEMENT GENERATOR
 *
 * Adapts open-source paradigms:
 *   1. Walled Concentric (Watabou): Defensive curtain walls, bastions, gates, inner wards.
 *   2. Linear Ribbon (Runions): Roadside ribbon settlement with deep agricultural strip crofts.
 *   3. Waterfront Port (Chen): Paved quayside street, wooden piers/jetties, fishmongers, warehouses.
 *   4. Crossroads Market: Open market green, coaching inn, smithy, livestock corrals.
 *   5. Socio-Economic Establishments (Eigengrau / Ross): Resource-driven named shops, inns, temples.
 */
export function generateCadastre(
  geo: GeneratedRegion,
  settlement: Settlement,
  population?: ZonePopulation,
  config?: CadastreConfig
): SettlementCadastre {
  const t0 = performance.now();
  const seedString = config?.customSeed ?? `${geo.seed}::cadastre::${settlement.id}`;
  const rng = makeRng(seedString);

  const profile = TIER_CADASTRE_PROFILES[settlement.tier];
  const density = config?.buildingDensity ?? 1.0;
  const pitchMult = config?.roofPitchMultiplier ?? 1.0;

  let radiusM = profile.radiusM * Math.sqrt(density);
  if (population && population.occupancy > 0) {
    const scaleFactor = Math.min(1.35, Math.max(0.75, Math.pow(population.occupancy / Math.max(10, settlement.popCap), 0.3)));
    radiusM *= scaleFactor;
  }
  const radiusUnits = metersToUnits(radiusM);
  const center = settlement.point;

  // Detect local biome
  let biomeType = "temperate_grassland";
  const biomeTypes = new Set(["forest", "grassland", "savanna", "desert", "tundra", "wetland", "glacier"]);
  for (const f of geo.features) {
    if (biomeTypes.has(f.properties.featureType)) {
      const b = f.bbox;
      if (center[0] >= b.minX && center[0] <= b.maxX && center[1] >= b.minY && center[1] <= b.maxY) {
        biomeType = f.properties.name || f.properties.climateZone || f.properties.featureType;
        break;
      }
    }
  }

  const morphology = resolveSettlementMorphology(geo, settlement, config);

  const streets: StreetSegment[] = [];
  const parcels: Parcel[] = [];
  const rawBuildings: BuildingFootprint[] = [];
  let buildingIdCounter = 0;

  const primaryAngle = rng() * Math.PI * 2;

  let defense: DefensiveEnceinte | undefined;
  let waterfront: WaterfrontFeature | undefined;
  let marketSquare: Pt[] | undefined;

  const civicWell = {
    center,
    radiusM: 2.2,
  };

  // Village pond
  const pondAngle = primaryAngle - 1.2;
  const pondDistM = radiusM * 0.45;
  const pondRadiusM = range(rng, 14, 22);
  const pondCenter: Pt = [
    center[0] + metersToUnits(pondDistM * Math.cos(pondAngle)),
    center[1] + metersToUnits(pondDistM * Math.sin(pondAngle)),
  ];
  const pondSteps = 16;
  const pondPoly: Pt[] = [];
  for (let p = 0; p < pondSteps; p++) {
    const a = (p / pondSteps) * Math.PI * 2;
    const rJitter = pondRadiusM * (0.85 + (Math.sin(a * 3) + Math.cos(a * 2)) * 0.1);
    pondPoly.push([
      pondCenter[0] + metersToUnits(rJitter * Math.cos(a)),
      pondCenter[1] + metersToUnits(rJitter * Math.sin(a)),
    ]);
  }
  const civicPond = {
    center: pondCenter,
    radiusM: pondRadiusM,
    polygon: pondPoly,
  };

  // =========================================================================
  // ARCHETYPE 1: WALLED CONCENTRIC (Watabou Enceinte & Radial Wards)
  // =========================================================================
  if (morphology === "walled_concentric") {
    const plazaLenM = settlement.tier === "metropolis" ? 100 : settlement.tier === "city" ? 80 : 60;
    const plazaWidM = settlement.tier === "metropolis" ? 75 : settlement.tier === "city" ? 60 : 45;
    const halfPlazaLenUnits = metersToUnits(plazaLenM / 2);
    const halfPlazaWidUnits = metersToUnits(plazaWidM / 2);

    const plazaCornersLocal: Pt[] = [
      [-halfPlazaLenUnits, -halfPlazaWidUnits],
      [halfPlazaLenUnits, -halfPlazaWidUnits],
      [halfPlazaLenUnits, halfPlazaWidUnits],
      [-halfPlazaLenUnits, halfPlazaWidUnits],
    ];
    marketSquare = plazaCornersLocal.map(([lx, ly]) => {
      const rx = lx * Math.cos(primaryAngle) - ly * Math.sin(primaryAngle);
      const ry = lx * Math.sin(primaryAngle) + ly * Math.cos(primaryAngle);
      return [center[0] + rx, center[1] + ry];
    });

    parcels.push({
      id: `pcl_${settlement.id}_plaza`,
      boundary: marketSquare,
      landUse: "plaza",
      areaM2: plazaLenM * plazaWidM,
      buildingIds: [],
      fillColor: "rgba(180, 165, 140, 0.22)",
    });

    streets.push({
      id: `str_${settlement.id}_plaza_ring`,
      kind: "plaza",
      surface: profile.streetSurface,
      widthM: profile.primaryStreetWidthM,
      points: [...marketSquare, marketSquare[0]],
    });

    // Town Well at plaza center
    const wellBuilding = createBuildingFootprint(
      `bld_${settlement.id}_well`,
      "well",
      center,
      4.0, 4.0, 2.5, 1,
      "thatched_round",
      resolveRoofMaterial(biomeType, settlement.tier, "well"),
      primaryAngle, 26
    );
    rawBuildings.push(wellBuilding);

    // Historic Inn (South edge)
    const innOffsetM = plazaWidM / 2 + 10;
    const innPerpAngle = primaryAngle + Math.PI / 2;
    const innCenter: Pt = [
      center[0] + metersToUnits(innOffsetM * Math.cos(innPerpAngle)),
      center[1] + metersToUnits(innOffsetM * Math.sin(innPerpAngle)),
    ];
    const innDim = BUILDING_DIMENSIONS.inn;
    const innLen = range(rng, innDim.lengthRangeM[0], innDim.lengthRangeM[1]);
    const innWid = range(rng, innDim.widthRangeM[0], innDim.widthRangeM[1]);
    const innBld = createBuildingFootprint(
      `bld_${settlement.id}_inn`,
      "inn",
      innCenter,
      innLen, innWid,
      range(rng, innDim.heightRangeM[0], innDim.heightRangeM[1]),
      innDim.stories, innDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "inn"),
      primaryAngle,
      innDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(innBld);

    // Cathedral or Temple (North edge)
    const templeFunc: BuildingFunction = settlement.tier === "metropolis" || settlement.tier === "city" ? "cathedral" : "temple";
    const templeDim = BUILDING_DIMENSIONS[templeFunc];
    const templeOffsetM = -(plazaWidM / 2 + 14);
    const templeCenter: Pt = [
      center[0] + metersToUnits(templeOffsetM * Math.cos(innPerpAngle)),
      center[1] + metersToUnits(templeOffsetM * Math.sin(innPerpAngle)),
    ];
    const templeLen = range(rng, templeDim.lengthRangeM[0], templeDim.lengthRangeM[1]);
    const templeWid = range(rng, templeDim.widthRangeM[0], templeDim.widthRangeM[1]);
    const templeBld = createBuildingFootprint(
      `bld_${settlement.id}_temple`,
      templeFunc,
      templeCenter,
      templeLen, templeWid,
      range(rng, templeDim.heightRangeM[0], templeDim.heightRangeM[1]),
      templeDim.stories, templeDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, templeFunc),
      primaryAngle + Math.PI / 2,
      templeDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(templeBld);

    // Townhall or Keep (West edge)
    const civicFunc: BuildingFunction = settlement.type === "fortress_city" ? "keep" : "townhall";
    const cDim = BUILDING_DIMENSIONS[civicFunc];
    const civicOffsetM = -(plazaLenM / 2 + 15);
    const civicCenter: Pt = [
      center[0] + metersToUnits(civicOffsetM * Math.cos(primaryAngle)),
      center[1] + metersToUnits(civicOffsetM * Math.sin(primaryAngle)),
    ];
    const civicBld = createBuildingFootprint(
      `bld_${settlement.id}_civic`,
      civicFunc,
      civicCenter,
      range(rng, cDim.lengthRangeM[0], cDim.lengthRangeM[1]),
      range(rng, cDim.widthRangeM[0], cDim.widthRangeM[1]),
      range(rng, cDim.heightRangeM[0], cDim.heightRangeM[1]),
      cDim.stories, cDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, civicFunc),
      primaryAngle,
      cDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(civicBld);

    // Radial Roads
    const radialCount = settlement.tier === "metropolis" ? 6 : settlement.tier === "city" ? 5 : 4;
    const radialAngles: number[] = [];
    for (let r = 0; r < radialCount; r++) {
      const rAngle = primaryAngle + (r / radialCount) * Math.PI * 2 + (rng() - 0.5) * 0.1;
      radialAngles.push(rAngle);

      const roadLenM = radiusM * 1.15;
      const steps = 6;
      const pts: Pt[] = [];
      const startM = Math.min(plazaLenM, plazaWidM) / 2;
      for (let s = 0; s <= steps; s++) {
        const dM = startM + ((roadLenM - startM) * s) / steps;
        pts.push([
          center[0] + metersToUnits(dM * Math.cos(rAngle)),
          center[1] + metersToUnits(dM * Math.sin(rAngle)),
        ]);
      }
      streets.push({
        id: `str_${settlement.id}_radial_${r}`,
        kind: "arterial",
        surface: profile.streetSurface,
        widthM: profile.primaryStreetWidthM,
        points: pts,
      });
    }

    // Defensive Enceinte (Curtain Walls, Bastions, Gatehouses)
    const enableWalls = config?.enableDefensiveWalls !== false;
    if (enableWalls) {
      const wallRadiusM = radiusM * 0.56;
      const wallRadiusUnits = metersToUnits(wallRadiusM);
      const curtainWallSegments: Pt[][] = [];
      const towers: DefensiveTower[] = [];
      const gates: DefensiveGatehouse[] = [];

      for (let r = 0; r < radialCount; r++) {
        const nextR = (r + 1) % radialCount;
        const a1 = radialAngles[r];
        const a2 = radialAngles[nextR];

        // Gatehouse at radial road piercing wall
        const gateCenter: Pt = [
          center[0] + wallRadiusUnits * Math.cos(a1),
          center[1] + wallRadiusUnits * Math.sin(a1),
        ];
        const perpA = a1 + Math.PI / 2;
        const gateSpanM = profile.primaryStreetWidthM + 4;
        const t1Pos: Pt = [
          gateCenter[0] + metersToUnits((gateSpanM / 2) * Math.cos(perpA)),
          gateCenter[1] + metersToUnits((gateSpanM / 2) * Math.sin(perpA)),
        ];
        const t2Pos: Pt = [
          gateCenter[0] - metersToUnits((gateSpanM / 2) * Math.cos(perpA)),
          gateCenter[1] - metersToUnits((gateSpanM / 2) * Math.sin(perpA)),
        ];

        const gt1: DefensiveTower = { id: `tow_${settlement.id}_g_${r}_1`, center: t1Pos, radiusM: 3.8, heightM: 14.0, isGateTower: true };
        const gt2: DefensiveTower = { id: `tow_${settlement.id}_g_${r}_2`, center: t2Pos, radiusM: 3.8, heightM: 14.0, isGateTower: true };
        towers.push(gt1, gt2);

        gates.push({
          id: `gate_${settlement.id}_${r}`,
          center: gateCenter,
          roadAngleRad: a1,
          widthM: gateSpanM,
          depthM: 8.0,
          towers: [gt1, gt2],
        });

        // Curtain wall arc between gate r and gate nextR
        const arcSteps = 3;
        const wallArcPts: Pt[] = [t1Pos];
        for (let s = 1; s < arcSteps; s++) {
          const interpA = a1 + ((a2 - a1 + Math.PI * 2) % (Math.PI * 2)) * (s / arcSteps);
          const midPt: Pt = [
            center[0] + wallRadiusUnits * Math.cos(interpA),
            center[1] + wallRadiusUnits * Math.sin(interpA),
          ];
          const midTower: DefensiveTower = {
            id: `tow_${settlement.id}_wall_${r}_${s}`,
            center: midPt,
            radiusM: 3.2,
            heightM: 12.0,
          };
          towers.push(midTower);
          wallArcPts.push(midPt);
        }
        const nextGateLeftTower = [
          center[0] + wallRadiusUnits * Math.cos(a2) - metersToUnits((gateSpanM / 2) * Math.sin(a2)),
          center[1] + wallRadiusUnits * Math.sin(a2) + metersToUnits((gateSpanM / 2) * Math.cos(a2)),
        ] as Pt;
        wallArcPts.push(nextGateLeftTower);

        curtainWallSegments.push(wallArcPts);
      }

      defense = {
        curtainWalls: curtainWallSegments,
        wallThicknessM: settlement.tier === "metropolis" ? 4.2 : 3.2,
        towers,
        gates,
        hasMoat: settlement.tier === "city" || settlement.tier === "metropolis",
      };
    }

    // Inside walls: Patrician Manors & Common Artisans
    const manorCount = settlement.tier === "metropolis" ? 8 : settlement.tier === "city" ? 5 : 2;
    for (let m = 0; m < manorCount; m++) {
      const mA = primaryAngle + 0.6 + m * 0.55;
      const mDistM = range(rng, radiusM * 0.25, radiusM * 0.48);
      const mCenter: Pt = [
        center[0] + metersToUnits(mDistM * Math.cos(mA)),
        center[1] + metersToUnits(mDistM * Math.sin(mA)),
      ];
      const mDim = BUILDING_DIMENSIONS.manor;
      const manorBld = createBuildingFootprint(
        `bld_${settlement.id}_manor_${++buildingIdCounter}`,
        "manor",
        mCenter,
        range(rng, mDim.lengthRangeM[0], mDim.lengthRangeM[1]),
        range(rng, mDim.widthRangeM[0], mDim.widthRangeM[1]),
        range(rng, mDim.heightRangeM[0], mDim.heightRangeM[1]),
        mDim.stories, "hip",
        resolveRoofMaterial(biomeType, settlement.tier, "manor"),
        mA, mDim.defaultPitchDeg * pitchMult
      );
      rawBuildings.push(manorBld);

      const estatePoly = createParcelPolygon(mCenter, 24, 28, mA);
      parcels.push({
        id: `pcl_${settlement.id}_manor_${m}`,
        boundary: estatePoly,
        landUse: "mansion_estate",
        areaM2: 24 * 28,
        buildingIds: [manorBld.id],
        fences: generateEnclosureFences(estatePoly, 6.0),
        fillColor: "rgba(100, 155, 90, 0.22)",
      });
    }

    // Common Artisan Burgage blocks
    const artisanCount = settlement.tier === "metropolis" ? 45 : settlement.tier === "city" ? 28 : 14;
    for (let a = 0; a < artisanCount; a++) {
      const rIdx = a % radialCount;
      const baseA = radialAngles[rIdx];
      const side = a % 2 === 0 ? 1 : -1;
      const dM = range(rng, radiusM * 0.22, radiusM * 0.48);
      const perpA = baseA + side * (Math.PI / 2);
      const setbackM = (profile.primaryStreetWidthM / 2) + 12;
      const aCenter: Pt = [
        center[0] + metersToUnits(dM * Math.cos(baseA) + setbackM * Math.cos(perpA)),
        center[1] + metersToUnits(dM * Math.sin(baseA) + setbackM * Math.sin(perpA)),
      ];
      const func: BuildingFunction = a % 6 === 0 ? "blacksmith" : a % 4 === 0 ? "storehouse" : "cottage";
      const dim = BUILDING_DIMENSIONS[func];
      const aBld = createBuildingFootprint(
        `bld_${settlement.id}_artisan_${++buildingIdCounter}`,
        func,
        aCenter,
        range(rng, dim.lengthRangeM[0], dim.lengthRangeM[1]),
        range(rng, dim.widthRangeM[0], dim.widthRangeM[1]),
        range(rng, dim.heightRangeM[0], dim.heightRangeM[1]),
        dim.stories, dim.roofType,
        resolveRoofMaterial(biomeType, settlement.tier, func),
        baseA, dim.defaultPitchDeg * pitchMult
      );
      rawBuildings.push(aBld);
    }
  }

  // =========================================================================
  // ARCHETYPE 2: LINEAR RIBBON (Runions Roadside Hamlets & Strip Crofts)
  // =========================================================================
  else if (morphology === "linear_ribbon") {
    const spineLengthM = radiusM * 1.8;
    const spineHalfUnits = metersToUnits(spineLengthM / 2);
    const spineStart: Pt = [
      center[0] - spineHalfUnits * Math.cos(primaryAngle),
      center[1] - spineHalfUnits * Math.sin(primaryAngle),
    ];
    const spineEnd: Pt = [
      center[0] + spineHalfUnits * Math.cos(primaryAngle),
      center[1] + spineHalfUnits * Math.sin(primaryAngle),
    ];

    streets.push({
      id: `str_${settlement.id}_spine`,
      kind: "spine",
      surface: profile.streetSurface,
      widthM: profile.primaryStreetWidthM,
      points: [spineStart, spineEnd],
    });

    // Roadside Town Well at the center
    const wellBuilding = createBuildingFootprint(
      `bld_${settlement.id}_well`,
      "well",
      center,
      4.0, 4.0, 2.5, 1,
      "thatched_round",
      resolveRoofMaterial(biomeType, settlement.tier, "well"),
      primaryAngle, 26
    );
    rawBuildings.push(wellBuilding);

    // Roadside Coaching Inn & Chapel fronting the highway
    const perpAngle = primaryAngle + Math.PI / 2;
    const innCenter: Pt = [
      center[0] + metersToUnits(14 * Math.cos(perpAngle)),
      center[1] + metersToUnits(14 * Math.sin(perpAngle)),
    ];
    const innDim = BUILDING_DIMENSIONS.inn;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_inn`,
      "inn",
      innCenter,
      range(rng, innDim.lengthRangeM[0], innDim.lengthRangeM[1]),
      range(rng, innDim.widthRangeM[0], innDim.widthRangeM[1]),
      range(rng, innDim.heightRangeM[0], innDim.heightRangeM[1]),
      innDim.stories, innDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "inn"),
      primaryAngle, innDim.defaultPitchDeg * pitchMult
    ));

    const chapelCenter: Pt = [
      center[0] - metersToUnits(14 * Math.cos(perpAngle)),
      center[1] - metersToUnits(14 * Math.sin(perpAngle)),
    ];
    const chDim = BUILDING_DIMENSIONS.chapel;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_chapel`,
      "chapel",
      chapelCenter,
      range(rng, chDim.lengthRangeM[0], chDim.lengthRangeM[1]),
      range(rng, chDim.widthRangeM[0], chDim.widthRangeM[1]),
      range(rng, chDim.heightRangeM[0], chDim.heightRangeM[1]),
      chDim.stories, chDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "chapel"),
      primaryAngle, chDim.defaultPitchDeg * pitchMult
    ));

    // Roadside Strip Cottages & Deep Agricultural Strip Crofts
    const cottageCount = settlement.tier === "hamlet" ? 10 : 6;
    for (let c = 0; c < cottageCount; c++) {
      const side = c % 2 === 0 ? 1 : -1;
      const t = (Math.floor(c / 2) + 1) / (cottageCount / 2 + 1);
      const roadOffsetM = (t - 0.5) * (spineLengthM * 0.75);
      const setbackM = (profile.primaryStreetWidthM / 2) + 10;

      const cCenter: Pt = [
        center[0] + metersToUnits(roadOffsetM * Math.cos(primaryAngle) + side * setbackM * Math.cos(perpAngle)),
        center[1] + metersToUnits(roadOffsetM * Math.sin(primaryAngle) + side * setbackM * Math.sin(perpAngle)),
      ];

      const cFunc: BuildingFunction = c === 1 ? "blacksmith" : "cottage";
      const dim = BUILDING_DIMENSIONS[cFunc];
      const cotBld = createBuildingFootprint(
        `bld_${settlement.id}_ribbon_${++buildingIdCounter}`,
        cFunc,
        cCenter,
        range(rng, dim.lengthRangeM[0], dim.lengthRangeM[1]),
        range(rng, dim.widthRangeM[0], dim.widthRangeM[1]),
        range(rng, dim.heightRangeM[0], dim.heightRangeM[1]),
        dim.stories, dim.roofType,
        resolveRoofMaterial(biomeType, settlement.tier, cFunc),
        primaryAngle, dim.defaultPitchDeg * pitchMult
      );
      rawBuildings.push(cotBld);

      // Deep perpendicular strip croft parcel behind cottage
      const croftWidthM = 16;
      const croftDepthM = 48;
      const croftCenter: Pt = [
        cCenter[0] + metersToUnits(side * (croftDepthM / 2 + 6) * Math.cos(perpAngle)),
        cCenter[1] + metersToUnits(side * (croftDepthM / 2 + 6) * Math.sin(perpAngle)),
      ];
      const croftPoly = createParcelPolygon(croftCenter, croftWidthM, croftDepthM, primaryAngle);
      parcels.push({
        id: `pcl_${settlement.id}_croft_${c}`,
        boundary: croftPoly,
        landUse: "strip_croft",
        areaM2: croftWidthM * croftDepthM,
        buildingIds: [cotBld.id],
        cropType: c % 2 === 0 ? "wheat" : "vegetables",
        furrows: generateCropFurrows(croftPoly, 4.0),
        fillColor: c % 2 === 0 ? "rgba(225, 195, 115, 0.25)" : "rgba(135, 165, 85, 0.22)",
      });
    }
  }

  // =========================================================================
  // ARCHETYPE 3: WATERFRONT PORT (Chen Coastal & Quayside Conformance)
  // =========================================================================
  else if (morphology === "waterfront_port") {
    const water = detectNearbyWaterBody(geo, center);
    const quayAngle = water.hasWater ? water.tangentAngle : primaryAngle;
    const inlandPerpAngle = quayAngle + Math.PI / 2;

    const quayLengthM = radiusM * 1.35;
    const halfQuayUnits = metersToUnits(quayLengthM / 2);
    const quayStart: Pt = [
      center[0] - halfQuayUnits * Math.cos(quayAngle),
      center[1] - halfQuayUnits * Math.sin(quayAngle),
    ];
    const quayEnd: Pt = [
      center[0] + halfQuayUnits * Math.cos(quayAngle),
      center[1] + halfQuayUnits * Math.sin(quayAngle),
    ];

    const quayStreet: StreetSegment = {
      id: `str_${settlement.id}_quayside`,
      kind: "waterfront",
      surface: "paved_stone",
      widthM: profile.primaryStreetWidthM + 2.0,
      points: [quayStart, quayEnd],
    };
    streets.push(quayStreet);

    // Wooden Piers extending into water
    const pierCount = settlement.tier === "city" ? 4 : settlement.tier === "town" ? 3 : 2;
    const piers: WaterfrontPier[] = [];
    for (let p = 0; p < pierCount; p++) {
      const frac = (p + 1) / (pierCount + 1);
      const rootM = (frac - 0.5) * quayLengthM * 0.75;
      const rootPos: Pt = [
        center[0] + metersToUnits(rootM * Math.cos(quayAngle)),
        center[1] + metersToUnits(rootM * Math.sin(quayAngle)),
      ];
      const pierLenM = range(rng, 26, 42);
      const waterPerpAngle = inlandPerpAngle + Math.PI; // jut into water
      const tipPos: Pt = [
        rootPos[0] + metersToUnits(pierLenM * Math.cos(waterPerpAngle)),
        rootPos[1] + metersToUnits(pierLenM * Math.sin(waterPerpAngle)),
      ];
      piers.push({
        id: `pier_${settlement.id}_${p}`,
        start: rootPos,
        end: tipPos,
        widthM: 4.5,
        lengthM: pierLenM,
      });
    }

    waterfront = {
      quayStreetId: quayStreet.id,
      waterEdgePolyline: [quayStart, quayEnd],
      piers,
      quaysideWidthM: quayStreet.widthM,
    };

    // Public Town Well along the quayside square
    const wellBuilding = createBuildingFootprint(
      `bld_${settlement.id}_well`,
      "well",
      center,
      4.0, 4.0, 2.5, 1,
      "thatched_round",
      resolveRoofMaterial(biomeType, settlement.tier, "well"),
      quayAngle, 26
    );
    rawBuildings.push(wellBuilding);

    // Waterfront Wharf Tavern & Storehouses
    const tavernCenter: Pt = [
      center[0] + metersToUnits(16 * Math.cos(inlandPerpAngle) + 20 * Math.cos(quayAngle)),
      center[1] + metersToUnits(16 * Math.sin(inlandPerpAngle) + 20 * Math.sin(quayAngle)),
    ];
    const tvDim = BUILDING_DIMENSIONS.tavern;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_tavern`,
      "tavern",
      tavernCenter,
      range(rng, tvDim.lengthRangeM[0], tvDim.lengthRangeM[1]),
      range(rng, tvDim.widthRangeM[0], tvDim.widthRangeM[1]),
      range(rng, tvDim.heightRangeM[0], tvDim.heightRangeM[1]),
      tvDim.stories, tvDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "tavern"),
      quayAngle, tvDim.defaultPitchDeg * pitchMult
    ));

    // Storehouses and Fish Market
    for (let s = 0; s < 3; s++) {
      const sPos: Pt = [
        center[0] + metersToUnits(16 * Math.cos(inlandPerpAngle) - (18 + s * 22) * Math.cos(quayAngle)),
        center[1] + metersToUnits(16 * Math.sin(inlandPerpAngle) - (18 + s * 22) * Math.sin(quayAngle)),
      ];
      const stDim = BUILDING_DIMENSIONS.storehouse;
      rawBuildings.push(createBuildingFootprint(
        `bld_${settlement.id}_wharf_store_${s}`,
        "storehouse",
        sPos,
        range(rng, stDim.lengthRangeM[0], stDim.lengthRangeM[1]),
        range(rng, stDim.widthRangeM[0], stDim.widthRangeM[1]),
        range(rng, stDim.heightRangeM[0], stDim.heightRangeM[1]),
        stDim.stories, stDim.roofType,
        "timber",
        quayAngle, stDim.defaultPitchDeg * pitchMult
      ));
    }

    // Inland Upper Tier (Residential & Temple)
    const upperStreetDistM = 36;
    const upperStart: Pt = [
      quayStart[0] + metersToUnits(upperStreetDistM * Math.cos(inlandPerpAngle)),
      quayStart[1] + metersToUnits(upperStreetDistM * Math.sin(inlandPerpAngle)),
    ];
    const upperEnd: Pt = [
      quayEnd[0] + metersToUnits(upperStreetDistM * Math.cos(inlandPerpAngle)),
      quayEnd[1] + metersToUnits(upperStreetDistM * Math.sin(inlandPerpAngle)),
    ];
    streets.push({
      id: `str_${settlement.id}_upper_lane`,
      kind: "lane",
      surface: "cobblestone",
      widthM: profile.secondaryStreetWidthM,
      points: [upperStart, upperEnd],
    });

    const templePos: Pt = [
      center[0] + metersToUnits(46 * Math.cos(inlandPerpAngle)),
      center[1] + metersToUnits(46 * Math.sin(inlandPerpAngle)),
    ];
    const tmpDim = BUILDING_DIMENSIONS.temple;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_temple`,
      "temple",
      templePos,
      range(rng, tmpDim.lengthRangeM[0], tmpDim.lengthRangeM[1]),
      range(rng, tmpDim.widthRangeM[0], tmpDim.widthRangeM[1]),
      range(rng, tmpDim.heightRangeM[0], tmpDim.heightRangeM[1]),
      tmpDim.stories, tmpDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "temple"),
      quayAngle, tmpDim.defaultPitchDeg * pitchMult
    ));

    const portCottageCount = settlement.tier === "city" ? 18 : 8;
    for (let c = 0; c < portCottageCount; c++) {
      const xOffM = (c - portCottageCount / 2) * 16;
      const cPos: Pt = [
        center[0] + metersToUnits(upperStreetDistM * Math.cos(inlandPerpAngle) + xOffM * Math.cos(quayAngle)),
        center[1] + metersToUnits(upperStreetDistM * Math.sin(inlandPerpAngle) + xOffM * Math.sin(quayAngle)),
      ];
      const ctDim = BUILDING_DIMENSIONS.cottage;
      rawBuildings.push(createBuildingFootprint(
        `bld_${settlement.id}_port_cot_${++buildingIdCounter}`,
        "cottage",
        cPos,
        range(rng, ctDim.lengthRangeM[0], ctDim.lengthRangeM[1]),
        range(rng, ctDim.widthRangeM[0], ctDim.widthRangeM[1]),
        range(rng, ctDim.heightRangeM[0], ctDim.heightRangeM[1]),
        1, "gable",
        resolveRoofMaterial(biomeType, settlement.tier, "cottage"),
        quayAngle, ctDim.defaultPitchDeg * pitchMult
      ));
    }
  }

  // =========================================================================
  // ARCHETYPE 4: CROSSROADS MARKET (Agricultural Village Green)
  // =========================================================================
  else {
    const marketRadiusM = 32;
    const halfLenUnits = metersToUnits(marketRadiusM);
    const greenPts: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      const a = primaryAngle + (i * Math.PI) / 2;
      greenPts.push([
        center[0] + halfLenUnits * Math.cos(a),
        center[1] + halfLenUnits * Math.sin(a),
      ]);
    }
    marketSquare = greenPts;

    parcels.push({
      id: `pcl_${settlement.id}_market_green`,
      boundary: greenPts,
      landUse: "plaza",
      areaM2: marketRadiusM * marketRadiusM * 2,
      buildingIds: [],
      fillColor: "rgba(165, 185, 130, 0.24)",
    });

    streets.push({
      id: `str_${settlement.id}_green_perimeter`,
      kind: "plaza",
      surface: "gravel",
      widthM: profile.primaryStreetWidthM,
      points: [...greenPts, greenPts[0]],
    });

    // Town Well at center
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_well`,
      "well",
      center,
      4.0, 4.0, 2.5, 1,
      "thatched_round",
      resolveRoofMaterial(biomeType, settlement.tier, "well"),
      primaryAngle, 26
    ));

    // Coaching Inn & Smithy
    const innPos: Pt = [
      center[0] + metersToUnits((marketRadiusM + 12) * Math.cos(primaryAngle)),
      center[1] + metersToUnits((marketRadiusM + 12) * Math.sin(primaryAngle)),
    ];
    const innDim = BUILDING_DIMENSIONS.inn;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_inn`,
      "inn",
      innPos,
      range(rng, innDim.lengthRangeM[0], innDim.lengthRangeM[1]),
      range(rng, innDim.widthRangeM[0], innDim.widthRangeM[1]),
      range(rng, innDim.heightRangeM[0], innDim.heightRangeM[1]),
      innDim.stories, innDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, "inn"),
      primaryAngle + Math.PI / 2, innDim.defaultPitchDeg * pitchMult
    ));

    const smithPos: Pt = [
      center[0] - metersToUnits((marketRadiusM + 12) * Math.cos(primaryAngle)),
      center[1] - metersToUnits((marketRadiusM + 12) * Math.sin(primaryAngle)),
    ];
    const smDim = BUILDING_DIMENSIONS.blacksmith;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_smith`,
      "blacksmith",
      smithPos,
      range(rng, smDim.lengthRangeM[0], smDim.lengthRangeM[1]),
      range(rng, smDim.widthRangeM[0], smDim.widthRangeM[1]),
      range(rng, smDim.heightRangeM[0], smDim.heightRangeM[1]),
      1, "gable",
      resolveRoofMaterial(biomeType, settlement.tier, "blacksmith"),
      primaryAngle + Math.PI / 2, smDim.defaultPitchDeg * pitchMult
    ));

    // 4 Converging Crossroads Arterials
    for (let r = 0; r < 4; r++) {
      const rA = primaryAngle + (r * Math.PI) / 2 + (rng() - 0.5) * 0.12;
      const roadLenM = radiusM * 1.1;
      const startPos: Pt = [
        center[0] + metersToUnits(marketRadiusM * Math.cos(rA)),
        center[1] + metersToUnits(marketRadiusM * Math.sin(rA)),
      ];
      const endPos: Pt = [
        center[0] + metersToUnits(roadLenM * Math.cos(rA)),
        center[1] + metersToUnits(roadLenM * Math.sin(rA)),
      ];
      streets.push({
        id: `str_${settlement.id}_cross_${r}`,
        kind: "arterial",
        surface: "dirt",
        widthM: profile.primaryStreetWidthM,
        points: [startPos, endPos],
      });
    }

    // Cottages clustering around crossroads
    for (let c = 0; c < 12; c++) {
      const a = primaryAngle + (c / 12) * Math.PI * 2 + 0.2;
      const dM = range(rng, marketRadiusM + 14, radiusM * 0.55);
      const cPos: Pt = [
        center[0] + metersToUnits(dM * Math.cos(a)),
        center[1] + metersToUnits(dM * Math.sin(a)),
      ];
      const cDim = BUILDING_DIMENSIONS.cottage;
      rawBuildings.push(createBuildingFootprint(
        `bld_${settlement.id}_cross_cot_${++buildingIdCounter}`,
        "cottage",
        cPos,
        range(rng, cDim.lengthRangeM[0], cDim.lengthRangeM[1]),
        range(rng, cDim.widthRangeM[0], cDim.widthRangeM[1]),
        range(rng, cDim.heightRangeM[0], cDim.heightRangeM[1]),
        1, "gable",
        resolveRoofMaterial(biomeType, settlement.tier, "cottage"),
        a, cDim.defaultPitchDeg * pitchMult
      ));
    }
  }

  // =========================================================================
  // UNIVERSAL GREENBELT (Outer Ring: Working Farms, Cattle Ranches & Mills)
  // Shared across all archetypes to guarantee agricultural livelihood
  // =========================================================================
  const farmCount = settlement.tier === "nomadic" ? 2 : settlement.tier === "hamlet" ? 3 : settlement.tier === "village" ? 6 : 10;
  const cropTypes: ("wheat" | "barley" | "vegetables" | "pasture" | "fallow")[] = [
    "wheat", "barley", "vegetables", "pasture", "fallow",
  ];

  for (let f = 0; f < farmCount; f++) {
    const fAngle = primaryAngle + ((f + 0.5) / farmCount) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const fDistM = range(rng, radiusM * 0.68, radiusM * 0.98);
    const fCenter: Pt = [
      center[0] + metersToUnits(fDistM * Math.cos(fAngle)),
      center[1] + metersToUnits(fDistM * Math.sin(fAngle)),
    ];

    const fieldW = range(rng, 42, 65);
    const fieldL = range(rng, 50, 78);
    const fieldPoly = createParcelPolygon(fCenter, fieldW, fieldL, fAngle);
    const cType = cropTypes[f % cropTypes.length];

    const fhDim = BUILDING_DIMENSIONS.farmhouse;
    const fhPos: Pt = [
      fCenter[0] - metersToUnits(fieldL * 0.3 * Math.cos(fAngle)),
      fCenter[1] - metersToUnits(fieldL * 0.3 * Math.sin(fAngle)),
    ];
    const fhBld = createBuildingFootprint(
      `bld_${settlement.id}_farmhouse_${++buildingIdCounter}`,
      "farmhouse",
      fhPos,
      range(rng, fhDim.lengthRangeM[0], fhDim.lengthRangeM[1]),
      range(rng, fhDim.widthRangeM[0], fhDim.widthRangeM[1]),
      range(rng, fhDim.heightRangeM[0], fhDim.heightRangeM[1]),
      2, "gable",
      resolveRoofMaterial(biomeType, settlement.tier, "farmhouse"),
      fAngle, fhDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(fhBld);

    const bDim = BUILDING_DIMENSIONS.barn;
    const bPos: Pt = [
      fhPos[0] + metersToUnits(15 * Math.sin(fAngle)),
      fhPos[1] - metersToUnits(15 * Math.cos(fAngle)),
    ];
    const barnBld = createBuildingFootprint(
      `bld_${settlement.id}_barn_${++buildingIdCounter}`,
      "barn",
      bPos,
      range(rng, bDim.lengthRangeM[0], bDim.lengthRangeM[1]),
      range(rng, bDim.widthRangeM[0], bDim.widthRangeM[1]),
      range(rng, bDim.heightRangeM[0], bDim.heightRangeM[1]),
      1, "gable",
      "timber",
      fAngle, bDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(barnBld);

    parcels.push({
      id: `pcl_${settlement.id}_farm_${f}`,
      boundary: fieldPoly,
      landUse: "farm_field",
      areaM2: fieldW * fieldL,
      buildingIds: [fhBld.id, barnBld.id],
      cropType: cType,
      furrows: generateCropFurrows(fieldPoly, 4.5),
      fences: generateEnclosureFences(fieldPoly, 7.0),
      fillColor:
        cType === "wheat"
          ? "rgba(225, 195, 115, 0.28)"
          : cType === "barley"
          ? "rgba(210, 180, 105, 0.26)"
          : cType === "vegetables"
          ? "rgba(135, 165, 85, 0.25)"
          : "rgba(150, 130, 105, 0.22)",
    });
  }

  // Cattle Ranches
  const ranchCount = settlement.tier === "nomadic" ? 1 : settlement.tier === "hamlet" ? 2 : settlement.tier === "village" ? 3 : 5;
  for (let c = 0; c < ranchCount; c++) {
    const cAngle = primaryAngle + ((c + 0.25) / ranchCount) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const cDistM = range(rng, radiusM * 0.70, radiusM * 0.95);
    const rCenter: Pt = [
      center[0] + metersToUnits(cDistM * Math.cos(cAngle)),
      center[1] + metersToUnits(cDistM * Math.sin(cAngle)),
    ];

    const ranchW = range(rng, 48, 70);
    const ranchL = range(rng, 55, 80);
    const ranchPoly = createParcelPolygon(rCenter, ranchW, ranchL, cAngle);

    const csDim = BUILDING_DIMENSIONS.cattle_shed;
    const csCenter: Pt = [
      rCenter[0] + metersToUnits(ranchW * 0.25 * Math.cos(cAngle + Math.PI / 2)),
      rCenter[1] + metersToUnits(ranchW * 0.25 * Math.sin(cAngle + Math.PI / 2)),
    ];
    const csBld = createBuildingFootprint(
      `bld_${settlement.id}_cattle_shed_${++buildingIdCounter}`,
      "cattle_shed",
      csCenter,
      range(rng, csDim.lengthRangeM[0], csDim.lengthRangeM[1]),
      range(rng, csDim.widthRangeM[0], csDim.widthRangeM[1]),
      range(rng, csDim.heightRangeM[0], csDim.heightRangeM[1]),
      1, "gable",
      "timber",
      cAngle, csDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(csBld);

    parcels.push({
      id: `pcl_${settlement.id}_ranch_${c}`,
      boundary: ranchPoly,
      landUse: "cattle_ranch",
      areaM2: ranchW * ranchL,
      buildingIds: [csBld.id],
      fences: generateEnclosureFences(ranchPoly, 8.0),
      fillColor: "rgba(120, 180, 95, 0.28)",
    });
  }

  // Windmill on knoll
  if (settlement.tier !== "nomadic") {
    const wmAngle = primaryAngle + 2.1;
    const wmDistM = radiusM * 0.88;
    const wmCenter: Pt = [
      center[0] + metersToUnits(wmDistM * Math.cos(wmAngle)),
      center[1] + metersToUnits(wmDistM * Math.sin(wmAngle)),
    ];
    const wmDim = BUILDING_DIMENSIONS.windmill;
    rawBuildings.push(createBuildingFootprint(
      `bld_${settlement.id}_windmill`,
      "windmill",
      wmCenter,
      range(rng, wmDim.lengthRangeM[0], wmDim.lengthRangeM[1]),
      range(rng, wmDim.widthRangeM[0], wmDim.widthRangeM[1]),
      range(rng, wmDim.heightRangeM[0], wmDim.heightRangeM[1]),
      3, "tower_conical",
      "cedar_shingle",
      wmAngle, wmDim.defaultPitchDeg * pitchMult
    ));
  }

  // Watermill adjacent to civic pond
  const wmWaterCenter: Pt = [
    pondCenter[0] + metersToUnits((pondRadiusM + 8) * Math.cos(pondAngle)),
    pondCenter[1] + metersToUnits((pondRadiusM + 8) * Math.sin(pondAngle)),
  ];
  const wmWaterDim = BUILDING_DIMENSIONS.watermill;
  rawBuildings.push(createBuildingFootprint(
    `bld_${settlement.id}_watermill`,
    "watermill",
    wmWaterCenter,
    range(rng, wmWaterDim.lengthRangeM[0], wmWaterDim.lengthRangeM[1]),
    range(rng, wmWaterDim.widthRangeM[0], wmWaterDim.widthRangeM[1]),
    range(rng, wmWaterDim.heightRangeM[0], wmWaterDim.heightRangeM[1]),
    2, "gable",
    "timber",
    pondAngle + Math.PI / 2, wmWaterDim.defaultPitchDeg * pitchMult
  ));

  // =========================================================================
  // SOCIO-ECONOMIC ESTABLISHMENTS GENERATION (Eigengrau / Ross model)
  // =========================================================================
  const establishments = generateSettlementEstablishments(
    settlement.id,
    settlement.name,
    settlement.tier,
    rawBuildings,
    geo,
    center,
    seedString
  );

  // =========================================================================
  // FINETUNE STAGE (Spatial Relaxation, Clearance & Collision Resolution)
  // =========================================================================
  const rawVerification = verifyCadastre(rawBuildings, streets, center, radiusUnits, geo, settlement.name);

  const tFinetuneStart = performance.now();
  const finetunedBuildings = runCadastreFinetune(
    rawBuildings,
    streets,
    geo,
    center,
    radiusUnits,
    civicWell.center,
    civicPond
  );
  const finetuneMs = Math.round(performance.now() - tFinetuneStart);

  const afterVerification = verifyCadastre(finetunedBuildings, streets, center, radiusUnits, geo, settlement.name);

  // =========================================================================
  // STATS SUMMARY
  // =========================================================================
  let totalRoofAreaM2 = 0;
  let totalStreetLengthM = 0;
  let residentialCount = 0;
  const matCounts: Record<RoofMaterial, number> = {
    thatch: 0, slate: 0, terracotta: 0, cedar_shingle: 0, copper_verdigris: 0, timber: 0,
  };

  for (const b of finetunedBuildings) {
    totalRoofAreaM2 += b.widthM * b.lengthM;
    matCounts[b.roofMaterial] = (matCounts[b.roofMaterial] || 0) + 1;
    if (b.buildingType === "cottage" || b.buildingType === "farmhouse" || b.buildingType === "hovel" || b.buildingType === "manor") {
      residentialCount++;
    }
  }

  for (const str of streets) {
    for (let i = 0; i < str.points.length - 1; i++) {
      totalStreetLengthM +=
        Math.hypot(str.points[i + 1][0] - str.points[i][0], str.points[i + 1][1] - str.points[i][1]) * 5560;
    }
  }

  let predominantRoof: RoofMaterial = "thatch";
  let maxRoofMatCount = -1;
  for (const [mat, count] of Object.entries(matCounts) as [RoofMaterial, number][]) {
    if (count > maxRoofMatCount) {
      maxRoofMatCount = count;
      predominantRoof = mat;
    }
  }

  const generationMs = Math.round(performance.now() - t0);

  return {
    settlementId: settlement.id,
    settlementName: settlement.name,
    tier: settlement.tier,
    type: settlement.type,
    morphology,
    center,
    radiusUnits,
    radiusM: Math.round(radiusM),
    streets,
    parcels,
    buildings: finetunedBuildings,
    civicWell,
    civicPond,
    marketSquare,
    defense,
    waterfront,
    establishments,
    rawBuildingCount: rawBuildings.length,
    stats: {
      totalBuildings: finetunedBuildings.length,
      residentialBuildings: residentialCount,
      totalRoofAreaM2: Math.round(totalRoofAreaM2),
      totalStreetLengthM: Math.round(totalStreetLengthM),
      parcelCount: parcels.length,
      predominantRoof,
      averagePitch: Math.round(45 * pitchMult),
      generationMs,
      finetuneMs,
    },
    verificationBefore: rawVerification,
    verificationAfter: afterVerification,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helper: Create single building footprint, roof facets, and ground shadow
// ---------------------------------------------------------------------------
export function createBuildingFootprint(
  id: string,
  buildingType: BuildingFunction,
  center: Pt,
  lengthM: number,
  widthM: number,
  heightM: number,
  stories: number,
  roofType: RoofType,
  roofMaterial: RoofMaterial,
  angleRad: number,
  pitchDeg: number,
  establishment?: EstablishmentInfo
): BuildingFootprint {
  const halfLenUnits = metersToUnits(lengthM / 2);
  const halfWidUnits = metersToUnits(widthM / 2);

  const cornersLocal: Pt[] = [
    [-halfLenUnits, -halfWidUnits],
    [halfLenUnits, -halfWidUnits],
    [halfLenUnits, halfWidUnits],
    [-halfLenUnits, halfWidUnits],
  ];

  const footprint: Pt[] = cornersLocal.map((c) => {
    const rx = c[0] * Math.cos(angleRad) - c[1] * Math.sin(angleRad);
    const ry = c[0] * Math.sin(angleRad) + c[1] * Math.cos(angleRad);
    return [center[0] + rx, center[1] + ry];
  });

  const ridgeStart: Pt = [
    center[0] - halfLenUnits * Math.cos(angleRad),
    center[1] - halfLenUnits * Math.sin(angleRad),
  ];
  const ridgeEnd: Pt = [
    center[0] + halfLenUnits * Math.cos(angleRad),
    center[1] + halfLenUnits * Math.sin(angleRad),
  ];

  const palette = ROOF_MATERIAL_PALETTES[roofMaterial] ?? ROOF_MATERIAL_PALETTES.thatch;
  const facets: RoofFacet[] = [];

  const slope1Angle = angleRad - Math.PI / 2;
  const sunExp1 = computeSunExposure(slope1Angle, pitchDeg);
  facets.push({
    polygon: [ridgeStart, ridgeEnd, footprint[1], footprint[0]],
    normal: [Math.cos(slope1Angle), Math.sin(slope1Angle), Math.cos((pitchDeg * Math.PI) / 180)],
    pitchDegrees: pitchDeg,
    sunExposure: sunExp1,
    color: sunExp1 > 0.55 ? palette.sunlitHex : palette.shadedHex,
  });

  const slope2Angle = angleRad + Math.PI / 2;
  const sunExp2 = computeSunExposure(slope2Angle, pitchDeg);
  facets.push({
    polygon: [ridgeStart, ridgeEnd, footprint[2], footprint[3]],
    normal: [Math.cos(slope2Angle), Math.sin(slope2Angle), Math.cos((pitchDeg * Math.PI) / 180)],
    pitchDegrees: pitchDeg,
    sunExposure: sunExp2,
    color: sunExp2 > 0.55 ? palette.sunlitHex : palette.shadedHex,
  });

  const shadowDistUnits = metersToUnits(heightM * 0.95);
  const shadowAzimuthRad = (135 * Math.PI) / 180;
  const sOffset: Pt = [
    shadowDistUnits * Math.cos(shadowAzimuthRad),
    shadowDistUnits * Math.sin(shadowAzimuthRad),
  ];

  const shadowPolygon: Pt[] = [
    footprint[0],
    footprint[1],
    [footprint[1][0] + sOffset[0], footprint[1][1] + sOffset[1]],
    [footprint[2][0] + sOffset[0], footprint[2][1] + sOffset[1]],
    footprint[2],
    footprint[3],
  ];

  const chimneys: Pt[] = [];
  if (stories > 0 && buildingType !== "market_stall" && buildingType !== "well") {
    const chimCount = buildingType === "manor" ? 3 : buildingType === "inn" ? 2 : 1;
    for (let c = 0; c < chimCount; c++) {
      const chimOff = halfLenUnits * (0.6 - c * 0.4);
      chimneys.push([
        center[0] + chimOff * Math.cos(angleRad),
        center[1] + chimOff * Math.sin(angleRad),
      ]);
    }
  }

  return {
    id,
    buildingType,
    center,
    footprint,
    shadowPolygon,
    widthM,
    lengthM,
    heightM,
    stories,
    ridgeLine: [ridgeStart, ridgeEnd],
    roofType,
    roofMaterial,
    facets,
    chimneys,
    orientationRad: angleRad,
    establishment,
  };
}

export function createParcelPolygon(center: Pt, frontageM: number, depthM: number, angleRad: number): Pt[] {
  const hFront = metersToUnits(frontageM / 2);
  const hDepth = metersToUnits(depthM / 2);

  const localPts: Pt[] = [
    [-hFront, -hDepth],
    [hFront, -hDepth],
    [hFront, hDepth],
    [-hFront, hDepth],
  ];

  return localPts.map((p) => {
    const rx = p[0] * Math.cos(angleRad) - p[1] * Math.sin(angleRad);
    const ry = p[0] * Math.sin(angleRad) + p[1] * Math.cos(angleRad);
    return [center[0] + rx, center[1] + ry];
  });
}
