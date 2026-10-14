import type { BioLayerResult } from "../world/bio/bio-types";
import type { HumanLayerResult } from "../world/human/human-types";
import type { GeneratedRegion, MapThemeId, PlanetMacro, WorkspaceTab } from "../world/types";
import type { RenderLayers } from "../world/canvas-renderer";
import { SPECIES_BY_ID } from "../world/bio/species-catalog";
import { SETTLEMENT_BY_TYPE } from "../world/human/settlement-catalog";
import type { ResourceFilterConfig, ResourceLayerResult } from "../world/resources/resource-types";
import type { RouteLayerResult } from "../world/routes/route-types";
import type { CadastreLayerResult, SettlementCadastre } from "../world/cadastre/cadastre-types";

import type { PopulationLayerResult, ZonePopulation } from "../world/population/population-types";

export const CHECKPOINT_FORMAT = "terra-ex-nihilo/workspace";
/**
 * v1 — macro + regions + biosphere + humans (+ optional populations) and view.
 * v2 — additionally resources, routes and cadastres, the resource filter
 *      config, and the resource/routes/cadastre visibility flags. v1 files
 *      remain restorable: the missing layers simply arrive empty.
 */
export const CHECKPOINT_VERSION = 2;
export const SUPPORTED_CHECKPOINT_VERSIONS = [1, 2];
export const MAX_CHECKPOINT_BYTES = 150 * 1024 * 1024;

export interface WorkspaceView {
  tabs: WorkspaceTab[];
  activeTabId: string;
  themeId: MapThemeId;
  layers: RenderLayers;
  visibility: { geo: boolean; bio: boolean; human: boolean; population?: boolean; resource?: boolean; routes?: boolean; cadastre?: boolean };
  raw: { geography: boolean; biosphere: boolean; human: boolean; population?: boolean };
}

export interface SerializedPopulationLayerResult extends Omit<PopulationLayerResult, "model" | "rawModel"> {
  model: Record<string, ZonePopulation>;
  rawModel: Record<string, ZonePopulation>;
}

export interface SerializedCadastreLayerResult extends Omit<CadastreLayerResult, "cadastres"> {
  cadastres: Record<string, SettlementCadastre>;
}

export interface WorkspaceCheckpoint {
  format: typeof CHECKPOINT_FORMAT;
  version: number;
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
  /** v2: geological resources, trade routes and cadastral surveys. */
  resources?: ResourceLayerResult[];
  routes?: RouteLayerResult[];
  cadastres?: SerializedCadastreLayerResult[];
  /** v2: the resource filter configuration active when the world was saved. */
  resourceConfig?: ResourceFilterConfig;
  view: WorkspaceView;
}

