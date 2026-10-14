import type { GeneratedRegion, Pt } from "../types";
import type { Settlement } from "../human/human-types";
import type { ZonePopulation } from "../population/population-types";
import type {
  BuildingFootprint,
  BuildingFunction,
  CadastreConfig,
  Parcel,
  RoofFacet,
  RoofMaterial,
  RoofType,
  SettlementCadastre,
  StreetSegment,
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
  // Find bounding box
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

  // Run furrows along the longer axis
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
  // Return boundary perimeter edges with an opening on the street-facing side
  const segments: Pt[][] = [];
  const n = boundary.length;
  // Leave segment 0-1 open for the gate
  for (let i = 1; i < n; i++) {
    const nextIdx = (i + 1) % n;
    segments.push([boundary[i], boundary[nextIdx]]);
  }
  return segments;
}

/**
 * GENERATE STAGE — City / Village Micro-Urbanism Synthesizer
 *
 * Generates an unconstrained, highly structured settlement layout:
 *   1. Central Market Plaza with Public Town Well, Historic Inn, and Temple.
 *   2. Radial-concentric street network with market stalls and public lanes.
 *   3. Patrician Quarter with Gentry Mansions, private walled gardens & lawns.
 *   4. Artisan & Merchant Quarter along radial thoroughfares.
 *   5. Poor Quarter with crowded hovels and cottages along crooked alleys.
 *   6. Outer Agricultural Greenbelt:
 *      - Crop fields with parallel furrow striations.
 *      - Cattle ranches with wooden post-and-rail fences & livestock sheds.
 *      - Windmill on outer knolls / Watermill on millrace/stream.
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

  // Scale radius based on tier and optional population scale
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

  const streets: StreetSegment[] = [];
  const parcels: Parcel[] = [];
  const rawBuildings: BuildingFootprint[] = [];
  let buildingIdCounter = 0;

  const primaryAngle = rng() * Math.PI * 2; // Main axis angle

  // ---------------------------------------------------------------------------
  // 1. Central Market Plaza & Civic Heart
  // ---------------------------------------------------------------------------
  const plazaSizeMap: Record<string, [number, number]> = {
    nomadic: [20, 16],
    hamlet: [26, 20],
    village: [42, 32],
    town: [64, 48],
    city: [84, 64],
    metropolis: [110, 80],
  };
  const [plazaLenM, plazaWidM] = plazaSizeMap[settlement.tier] ?? [40, 30];
  const halfPlazaLenUnits = metersToUnits(plazaLenM / 2);
  const halfPlazaWidUnits = metersToUnits(plazaWidM / 2);

  // Four corners of the Market Plaza
  const plazaCornersLocal: Pt[] = [
    [-halfPlazaLenUnits, -halfPlazaWidUnits],
    [halfPlazaLenUnits, -halfPlazaWidUnits],
    [halfPlazaLenUnits, halfPlazaWidUnits],
    [-halfPlazaLenUnits, halfPlazaWidUnits],
  ];
  const marketSquare: Pt[] = plazaCornersLocal.map(([lx, ly]) => {
    const rx = lx * Math.cos(primaryAngle) - ly * Math.sin(primaryAngle);
    const ry = lx * Math.sin(primaryAngle) + ly * Math.cos(primaryAngle);
    return [center[0] + rx, center[1] + ry];
  });

  // Register Market Plaza parcel
  parcels.push({
    id: `pcl_${settlement.id}_plaza`,
    boundary: marketSquare,
    landUse: "plaza",
    areaM2: plazaLenM * plazaWidM,
    buildingIds: [],
    fillColor: "rgba(180, 165, 140, 0.22)",
  });

  // Plaza perimeter carriageway
  const plazaRingStreet: StreetSegment = {
    id: `str_${settlement.id}_plaza_ring`,
    kind: "plaza",
    surface: profile.streetSurface,
    widthM: profile.primaryStreetWidthM,
    points: [...marketSquare, marketSquare[0]],
  };
  streets.push(plazaRingStreet);

  // 1A. THE TOWN WELL (Center of the Market Plaza)
  const civicWell = {
    center,
    radiusM: 2.2,
  };
  const wellRoofMat = resolveRoofMaterial(biomeType, settlement.tier, "well");
  const wellBuilding = createBuildingFootprint(
    `bld_${settlement.id}_well`,
    "well",
    center,
    4.0,
    4.0,
    2.5,
    1,
    "thatched_round",
    wellRoofMat,
    primaryAngle,
    26
  );
  rawBuildings.push(wellBuilding);

  // 1B. THE INN (South edge of Plaza, facing inward)
  const innOffsetM = plazaWidM / 2 + 10;
  const innPerpAngle = primaryAngle + Math.PI / 2;
  const innCenter: Pt = [
    center[0] + metersToUnits(innOffsetM * Math.cos(innPerpAngle)),
    center[1] + metersToUnits(innOffsetM * Math.sin(innPerpAngle)),
  ];
  const innDim = BUILDING_DIMENSIONS.inn;
  const innLen = range(rng, innDim.lengthRangeM[0], innDim.lengthRangeM[1]);
  const innWid = range(rng, innDim.widthRangeM[0], innDim.widthRangeM[1]);
  const innBuilding = createBuildingFootprint(
    `bld_${settlement.id}_inn`,
    "inn",
    innCenter,
    innLen,
    innWid,
    range(rng, innDim.heightRangeM[0], innDim.heightRangeM[1]),
    innDim.stories,
    innDim.roofType,
    resolveRoofMaterial(biomeType, settlement.tier, "inn"),
    primaryAngle,
    innDim.defaultPitchDeg * pitchMult
  );
  rawBuildings.push(innBuilding);

  // Inn courtyard parcel
  parcels.push({
    id: `pcl_${settlement.id}_inn_yard`,
    boundary: createParcelPolygon(innCenter, innLen + 8, innWid + 12, primaryAngle),
    landUse: "inn_courtyard",
    areaM2: (innLen + 8) * (innWid + 12),
    buildingIds: [innBuilding.id],
    fillColor: "rgba(160, 140, 120, 0.16)",
  });

  // 1C. THE TEMPLE / SANCTUARY (North edge of Plaza)
  const templeFunc: BuildingFunction =
    settlement.tier === "metropolis" || settlement.tier === "city"
      ? "cathedral"
      : settlement.tier === "hamlet" || settlement.tier === "nomadic"
      ? "chapel"
      : "temple";
  const templeDim = BUILDING_DIMENSIONS[templeFunc];
  const templeOffsetM = -(plazaWidM / 2 + 12);
  const templeCenter: Pt = [
    center[0] + metersToUnits(templeOffsetM * Math.cos(innPerpAngle)),
    center[1] + metersToUnits(templeOffsetM * Math.sin(innPerpAngle)),
  ];
  const templeLen = range(rng, templeDim.lengthRangeM[0], templeDim.lengthRangeM[1]);
  const templeWid = range(rng, templeDim.widthRangeM[0], templeDim.widthRangeM[1]);
  const templeBuilding = createBuildingFootprint(
    `bld_${settlement.id}_temple`,
    templeFunc,
    templeCenter,
    templeLen,
    templeWid,
    range(rng, templeDim.heightRangeM[0], templeDim.heightRangeM[1]),
    templeDim.stories,
    templeDim.roofType,
    resolveRoofMaterial(biomeType, settlement.tier, templeFunc),
    primaryAngle + (Math.PI / 2), // East-West traditional altar alignment
    templeDim.defaultPitchDeg * pitchMult
  );
  rawBuildings.push(templeBuilding);

  // Temple precinct parcel
  parcels.push({
    id: `pcl_${settlement.id}_temple_precinct`,
    boundary: createParcelPolygon(templeCenter, templeLen + 10, templeWid + 12, primaryAngle + Math.PI / 2),
    landUse: "temple_precinct",
    areaM2: (templeLen + 10) * (templeWid + 12),
    buildingIds: [templeBuilding.id],
    fillColor: "rgba(130, 145, 130, 0.18)",
  });

  // 1D. TOWNHALL OR KEEP (West edge for town/city)
  if (settlement.tier === "town" || settlement.tier === "city" || settlement.tier === "metropolis") {
    const civicFunc: BuildingFunction = settlement.tier === "town" ? "townhall" : settlement.type === "fortress_city" ? "keep" : "townhall";
    const cDim = BUILDING_DIMENSIONS[civicFunc];
    const civicOffsetM = -(plazaLenM / 2 + 14);
    const civicCenter: Pt = [
      center[0] + metersToUnits(civicOffsetM * Math.cos(primaryAngle)),
      center[1] + metersToUnits(civicOffsetM * Math.sin(primaryAngle)),
    ];
    const cLen = range(rng, cDim.lengthRangeM[0], cDim.lengthRangeM[1]);
    const cWid = range(rng, cDim.widthRangeM[0], cDim.widthRangeM[1]);
    const civicBuilding = createBuildingFootprint(
      `bld_${settlement.id}_civic`,
      civicFunc,
      civicCenter,
      cLen,
      cWid,
      range(rng, cDim.heightRangeM[0], cDim.heightRangeM[1]),
      cDim.stories,
      cDim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, civicFunc),
      primaryAngle,
      cDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(civicBuilding);
  }

  // 1E. MARKET STALLS (Ringing the Plaza perimeter)
  const stallCount = settlement.tier === "hamlet" ? 4 : settlement.tier === "village" ? 8 : 14;
  for (let i = 0; i < stallCount; i++) {
    const t = (i + 0.5) / stallCount;
    const stallAngle = primaryAngle + t * Math.PI * 2;
    // Set 6m back from plaza boundary
    const stallDistM = Math.min(plazaLenM, plazaWidM) * 0.42;
    const sPos: Pt = [
      center[0] + metersToUnits(stallDistM * Math.cos(stallAngle)),
      center[1] + metersToUnits(stallDistM * Math.sin(stallAngle)),
    ];
    const stallDim = BUILDING_DIMENSIONS.market_stall;
    const stallBld = createBuildingFootprint(
      `bld_${settlement.id}_stall_${i}`,
      "market_stall",
      sPos,
      range(rng, stallDim.lengthRangeM[0], stallDim.lengthRangeM[1]),
      range(rng, stallDim.widthRangeM[0], stallDim.widthRangeM[1]),
      2.8,
      1,
      "gable",
      i % 2 === 0 ? "terracotta" : "thatch",
      stallAngle + Math.PI / 2,
      25
    );
    rawBuildings.push(stallBld);
  }

  // ---------------------------------------------------------------------------
  // 2. Radial-Concentric Street Network
  // ---------------------------------------------------------------------------
  const radialCount = settlement.tier === "nomadic" ? 3 : settlement.tier === "hamlet" ? 4 : settlement.tier === "village" ? 5 : 6;
  const radialAngles: number[] = [];
  const radialOuterPoints: Pt[] = [];

  for (let r = 0; r < radialCount; r++) {
    const rAngle = primaryAngle + (r / radialCount) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    radialAngles.push(rAngle);

    const roadLengthM = radiusM * 1.15;
    const steps = Math.max(4, Math.floor(roadLengthM / 35));
    const pts: Pt[] = [];

    // Start at edge of plaza
    const startM = Math.min(plazaLenM, plazaWidM) / 2;
    for (let s = 0; s <= steps; s++) {
      const dM = startM + ((roadLengthM - startM) * s) / steps;
      const wiggleM = s === 0 ? 0 : (rng() - 0.5) * 10;
      const pxM = dM * Math.cos(rAngle) - wiggleM * Math.sin(rAngle);
      const pyM = dM * Math.sin(rAngle) + wiggleM * Math.cos(rAngle);
      pts.push([center[0] + metersToUnits(pxM), center[1] + metersToUnits(pyM)]);
    }

    radialOuterPoints.push(pts[pts.length - 1]);
    streets.push({
      id: `str_${settlement.id}_radial_${r}`,
      kind: "arterial",
      surface: profile.streetSurface,
      widthM: profile.primaryStreetWidthM,
      points: pts,
    });
  }

  // Ring bypass road connecting the radials at mid-radius (~50% radius)
  if (settlement.tier !== "nomadic") {
    const ringDistM = radiusM * 0.52;
    const ringPts: Pt[] = [];
    const ringSteps = radialCount * 3;
    for (let i = 0; i <= ringSteps; i++) {
      const a = primaryAngle + (i / ringSteps) * Math.PI * 2;
      const wM = (rng() - 0.5) * 8;
      const rxM = (ringDistM + wM) * Math.cos(a);
      const ryM = (ringDistM + wM) * Math.sin(a);
      ringPts.push([center[0] + metersToUnits(rxM), center[1] + metersToUnits(ryM)]);
    }
    streets.push({
      id: `str_${settlement.id}_ring_mid`,
      kind: "spine",
      surface: profile.streetSurface === "paved_stone" ? "cobblestone" : "gravel",
      widthM: profile.secondaryStreetWidthM,
      points: ringPts,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. District Zoning & Structural Parcels
  // ---------------------------------------------------------------------------

  // 3A. PATRICIAN QUARTER (Rich Mansions with Private Estate Gardens)
  // Located in windward quadrant (NW), away from industrial smoke & cattle
  const manorCount = settlement.tier === "metropolis" ? 12 : settlement.tier === "city" ? 6 : settlement.tier === "town" ? 3 : 1;
  const manorStartAngle = primaryAngle + 0.5;
  for (let m = 0; m < manorCount; m++) {
    const mAngle = manorStartAngle + (m * 0.45) + (rng() - 0.5) * 0.1;
    const mDistM = range(rng, radiusM * 0.28, radiusM * 0.58);
    const mCenter: Pt = [
      center[0] + metersToUnits(mDistM * Math.cos(mAngle)),
      center[1] + metersToUnits(mDistM * Math.sin(mAngle)),
    ];

    const mDim = BUILDING_DIMENSIONS.manor;
    const mLen = range(rng, mDim.lengthRangeM[0], mDim.lengthRangeM[1]);
    const mWid = range(rng, mDim.widthRangeM[0], mDim.widthRangeM[1]);
    const manorBld = createBuildingFootprint(
      `bld_${settlement.id}_manor_${++buildingIdCounter}`,
      "manor",
      mCenter,
      mLen,
      mWid,
      range(rng, mDim.heightRangeM[0], mDim.heightRangeM[1]),
      mDim.stories,
      "hip",
      resolveRoofMaterial(biomeType, settlement.tier, "manor"),
      mAngle,
      mDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(manorBld);

    // Spacious estate parcel with private stone walls
    const estateW = mWid + 24;
    const estateL = mLen + 28;
    const estatePoly = createParcelPolygon(mCenter, estateW, estateL, mAngle);
    parcels.push({
      id: `pcl_${settlement.id}_manor_${m}`,
      boundary: estatePoly,
      landUse: "mansion_estate",
      areaM2: estateW * estateL,
      buildingIds: [manorBld.id],
      fences: generateEnclosureFences(estatePoly, 6.0),
      fillColor: "rgba(100, 155, 90, 0.22)", // Rich manicured green lawn
    });
  }

  // 3B. COMMON ARTISAN & MERCHANT QUARTER
  // Regular burgage lots facing radial avenues and ring street
  const artisanCount = settlement.tier === "nomadic" ? 3 : settlement.tier === "hamlet" ? 8 : settlement.tier === "village" ? 18 : 45;
  for (let a = 0; a < artisanCount; a++) {
    const radIdx = a % radialCount;
    const baseAngle = radialAngles[radIdx];
    const side = (a % 2 === 0 ? 1 : -1);
    let dM = range(rng, radiusM * 0.22, radiusM * 0.65);
    const ringDistM = radiusM * 0.52;
    if (Math.abs(dM - ringDistM) < 18) {
      dM = dM < ringDistM ? ringDistM - 20 : ringDistM + 20;
    }
    const perpA = baseAngle + side * (Math.PI / 2);
    const setbackM = (profile.primaryStreetWidthM / 2) + 12;
    const artCenter: Pt = [
      center[0] + metersToUnits(dM * Math.cos(baseAngle) + setbackM * Math.cos(perpA)),
      center[1] + metersToUnits(dM * Math.sin(baseAngle) + setbackM * Math.sin(perpA)),
    ];

    const isSmith = a % 7 === 0;
    const isStore = a % 5 === 0;
    const func: BuildingFunction = isSmith ? "blacksmith" : isStore ? "storehouse" : "cottage";
    const dim = BUILDING_DIMENSIONS[func];
    const bLen = range(rng, dim.lengthRangeM[0], dim.lengthRangeM[1]);
    const bWid = range(rng, dim.widthRangeM[0], dim.widthRangeM[1]);
    const bld = createBuildingFootprint(
      `bld_${settlement.id}_artisan_${++buildingIdCounter}`,
      func,
      artCenter,
      bLen,
      bWid,
      range(rng, dim.heightRangeM[0], dim.heightRangeM[1]),
      dim.stories,
      dim.roofType,
      resolveRoofMaterial(biomeType, settlement.tier, func),
      baseAngle,
      dim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(bld);

    const pLot = createParcelPolygon(artCenter, bWid + 6, bLen + 10, baseAngle);
    parcels.push({
      id: `pcl_${settlement.id}_artisan_${a}`,
      boundary: pLot,
      landUse: isSmith ? "artisan" : "residential",
      areaM2: (bWid + 6) * (bLen + 10),
      buildingIds: [bld.id],
    });
  }

  // 3C. THE POOR QUARTER / TENEMENTS
  // Tightly clustered peasant hovels & cottages in SE downwind quadrant
  const poorQuarterCount = settlement.tier === "nomadic" ? 4 : settlement.tier === "hamlet" ? 6 : settlement.tier === "village" ? 16 : 40;
  const poorStartAngle = primaryAngle + Math.PI + 0.3;
  for (let p = 0; p < poorQuarterCount; p++) {
    const pAngle = poorStartAngle + (p / poorQuarterCount) * 1.3 + (rng() - 0.5) * 0.2;
    const pDistM = range(rng, radiusM * 0.32, radiusM * 0.68);
    const pCenter: Pt = [
      center[0] + metersToUnits(pDistM * Math.cos(pAngle)),
      center[1] + metersToUnits(pDistM * Math.sin(pAngle)),
    ];

    const hovelFunc: BuildingFunction = p % 2 === 0 ? "hovel" : "cottage";
    const hDim = BUILDING_DIMENSIONS[hovelFunc];
    const hLen = range(rng, hDim.lengthRangeM[0], hDim.lengthRangeM[1]);
    const hWid = range(rng, hDim.widthRangeM[0], hDim.widthRangeM[1]);
    const hBld = createBuildingFootprint(
      `bld_${settlement.id}_poor_${++buildingIdCounter}`,
      hovelFunc,
      pCenter,
      hLen,
      hWid,
      range(rng, hDim.heightRangeM[0], hDim.heightRangeM[1]),
      1,
      "gable",
      "thatch",
      pAngle + (rng() - 0.5) * 0.4,
      hDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(hBld);

    const hPoly = createParcelPolygon(pCenter, hWid + 3, hLen + 4, pAngle);
    parcels.push({
      id: `pcl_${settlement.id}_poor_${p}`,
      boundary: hPoly,
      landUse: "poor_quarter",
      areaM2: (hWid + 3) * (hLen + 4),
      buildingIds: [hBld.id],
      fillColor: "rgba(145, 130, 110, 0.14)",
    });
  }

  // 3D. RURAL AGRICULTURAL GREENBELT (Outer Ring: Farms & Cattle Ranches)
  // Outer perimeter from 0.55 * radiusM out to 1.05 * radiusM

  // Farms (Crop Fields with Parallel Furrow Striations)
  const farmCount = settlement.tier === "nomadic" ? 2 : settlement.tier === "hamlet" ? 4 : settlement.tier === "village" ? 8 : 16;
  const cropTypes: ("wheat" | "barley" | "vegetables" | "pasture" | "fallow")[] = [
    "wheat",
    "barley",
    "vegetables",
    "pasture",
    "fallow",
  ];

  for (let f = 0; f < farmCount; f++) {
    const fAngle = primaryAngle + ((f + 0.5) / farmCount) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const fDistM = range(rng, radiusM * 0.62, radiusM * 0.98);
    const fCenter: Pt = [
      center[0] + metersToUnits(fDistM * Math.cos(fAngle)),
      center[1] + metersToUnits(fDistM * Math.sin(fAngle)),
    ];

    const fieldW = range(rng, 42, 68);
    const fieldL = range(rng, 55, 88);
    const fieldPoly = createParcelPolygon(fCenter, fieldW, fieldL, fAngle);
    const cType = cropTypes[f % cropTypes.length];

    // Build farmhouse & timber barn on the farmstead edge
    const farmBlds: string[] = [];
    const fhDim = BUILDING_DIMENSIONS.farmhouse;
    const fhPos: Pt = [
      fCenter[0] - metersToUnits(fieldL * 0.32 * Math.cos(fAngle)),
      fCenter[1] - metersToUnits(fieldL * 0.32 * Math.sin(fAngle)),
    ];
    const fhBld = createBuildingFootprint(
      `bld_${settlement.id}_farmhouse_${++buildingIdCounter}`,
      "farmhouse",
      fhPos,
      range(rng, fhDim.lengthRangeM[0], fhDim.lengthRangeM[1]),
      range(rng, fhDim.widthRangeM[0], fhDim.widthRangeM[1]),
      range(rng, fhDim.heightRangeM[0], fhDim.heightRangeM[1]),
      2,
      "gable",
      resolveRoofMaterial(biomeType, settlement.tier, "farmhouse"),
      fAngle,
      fhDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(fhBld);
    farmBlds.push(fhBld.id);

    // Barn
    const bDim = BUILDING_DIMENSIONS.barn;
    const bPos: Pt = [
      fhPos[0] + metersToUnits(16 * Math.sin(fAngle)),
      fhPos[1] - metersToUnits(16 * Math.cos(fAngle)),
    ];
    const barnBld = createBuildingFootprint(
      `bld_${settlement.id}_barn_${++buildingIdCounter}`,
      "barn",
      bPos,
      range(rng, bDim.lengthRangeM[0], bDim.lengthRangeM[1]),
      range(rng, bDim.widthRangeM[0], bDim.widthRangeM[1]),
      range(rng, bDim.heightRangeM[0], bDim.heightRangeM[1]),
      1,
      "gable",
      "timber",
      fAngle,
      bDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(barnBld);
    farmBlds.push(barnBld.id);

    parcels.push({
      id: `pcl_${settlement.id}_farm_${f}`,
      boundary: fieldPoly,
      landUse: "farm_field",
      areaM2: fieldW * fieldL,
      buildingIds: farmBlds,
      cropType: cType,
      furrows: generateCropFurrows(fieldPoly, 4.5),
      fences: generateEnclosureFences(fieldPoly, 7.0),
      fillColor:
        cType === "wheat"
          ? "rgba(225, 195, 115, 0.28)" // Warm golden wheat
          : cType === "barley"
          ? "rgba(210, 180, 105, 0.26)" // Straw yellow barley
          : cType === "vegetables"
          ? "rgba(135, 165, 85, 0.25)" // Lush green cabbage/veggie rows
          : "rgba(150, 130, 105, 0.22)", // Ploughed brown fallow
    });
  }

  // Cattle Ranches / Grazing Paddocks (Wooden Fences & Livestock Sheds)
  const ranchCount = settlement.tier === "nomadic" ? 1 : settlement.tier === "hamlet" ? 2 : settlement.tier === "village" ? 4 : 8;
  for (let c = 0; c < ranchCount; c++) {
    const cAngle = primaryAngle + ((c + 0.25) / ranchCount) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const cDistM = range(rng, radiusM * 0.65, radiusM * 0.95);
    const rCenter: Pt = [
      center[0] + metersToUnits(cDistM * Math.cos(cAngle)),
      center[1] + metersToUnits(cDistM * Math.sin(cAngle)),
    ];

    const ranchW = range(rng, 50, 78);
    const ranchL = range(rng, 60, 95);
    const ranchPoly = createParcelPolygon(rCenter, ranchW, ranchL, cAngle);

    // Cattle shed inside the paddock
    const csDim = BUILDING_DIMENSIONS.cattle_shed;
    const csCenter: Pt = [
      rCenter[0] + metersToUnits(ranchW * 0.28 * Math.cos(cAngle + Math.PI / 2)),
      rCenter[1] + metersToUnits(ranchW * 0.28 * Math.sin(cAngle + Math.PI / 2)),
    ];
    const csBld = createBuildingFootprint(
      `bld_${settlement.id}_cattle_shed_${++buildingIdCounter}`,
      "cattle_shed",
      csCenter,
      range(rng, csDim.lengthRangeM[0], csDim.lengthRangeM[1]),
      range(rng, csDim.widthRangeM[0], csDim.widthRangeM[1]),
      range(rng, csDim.heightRangeM[0], csDim.heightRangeM[1]),
      1,
      "gable",
      "timber",
      cAngle,
      csDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(csBld);

    parcels.push({
      id: `pcl_${settlement.id}_ranch_${c}`,
      boundary: ranchPoly,
      landUse: "cattle_ranch",
      areaM2: ranchW * ranchL,
      buildingIds: [csBld.id],
      fences: generateEnclosureFences(ranchPoly, 8.0),
      fillColor: "rgba(120, 180, 95, 0.30)", // Fresh pasture green grass
    });
  }

  // 3E. WINDMILL & VILLAGE POND
  // Windmill on elevated outer perimeter
  if (settlement.tier !== "nomadic") {
    const wmAngle = primaryAngle + 2.2;
    const wmDistM = radiusM * 0.88;
    const wmCenter: Pt = [
      center[0] + metersToUnits(wmDistM * Math.cos(wmAngle)),
      center[1] + metersToUnits(wmDistM * Math.sin(wmAngle)),
    ];
    const wmDim = BUILDING_DIMENSIONS.windmill;
    const wmBld = createBuildingFootprint(
      `bld_${settlement.id}_windmill`,
      "windmill",
      wmCenter,
      range(rng, wmDim.lengthRangeM[0], wmDim.lengthRangeM[1]),
      range(rng, wmDim.widthRangeM[0], wmDim.widthRangeM[1]),
      range(rng, wmDim.heightRangeM[0], wmDim.heightRangeM[1]),
      3,
      "tower_conical",
      "cedar_shingle",
      wmAngle,
      wmDim.defaultPitchDeg * pitchMult
    );
    rawBuildings.push(wmBld);
  }

  // Village Pond / Millpond (In common grazing meadow or near water)
  const pondAngle = primaryAngle - 1.2;
  const pondDistM = radiusM * 0.45;
  const pondRadiusM = range(rng, 14, 24);
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

  // Watermill adjacent to pond
  const wmWaterCenter: Pt = [
    pondCenter[0] + metersToUnits((pondRadiusM + 8) * Math.cos(pondAngle)),
    pondCenter[1] + metersToUnits((pondRadiusM + 8) * Math.sin(pondAngle)),
  ];
  const wmWaterDim = BUILDING_DIMENSIONS.watermill;
  const watermillBld = createBuildingFootprint(
    `bld_${settlement.id}_watermill`,
    "watermill",
    wmWaterCenter,
    range(rng, wmWaterDim.lengthRangeM[0], wmWaterDim.lengthRangeM[1]),
    range(rng, wmWaterDim.widthRangeM[0], wmWaterDim.widthRangeM[1]),
    range(rng, wmWaterDim.heightRangeM[0], wmWaterDim.heightRangeM[1]),
    2,
    "gable",
    "timber",
    pondAngle + Math.PI / 2,
    wmWaterDim.defaultPitchDeg * pitchMult
  );
  rawBuildings.push(watermillBld);

  // ---------------------------------------------------------------------------
  // 4. Finetune Stage (Rule-Based Relocation & Conflict Resolution)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 5. Cadastre Stats Summary
  // ---------------------------------------------------------------------------
  let totalRoofAreaM2 = 0;
  let totalStreetLengthM = 0;
  let residentialCount = 0;
  const matCounts: Record<RoofMaterial, number> = {
    thatch: 0,
    slate: 0,
    terracotta: 0,
    cedar_shingle: 0,
    copper_verdigris: 0,
    timber: 0,
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
    center,
    radiusUnits,
    radiusM: Math.round(radiusM),
    streets,
    parcels,
    buildings: finetunedBuildings,
    civicWell,
    civicPond,
    marketSquare,
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
  pitchDeg: number
): BuildingFootprint {
  const halfLenUnits = metersToUnits(lengthM / 2);
  const halfWidUnits = metersToUnits(widthM / 2);

  // 4 corners of rectangular building footprint
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

  // Ridge crest running along length axis
  const ridgeStart: Pt = [
    center[0] - halfLenUnits * Math.cos(angleRad),
    center[1] - halfLenUnits * Math.sin(angleRad),
  ];
  const ridgeEnd: Pt = [
    center[0] + halfLenUnits * Math.cos(angleRad),
    center[1] + halfLenUnits * Math.sin(angleRad),
  ];

  // Palette
  const palette = ROOF_MATERIAL_PALETTES[roofMaterial] ?? ROOF_MATERIAL_PALETTES.thatch;

  // Compute roof slope facets
  const facets: RoofFacet[] = [];

  // Facet 1: Left slope
  const slope1Angle = angleRad - Math.PI / 2;
  const sunExp1 = computeSunExposure(slope1Angle, pitchDeg);
  facets.push({
    polygon: [ridgeStart, ridgeEnd, footprint[1], footprint[0]],
    normal: [Math.cos(slope1Angle), Math.sin(slope1Angle), Math.cos((pitchDeg * Math.PI) / 180)],
    pitchDegrees: pitchDeg,
    sunExposure: sunExp1,
    color: sunExp1 > 0.55 ? palette.sunlitHex : palette.shadedHex,
  });

  // Facet 2: Right slope
  const slope2Angle = angleRad + Math.PI / 2;
  const sunExp2 = computeSunExposure(slope2Angle, pitchDeg);
  facets.push({
    polygon: [ridgeStart, ridgeEnd, footprint[2], footprint[3]],
    normal: [Math.cos(slope2Angle), Math.sin(slope2Angle), Math.cos((pitchDeg * Math.PI) / 180)],
    pitchDegrees: pitchDeg,
    sunExposure: sunExp2,
    color: sunExp2 > 0.55 ? palette.sunlitHex : palette.shadedHex,
  });

  // Ground cast shadow polygon:
  // Sun from NW (315°), shadow projects toward SE (135°)
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

  // Chimney placement
  const chimneys: Pt[] = [];
  if (stories > 0 && buildingType !== "market_stall" && buildingType !== "well") {
    // 1 chimney for cottages/barns, 2-3 chimneys for inns and mansions
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
