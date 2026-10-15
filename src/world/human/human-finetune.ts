import type { GeneratedRegion, Pt, RegionCompartment } from "../types";
import type {
  HumanConfig,
  HumanFinetuneReport,
  HumanLogEntry,
  Settlement,
  SettlementDef,
  SettlementDiff,
  SettlementTier,
} from "./human-types";
import { HumanEnvReader } from "./human-env";
import { SETTLEMENT_BY_TYPE, SETTLEMENT_CATALOG, TIER_CAPS, TIER_DENSITY_PER_MKM2, TIER_ORDER, TIER_RANK } from "./settlement-catalog";
import { settlementSpacingKm } from "./human-rules";
import { makeSettlement, chooseHabitation } from "./human-generate";
import type { RNG } from "../rng";
import { dist } from "../geom";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// LAYER 4 FINETUNE — rule half of the adversarial pair for HABITABLE SITES.
// Population-free: rules judge whether a place is LIVABLE, never how many
// people live there. Structural capacity is a site property only.
//   R1 site — on land, off glacier, no forbidden biome, hard needs met
//   R2 water — a site within reach of fresh water (or coast for sea sites)
//   R3 resources — the frozen biosphere supplies its required food roles
//   R4 capacity — capacity is computed from real resources & scaled down;
//                  excessive sites are DEMOTED (metropolis→city→town…)
//   R5 spacing — competing sites of same/higher tier keep distance, smaller yields
//   R6 caps — per-tier caps scale with land area; hierarchy-aware floors
//   R7 hierarchy — towns need villages, cities need towns, one capital
// ---------------------------------------------------------------------------

function compartmentAt(p: Pt, comps: RegionCompartment[]): number {
  for (const c of comps) {
    if (p[0] >= c.bbox.minX && p[0] <= c.bbox.maxX && p[1] >= c.bbox.minY && p[1] <= c.bbox.maxY) return c.id;
  }
  return -1;
}

function sampleFor(def: SettlementDef, env: HumanEnvReader, rng: RNG): Pt | null {
  if (def.needs.includes("coast")) return env.randomCoastPoint(rng);
  if (def.needs.includes("river")) return env.randomRiverSite(rng);
  if (def.prefers.includes("river") && rng() < 0.65) return env.randomRiverSite(rng);
  if (def.waterKm <= 12 && rng() < 0.55) return env.randomRiverSite(rng) ?? env.randomCoastPoint(rng);
  if (def.prefers.includes("coast") && rng() < 0.45) return env.randomCoastPoint(rng);
  if ((def.prefers.includes("minerals") || def.type === "mining_camp" || def.type === "mining_town") && env.resources?.deposits.length && rng() < 0.7) {
    const d = env.resources.deposits[Math.floor(rng() * env.resources.deposits.length)];
    return [d.point[0] + (rng() - 0.5) * kmToUnits(15), d.point[1] + (rng() - 0.5) * kmToUnits(15)];
  }
  if (def.needs.includes("oasis") || def.needs.includes("desert")) {
    const cs = env.geo.biomeCentres(["desert"]);
    if (cs.length) {
      const c = cs[Math.floor(rng() * cs.length)];
      return [c[0] + (rng() - 0.5) * kmToUnits(200), c[1] + (rng() - 0.5) * kmToUnits(200)];
    }
  }
  if (def.needs.includes("mountain") || def.needs.includes("highland")) return env.randomLandPoint(rng, 0.2);
  if (def.needs.includes("forest")) {
    const cs = env.geo.biomeCentres(["forest"]);
    if (cs.length) {
      const c = cs[Math.floor(rng() * cs.length)];
      return [c[0] + (rng() - 0.5) * kmToUnits(150), c[1] + (rng() - 0.5) * kmToUnits(150)];
    }
  }
  if (def.needs.includes("pasture")) {
    const cs = env.geo.biomeCentres(["grassland", "savanna", "tundra"]);
    if (cs.length) {
      const c = cs[Math.floor(rng() * cs.length)];
      return [c[0] + (rng() - 0.5) * kmToUnits(150), c[1] + (rng() - 0.5) * kmToUnits(150)];
    }
  }
  return env.randomLandPoint(rng, 0.05);
}

function findSite(def: SettlementDef, env: HumanEnvReader, rng: RNG, tries: number) {
  let best: { p: Pt; rep: ReturnType<HumanEnvReader["evaluate"]> } | null = null;
  for (let t = 0; t < tries; t++) {
    const p = sampleFor(def, env, rng);
    if (!p) continue;
    const rep = env.evaluate(def, p);
    if (!rep.ok) continue;
    if (!best || rep.score > best.rep.score) best = { p, rep };
    if (best.rep.score > 3) break;
  }
  return best;
}

