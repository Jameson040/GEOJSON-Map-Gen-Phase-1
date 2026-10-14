import type { GeneratedRegion } from "../types";
import type { Settlement } from "../human/human-types";
import type { ResourceLayerResult } from "../resources";
import type {
  RouteConfig,
  RouteFeature,
  RouteLayerResult,
  RouteProgressFn,
  RouteType,
} from "./route-types";
import { DEFAULT_ROUTE_CONFIG } from "./route-types";
import { RoutePathfinder } from "./route-pathfinder";
import { nameRoute } from "./route-names";
import { runRouteFinetune } from "./route-finetune";
import { verifyRouteLayer } from "./route-verifier";
import { makeRng } from "../rng";
import { dist } from "../geom";
import { kmToUnits, unitsToKm } from "../constants";
import { TIER_RANK } from "../human/settlement-catalog";

// ---------------------------------------------------------------------------
// LAYER 6 ROUTE GENERATOR — CENTRAL-PLACE ROAD & TRADE NETWORK SYNTHESIS
// ---------------------------------------------------------------------------

let uid = 0;
const nid = () => `route_${++uid}`;

function associateGoods(sA: Settlement, sB: Settlement, resources?: ResourceLayerResult | null): string[] {
  const goods = new Set<string>();
  if (resources?.deposits.length) {
    for (const d of resources.deposits) {
      if (dist(d.point, sA.point) < kmToUnits(25) || dist(d.point, sB.point) < kmToUnits(25)) {
        goods.add(d.name.toLowerCase());
      }
    }
  }
  const addFrom = (s: Settlement) => {
    if (s.type.includes("mining")) {
      goods.add("iron");
      goods.add("copper");
      goods.add("stone");
    } else if (s.type.includes("farm") || s.type.includes("river")) {
      goods.add("grain");
      goods.add("flour");
      goods.add("ale");
    } else if (s.type.includes("port") || s.type.includes("fish")) {
      goods.add("salt");
      goods.add("fish");
      goods.add("spices");
    } else if (s.type.includes("forest") || s.type.includes("logging")) {
      goods.add("timber");
      goods.add("charcoal");
    } else if (s.type.includes("capital")) {
      goods.add("silk");
      goods.add("coin");
      goods.add("fine textiles");
    } else if (s.type.includes("herding") || s.type.includes("pastoral")) {
      goods.add("wool");
      goods.add("leather");
      goods.add("cheese");
    }
  };
  addFrom(sA);
  addFrom(sB);
  if (goods.size === 0) goods.add("produce");
  return Array.from(goods).slice(0, 4);
}

