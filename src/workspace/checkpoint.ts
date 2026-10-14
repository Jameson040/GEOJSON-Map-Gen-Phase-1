import type { BioLayerResult } from "../world/bio/bio-types";
import type { HumanLayerResult } from "../world/human/human-types";
import type { GeneratedRegion, MapThemeId, PlanetMacro, WorkspaceTab } from "../world/types";
import type { RenderLayers } from "../world/canvas-renderer";
import { SPECIES_BY_ID } from "../world/bio/species-catalog";
import { SETTLEMENT_BY_TYPE } from "../world/human/settlement-catalog";

import type { PopulationLayerResult, ZonePopulation } from "../world/population/population-types";

export const CHECKPOINT_FORMAT = "terra-ex-nihilo/workspace";
export const CHECKPOINT_VERSION = 1;
export const MAX_CHECKPOINT_BYTES = 150 * 1024 * 1024;

export interface WorkspaceView {
  tabs: WorkspaceTab[];
  activeTabId: string;
  themeId: MapThemeId;
  layers: RenderLayers;
  visibility: { geo: boolean; bio: boolean; human: boolean; population?: boolean };
  raw: { geography: boolean; biosphere: boolean; human: boolean; population?: boolean };
}

export interface SerializedPopulationLayerResult extends Omit<PopulationLayerResult, "model" | "rawModel"> {
  model: Record<string, ZonePopulation>;
  rawModel: Record<string, ZonePopulation>;
}

export interface WorkspaceCheckpoint {
  format: typeof CHECKPOINT_FORMAT;
  version: typeof CHECKPOINT_VERSION;
  savedAt: string;
  architecture: {
    geography: "frozen";
    biosphere: "frozen";
    human: string;
    populationLayer: string;
  };
  macro: PlanetMacro;
  regions: GeneratedRegion[];
  biosphere: BioLayerResult[];
  humans: HumanLayerResult[];
  populations?: SerializedPopulationLayerResult[];
  view: WorkspaceView;
}

export interface CheckpointInput {
  macro: PlanetMacro;
  regions: Map<string, GeneratedRegion>;
  biosphere: Map<string, BioLayerResult>;
  humans: Map<string, HumanLayerResult>;
  populations?: Map<string, PopulationLayerResult>;
  view: WorkspaceView;
}

export function deserializePopulations(serialized?: SerializedPopulationLayerResult[]): Map<string, PopulationLayerResult> {
  const out = new Map<string, PopulationLayerResult>();
  if (!serialized) return out;
  for (const s of serialized) {
    out.set(s.regionId, {
      ...s,
      model: new Map(Object.entries(s.model ?? {})),
      rawModel: new Map(Object.entries(s.rawModel ?? {})),
    });
  }
  return out;
}

export function createCheckpoint(input: CheckpointInput): WorkspaceCheckpoint {
  // Serialize real generated data, not just seeds: restore never regenerates
  // the frozen lower layers or silently changes a previously completed world.
  const value: WorkspaceCheckpoint = {
    format: CHECKPOINT_FORMAT,
    version: CHECKPOINT_VERSION,
    savedAt: new Date().toISOString(),
    architecture: {
      geography: "frozen",
      biosphere: "frozen",
      human: "habitable-zones",
      populationLayer: input.populations && input.populations.size > 0 ? "active" : "pending",
    },
    macro: input.macro,
    regions: [...input.regions.values()],
    biosphere: [...input.biosphere.values()],
    humans: [...input.humans.values()],
    populations: input.populations && input.populations.size > 0
      ? [...input.populations.values()].map((p) => ({
          ...p,
          model: Object.fromEntries(p.model.entries()),
          rawModel: Object.fromEntries(p.rawModel.entries()),
        }))
      : undefined,
    view: input.view,
  };
  return readCheckpoint(JSON.stringify(value));
}

export function readCheckpoint(text: string): WorkspaceCheckpoint {
  if (text.length > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint exceeds the 150 MB restore limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid checkpoint JSON");
  }
  const issues = inspectCheckpoint(parsed);
  if (issues.length) throw new Error(`Checkpoint rejected: ${issues.slice(0, 4).join("; ")}`);
  return parsed as WorkspaceCheckpoint;
}