/** Structural capacity score 0..1 of a spot, from resources actually present. */
function capacityScore(env: HumanEnvReader, p: Pt, def: SettlementDef): number {
  const food = env.foodWithin(p, def.supplyKm);
  let cap = 0.22;
  for (const f of food) {
    const w = f.abundance;
    if (f.roles.includes("staple")) cap += 0.22 * w;
    if (f.roles.includes("protein")) cap += 0.1 * w;
    if (f.roles.includes("meat") || f.roles.includes("dairy")) cap += 0.07 * w;
    if (f.roles.includes("fishery")) cap += 0.09 * w;
    if (f.roles.includes("vegetable") || f.roles.includes("fruit")) cap += 0.05 * w;
  }
  if (env.resources && (def.type === "mining_camp" || def.type === "mining_town")) {
    const mins = env.mineralsWithin(p, def.supplyKm);
    if (mins.length > 0) cap += 0.35;
  }
  const radiusBoost = Math.max(1, def.supplyKm / 60);
  return Math.min(1, Math.round(cap * radiusBoost * 100) / 100);
}

function demoteDef(def: SettlementDef): SettlementDef | null {
  const rank = TIER_RANK[def.tier];
  if (rank === 0) return null;
  const lowerTier = TIER_ORDER[rank - 1];
  const pool = SETTLEMENT_CATALOG.filter((d) => d.tier === lowerTier);
  const same = pool.filter((d) => d.needs.some((n) => def.needs.includes(n)));
  const src = same.length ? same : pool;
  return src[0] ?? null;
}

enum SpacingOutcome { Keep, Absorb, Moved }