export async function generateRouteLayer(
  region: GeneratedRegion,
  settlements: Settlement[],
  config: RouteConfig = DEFAULT_ROUTE_CONFIG,
  onProgress?: RouteProgressFn,
  resources?: ResourceLayerResult | null
): Promise<RouteLayerResult> {
  uid = 0;
  const t0 = performance.now();
  const seedUsed = `${region.descriptor.regionSeed}::routes::${config.customSeed ?? "default"}`;
  const rng = makeRng(seedUsed);

  const tick = async (stage: number, stageName: string, percent: number, count: number) => {
    onProgress?.({
      stage,
      totalStages: 5,
      stageName,
      percent,
      featuresCount: count,
      elapsedMs: Math.round(performance.now() - t0),
    });
    await new Promise((r) => setTimeout(r, 0));
  };

  const geoCountBefore = region.features.length;
  const settlementsCountBefore = settlements.length;

  // Stage 1: Build terrain-aware pathfinding cost surface
  await tick(1, "Analyzing Terrain & River Valleys", 15, 0);
  const pathfinder = new RoutePathfinder(region);

  // Group settlements by structural rank
  const cities = settlements.filter((s) => TIER_RANK[s.tier] >= 4);
  const towns = settlements.filter((s) => TIER_RANK[s.tier] === 3);
  const villages = settlements.filter((s) => TIER_RANK[s.tier] === 2);
  const hamlets = settlements.filter((s) => TIER_RANK[s.tier] === 1);
  const ports = settlements.filter(
    (s) =>
      s.type === "port_city" ||
      s.type === "port_town" ||
      s.type === "port_metropolis" ||
      s.type === "fishing_village" ||
      s.type === "seasonal_fishing_camp"
  );

  const rawRoutes: RouteFeature[] = [];
  const connectedPairs = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}--${b}` : `${b}--${a}`);

  const addRoute = (
    sA: Settlement,
    sB: Settlement,
    type: RouteType,
    paved: boolean,
    lodZoom: number,
    isSea = false
  ) => {
    const key = pairKey(sA.id, sB.id);
    if (connectedPairs.has(key)) return;

    const pathRes = pathfinder.findRoute(sA.point, sB.point, isSea);
    if (!pathRes) return; // e.g. inland "port" — no viable maritime lane
    connectedPairs.add(key);

    const straightKm = Math.round(unitsToKm(dist(sA.point, sB.point)) * 10) / 10;
    const sinuosity = straightKm > 0 ? Math.round((pathRes.lengthKm / straightKm) * 100) / 100 : 1;
    const tradeGoods = associateGoods(sA, sB, resources);

    const feature: RouteFeature = {
      id: nid(),
      layer: "routes",
      name: nameRoute(rng, type, sA.name, sB.name, tradeGoods),
      type,
      startSettlementId: sA.id,
      startSettlementName: sA.name,
      startTier: sA.tier,
      endSettlementId: sB.id,
      endSettlementName: sB.name,
      endTier: sB.tier,
      points: pathRes.points,
      lengthKm: pathRes.lengthKm,
      straightKm,
      sinuosity,
      paved,
      bridgesCount: pathRes.bridgesCount,
      mountainPassesCount: pathRes.mountainPassesCount,
      lakeCrossings: pathRes.lakeCrossings,
      tradeGoods,
      lodZoom,
    };

    rawRoutes.push(feature);
    if (!isSea) {
      pathfinder.markCorridor(pathRes.points);
    }
  };

  // Stage 2: Maritime Shipping Lanes between coastal ports
  await tick(2, "Surveying Maritime Shipping Corridors", 35, rawRoutes.length);
  if (config.coastalShipping && ports.length >= 2) {
    for (let i = 0; i < ports.length; i++) {
      const pA = ports[i];
      // Connect to closest 1 or 2 other ports within sea reach
      const peers = ports
        .filter((p) => p.id !== pA.id)
        .map((pB) => ({ port: pB, d: unitsToKm(dist(pA.point, pB.point)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);

      for (const peer of peers) {
        if (peer.d <= 400 * config.density) {
          addRoute(pA, peer.port, "sea_lane", false, 0.8, true);
        }
      }
    }
  }

  // Stage 3: King's Highways between Cities, Metropolises & Capitals
  await tick(3, "Engineering Royal Trunk Highways", 55, rawRoutes.length);
  if (cities.length >= 2) {
    for (let i = 0; i < cities.length; i++) {
      const cA = cities[i];
      const peers = cities
        .filter((c) => c.id !== cA.id)
        .map((cB) => ({ city: cB, d: unitsToKm(dist(cA.point, cB.point)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.min(3, Math.round(2 * config.density)));

      for (const peer of peers) {
        if (peer.d <= 350) {
          addRoute(cA, peer.city, "highway", true, 0, false);
        }
      }
    }

    // Relay rule: two cities too far apart for a direct trunk (350–700 km)
    // are joined THROUGH an intermediate settlement near the straight
    // corridor — roads divert to (and through) the wayside city instead of
    // spanning the empty distance. Both legs must stay within the trunk cap
    // and the detour must remain sane.
    const farPairs: { a: Settlement; b: Settlement; d: number }[] = [];
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const d = unitsToKm(dist(cities[i].point, cities[j].point));
        if (d > 350 && d <= 700) farPairs.push({ a: cities[i], b: cities[j], d });
      }
    }
    farPairs.sort((x, y) => y.d - x.d || x.a.id.localeCompare(y.a.id));

    const relayHubs = [...cities, ...towns];
    for (const pair of farPairs) {
      const key = pairKey(pair.a.id, pair.b.id);
      if (connectedPairs.has(key)) continue;
      let best: { hub: Settlement; detour: number } | null = null;
      for (const hub of relayHubs) {
        if (hub.id === pair.a.id || hub.id === pair.b.id) continue;
        const legA = unitsToKm(dist(pair.a.point, hub.point));
        const legB = unitsToKm(dist(hub.point, pair.b.point));
        if (legA > 350 || legB > 350) continue;
        const detour = legA + legB - pair.d;
        if (detour > 0.55 * pair.d) continue; // absurd dog-leg, skip
        const rank = -TIER_RANK[hub.tier];
        const score = detour * 1000 + rank; // prefer short detour, then higher tier
        const bestScore = best ? best.detour * 1000 - TIER_RANK[best.hub.tier] : Infinity;
        if (score < bestScore) best = { hub, detour };
      }
      if (best) {
        addRoute(pair.a, best.hub, "highway", true, 0, false);
        addRoute(best.hub, pair.b, "highway", true, 0, false);
      }
    }
  }

  // Stage 4: Regional Market Arterials & Feeder Tracks
  await tick(4, "Mapping Regional Market Roads & Byways", 75, rawRoutes.length);
  // Connect each Town to nearest City (or superior Town)
  for (const t of towns) {
    // 1. Connect to nearest City
    if (cities.length > 0) {
      const nearestCity = [...cities]
        .map((c) => ({ node: c, d: unitsToKm(dist(t.point, c.point)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearestCity && nearestCity.d <= 140) {
        addRoute(t, nearestCity.node, "arterial", rng() < config.pavedHighwayShare, 0.8, false);
      }
    }
    // 2. Connect to nearest neighboring Town
    const neighborTowns = towns
      .filter((o) => o.id !== t.id)
      .map((o) => ({ node: o, d: unitsToKm(dist(t.point, o.point)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(1, Math.round(1.5 * config.density)));

    for (const nb of neighborTowns) {
      if (nb.d <= 75) {
        addRoute(t, nb.node, "arterial", rng() < config.pavedHighwayShare * 0.5, 1.2, false);
      }
    }
  }

  // Connect Villages to nearest Town (or peer Village)
  const townOrCity = [...cities, ...towns];
  for (const v of villages) {
    if (townOrCity.length > 0) {
      const nearestHub = [...townOrCity]
        .map((h) => ({ node: h, d: unitsToKm(dist(v.point, h.point)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearestHub && nearestHub.d <= 50) {
        addRoute(v, nearestHub.node, "byway", false, 2.0, false);
        continue;
      }
    }
    // Fallback: connect to peer village
    const peerVillage = villages
      .filter((o) => o.id !== v.id)
      .map((o) => ({ node: o, d: unitsToKm(dist(v.point, o.point)) }))
      .sort((a, b) => a.d - b.d)[0];
    if (peerVillage && peerVillage.d <= 30) {
      addRoute(v, peerVillage.node, "byway", false, 2.0, false);
    }
  }

  // Connect Hamlets & Mining Camps to nearest Village or Town
  const superiorHubs = [...cities, ...towns, ...villages];
  for (const h of hamlets) {
    if (superiorHubs.length > 0) {
      const nearestHub = [...superiorHubs]
        .map((o) => ({ node: o, d: unitsToKm(dist(h.point, o.point)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearestHub && nearestHub.d <= 35) {
        const isMining = h.type.includes("mining");
        addRoute(h, nearestHub.node, isMining ? "arterial" : "byway", false, 2.5, false);
      }
    }
  }

  // Stage 5: Finetuning, De-duplication & Verification
  await tick(5, "Finetuning Corridors & Invariant Verification", 90, rawRoutes.length);
  const verifyBefore = verifyRouteLayer(rawRoutes, settlements, region, geoCountBefore, settlementsCountBefore);
  const { routes, stats, report } = runRouteFinetune(rawRoutes, settlements);
  const verifyAfter = verifyRouteLayer(routes, settlements, region, geoCountBefore, settlementsCountBefore);

  await tick(5, "Trade Route Network Complete", 100, routes.length);

  return {
    regionId: region.descriptor.id,
    regionName: region.descriptor.name,
    config,
    seedUsed,
    routes,
    rawRoutes,
    stats,
    report,
    verifyBefore,
    verifyAfter,
    generatedAt: Date.now(),
  };
}
