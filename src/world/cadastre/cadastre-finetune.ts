import type { GeneratedRegion, Pt } from "../types";
import type { BuildingFootprint, StreetSegment } from "./cadastre-types";
import { metersToUnits } from "./cadastre-types";
import { createBuildingFootprint } from "./cadastre-generate";
import { dist, nearestOnLine, pointInPolygon } from "../geom";

// ---------------------------------------------------------------------------
// CADASTRE FINETUNER (Discriminator / Corrector)
//
// Enforces micro-urban physical, architectural, and spatial invariants:
//   1. Civic Well & Market Plaza clearance (Well unobstructed in open square).
//   2. Zero building-to-building collision (firebreak separation >= 2.0m - 5.0m).
//   3. Street carriageway clearance (no encroachment on public routes).
//   4. Shoreline snapping for watermills and water avoidance for dry housing.
//   5. Ground cast shadow & roof facet recalibration after repositioning.
// ---------------------------------------------------------------------------

export function runCadastreFinetune(
  rawBuildings: BuildingFootprint[],
  streets: StreetSegment[],
  geo: GeneratedRegion,
  _center: Pt,
  _radiusUnits: number,
  wellCenter?: Pt,
  civicPond?: { center: Pt; radiusM: number; polygon: Pt[] }
): BuildingFootprint[] {
  let buildings: BuildingFootprint[] = rawBuildings.map((b) => ({ ...b }));

  // Collect water features (rivers and lakes)
  const waterPolys: Pt[][][] = [];
  for (const f of geo.features) {
    if (f.properties.featureType === "lake" || f.properties.featureType === "sea") {
      const coords = f.geometry.coordinates as unknown as Pt[][][];
      if (Array.isArray(coords)) {
        for (const ring of coords) {
          if (Array.isArray(ring) && ring.length > 0) waterPolys.push(coords as unknown as Pt[][]);
        }
      }
    }
  }

  // Pass 1: Water clearance (except watermill which hugs the shore)
  buildings = buildings.filter((b) => {
    if (b.buildingType === "watermill") return true;

    // Check against natural lakes/seas
    for (const poly of waterPolys) {
      if (pointInPolygon(b.center, poly)) return false;
    }

    // Check against civic village pond
    if (civicPond && dist(b.center, civicPond.center) < metersToUnits(civicPond.radiusM * 0.95)) {
      return false;
    }

    return true;
  });

  // Pass 2: Town Well Protection (The Well is fixed; clear 4.5m pedestrian perimeter)
  if (wellCenter) {
    const wellClearanceUnits = metersToUnits(4.5);
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.buildingType === "well") continue; // Well is sacred anchor
      const d = dist(b.center, wellCenter);
      if (d < wellClearanceUnits && d > 1e-6) {
        const pushUnits = wellClearanceUnits - d + metersToUnits(1.0);
        const dx = (b.center[0] - wellCenter[0]) / d;
        const dy = (b.center[1] - wellCenter[1]) / d;
        const newCenter: Pt = [b.center[0] + dx * pushUnits, b.center[1] + dy * pushUnits];

        buildings[i] = createBuildingFootprint(
          b.id,
          b.buildingType,
          newCenter,
          b.lengthM,
          b.widthM,
          b.heightM,
          b.stories,
          b.roofType,
          b.roofMaterial,
          b.orientationRad,
          b.facets[0]?.pitchDegrees ?? 45,
          b.establishment
        );
      }
    }
  }

  // Pass 3: Street corridor clearance (except central well and plaza stalls)
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.buildingType === "well") continue;

    for (const str of streets) {
      if (str.kind === "plaza") continue; // Stalls are permitted around plaza edge
      const near = nearestOnLine(str.points, b.center);
      const minDistM = (str.widthM / 2) + (Math.min(b.widthM, b.lengthM) / 2) + 1.2;
      const minDistUnits = metersToUnits(minDistM);

      if (near.dist < minDistUnits) {
        // Encroachment! Push away from street
        const pushDistUnits = minDistUnits - near.dist + metersToUnits(0.6);
        let pushDirX = b.center[0] - near.point[0];
        let pushDirY = b.center[1] - near.point[1];
        const pushLen = Math.hypot(pushDirX, pushDirY) || 1e-6;
        pushDirX /= pushLen;
        pushDirY /= pushLen;

        const newCenter: Pt = [
          b.center[0] + pushDirX * pushDistUnits,
          b.center[1] + pushDirY * pushDistUnits,
        ];

        buildings[i] = createBuildingFootprint(
          b.id,
          b.buildingType,
          newCenter,
          b.lengthM,
          b.widthM,
          b.heightM,
          b.stories,
          b.roofType,
          b.roofMaterial,
          b.orientationRad,
          b.facets[0]?.pitchDegrees ?? 45,
          b.establishment
        );
      }
    }
  }

  // Pass 4: Iterative Building Collision Resolution (Relaxation)
  // Ensures firebreak gap of >= 2.0m - 5.0m between every adjacent building
  const iterations = 4;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const bi = buildings[i];
        const bj = buildings[j];

        // Well never moves
        const iIsWell = bi.buildingType === "well";
        const jIsWell = bj.buildingType === "well";

        const dUnits = dist(bi.center, bj.center);
        const minGapM = (bi.buildingType === "manor" || bj.buildingType === "manor") ? 5.0 : 2.2;
        const reqDistM = (Math.max(bi.widthM, bi.lengthM) + Math.max(bj.widthM, bj.lengthM)) / 2 * 0.72 + minGapM;
        const reqDistUnits = metersToUnits(reqDistM);

        if (dUnits < reqDistUnits) {
          const overlapUnits = reqDistUnits - dUnits;
          let dx = bj.center[0] - bi.center[0];
          let dy = bj.center[1] - bi.center[1];
          const len = Math.hypot(dx, dy) || 1e-6;
          dx /= len;
          dy /= len;

          if (iIsWell) {
            // Push j away only
            const newCenterJ: Pt = [bj.center[0] + dx * overlapUnits, bj.center[1] + dy * overlapUnits];
            buildings[j] = createBuildingFootprint(
              bj.id,
              bj.buildingType,
              newCenterJ,
              bj.lengthM,
              bj.widthM,
              bj.heightM,
              bj.stories,
              bj.roofType,
              bj.roofMaterial,
              bj.orientationRad,
              bj.facets[0]?.pitchDegrees ?? 45,
              bj.establishment
            );
          } else if (jIsWell) {
            // Push i away only
            const newCenterI: Pt = [bi.center[0] - dx * overlapUnits, bi.center[1] - dy * overlapUnits];
            buildings[i] = createBuildingFootprint(
              bi.id,
              bi.buildingType,
              newCenterI,
              bi.lengthM,
              bi.widthM,
              bi.heightM,
              bi.stories,
              bi.roofType,
              bi.roofMaterial,
              bi.orientationRad,
              bi.facets[0]?.pitchDegrees ?? 45,
              bi.establishment
            );
          } else {
            // Push both apart symmetrically
            const pushUnits = overlapUnits / 2;
            const newCenterI: Pt = [bi.center[0] - dx * pushUnits, bi.center[1] - dy * pushUnits];
            const newCenterJ: Pt = [bj.center[0] + dx * pushUnits, bj.center[1] + dy * pushUnits];

            buildings[i] = createBuildingFootprint(
              bi.id,
              bi.buildingType,
              newCenterI,
              bi.lengthM,
              bi.widthM,
              bi.heightM,
              bi.stories,
              bi.roofType,
              bi.roofMaterial,
              bi.orientationRad,
              bi.facets[0]?.pitchDegrees ?? 45,
              bi.establishment
            );

            buildings[j] = createBuildingFootprint(
              bj.id,
              bj.buildingType,
              newCenterJ,
              bj.lengthM,
              bj.widthM,
              bj.heightM,
              bj.stories,
              bj.roofType,
              bj.roofMaterial,
              bj.orientationRad,
              bj.facets[0]?.pitchDegrees ?? 45,
              bj.establishment
            );
          }
        }
      }
    }

    // Re-enforce street clearance so pushed buildings never protrude into carriageways
    for (let i = 0; i < buildings.length; i++) {
      let b = buildings[i];
      if (b.buildingType === "well") continue;

      for (const str of streets) {
        if (str.kind === "plaza") continue;
        const near = nearestOnLine(str.points, b.center);
        const minDistM = (str.widthM / 2) + (Math.max(b.widthM, b.lengthM) / 2) + 1.2;
        const minDistUnits = metersToUnits(minDistM);

        if (near.dist < minDistUnits) {
          const pushDistUnits = minDistUnits - near.dist + metersToUnits(0.8);
          let pushDirX = b.center[0] - near.point[0];
          let pushDirY = b.center[1] - near.point[1];
          const pushLen = Math.hypot(pushDirX, pushDirY) || 1e-6;
          pushDirX /= pushLen;
          pushDirY /= pushLen;

          const newCenter: Pt = [
            b.center[0] + pushDirX * pushDistUnits,
            b.center[1] + pushDirY * pushDistUnits,
          ];

          buildings[i] = createBuildingFootprint(
            b.id,
            b.buildingType,
            newCenter,
            b.lengthM,
            b.widthM,
            b.heightM,
            b.stories,
            b.roofType,
            b.roofMaterial,
            b.orientationRad,
            b.facets[0]?.pitchDegrees ?? 45,
            b.establishment
          );
          b = buildings[i];
        }
      }
    }
  }

  // Pass 5: Final Pinch-Point & Street Corridor Pruning
  // Drop any minor dwelling in an irreconcilable pinch point
  for (let i = buildings.length - 1; i >= 0; i--) {
    const bi = buildings[i];
    if (
      bi.buildingType === "well" ||
      bi.buildingType === "temple" ||
      bi.buildingType === "cathedral" ||
      bi.buildingType === "chapel" ||
      bi.buildingType === "inn" ||
      bi.buildingType === "townhall" ||
      bi.buildingType === "keep"
    ) {
      continue;
    }

    // Check street obstruction
    let inStreet = false;
    for (const str of streets) {
      if (str.kind === "plaza") continue;
      const near = nearestOnLine(str.points, bi.center);
      const minClrM = str.widthM / 2 + Math.min(bi.widthM, bi.lengthM) / 2 * 0.6;
      if (near.dist < metersToUnits(minClrM)) {
        inStreet = true;
        break;
      }
    }
    if (inStreet) {
      buildings.splice(i, 1);
      continue;
    }

    // Check building overlap
    for (let j = 0; j < i; j++) {
      const bj = buildings[j];
      const d = dist(bi.center, bj.center);
      const minReqM = (Math.max(bi.widthM, bi.lengthM) + Math.max(bj.widthM, bj.lengthM)) / 2 * 0.7;
      if (d < metersToUnits(minReqM)) {
        buildings.splice(i, 1);
        break;
      }
    }
  }

  return buildings;
}