export function runHumanFinetune(
  raw: Settlement[],
  env: HumanEnvReader,
  region: GeneratedRegion,
  config: HumanConfig,
  rng: RNG
): { settlements: Settlement[]; report: HumanFinetuneReport; log: HumanLogEntry[]; diffs: SettlementDiff[] } {
  const t0 = performance.now();
  const comps = region.compartments;
  const log: HumanLogEntry[] = [];
  const diffs: SettlementDiff[] = [];
  const droppedByRule: Record<string, number> = {};
  let keptAsIs = 0;
  let relocated = 0;
  let resized = 0;
  let dropped = 0;
  let demotions = 0;
  const drop = (rule: string, text: string) => {
    dropped++;
    droppedByRule[rule] = (droppedByRule[rule] ?? 0) + 1;
    if (log.length < 260) log.push({ action: "drop", rule, text });
  };

  const ordered = [...raw].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.popCap - a.popCap);
  const kept: Settlement[] = [];

  for (const s0 of ordered) {
    let s = { ...s0 };
    let def = SETTLEMENT_BY_TYPE.get(s.type)!;

    // --- R1–R3: site, water, resources ---------------------------------------
    let placed: { p: Pt; rep: ReturnType<HumanEnvReader["evaluate"]> } | null = null;
    let demotedFrom: string | null = null;
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      if (!demotedFrom) {
        const inPlace = env.evaluate(def, s.point);
        if (inPlace.ok) {
          placed = { p: s.point, rep: inPlace };
          break;
        }
        const site = findSite(def, env, rng, 14);
        if (site) {
          placed = site;
          s.origin = `relocated (${inPlace.rule})`;
          relocated++;
          if (log.length < 260) log.push({ action: "relocate", rule: inPlace.rule!, text: `${s.name} (${def.name}) violated "${inPlace.rule}" and moved to a livable site.` });
          break;
        }
      } else {
        const site = findSite(def, env, rng, 14);
        if (site) {
          placed = site;
          break;
        }
      }
      const lower = demoteDef(def);
      if (!lower) break;
      demotedFrom = demotedFrom ?? def.name;
      def = lower;
      demotions++;
    }
    if (!placed) {
      drop("no_viable_site", `${s.name} (${SETTLEMENT_BY_TYPE.get(s.type)!.name}) — no livable site in this region.`);
      continue;
    }
    if (demotedFrom) {
      s.type = def.type;
      s.tier = def.tier;
      s.glyph = def.glyph;
      s.popCap = Math.round(Math.min(s.popCap, def.popCap[1]));
      s.origin = `demoted from ${demotedFrom}`;
      resized++;
      diffs.push({ id: s.id, type: s.type, beforeCap: s0.popCap, afterCap: s.popCap, note: `demoted from ${demotedFrom}` });
      if (log.length < 260) log.push({ action: "resize", rule: "demotion", text: `${s.name}: no viable ${demotedFrom} site — re-marked as a ${def.name}.` });
    }
    s.point = placed.p;
    s.compartmentId = compartmentAt(placed.p, comps);
    s.siteTraits = placed.rep.traits;
    s.resourceRoles = placed.rep.supplies;
    s.waterSource = placed.rep.waterSource;
    s.lodZoom = TIER_RANK[def.tier] >= 4 ? 0 : TIER_RANK[def.tier] === 3 ? 0.9 : TIER_RANK[def.tier] === 2 ? 2 : 3.2;

    // --- R4: structural capacity vs. food actually present ----------------------
    let cap = capacityScore(env, s.point, def);
    while (s.popCap > def.popCap[1] * (0.2 + 0.8 * cap) && TIER_RANK[def.tier] > 0) {
      const lower = demoteDef(def);
      if (!lower) break;
      if (log.length < 260) log.push({ action: "resize", rule: "carrying_capacity", text: `${s.name}: a ${def.name} (cap ${s.popCap.toLocaleString()}) outgrew its resource base (score ${cap.toFixed(2)}) — re-marked as a ${lower.name}.` });
      def = lower;
      s.type = def.type;
      s.tier = def.tier;
      s.glyph = def.glyph;
      s.popCap = Math.min(s.popCap, def.popCap[1]);
      demotions++;
      resized++;
      diffs.push({ id: s.id, type: s.type, beforeCap: undefined, afterCap: s.popCap, note: "capacity demotion" });
      const again = env.evaluate(def, s.point);
      if (!again.ok) {
        const site = findSite(def, env, rng, 12);
        if (!site) {
          drop("carrying_capacity", `${s.name} has no food-secure site at any size here.`);
          continue;
        }
        s.point = site.p;
        s.compartmentId = compartmentAt(site.p, comps);
        s.siteTraits = site.rep.traits;
        s.resourceRoles = site.rep.supplies;
        s.waterSource = site.rep.waterSource;
        relocated++;
      } else {
        s.siteTraits = again.traits;
        s.resourceRoles = again.supplies;
        s.waterSource = again.waterSource;
      }
      cap = capacityScore(env, s.point, def);
    }
    s.capacity = cap;
    s.lodZoom = TIER_RANK[def.tier] >= 4 ? 0 : TIER_RANK[def.tier] === 3 ? 0.9 : TIER_RANK[def.tier] === 2 ? 2 : 3.2;
    if (s.origin === s0.origin && !demotedFrom) keptAsIs++;
    kept.push(s);
  }

  // --- R5: spacing -------------------------------------------------------------
  const final: Settlement[] = [];
  const sortedKept = [...kept].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.popCap - a.popCap);
  for (const s of sortedKept) {
    const def = SETTLEMENT_BY_TYPE.get(s.type)!;
    const crowded = final.find((o) => {
      const oDef = SETTLEMENT_BY_TYPE.get(o.type)!;
      return dist(o.point, s.point) < kmToUnits(settlementSpacingKm(def, oDef));
    });
    if (!crowded) {
      final.push(s);
      continue;
    }
    const site = findSite(def, env, rng, 10);
    if (
      site &&
      !final.some((o) => {
        const oDef = SETTLEMENT_BY_TYPE.get(o.type)!;
        return dist(o.point, site.p) < kmToUnits(settlementSpacingKm(def, oDef));
      })
    ) {
      final.push({ ...s, point: site.p, compartmentId: compartmentAt(site.p, comps), siteTraits: site.rep.traits, resourceRoles: site.rep.supplies, waterSource: site.rep.waterSource, origin: `relocated (spacing from ${crowded.name})` });
      relocated++;
      continue;
    }
    const lower = demoteDef(def);
    if (lower && TIER_RANK[def.tier] >= 2) {
      const ev = env.evaluate(lower, s.point);
      const stillCrowded = final.some((o) => {
        const oDef = SETTLEMENT_BY_TYPE.get(o.type)!;
        return dist(o.point, s.point) < kmToUnits(settlementSpacingKm(lower, oDef));
      });
      if (ev.ok && !stillCrowded) {
        final.push({ ...s, type: lower.type, tier: lower.tier, glyph: lower.glyph, popCap: Math.min(s.popCap, lower.popCap[1]), siteTraits: ev.traits, resourceRoles: ev.supplies, origin: `demoted (too close to ${crowded.name})`, lodZoom: 3.2 });
        demotions++;
        continue;
      }
    }
    drop("spacing", `${s.name} (${def.name}) sat inside ${crowded.name}'s central-place buffer zone and was absorbed.`);
  }

  // --- R6: per-tier caps --------------------------------------------------------
  const mkm2 = region.descriptor.areaKm2 / 1e6;
  const out: Settlement[] = [];
  const hasCityLike = final.some((s) => TIER_RANK[s.tier] >= 4);
  const hasTownLike = final.some((s) => TIER_RANK[s.tier] >= 3);
  for (const tier of TIER_ORDER) {
    const group = final.filter((s) => s.tier === tier).sort((a, b) => b.popCap - a.popCap);
    let cap = Math.max(tier === "metropolis" ? 0 : 1, Math.min(TIER_CAPS[tier], Math.round(TIER_DENSITY_PER_MKM2[tier] * mkm2 * config.density + (tier === "metropolis" ? 0 : 1))));
    if (tier === "town" && hasCityLike) cap = Math.max(cap, 2);
    if (tier === "village" && hasTownLike) cap = Math.max(cap, 2);
    out.push(...group.slice(0, cap));
    const excess = group.length - cap;
    if (excess > 0) {
      dropped += excess;
      droppedByRule[`cap_${tier}`] = (droppedByRule[`cap_${tier}`] ?? 0) + excess;
    }
  }

  // --- R7: hierarchy & completeness ---------------------------------------------
  let added = 0;
  const has = (t: SettlementTier) => out.some((s) => s.tier === t);
  const spacedOK = (def: SettlementDef, p: Pt) => {
    return !out.some((o) => {
      const oDef = SETTLEMENT_BY_TYPE.get(o.type)!;
      return dist(o.point, p) < kmToUnits(settlementSpacingKm(def, oDef));
    });
  };
  const addOne = (def: SettlementDef, why: string) => {
    let site: ReturnType<typeof findSite> = null;
    for (let t = 0; t < 4 && !site; t++) {
      const cand = findSite(def, env, rng, 24);
      if (cand && spacedOK(def, cand.p)) site = cand;
    }
    if (!site) return false;
    const s = makeSettlement(rng, def, site.p, comps, `added (${why})`);
    s.siteTraits = site.rep.traits;
    s.resourceRoles = site.rep.supplies;
    s.waterSource = site.rep.waterSource;
    out.push(s);
    added++;
    log.push({ action: "add", rule: "hierarchy", text: `${why}: marked ${s.name} (${def.name}).` });
    return true;
  };
  const demoteTierInPlace = (fromRank: number, why: string) => {
    for (const s of out) {
      if (TIER_RANK[s.tier] < fromRank) continue;
      let def = SETTLEMENT_BY_TYPE.get(s.type)!;
      let lower = demoteDef(def);
      while (lower) {
        const ev = env.evaluate(lower, s.point);
        if (ev.ok) break;
        const site = findSite(lower, env, rng, 10);
        if (site) {
          s.point = site.p;
          s.compartmentId = compartmentAt(site.p, comps);
          break;
        }
        def = lower;
        lower = demoteDef(def);
      }
      if (!lower) continue;
      const ev = env.evaluate(lower, s.point);
      s.type = lower.type;
      s.tier = lower.tier;
      s.glyph = lower.glyph;
      s.popCap = Math.min(s.popCap, lower.popCap[1]);
      s.siteTraits = ev.traits;
      s.resourceRoles = ev.supplies;
      s.waterSource = ev.waterSource;
      s.origin = `demoted (${why})`;
      s.lodZoom = TIER_RANK[lower.tier] >= 4 ? 0 : TIER_RANK[lower.tier] === 3 ? 0.9 : TIER_RANK[lower.tier] === 2 ? 2 : 3.2;
      demotions++;
      if (log.length < 260) log.push({ action: "resize", rule: "hierarchy", text: `${s.name}: ${why} — re-marked as a ${lower.name}.` });
    }
  };
  if (has("city") || has("metropolis")) {
    const ok =
      has("town") ||
      addOne(SETTLEMENT_BY_TYPE.get("market_town")!, "a city needs market towns") ||
      addOne(SETTLEMENT_BY_TYPE.get("port_town")!, "a city needs a port town") ||
      addOne(SETTLEMENT_BY_TYPE.get("river_town")!, "a city needs a river town");
    if (!ok) demoteTierInPlace(4, "no town can exist in this region to support a city");
  }
  if (has("town")) {
    const ok =
      has("village") ||
      addOne(SETTLEMENT_BY_TYPE.get("farming_village")!, "towns need feeding villages") ||
      addOne(SETTLEMENT_BY_TYPE.get("fishing_village")!, "towns need feeding villages") ||
      addOne(SETTLEMENT_BY_TYPE.get("river_village")!, "towns need feeding villages");
    if (!ok) demoteTierInPlace(3, "no village can exist here to feed a town");
  }

  const capitals = out.filter((s) => s.type === "capital_city").sort((a, b) => b.popCap - a.popCap);
  if (capitals.length > 1) {
    for (const extra of capitals.slice(1)) {
      const trade = SETTLEMENT_BY_TYPE.get("trade_city")!;
      const site = env.evaluate(trade, extra.point);
      if (!site.ok) {
        out.splice(out.indexOf(extra), 1);
        drop("capital_site", `${extra.name} cannot be re-marked as a viable trade-city site.`);
        continue;
      }
      extra.type = "trade_city";
      extra.tier = trade.tier;
      extra.glyph = trade.glyph;
      extra.popCap = Math.min(extra.popCap, trade.popCap[1]);
      extra.siteTraits = site.traits;
      extra.resourceRoles = site.supplies;
      extra.waterSource = site.waterSource;
      extra.origin = "demoted (one capital per region)";
      demotions++;
    }
  } else if (capitals.length === 0 && (has("city") || has("metropolis"))) {
    const capital = SETTLEMENT_BY_TYPE.get("capital_city")!;
    const best = out.filter((s) => TIER_RANK[s.tier] >= 4 && s.popCap <= capital.popCap[1] && env.evaluate(capital, s.point).ok).sort((a, b) => b.popCap - a.popCap)[0];
    if (best) {
      const site = env.evaluate(capital, best.point);
      best.type = "capital_city";
      best.tier = capital.tier;
      best.glyph = capital.glyph;
      best.siteTraits = site.traits;
      best.resourceRoles = site.supplies;
      best.waterSource = site.waterSource;
      best.origin = "promoted (regional capital)";
      log.push({ action: "resize", rule: "hierarchy", text: `${best.name} marked as the regional capital site.` });
    }
  }
  const hasFishery = env.bio.populations.some((b) => b.roles.includes("fishery"));
  if (hasFishery && !out.some((s) => s.type.startsWith("port") || s.type.includes("fishing"))) {
    addOne(SETTLEMENT_BY_TYPE.get("fishing_village")!, "coastal fishery with no fishing site");
  }
  if (out.length === 0) {
    addOne(SETTLEMENT_BY_TYPE.get("farmstead")!, "empty region") ||
      addOne(SETTLEMENT_BY_TYPE.get("fishing_hamlet")!, "empty region") ||
      addOne(SETTLEMENT_BY_TYPE.get("hunter_camp")!, "empty region") ||
      addOne(SETTLEMENT_BY_TYPE.get("pastoral_camp")!, "empty region");
  }

  // --- Final sweep ---------------------------------------------------------------
  let swept: Settlement[] = out;
  for (let pass = 0; pass < 6; pass++) {
    const next: Settlement[] = [];
    let changed = false;
    for (const s of [...swept].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.popCap - a.popCap)) {
      const def = SETTLEMENT_BY_TYPE.get(s.type)!;
      const viable = env.evaluate(def, s.point);
      if (!viable.ok || s.tier !== def.tier || s.popCap > def.popCap[1]) {
        changed = true;
        drop("final_site", `${s.name} failed its final type's livability or cap check.`);
        continue;
      }
      const clash = next.find((o) => {
        const da = SETTLEMENT_BY_TYPE.get(s.type)!;
        const db = SETTLEMENT_BY_TYPE.get(o.type)!;
        const minKm = TIER_RANK[db.tier] >= TIER_RANK[da.tier] ? da.spacingKm : db.spacingKm;
        return dist(o.point, s.point) < kmToUnits(minKm);
      });
      if (!clash) next.push(s);
      else {
        changed = true;
        drop("spacing", `${s.name} (${def.name}) absorbed by ${clash.name} in the final sweep.`);
      }
    }
    const hasVillage = next.some((s) => s.tier === "village");
    const hasTown = hasVillage && next.some((s) => s.tier === "town");
    for (let i = next.length - 1; i >= 0; i--) {
      const s = next[i];
      if ((s.tier === "town" && !hasVillage) || (TIER_RANK[s.tier] >= 4 && !hasTown)) {
        changed = true;
        next.splice(i, 1);
        drop("unsupported_hierarchy", `${s.name} has no surviving lower-tier support.`);
      }
    }
    swept = next;
    if (!changed) break;
  }

  const report: HumanFinetuneReport = {
    rawCount: raw.length,
    keptAsIs,
    relocated,
    resized,
    dropped,
    added,
    finalCount: swept.length,
    droppedByRule,
    demotions,
    elapsedMs: Math.round(performance.now() - t0),
  };
  return { settlements: swept, report, log, diffs };
}

export { SpacingOutcome };
void chooseHabitation;
