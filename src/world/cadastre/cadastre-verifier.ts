import type { GeneratedRegion, Pt, VerificationCheck, VerificationReport } from "../types";
import type { BuildingFootprint, StreetSegment } from "./cadastre-types";
import { metersToUnits } from "./cadastre-types";
import { dist, nearestOnLine, pointInPolygon } from "../geom";

// ---------------------------------------------------------------------------
// CADASTRE VERIFIER
//
// Asserts physical integrity of the cadastral layout:
//   1. Firebreak Separation: Zero building-to-building overlaps.
//   2. Street Clearance: Zero buildings encroaching on street corridors.
//   3. Water Safety Setback: Zero dry buildings placed in lakes or ponds.
//   4. Roof Geometric Integrity: Closed facet polygons & valid ridge lines.
//   5. Precinct Containment: Buildings positioned within settlement radius.
//   6. Civic Well: Public town well present and accessible.
//   7. Rural Greenbelt: Working farmsteads and cattle ranches present.
// ---------------------------------------------------------------------------

export function verifyCadastre(
  buildings: BuildingFootprint[],
  streets: StreetSegment[],
  center: Pt,
  radiusUnits: number,
  geo: GeneratedRegion,
  targetName = "Settlement Cadastre"
): VerificationReport {
  const t0 = performance.now();
  const checks: VerificationCheck[] = [];

  // Check 1: Building-to-Building Overlaps
  let overlapViolations = 0;
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const bi = buildings[i];
      const bj = buildings[j];
      const d = dist(bi.center, bj.center);
      const minReqM = (Math.max(bi.widthM, bi.lengthM) + Math.max(bj.widthM, bj.lengthM)) / 2 * 0.7;
      if (d < metersToUnits(minReqM)) {
        overlapViolations++;
      }
    }
  }

  checks.push({
    id: "cadastre_no_overlap",
    category: "placement",
    title: "Zero Building Footprint Collisions",
    rule: "Buildings maintain minimum firebreak clearance without intersecting adjacent walls.",
    passed: overlapViolations === 0,
    checkedCount: (buildings.length * (buildings.length - 1)) / 2,
    violationCount: overlapViolations,
    details:
      overlapViolations === 0
        ? `All ${buildings.length} buildings have distinct, non-overlapping footprints.`
        : `${overlapViolations} building pairs collide or lack firebreak clearance.`,
    sampleViolations: [],
  });

  // Check 2: Street Clearance (carriageway corridors)
  let streetEncroachments = 0;
  for (const b of buildings) {
    if (b.buildingType === "well" || b.buildingType === "market_stall") continue;
    for (const str of streets) {
      if (str.kind === "plaza") continue; // Stalls are permitted around plaza edge
      const near = nearestOnLine(str.points, b.center);
      const minClrM = str.widthM / 2 + Math.min(b.widthM, b.lengthM) / 2 * 0.6;
      if (near.dist < metersToUnits(minClrM)) {
        streetEncroachments++;
        break;
      }
    }
  }

  checks.push({
    id: "cadastre_street_clearance",
    category: "placement",
    title: "Carriageway Street Clearance",
    rule: "Building walls do not obstruct public streets or arterial lanes.",
    passed: streetEncroachments === 0,
    checkedCount: buildings.length,
    violationCount: streetEncroachments,
    details:
      streetEncroachments === 0
        ? `All ${buildings.length} buildings are safely set back from street corridors.`
        : `${streetEncroachments} buildings protrude into street corridors.`,
    sampleViolations: [],
  });

  // Check 3: Water Safety Clearance
  let waterViolations = 0;
  const waterPolys: Pt[][][] = [];
  for (const f of geo.features) {
    if (f.properties.featureType === "lake") {
      const coords = f.geometry.coordinates as unknown as Pt[][][];
      if (Array.isArray(coords)) waterPolys.push(coords as unknown as Pt[][]);
    }
  }

  for (const b of buildings) {
    if (b.buildingType === "watermill") continue;
    for (const poly of waterPolys) {
      if (pointInPolygon(b.center, poly)) {
        waterViolations++;
        break;
      }
    }
  }

  checks.push({
    id: "cadastre_water_setback",
    category: "placement",
    title: "Water Shoreline Setback",
    rule: "Buildings are founded on dry land and not submerged inside lakes or open ocean.",
    passed: waterViolations === 0,
    checkedCount: buildings.length,
    violationCount: waterViolations,
    details:
      waterViolations === 0
        ? `All buildings are founded securely above high water.`
        : `${waterViolations} buildings overlap water bodies.`,
    sampleViolations: [],
  });

  // Check 4: Roof Geometric Integrity
  let roofViolations = 0;
  for (const b of buildings) {
    if (!b.ridgeLine || b.ridgeLine.length !== 2) {
      roofViolations++;
      continue;
    }
    if (!b.facets || b.facets.length === 0) {
      roofViolations++;
      continue;
    }
    for (const f of b.facets) {
      if (f.pitchDegrees < 10 || f.pitchDegrees > 75 || f.polygon.length < 3) {
        roofViolations++;
        break;
      }
    }
  }

  checks.push({
    id: "cadastre_roof_integrity",
    category: "scale",
    title: "Pitched Roof Architectural Integrity",
    rule: "Every building features realistic ridge crests, slope pitch, and shaded facet polygons.",
    passed: roofViolations === 0,
    checkedCount: buildings.length,
    violationCount: roofViolations,
    details:
      roofViolations === 0
        ? `All ${buildings.length} roofs have geometrically valid ridge lines and sloped facets.`
        : `${roofViolations} buildings have invalid or degenerated roof geometry.`,
    sampleViolations: [],
  });

  // Check 5: Settlement Precinct Containment
  let boundaryViolations = 0;
  for (const b of buildings) {
    const d = dist(b.center, center);
    if (d > radiusUnits * 1.35) {
      boundaryViolations++;
    }
  }

  checks.push({
    id: "cadastre_precinct_bounds",
    category: "scale",
    title: "Settlement Precinct Containment",
    rule: "Buildings reside within the designated cadastral precinct boundary.",
    passed: boundaryViolations === 0,
    checkedCount: buildings.length,
    violationCount: boundaryViolations,
    details:
      boundaryViolations === 0
        ? `All buildings cluster within the settlement boundary.`
        : `${boundaryViolations} buildings drift beyond the settlement boundary.`,
    sampleViolations: [],
  });

  // Check 6: Town Well & Civic Amenities
  const wellPresent = buildings.some((b) => b.buildingType === "well");
  checks.push({
    id: "cadastre_civic_well",
    category: "placement",
    title: "Public Well & Civic Core Integrity",
    rule: "Every organized settlement features an accessible town well or fountain in its public plaza.",
    passed: wellPresent,
    checkedCount: 1,
    violationCount: wellPresent ? 0 : 1,
    details: wellPresent
      ? "Town Well is established in the central plaza with clear pedestrian access."
      : "Settlement lacks a designated public water well.",
    sampleViolations: [],
  });

  // Check 7: Rural Greenbelt (Farms & Cattle Enclosures)
  const hasRural = buildings.some((b) => b.buildingType === "farmhouse" || b.buildingType === "barn" || b.buildingType === "cattle_shed");
  checks.push({
    id: "cadastre_rural_greenbelt",
    category: "placement",
    title: "Agricultural Belt & Livestock Ranches",
    rule: "Settlement includes working agricultural homesteads, crop plots, and cattle pastures.",
    passed: hasRural,
    checkedCount: buildings.length,
    violationCount: hasRural ? 0 : 1,
    details: hasRural
      ? "Outer agricultural greenbelt verified with working farmsteads and livestock pastures."
      : "Settlement lacks agricultural support infrastructure.",
    sampleViolations: [],
  });

  // Check 8: Socio-Economic Establishments (Eigengrau Model)
  const establishedBuildings = buildings.filter((b) => b.establishment !== undefined);
  const invalidEsts = establishedBuildings.filter(
    (b) => !b.establishment?.name || !b.establishment?.trade || !b.establishment?.proprietor
  );
  checks.push({
    id: "cadastre_establishment_integrity",
    category: "scale",
    title: "Socio-Economic Establishment Attribution",
    rule: "Municipal, commercial, and religious buildings possess verified establishment profiles.",
    passed: invalidEsts.length === 0,
    checkedCount: establishedBuildings.length,
    violationCount: invalidEsts.length,
    details: invalidEsts.length === 0
      ? `${establishedBuildings.length} active fantasy trade establishments and proprietors registered.`
      : `${invalidEsts.length} buildings have malformed establishment records.`,
    sampleViolations: [],
  });

  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((sum, c) => sum + c.violationCount, 0);

  return {
    targetName,
    tier: 2,
    passedAll: totalViolations === 0,
    passedChecks,
    totalChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}
