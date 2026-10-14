import type { RouteFeature, RouteFinetuneReport, RouteStats } from "./route-types";
import type { Settlement } from "../human/human-types";

// ---------------------------------------------------------------------------
// LAYER 6 FINETUNING — DE-DUPLICATION, TRUNK MERGING & NETWORK STATS
// ---------------------------------------------------------------------------

export function runRouteFinetune(
  rawRoutes: RouteFeature[],
  settlements: Settlement[]
): { routes: RouteFeature[]; stats: RouteStats; report: RouteFinetuneReport } {
  const t0 = performance.now();
  const kept: RouteFeature[] = [];
  const droppedByRule: Record<string, number> = {};
  let prunedDuplicates = 0;

  // 1. De-duplicate reverse routes (A-B vs B-A) and exact duplicates
  const edgeKey = (a: string, b: string) => (a < b ? `${a}--${b}` : `${b}--${a}`);
  const seenEdges = new Map<string, RouteFeature>();

  for (const r of rawRoutes) {
    const key = edgeKey(r.startSettlementId, r.endSettlementId);
    const existing = seenEdges.get(key);
    if (!existing) {
      seenEdges.set(key, r);
    } else {
      prunedDuplicates++;
      droppedByRule["duplicate_edge"] = (droppedByRule["duplicate_edge"] ?? 0) + 1;
      // Keep the paved or higher-priority highway
      if (r.paved && !existing.paved) {
        seenEdges.set(key, r);
      } else if (r.type === "highway" && existing.type !== "highway") {
        seenEdges.set(key, r);
      }
    }
  }

  // 2. Collect deduplicated list
  for (const r of seenEdges.values()) {
    // If route crossed mountain ridges, ensure it has mountain_pass designation if not a royal highway
    if (r.mountainPassesCount >= 2 && r.type === "byway") {
      r.type = "mountain_pass";
      r.name = r.name.replace(/Track|Trail|Byway/, "Pass Trail");
    }
    kept.push(r);
  }

  // 3. Compute Stats
  let totalKm = 0;
  let highwaysKm = 0;
  let arterialsKm = 0;
  let bywaysKm = 0;
  let seaLanesKm = 0;
  let highwaysCount = 0;
  let arterialsCount = 0;
  let bywaysCount = 0;
  let seaLanesCount = 0;
  let pavedKm = 0;
  let bridgesCount = 0;
  let longestRouteName = "";
  let longestRouteKm = 0;

  const connectedIds = new Set<string>();

  for (const r of kept) {
    totalKm += r.lengthKm;
    if (r.paved) pavedKm += r.lengthKm;
    bridgesCount += r.bridgesCount;

    connectedIds.add(r.startSettlementId);
    connectedIds.add(r.endSettlementId);

    if (r.lengthKm > longestRouteKm) {
      longestRouteKm = r.lengthKm;
      longestRouteName = r.name;
    }

    if (r.type === "highway") {
      highwaysKm += r.lengthKm;
      highwaysCount++;
    } else if (r.type === "arterial") {
      arterialsKm += r.lengthKm;
      arterialsCount++;
    } else if (r.type === "sea_lane") {
      seaLanesKm += r.lengthKm;
      seaLanesCount++;
    } else {
      bywaysKm += r.lengthKm;
      bywaysCount++;
    }
  }

  const settledNodes = settlements.filter((s) => s.tier !== "nomadic");
  const connectedNonNomadic = settledNodes.filter((s) => connectedIds.has(s.id)).length;
  const connectivityRatio =
    settledNodes.length > 0 ? Math.round((connectedNonNomadic / settledNodes.length) * 100) / 100 : 1;

  const stats: RouteStats = {
    totalRoutes: kept.length,
    totalKm: Math.round(totalKm),
    highwaysKm: Math.round(highwaysKm),
    arterialsKm: Math.round(arterialsKm),
    bywaysKm: Math.round(bywaysKm),
    seaLanesKm: Math.round(seaLanesKm),
    highwaysCount,
    arterialsCount,
    bywaysCount,
    seaLanesCount,
    pavedKm: Math.round(pavedKm),
    bridgesCount,
    connectedSettlementsCount: connectedIds.size,
    connectivityRatio,
    longestRouteName,
    longestRouteKm: Math.round(longestRouteKm),
  };

  const report: RouteFinetuneReport = {
    rawRoutesCount: rawRoutes.length,
    prunedDuplicates,
    relocatedOffOcean: 0,
    bridgesAdded: bridgesCount,
    finalRoutesCount: kept.length,
    droppedByRule,
    elapsedMs: Math.round(performance.now() - t0),
  };

  return { routes: kept, stats, report };
}