/** Validate structure and parent dependencies before replacing any live state. */
export function inspectCheckpoint(value: unknown): string[] {
  const issues: string[] = [];
  const issue = (message: string) => {
    if (issues.length < 40) issues.push(message);
  };
  const object = (v: unknown, path: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      issue(`${path} must be an object`);
      return {};
    }
    return v as Record<string, unknown>;
  };
  const array = (v: unknown, path: string): unknown[] => {
    if (!Array.isArray(v)) {
      issue(`${path} must be an array`);
      return [];
    }
    return v;
  };
  const strings = (v: unknown, path: string) => {
    for (const x of array(v, path)) if (typeof x !== "string") issue(`${path} contains a non-string`);
  };
  const requireStrings = (v: Record<string, unknown>, path: string, keys: string[]) => {
    for (const key of keys) if (typeof v[key] !== "string") issue(`${path}.${key} must be a string`);
  };
  const requireNumbers = (v: Record<string, unknown>, path: string, keys: string[]) => {
    for (const key of keys) {
      if (typeof v[key] !== "number" || !Number.isFinite(v[key])) issue(`${path}.${key} must be finite`);
    }
  };
  const point = (v: unknown, path: string) => {
    if (!Array.isArray(v) || v.length < 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      issue(`${path} must be a finite coordinate pair`);
    }
  };
  const bbox = (v: unknown, path: string) => {
    const b = object(v, path);
    requireNumbers(b, path, ["minX", "minY", "maxX", "maxY"]);
    if (Number(b.minX) > Number(b.maxX) || Number(b.minY) > Number(b.maxY)) issue(`${path} is inverted`);
  };
  const ring = (v: unknown, path: string) => {
    const pts = array(v, path);
    if (pts.length < 4) issue(`${path} is a degenerate ring`);
    for (const p of pts) point(p, path);
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Array.isArray(a) && Array.isArray(b) && (a[0] !== b[0] || a[1] !== b[1])) issue(`${path} is not closed`);
  };
  const unique = (items: unknown[], path: string, key = "id"): Set<string> => {
    const ids = new Set<string>();
    for (const item of items) {
      const r = object(item, path);
      const id = r[key];
      if (typeof id !== "string" || !id) issue(`${path}.${key} is missing`);
      else if (ids.has(id)) issue(`${path} has duplicate ${key} ${id}`);
      else ids.add(id);
    }
    return ids;
  };
  const report = (v: unknown, path: string) => {
    const r = object(v, path);
    requireStrings(r, path, ["targetName"]);
    requireNumbers(r, path, ["totalChecks", "passedChecks", "totalViolations", "elapsedMs"]);
    if (typeof r.passedAll !== "boolean") issue(`${path}.passedAll must be boolean`);
    for (const item of array(r.checks, `${path}.checks`)) {
      const c = object(item, `${path}.check`);
      requireStrings(c, path, ["id", "title", "rule", "details"]);
      requireNumbers(c, path, ["checkedCount", "violationCount"]);
      if (typeof c.passed !== "boolean") issue(`${path}.check.passed must be boolean`);
      strings(c.sampleViolations, `${path}.sampleViolations`);
    }
  };
  const features = (v: unknown, path: string) => {
    const list = array(v, path);
    unique(list, path);
    for (const item of list) {
      const f = object(item, path);
      const p = object(f.properties, `${path}.properties`);
      requireStrings(p, path, ["id", "name", "featureType"]);
      requireNumbers(f, path, ["lodMinZoom"]);
      bbox(f.bbox, `${path}.bbox`);
      const g = object(f.geometry, `${path}.geometry`);
      if (g.type === "Point") point(g.coordinates, `${path}.point`);
      else if (g.type === "LineString") {
        const pts = array(g.coordinates, `${path}.line`);
        if (pts.length < 2) issue(`${path}.line is degenerate`);
        for (const pt of pts) point(pt, `${path}.line`);
      } else if (g.type === "Polygon") {
        const rings = array(g.coordinates, `${path}.rings`);
        if (!rings.length) issue(`${path}.polygon is empty`);
        for (const r of rings) ring(r, `${path}.ring`);
      } else if (g.type === "MultiPolygon") {
        const polygons = array(g.coordinates, `${path}.polygons`);
        if (!polygons.length) issue(`${path}.multipolygon is empty`);
        for (const poly of polygons) {
          for (const r of array(poly, `${path}.rings`)) ring(r, `${path}.ring`);
        }
      } else issue(`${path} has unsupported geometry`);
    }
  };

  const root = object(value, "checkpoint");
  if (root.format !== CHECKPOINT_FORMAT) issue("Unrecognized checkpoint format");
  if (root.version !== CHECKPOINT_VERSION) issue("Unsupported checkpoint version");
  requireStrings(root, "checkpoint", ["savedAt"]);
  const architecture = object(root.architecture, "architecture");
  if (architecture.populationLayer !== "pending" && architecture.populationLayer !== "active") issue("This checkpoint belongs to a different population-layer version");

  const macro = object(root.macro, "macro");
  const config = object(macro.config, "macro.config");
  requireStrings(config, "macro.config", ["seed"]);
  requireNumbers(config, "macro.config", ["continentCount", "oceanLevel", "tectonicActivity", "islandDensity", "polarIceExtent"]);
  features(macro.features, "macro.features");
  if (macro.rawFeatures !== undefined) features(macro.rawFeatures, "macro.rawFeatures");
  const macroStats = object(macro.stats, "macro.stats");
  requireStrings(macroStats, "macro.stats", ["seed"]);
  requireNumbers(macroStats, "macro.stats", ["macroFeatures", "continents", "islands", "seas", "trenches", "plates", "landCoveragePercent", "totalLandAreaKm2", "generationTimeMs"]);
  const largestContinent = object(macroStats.largestContinent, "macro.stats.largestContinent");
  requireStrings(largestContinent, "largestContinent", ["name"]);
  requireNumbers(largestContinent, "largestContinent", ["areaKm2"]);
  const classes = object(macroStats.sizeClassCounts, "macro.stats.sizeClassCounts");
  requireNumbers(classes, "sizeClassCounts", ["islet", "small_island", "large_island", "subcontinent", "continent", "supercontinent"]);
  if (macro.shape !== undefined) {
    const shape = object(macro.shape, "macro.shape");
    requireNumbers(shape, "macro.shape", ["elapsedMs", "processed", "reshaped", "softened", "keptRaw", "sutured", "accreted", "seamX", "longitudeRotationDeg"]);
    array(shape.records, "macro.shape.records");
  }
  array(macro.log, "macro.log");
  const descriptors = array(macro.regions, "macro.regions");
  const parentIds = unique(descriptors, "macro.regions");
  const sizeClasses = ["islet", "small_island", "large_island", "subcontinent", "continent", "supercontinent"];
  const descriptor = (v: unknown, path: string) => {
    const d = object(v, path);
    requireStrings(d, path, ["id", "name", "regionSeed", "plateName", "climateZone"]);
    requireNumbers(d, path, ["lon", "lat", "areaKm2", "areaUnits", "linearScaleKm", "detailBudget"]);
    if (!sizeClasses.includes(String(d.sizeClass))) issue(`${path} has an invalid size class`);
    if (d.kind !== "continent" && d.kind !== "island") issue(`${path} has an invalid kind`);
    ring(d.outline, `${path}.outline`);
    point(d.centroid, `${path}.centroid`);
    bbox(d.bbox, `${path}.bbox`);
    array(d.convergentEdges, `${path}.convergentEdges`);
    strings(d.adjacentSeas, `${path}.adjacentSeas`);
  };
  for (const d of descriptors) descriptor(d, "macro.region");
  for (const item of array(macro.plates, "macro.plates")) {
    const p = object(item, "plate");
    requireStrings(p, "plate", ["name"]);
    requireNumbers(p, "plate", ["id", "driftAngle", "driftSpeed"]);
    point(p.center, "plate.center");
  }

  const regions = array(root.regions, "regions");
  const regionIds = new Set<string>();
  for (const item of regions) {
    const r = object(item, "region");
    descriptor(r.descriptor, "region.descriptor");
    const d = object(r.descriptor, "region.descriptor");
    const id = String(d.id);
    if (!parentIds.has(id)) issue(`Region ${id} does not belong to the planet`);
    if (regionIds.has(id)) issue(`Region ${id} is duplicated`);
    regionIds.add(id);
    const c = object(r.config, "region.config");
    if (!["sketch", "standard", "high", "ultra"].includes(String(c.detailLevel))) issue(`Region ${id} has an invalid detail level`);
    requireNumbers(c, "region.config", ["riverDensity", "reliefIntensity", "moisture", "glaciation"]);
    requireStrings(r, "region", ["seed"]);
    requireNumbers(r, "region", ["generatedAt"]);
    features(r.features, "region.features");
    features(r.rawFeatures, "region.rawFeatures");
    const stats = object(r.stats, "region.stats");
    requireNumbers(stats, "region.stats", ["totalFeatures", "mountainRanges", "peaks", "volcanoes", "rivers", "riverSegments", "totalRiverLengthKm", "lakes", "glaciers", "biomes", "meanElevationM", "generationTimeMs", "approxMemoryKb"]);
    for (const [key, metric] of [["highestPeak", "elevation"], ["longestRiver", "lengthKm"], ["largestLake", "areaKm2"]]) {
      const record = object(stats[key], `region.stats.${key}`);
      requireStrings(record, key, ["name"]);
      requireNumbers(record, key, [metric]);
    }
    const finetune = object(r.finetune, "region.finetune");
    requireNumbers(finetune, "region.finetune", ["rawFeatureCount", "finalFeatureCount", "elapsedMs", "riversSnappedConfluence", "riversDroppedBraidOrCrowd", "riversDroppedStub", "volcanoesDroppedCraton"]);
    for (const item of array(r.compartments, "region.compartments")) {
      const comp = object(item, "compartment");
      requireNumbers(comp, "compartment", ["id", "landKm2", "landShare", "featureCount"]);
      bbox(comp.bbox, "compartment.bbox");
    }
    array(r.log, "region.log");
    report(r.verificationBefore, "region.verificationBefore");
    report(r.verificationAfter, "region.verificationAfter");
  }

  const bios = array(root.biosphere, "biosphere");
  const bioIds = unique(bios, "biosphere", "regionId");
  for (const item of bios) {
    const b = object(item, "biosphere");
    if (!regionIds.has(String(b.regionId))) issue(`Biosphere ${String(b.regionId)} has no geographic parent`);
    requireStrings(b, "biosphere", ["regionName", "seedUsed"]);
    requireNumbers(b, "biosphere", ["generatedAt"]);
    const config = object(b.config, "biosphere.config");
    requireNumbers(config, "biosphere.config", ["richness", "wildShare"]);
    const stats = object(b.stats, "biosphere.stats");
    requireNumbers(stats, "biosphere.stats", ["populations", "species", "irrigatedFarms", "wildPopulations"]);
    requireNumbers(object(stats.byKind, "biosphere.stats.byKind"), "byKind", ["crop", "livestock", "wild", "flora"]);
    strings(stats.staples, "biosphere.stats.staples");
    strings(stats.proteins, "biosphere.stats.proteins");
    object(stats.roleCoverage, "biosphere.stats.roleCoverage");
    const r = object(b.report, "biosphere.report");
    requireNumbers(r, "biosphere.report", ["rawCount", "keptAsIs", "relocated", "dropped", "added", "finalCount", "speciesPresent", "elapsedMs"]);
    strings(r.addedForRoles, "biosphere.report.addedForRoles");
    object(r.droppedByRule, "biosphere.report.droppedByRule");
    array(b.log, "biosphere.log");
    for (const key of ["populations", "rawPopulations"]) {
      const list = array(b[key], `biosphere.${key}`);
      unique(list, `biosphere.${key}`);
      for (const item of list) {
        const p = object(item, "population");
        requireStrings(p, "population", ["id", "speciesId", "name", "glyph", "origin", "kind", "category"]);
        requireNumbers(p, "population", ["radiusUnits", "abundance", "compartmentId", "lodZoom"]);
        if (p.layer !== "bio") issue("Population is not part of the biosphere layer");
        const species = SPECIES_BY_ID.get(String(p.speciesId));
        if (!species || p.kind !== species.kind || p.category !== species.category) issue("Unknown or mismatched catalog species");
        point(p.point, "population.point");
        strings(p.roles, "population.roles");
      }
    }
    report(b.verifyBefore, "biosphere.verifyBefore");
    report(b.verifyAfter, "biosphere.verifyAfter");
  }

  const humans = array(root.humans, "humans");
  unique(humans, "humans", "regionId");
  for (const item of humans) {
    const h = object(item, "humans");
    if (!bioIds.has(String(h.regionId))) issue(`Human layer ${String(h.regionId)} has no biosphere parent`);
    requireStrings(h, "humans", ["regionName", "seedUsed"]);
    requireNumbers(h, "humans", ["generatedAt"]);
    requireNumbers(object(h.config, "humans.config"), "humans.config", ["density", "urbanisation"]);
    const stats = object(h.stats, "humans.stats");
    if ("zones" in stats) {
      requireNumbers(stats, "humans.stats", ["zones", "totalCapacity"]);
      requireNumbers(object(stats.byTier, "humans.stats.byTier"), "byTier", ["nomadic", "hamlet", "village", "town", "city", "metropolis"]);
      object(stats.byType, "humans.stats.byType");
      if (stats.bestSite !== null && stats.bestSite !== undefined) {
        const best = object(stats.bestSite, "humans.stats.bestSite");
        requireStrings(best, "bestSite", ["name", "type"]);
        requireNumbers(best, "bestSite", ["capacity"]);
      }
    } else {
      requireNumbers(stats, "humans.stats", ["settlements", "totalPopulation", "capitals", "coastalShare"]);
      requireNumbers(object(stats.byTier, "humans.stats.byTier"), "byTier", ["nomadic", "hamlet", "village", "town", "city", "metropolis"]);
      object(stats.byType, "humans.stats.byType");
      if (stats.largest !== null) {
        const largest = object(stats.largest, "humans.stats.largest");
        requireStrings(largest, "largest", ["name", "type"]);
        requireNumbers(largest, "largest", ["population"]);
      }
    }
    const r = object(h.report, "humans.report");
    requireNumbers(r, "humans.report", ["rawCount", "keptAsIs", "relocated", "resized", "dropped", "added", "finalCount", "demotions", "elapsedMs"]);
    object(r.droppedByRule, "humans.report.droppedByRule");
    array(h.log, "humans.log");
    for (const key of ["settlements", "rawSettlements"]) {
      const list = array(h[key], `humans.${key}`);
      unique(list, `humans.${key}`);
      for (const item of list) {
        const s = object(item, "settlement");
        // Layer 3 stays population-free: population is Layer 4, not baked into zones.
        if (s.population !== undefined) issue("Settlement carries a population field — population must live in Layer 4, not Layer 3");
        requireStrings(s, "settlement", ["id", "name", "glyph", "origin", "type"]);
        requireNumbers(s, "settlement", ["popCap", "capacity", "compartmentId", "lodZoom"]);
        if (s.habitation !== undefined && !["lived_now", "ancient_pulse", "potential"].includes(String(s.habitation))) issue("Invalid habitation state");
        if (s.layer !== "human") issue("Settlement is not part of the human layer");
        if (!SETTLEMENT_BY_TYPE.has(s.type as Parameters<typeof SETTLEMENT_BY_TYPE.has>[0])) issue("Unknown settlement type");
        if (!["nomadic", "hamlet", "village", "town", "city", "metropolis"].includes(String(s.tier))) issue("Invalid settlement tier");
        point(s.point, "settlement.point");
        strings(s.resourceRoles ?? s.supplies ?? [], "settlement.resourceRoles");
        strings(s.siteTraits, "settlement.siteTraits");
      }
    }
    report(h.verifyBefore, "humans.verifyBefore");
    report(h.verifyAfter, "humans.verifyAfter");
  }

  // L4 population records (optional; strictly validated when present)
  const pops = root.populations === undefined ? [] : array(root.populations, "populations");
  unique(pops, "populations", "regionId");
  for (const item of pops) {
    const p = object(item, "populations");
    if (!bioIds.has(String(p.regionId))) issue(`Population layer ${String(p.regionId)} has no biosphere parent`);
    requireStrings(p, "populations", ["regionName", "seedUsed"]);
    requireNumbers(p, "populations", ["generatedAt"]);
    const cfg = object(p.config, "populations.config");
    if (!["early_no_rivers", "pastoral_rivers", "classic_towns_cities", "mature_metropolitan", "current", "postIndustrial"].includes(String(cfg.era))) issue("Invalid population era");
    requireNumbers(cfg, "population.config", ["year", "targetScale"]);
    const rep = object(p.report, "populations.report");
    requireNumbers(rep, "populations.report", ["zonesModelled", "finalOccupancy", "elapsedMs", "movedToBiosphere", "revived", "downgraded"]);
    object(rep.droppedByRule, "populations.report.droppedByRule");
    for (const key of ["model", "rawModel"]) {
      const raw = object(p[key], `populations.${key}`);
      for (const v of Object.values(raw) as unknown[]) {
        const zp = object(v, "zonePop");
        requireStrings(zp, "zonePop", ["zoneId"]);
        requireNumbers(zp, "zonePop", ["occupancy", "densityPerKm2", "hardCap", "usagePercent", "yearProduced", "backcastYears", "forwardCastYears"]);
        if (zp.layer !== "population") issue("Layer-4 record lacks the population tag");
        if (Number(zp.occupancy) < 0) issue("Negative occupancy");
        for (const ph of array(zp.phases, "zonePop.phases")) {
          const seg = object(ph, "zonePop.phase");
          requireStrings(seg, "zonePop.phase", ["phase"]);
          requireNumbers(seg, "zonePop.phase", ["startYear", "endYear", "growthRatePerYr", "endPopulation"]);
          if (!["founding", "growth", "steady", "decline", "abandoned"].includes(String(seg.phase))) issue("Invalid population phase");
          if (Number(seg.endPopulation) < 0) issue("Negative phase population");
        }
        object(zp.drivers, "zonePop.drivers");
      }
    }
  }

  const view = object(root.view, "view");
  requireStrings(view, "view", ["activeTabId"]);
  if (!["gidding", "atlas", "topo", "antique", "satellite"].includes(String(view.themeId))) issue("Invalid map theme");
  const tabs = array(view.tabs, "view.tabs");
  const tabIds = unique(tabs, "view.tabs");
  if (!tabIds.has("planet")) issue("Planet tab is missing");
  if (!tabIds.has(String(view.activeTabId))) issue("Active tab is missing");
  for (const item of tabs) {
    const t = object(item, "tab");
    requireStrings(t, "tab", ["id", "title"]);
    if (t.kind !== "planet" && t.kind !== "region") issue("Invalid workspace tab kind");
    if (t.kind === "region" && !regionIds.has(String(t.regionId))) issue("A region tab has no generated geography");
  }
  const flags = object(view.layers, "view.layers");
  for (const key of ["landmasses", "seas", "tectonics", "relief", "peaks", "volcanoes", "rivers", "lakes", "biomes", "graticule", "labels", "regionOverlay", "compartments"]) {
    if (typeof flags[key] !== "boolean") issue(`Missing cartographic flag ${key}`);
  }
  const visibility = object(view.visibility, "view.visibility");
  for (const key of ["geo", "bio", "human"]) if (typeof visibility[key] !== "boolean") issue(`Missing visibility flag ${key}`);
  if (visibility.population !== undefined && typeof visibility.population !== "boolean") issue("Missing visibility flag population");
  const raw = object(view.raw, "view.raw");
  for (const key of ["geography", "biosphere", "human"]) if (typeof raw[key] !== "boolean") issue(`Missing raw-view flag ${key}`);
  if (raw.population !== undefined && typeof raw.population !== "boolean") issue("Missing raw-view flag population");
  return issues;
}