export interface CheckpointInput {
  macro: PlanetMacro;
  regions: Map<string, GeneratedRegion>;
  biosphere: Map<string, BioLayerResult>;
  humans: Map<string, HumanLayerResult>;
  populations?: Map<string, PopulationLayerResult>;
  resources?: Map<string, ResourceLayerResult>;
  routes?: Map<string, RouteLayerResult>;
  cadastres?: Map<string, CadastreLayerResult>;
  resourceConfig?: ResourceFilterConfig;
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

export function deserializeCadastres(serialized?: SerializedCadastreLayerResult[]): Map<string, CadastreLayerResult> {
  const out = new Map<string, CadastreLayerResult>();
  if (!serialized) return out;
  for (const s of serialized) {
    out.set(s.regionId, {
      ...s,
      cadastres: new Map(Object.entries(s.cadastres ?? {})),
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
    resources: input.resources && input.resources.size > 0 ? [...input.resources.values()] : undefined,
    routes: input.routes && input.routes.size > 0 ? [...input.routes.values()] : undefined,
    cadastres: input.cadastres && input.cadastres.size > 0
      ? [...input.cadastres.values()].map((c) => ({
          ...c,
          cadastres: Object.fromEntries(c.cadastres.entries()),
        }))
      : undefined,
    resourceConfig: input.resourceConfig,
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
  /** Cadastre polygons are stored as OPEN rings (first point ≠ last); the renderer and the GeoJSON export close them. */
  const openRing = (v: unknown, path: string) => {
    const pts = array(v, path);
    if (pts.length < 3) issue(`${path} is a degenerate ring`);
    for (const p of pts) point(p, path);
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
  if (!SUPPORTED_CHECKPOINT_VERSIONS.includes(Number(root.version))) issue("Unsupported checkpoint version");
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
  const humanIds = unique(humans, "humans", "regionId");
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
        // Layer 4 stays population-free: population is Layer 5, not baked into zones.
        if (s.population !== undefined) issue("Settlement carries a population field — population must live in Layer 5, not Layer 4");
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

  // L5 population records (optional; strictly validated when present)
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
        if (zp.layer !== "population") issue("Layer-5 record lacks the population tag");
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

  // ---- v2 layers (optional; strictly validated when present) ----
  // Geological resources depend on geography only.
  const resources = root.resources === undefined ? [] : array(root.resources, "resources");
  unique(resources, "resources", "regionId");
  for (const item of resources) {
    const r = object(item, "resources");
    if (!regionIds.has(String(r.regionId))) issue(`Resource layer ${String(r.regionId)} has no geographic parent`);
    requireStrings(r, "resources", ["regionName", "generatedAt"]);
    const cfg = object(r.config, "resources.config");
    const requireResourceConfig = (target: Record<string, unknown>, path: string) => {
      for (const key of ["includeFantasy", "includeFossilFuels", "includeCoal", "includePetroleum", "includeNaturalGas"]) {
        if (typeof target[key] !== "boolean") issue(`${path}.${key} must be boolean`);
      }
      requireNumbers(target, path, ["abundanceMultiplier"]);
      if (!["pure_fantasy", "historical_medieval", "bronze_iron_age", "steampunk_industrial", "custom"].includes(String(target.preset))) issue(`Invalid resource preset in ${path}`);
    };
    requireResourceConfig(cfg, "resources.config");
    strings(cfg.excludedResourceIds ?? [], "resources.config.excludedResourceIds");
    for (const key of ["deposits", "rawDeposits"]) {
      for (const d of array(r[key], `resources.${key}`)) {
        const dep = object(d, "resources.deposit");
        requireStrings(dep, "resources.deposit", ["id", "resourceId", "name", "glyph", "category", "domain", "yieldEstimate", "geologicalContext"]);
        requireNumbers(dep, "resources.deposit", ["abundance", "radiusUnits", "compartmentId"]);
        point(dep.point, "resources.deposit.point");
      }
    }
    const stats = object(r.stats, "resources.stats");
    requireNumbers(stats, "resources.stats", ["totalDeposits", "metalsCount", "claysCount", "stonesCount", "saltsCount", "fuelsCount", "gemsCount", "fantasyCount", "activeCatalogSize", "excludedCatalogSize"]);
  }
  if (root.resourceConfig !== undefined) {
    const cfg = object(root.resourceConfig, "resourceConfig");
    for (const key of ["includeFantasy", "includeFossilFuels", "includeCoal", "includePetroleum", "includeNaturalGas"]) {
      if (typeof cfg[key] !== "boolean") issue(`resourceConfig.${key} must be boolean`);
    }
    requireNumbers(cfg, "resourceConfig", ["abundanceMultiplier"]);
    if (!["pure_fantasy", "historical_medieval", "bronze_iron_age", "steampunk_industrial", "custom"].includes(String(cfg.preset))) issue("Invalid resource preset in resourceConfig");
    strings(cfg.excludedResourceIds ?? [], "resourceConfig.excludedResourceIds");
  }

  // Trade routes depend on the human layer (settlements).
  const routeLayers = root.routes === undefined ? [] : array(root.routes, "routes");
  unique(routeLayers, "routes", "regionId");
  for (const item of routeLayers) {
    const r = object(item, "routes");
    if (!humanIds.has(String(r.regionId))) issue(`Route layer ${String(r.regionId)} has no habitable-zone parent`);
    requireStrings(r, "routes", ["regionName", "seedUsed"]);
    requireNumbers(r, "routes", ["generatedAt"]);
    requireNumbers(object(r.config, "routes.config"), "routes.config", ["density", "pavedHighwayShare"]);
    for (const key of ["routes", "rawRoutes"]) {
      const list = array(r[key], `routes.${key}`);
      unique(list, `routes.${key}`);
      for (const rt of list) {
        const route = object(rt, "routes.route");
        requireStrings(route, "routes.route", ["id", "name", "type", "startSettlementId", "startSettlementName", "endSettlementId", "endSettlementName"]);
        requireNumbers(route, "routes.route", ["lengthKm", "straightKm", "sinuosity", "bridgesCount", "mountainPassesCount", "lodZoom"]);
        const pts = array(route.points, "routes.route.points");
        if (pts.length < 2) issue("routes.route.points is degenerate");
        for (const p of pts) point(p, "routes.route.point");
        strings(route.tradeGoods, "routes.route.tradeGoods");
      }
    }
    report(r.verifyBefore, "routes.verifyBefore");
    report(r.verifyAfter, "routes.verifyAfter");
  }

  // Cadastres depend on the human layer; population only sizes roofs.
  const cadastreLayers = root.cadastres === undefined ? [] : array(root.cadastres, "cadastres");
  unique(cadastreLayers, "cadastres", "regionId");
  for (const item of cadastreLayers) {
    const r = object(item, "cadastres");
    if (!humanIds.has(String(r.regionId))) issue(`Cadastre layer ${String(r.regionId)} has no habitable-zone parent`);
    const cadastres = object(r.cadastres, "cadastres.cadastres");
    for (const c of Object.values(cadastres) as unknown[]) {
      const cad = object(c, "cadastres.settlement");
      requireStrings(cad, "cadastres.settlement", ["settlementId", "settlementName", "tier", "type", "generatedAt"]);
      requireNumbers(cad, "cadastres.settlement", ["radiusUnits", "radiusM", "rawBuildingCount"]);
      point(cad.center, "cadastres.settlement.center");
      for (const s of array(cad.streets, "cadastres.settlement.streets")) {
        const street = object(s, "cadastres.street");
        requireStrings(street, "cadastres.street", ["id", "kind", "surface"]);
        requireNumbers(street, "cadastres.street", ["widthM"]);
        const pts = array(street.points, "cadastres.street.points");
        if (pts.length < 2) issue("cadastres.street.points is degenerate");
        for (const p of pts) point(p, "cadastres.street.point");
      }
      for (const p of array(cad.parcels, "cadastres.settlement.parcels")) {
        const parcel = object(p, "cadastres.parcel");
        requireStrings(parcel, "cadastres.parcel", ["id", "landUse"]);
        requireNumbers(parcel, "cadastres.parcel", ["areaM2"]);
        openRing(parcel.boundary, "cadastres.parcel.boundary");
      }
      for (const b of array(cad.buildings, "cadastres.settlement.buildings")) {
        const bld = object(b, "cadastres.building");
        requireStrings(bld, "cadastres.building", ["id", "buildingType", "roofType", "roofMaterial"]);
        requireNumbers(bld, "cadastres.building", ["widthM", "lengthM", "heightM", "stories", "orientationRad"]);
        point(bld.center, "cadastres.building.center");
        openRing(bld.footprint, "cadastres.building.footprint");
      }
      const stats = object(cad.stats, "cadastres.settlement.stats");
      requireNumbers(stats, "cadastres.settlement.stats", ["totalBuildings", "residentialBuildings", "totalRoofAreaM2", "totalStreetLengthM", "parcelCount", "generationMs", "finetuneMs"]);
      report(cad.verificationBefore, "cadastres.settlement.verificationBefore");
      report(cad.verificationAfter, "cadastres.settlement.verificationAfter");
    }
    const stats = object(r.stats, "cadastres.stats");
    requireNumbers(stats, "cadastres.stats", ["settlementsCount", "totalBuildings", "totalStreetsKm", "totalRoofAreaKm2"]);
    if (typeof stats.allPassing !== "boolean") issue("cadastres.stats.allPassing must be boolean");
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
  // v2 adds resource / routes / cadastre flags; they stay optional for v1 files.
  for (const key of ["resource", "routes", "cadastre"] as const) {
    if (visibility[key] !== undefined && typeof visibility[key] !== "boolean") issue(`Missing visibility flag ${key}`);
  }
  const raw = object(view.raw, "view.raw");
  for (const key of ["geography", "biosphere", "human"]) if (typeof raw[key] !== "boolean") issue(`Missing raw-view flag ${key}`);
  if (raw.population !== undefined && typeof raw.population !== "boolean") issue("Missing raw-view flag population");
  return issues;
}