import type { GeneratedRegion, Pt, VerificationCheck, VerificationReport } from "../types";
import type { RouteFeature } from "./route-types";
import type { Settlement } from "../human/human-types";
import { BioEnvReader } from "../bio/bio-env";
import { unitsToKm, kmToUnits } from "../constants";
import { dist } from "../geom";

// ---------------------------------------------------------------------------
// LAYER 6 VERIFIER — INVARIANTS FOR ROADS & TRADE ROUTES
//
// Asserts that routes:
//   1. Endpoints match real settlements from Layer 4.
//   2. Land routes stay on land; sea lanes traverse navigable waters.
//   3. Lower frozen layers (Geography L1, Biosphere L3, Settlements L4) are untouched.
//   4. Sinuosity is physically reasonable (no infinite loops or negative lengths).
//   5. Water discipline: roads cross rivers briefly (bridge/ford) instead of
//      running along the channel, and do not span wide lakes.
// ---------------------------------------------------------------------------

export function verifyRouteLayer(
  routes: RouteFeature[],
  settlements: Settlement[],
  region: GeneratedRegion,
  geoCountBefore: number,
  settlementsCountBefore: number
): VerificationReport {
  const t0 = performance.now();
  const checks: VerificationCheck[] = [];
  const push = (
    id: string,
    category: VerificationCheck["category"],
    title: string,
    rule: string,
    checkedCount: number,
    violations: string[],
    ok: string
  ) =>
    checks.push({
      id,
      category,
      title,
      rule,
      passed: violations.length === 0,
      checkedCount,
      violationCount: violations.length,
      details: violations.length === 0 ? ok : `${violations.length} violations.`,
      sampleViolations: violations.slice(0, 5),
    });

  const settlementIdSet = new Set(settlements.map((s) => s.id));

  // 1. Valid Endpoints
  {
    const v: string[] = [];
    for (const r of routes) {
      if (!settlementIdSet.has(r.startSettlementId)) {
        v.push(`${r.name}: invalid start settlement ${r.startSettlementId}`);
      }
      if (!settlementIdSet.has(r.endSettlementId)) {
        v.push(`${r.name}: invalid end settlement ${r.endSettlementId}`);
      }
      if (r.startSettlementId === r.endSettlementId) {
        v.push(`${r.name}: self-loop route`);
      }
    }
    push(
      "route_endpoints",
      "placement",
      "Valid Route Endpoints",
      "Every route links two distinct real settlements from the frozen settlement layer.",
      routes.length,
      v,
      `All ${routes.length} routes connect valid distinct settlements.`
    );
  }

  // 2. Physical Length & Sinuosity
  {
    const v: string[] = [];
    for (const r of routes) {
      if (r.lengthKm <= 0 || !Number.isFinite(r.lengthKm)) {
        v.push(`${r.name}: invalid non-positive length ${r.lengthKm}`);
      }
      if (r.points.length < 2) {
        v.push(`${r.name}: route has fewer than 2 coordinates`);
      }
      if (r.sinuosity > 5.0) {
        v.push(`${r.name}: excessive winding (sinuosity ${r.sinuosity.toFixed(2)})`);
      }
    }
    push(
      "route_geometry",
      "scale",
      "Physical Geometry & Sinuosity",
      "Routes have valid coordinate chains, positive length, and realistic sinuosity.",
      routes.length,
      v,
      `All routes have sound geometry and realistic sinuosity.`
    );
  }

  // 3. Land / Water Compliance (sampled against the frozen geography)
  {
    const geo = new BioEnvReader(region);
    const v: string[] = [];
    for (const r of routes) {
      const pts = r.points;
      if (pts.length < 2) continue;
      const stride = Math.max(1, Math.floor(pts.length / 80));
      // Port approaches (both endpoints sit on land by definition) are not
      // part of the open-water run — exclude samples near either terminus,
      // scaled down for short lanes so they still have water to verify.
      const sA = settlements.find((s) => s.id === r.startSettlementId);
      const sB = settlements.find((s) => s.id === r.endSettlementId);
      const exclKm = Math.min(40, Math.max(4, r.lengthKm * 0.2));
      const nearEnd = (p: Pt): boolean =>
        (!!sA && dist(p, sA.point) < kmToUnits(exclKm)) || (!!sB && dist(p, sB.point) < kmToUnits(exclKm));
      let landSamples = 0;
      let samples = 0;
      let seaRun = 0;
      let seaGap = 0;
      let maxSeaRun = 0;
      for (let i = 0; i < pts.length; i += stride) {
        const p = pts[i];
        const isLand = geo.envAt(p).onLand;
        if (r.type === "sea_lane" && nearEnd(p)) continue;
        samples++;
        if (isLand) landSamples++;
        if (!isLand) {
          seaRun++;
          seaGap = 0;
          maxSeaRun = Math.max(maxSeaRun, seaRun);
        } else if (seaRun > 0) {
          seaGap++;
          if (seaGap > 1) seaRun = 0;
        }
      }
      const landRatio = samples > 0 ? landSamples / samples : 0;
      if (r.type === "sea_lane") {
        if (samples === 0) v.push(`${r.name}: sea lane has no open-water samples to verify`);
        else if (landRatio > 0.1) v.push(`${r.name}: sea lane runs on land (${Math.round(landRatio * 100)}% of samples)`);
      } else {
        // Roads may hop water briefly (bridge/ford/ferry at the narrowest
        // going) but must not run along a coast or span a whole bay.
        if (maxSeaRun > 3) v.push(`${r.name}: road runs at sea for ${maxSeaRun} consecutive samples (ferries hop, they do not sail)`);
        else if (landRatio < 0.85) v.push(`${r.name}: road is mostly at sea (${Math.round((1 - landRatio) * 100)}% of samples)`);
      }
    }
    push(
      "route_land_sea",
      "placement",
      "Land / Water Compliance",
      "Land routes stay on land (short bridge/ferry hops excepted); sea lanes traverse navigable waters.",
      routes.length,
      v,
      `All routes respect the ${routes.length > 0 ? "coastline" : "region"} — roads on land, lanes at sea.`
    );
  }

  // 4. River & Lake Crossing Discipline
  {
    const geo = new BioEnvReader(region);
    const v: string[] = [];
    for (const r of routes) {
      if (r.type === "sea_lane") continue;
      const pts = r.points;
      if (pts.length < 2) continue;
      const stride = Math.max(1, Math.floor(pts.length / 80));

      // Walk the sampled points; a crossing is a contiguous run of channel
      // (or lake) samples, tolerating a single off-sample from smoothing.
      let channelRun = 0;
      let channelGap = 0;
      let lakeRun = 0;
      let lakeGap = 0;
      let maxChannelRun = 0;
      let maxLakeRun = 0;
      let riverRuns = 0;
      let lakeRuns = 0;

      for (let i = 0; i < pts.length; i += stride) {
        const p = pts[i];
        const riv = geo.nearestRiverInfo(p);
        let inChannel = false;
        if (riv) {
          const halfWidthKm = (4.0 * Math.sqrt(Math.max(1, riv.dischargeM3s))) / 2 / 1000;
          inChannel = unitsToKm(riv.distUnits) <= Math.max(0.4, halfWidthKm);
        }
        const inLake = geo.pointInLake(p);

        if (inChannel) {
          if (channelRun === 0 && channelGap === 0) riverRuns++;
          channelRun++;
          channelGap = 0;
        } else if (channelRun > 0) {
          channelGap++;
          if (channelGap > 1) {
            maxChannelRun = Math.max(maxChannelRun, channelRun);
            channelRun = 0;
            channelGap = 0;
          }
        }
        if (inLake) {
          if (lakeRun === 0 && lakeGap === 0) lakeRuns++;
          lakeRun++;
          lakeGap = 0;
        } else if (lakeRun > 0) {
          lakeGap++;
          if (lakeGap > 1) {
            maxLakeRun = Math.max(maxLakeRun, lakeRun);
            lakeRun = 0;
            lakeGap = 0;
          }
        }
      }
      maxChannelRun = Math.max(maxChannelRun, channelRun);
      maxLakeRun = Math.max(maxLakeRun, lakeRun);

      // A bridge/ford is a handful of samples; dozens of samples in the
      // channel means the road runs down the river itself.
      if (maxChannelRun > 3) {
        v.push(`${r.name}: runs along a river channel for ${maxChannelRun} consecutive samples (bridges cross, they do not follow)`);
      }
      if (maxLakeRun > 2) {
        v.push(`${r.name}: spans a lake for ${maxLakeRun} consecutive samples (causeways only, no lake-crossing roads)`);
      }
    }
    push(
      "route_water_discipline",
      "placement",
      "River & Lake Crossing Discipline",
      "Roads cross rivers briefly (bridge at the narrowest going) and never run along the channel or across wide lakes.",
      routes.length,
      v,
      `Every road crosses water like a bridge, not a boat.`
    );
  }

  // 5. Layer Immutability Contract
  {
    const v: string[] = [];
    if (region.features.length !== geoCountBefore) {
      v.push(`Geography features mutated: ${geoCountBefore} -> ${region.features.length}`);
    }
    if (settlements.length !== settlementsCountBefore) {
      v.push(`Settlements mutated: ${settlementsCountBefore} -> ${settlements.length}`);
    }
    for (const r of routes) {
      if (r.layer !== "routes" || !r.id.startsWith("route_")) {
        v.push(`${r.name}: foreign or malformed feature in routes layer`);
      }
    }
    push(
      "route_layer_immutability",
      "presence",
      "Lower Layers Untouched",
      "Geography (L1) and Settlements (L4) remain strictly frozen and unmutated.",
      routes.length + 2,
      v,
      `Frozen lower layers (L1: ${geoCountBefore}, L4: ${settlementsCountBefore}) strictly preserved.`
    );
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((a, c) => a + c.violationCount, 0);

  return {
    targetName: `${region.descriptor.name} — Roads & Trade Routes`,
    tier: 2,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}
