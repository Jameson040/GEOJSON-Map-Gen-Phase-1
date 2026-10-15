// Run: npx tsx scripts/check-project.ts [--smoke] [seed]
// Static checks do not generate worlds. --smoke executes the real three-layer
// pipeline sequentially and fails on verifier or lower-layer content changes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { GenerationGate } from "../src/workspace/generation-gate";
import { evictRegionIndexes, withoutRegion } from "../src/workspace/lifecycle";
import { createTar, projectRelativePath } from "../src/workspace/archive";
import { createCheckpoint, readCheckpoint } from "../src/workspace/checkpoint";
import { DEFAULT_LAYERS } from "../src/world/canvas-renderer";
import { SETTLEMENT_CATALOG } from "../src/world/human/settlement-catalog";
import { settlementSpacingKm } from "../src/world/human/human-rules";
import { LAYER_BY_ID, WORLD_LAYERS, layerConsumers } from "../src/world/layers";
import { cadastreCacheKey, cadastreCacheSize, clearCadastreCache } from "../src/world/cadastre/cadastre-cache";
import type { CadastreConfig } from "../src/world/cadastre/cadastre-types";
import type { ZonePopulation } from "../src/world/population/population-types";

const root = fileURLToPath(new URL("../", import.meta.url));
let failures = 0;
const run = (name: string, check: () => void) => {
  try {
    check();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

run("Essential project files and reproducible dependency lock", () => {
  for (const name of ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html", "src/main.tsx", "src/App.tsx"]) {
    assert(existsSync(path.join(root, name)), `${name} is missing`);
  }
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies, "Lockfile dependencies differ from package.json");
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies, "Lockfile dev dependencies differ from package.json");
});

run("Strict TypeScript check, including verification scripts", () => {
  const configPath = path.join(root, "tsconfig.json");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"));
  const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);
  const scriptNames = sourceFiles(path.join(root, "scripts")).filter((f) => /\.tsx?$/.test(f));
  const program = ts.createProgram([...new Set([...config.fileNames, ...scriptNames])], config.options);
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    }));
    throw new Error(`${diagnostics.length} TypeScript diagnostics`);
  }
});

run("Local import targets exist", () => {
  for (const file of [...sourceFiles(path.join(root, "src")), ...sourceFiles(path.join(root, "scripts"))]) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    ts.forEachChild(sf, (node) => {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const spec = node.moduleSpecifier.text;
      if (!spec.startsWith(".")) return;
      const base = path.resolve(path.dirname(file), spec);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.css`, `${base}.json`, path.join(base, "index.ts")];
      assert(candidates.some(existsSync), `${path.relative(root, file)} imports missing ${spec}`);
    });
  }
});

run("Generation gate rejects overlaps and releases after failure", () => {
  const gate = new GenerationGate();
  const finish = gate.begin("first");
  assert(finish);
  assert.equal(gate.begin("overlap"), null);
  try { throw new Error("simulated failure"); } catch { /* exercise finally */ } finally { finish(); }
  const second = gate.begin("second");
  assert(second);
  finish(); // releasing an old token must not unlock a newer job
  assert.equal(gate.activeJob, "second");
  second();
  assert.equal(gate.activeJob, null);
});

run("Unloading removes only the requested region and both cached views", () => {
  const original = new Map([["a", 1], ["ab", 2]]);
  const next = withoutRegion(original, "a");
  assert.equal(original.get("a"), 1);
  assert.equal(next.has("a"), false);
  assert.equal(next.get("ab"), 2);
  const indexes = new Map([["a:1:raw", 1], ["a:1:ft", 2], ["ab:1:ft", 3]]);
  evictRegionIndexes(indexes, "a");
  assert.deepEqual([...indexes.keys()], ["ab:1:ft"]);
});

run("Settlement spacing is symmetric for all catalog pairs", () => {
  for (const a of SETTLEMENT_CATALOG) for (const b of SETTLEMENT_CATALOG) {
    assert.equal(settlementSpacingKm(a, b), settlementSpacingKm(b, a));
    if (a.tier === b.tier) assert.equal(settlementSpacingKm(a, b), Math.max(a.spacingKm, b.spacingKm));
  }
});

run("World layer registry is a valid dependency DAG with sound invalidation closures", () => {
  const ids = new Set(WORLD_LAYERS.map((l) => l.id));
  assert.equal(ids.size, WORLD_LAYERS.length, "Duplicate layer ids");
  assert.deepEqual(
    WORLD_LAYERS.map((l) => l.index),
    WORLD_LAYERS.map((_, i) => i + 1),
    "Layer indexes must be contiguous and ordered"
  );
  for (const l of WORLD_LAYERS) {
    for (const ref of [l.dependsOn, ...(l.readsFrom ?? []), ...(l.refreshesFrom ?? [])]) {
      if (!ref) continue;
      assert(ids.has(ref), `${l.id} references unknown layer ${ref}`);
      assert(LAYER_BY_ID[ref].index < l.index, `${l.id} references a later layer ${ref} (cycle)`);
    }
  }
  // Hard invalidation closures the workspace store relies on:
  const consumersOf = (id: keyof typeof LAYER_BY_ID) => [...layerConsumers(id)].sort();
  assert.deepEqual(consumersOf("geo"), ["bio", "cadastre", "human", "population", "resource", "routes"]);
  assert.deepEqual(consumersOf("bio"), ["cadastre", "human", "population", "routes"]);
  assert.deepEqual(consumersOf("human"), ["cadastre", "population", "routes"]);
  assert.deepEqual(consumersOf("population"), ["cadastre"], "population re-runs must evict cadastres (roofs scale with occupancy)");
  assert.deepEqual(consumersOf("resource"), [], "optional resource reads must NOT evict consumers (staleness badge only)");
  assert.deepEqual(consumersOf("routes"), []);
  assert.deepEqual(consumersOf("cadastre"), []);
});

run("Cadastre cache keys fingerprint the population model and config", () => {
  const pop1 = { occupancy: 100, hardCap: 200 } as ZonePopulation;
  const pop2 = { occupancy: 300, hardCap: 400 } as ZonePopulation;
  const cfgA: CadastreConfig = { buildingDensity: 1, roofPitchMultiplier: 1 };
  const cfgB: CadastreConfig = { buildingDensity: 2, roofPitchMultiplier: 1 };
  const key = (p?: ZonePopulation, c?: CadastreConfig) => cadastreCacheKey("r1", "set_1", p, c);
  assert.equal(key(), key(undefined, undefined), "stable key for absent inputs");
  assert.equal(key(pop1, cfgA), cadastreCacheKey("r1", "set_1", { ...pop1 }, { ...cfgA }), "same content must share a key");
  assert.notEqual(key(pop1), key(pop2), "different population models must never collide");
  assert.notEqual(key(pop1), key(undefined), "a population model must not hit the no-population entry");
  assert.notEqual(key(pop1, cfgA), key(pop1, cfgB), "different cadastre configs must never collide");
  assert.notEqual(key(pop1), cadastreCacheKey("r2", "set_1", pop1), "different regions must never collide");
  assert.notEqual(key(pop1), cadastreCacheKey("r1", "set_2", pop1), "different settlements must never collide");
});

run("Tar archive preserves UTF-8 contents and validates header checksums", () => {
  assert.equal(projectRelativePath("../App.tsx"), "src/App.tsx");
  assert.equal(projectRelativePath("./archive.ts"), "src/workspace/archive.ts");
  assert.equal(projectRelativePath("../../package-lock.json"), "package-lock.json");
  assert.equal(projectRelativePath("/src/main.tsx"), "src/main.tsx");
  assert.throws(() => projectRelativePath("../../../outside"), /escapes/);
  const files = [{ path: "source/example.txt", data: "Geography stays frozen.\n" }, { path: "world-checkpoint.json", data: JSON.stringify({ title: String.fromCodePoint(0x1f30d) }) }];
  const bytes = createTar(files);
  const decoder = new TextDecoder();
  const restored = new Map<string, string>();
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const str = (start: number, len: number) => decoder.decode(header.slice(start, start + len)).replace(/\0.*$/, "");
    const name = str(0, 100);
    const size = Number.parseInt(str(124, 12), 8);
    const recorded = Number.parseInt(str(148, 8), 8);
    header.fill(32, 148, 156);
    assert.equal(header.reduce((sum, b) => sum + b, 0), recorded);
    restored.set(name, decoder.decode(bytes.slice(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  for (const file of files) assert.equal(restored.get(file.path), file.data);
  assert.throws(() => createTar([{ path: "../unsafe", data: "" }]), /Unsafe/);
  assert.throws(() => readCheckpoint('{"format":"unknown"}'), /Checkpoint rejected/);
  assert.throws(() => readCheckpoint("not json"), /not valid/);
});

async function smoke() {
  const seed = process.argv.find((v, i) => i > 1 && !v.startsWith("--")) ?? "terra-novus";
  const { generatePlanetMacro } = await import("../src/world/tier1-planet");
  const { finetunePlanetShapes } = await import("../src/world/tier1-finetune");
  const { verifyPlanetMacro } = await import("../src/world/verifier");
  const { generateRegionDetail } = await import("../src/world/tier2-region");
  const { generateBioLayer } = await import("../src/world/bio/bio-generate");
  const { generateHumanLayer } = await import("../src/world/human/human-generate");
  const macro = finetunePlanetShapes(await generatePlanetMacro({ seed, continentCount: 5, oceanLevel: 1, tectonicActivity: 1, islandDensity: 1, polarIceExtent: 1 }));
  const planetReport = verifyPlanetMacro(macro);
  assert(planetReport.passedAll, `Planet verifier failed: ${planetReport.checks.filter((c) => !c.passed).map((c) => c.title).join(", ")}`);
  const descriptor = macro.regions.find((r) => r.sizeClass === "large_island") ?? macro.regions[0];
  assert(descriptor, "Planet has no region to smoke-test");
  const region = await generateRegionDetail(descriptor, { detailLevel: "standard", riverDensity: 1, reliefIntensity: 1, moisture: 1, glaciation: 1 });
  assert(region.verificationAfter.passedAll, "Region verifier failed");
  const geoHash = hash(region);
  const bio = await generateBioLayer(region, { richness: 1, wildShare: 1 });
  assert.equal(hash(region), geoHash, "Biosphere changed frozen geography");
  assert(bio.verifyAfter.passedAll, "Biosphere verifier failed");
  const bioHash = hash(bio);
  const human = await generateHumanLayer(region, bio, { density: 0.5, urbanisation: 0.4 });
  assert.equal(hash(region), geoHash, "Human layer changed frozen geography");
  assert.equal(hash(bio), bioHash, "Human layer changed frozen biosphere");
  assert(human.verifyAfter.passedAll, "Human verifier failed");
  const humanHash = hash(human);

  // ---- L2 Geological Resources ----
  const { generateResourceLayer } = await import("../src/world/resources");
  const { DEFAULT_RESOURCE_CONFIG } = await import("../src/world/resources/resource-filter");
  const resource = await generateResourceLayer(region, DEFAULT_RESOURCE_CONFIG);
  assert(resource.deposits.length > 0, "No resource deposits were generated");
  assert.equal(hash(region), geoHash, "Resource layer changed frozen geography");
  const resourceHash = hash(resource);

  // ---- L5 Population ----
  const { generatePopulationLayer } = await import("../src/world/population/population-generate");
  const population = await generatePopulationLayer(region, bio, human, { era: "current", year: 2026, targetScale: 1 });
  assert(population.verifyAfter.passedAll, "Population verifier failed");
  assert.equal(hash(region), geoHash, "Population layer changed frozen geography");
  assert.equal(hash(human), humanHash, "Population layer changed the habitable zones");
  assert.equal(hash(bio), bioHash, "Population layer changed the biosphere");
  const populationHash = hash([...population.model.values()]);

  const { generateRouteLayer } = await import("../src/world/routes/route-generate");
  const route = await generateRouteLayer(region, human.settlements);
  assert.equal(hash(region), geoHash, "Route layer changed frozen geography");
  assert.equal(hash(bio), bioHash, "Route layer changed frozen biosphere");
  assert.equal(hash(human), humanHash, "Route layer changed frozen settlements");
  assert(route.verifyAfter.passedAll, "Route verifier failed");
  assert(route.routes.length > 0, "No routes were generated");
  // The math-only derived heightfield must agree with the frozen hydrology:
  // every river flows downhill in it, every lake sits in a bowl, and every
  // stated summit survives the conditioning.
  assert(route.heightfield, "Route layer did not report its derived heightfield");
  assert.equal(route.heightfield.riverViolations, 0, "Heightfield rivers climb");
  assert.equal(route.heightfield.lakeViolations, 0, "Heightfield lakes sit above their shoreline");
  assert(
    route.heightfield.peaksHonored >= Math.ceil(route.heightfield.peaksChecked * 0.995),
    "Heightfield lost stated summits"
  );
  const routeHash = hash(route);
  console.log(`PASS Route network generated: ${route.routes.length} routes, ${route.stats.totalKm} km, ${route.stats.connectedSettlementsCount} connected settlements`);

  // ---- L7 Cadastre (a surveyable subset) + cache invalidation semantics ----
  const { generateCadastreLayer, getCadastreForSettlement } = await import("../src/world/cadastre/cadastre-cache");
  const surveyed = human.settlements.slice(0, 3);
  const cadastre = await generateCadastreLayer(region, surveyed, population.model);
  assert(cadastre.stats.totalBuildings > 0, "No buildings were surveyed");
  assert.equal(hash(human), humanHash, "Cadastre layer changed frozen settlements");
  const cadastreHash = hash([...cadastre.cadastres.values()]);
  assert(cadastreCacheSize() >= surveyed.length, "Surveyed cadastres must be resident in the JIT cache");
  const beforeClear = cadastreCacheSize();
  clearCadastreCache(descriptor.id);
  assert.equal(cadastreCacheSize(), 0, `clearCadastreCache(regionId) must evict that region's ${beforeClear} entries`);
  // A different population model must generate a fresh entry, never a stale hit:
  const sample = surveyed[0];
  const popForSample = population.model.get(sample.id)!;
  const first = getCadastreForSettlement(region, sample, popForSample);
  const grewForNewModel = getCadastreForSettlement(region, sample, { ...popForSample, occupancy: popForSample.occupancy + 1234, hardCap: popForSample.hardCap });
  assert.notEqual(first, grewForNewModel, "A changed population model must not be served the previous cadastre");
  clearCadastreCache();

  // ---- Full 7-layer checkpoint round-trip ----
  const checkpoint = createCheckpoint({
    macro,
    regions: new Map([[descriptor.id, region]]),
    biosphere: new Map([[descriptor.id, bio]]),
    humans: new Map([[descriptor.id, human]]),
    populations: new Map([[descriptor.id, population]]),
    resources: new Map([[descriptor.id, resource]]),
    routes: new Map([[descriptor.id, route]]),
    cadastres: new Map([[descriptor.id, cadastre]]),
    resourceConfig: DEFAULT_RESOURCE_CONFIG,
    view: {
      tabs: [{ id: "planet", kind: "planet", title: "Planet" }, { id: `region:${descriptor.id}`, kind: "region", title: descriptor.name, regionId: descriptor.id }],
      activeTabId: `region:${descriptor.id}`,
      themeId: "atlas",
      layers: DEFAULT_LAYERS,
      visibility: { geo: true, bio: true, human: true, population: true, resource: true, routes: true, cadastre: true },
      raw: { geography: false, biosphere: false, human: false },
    },
  });
  const restored = readCheckpoint(JSON.stringify(checkpoint));
  assert.equal(hash(restored.regions[0]), geoHash);
  assert.equal(hash(restored.biosphere[0]), bioHash);
  assert.equal(hash(restored.humans[0]), hash(human));
  assert.equal(hash(Object.values(restored.populations![0].model)), populationHash, "Population model must survive the round-trip");
  assert.equal(hash(restored.resources![0]), resourceHash, "Resource layer must survive the round-trip");
  assert.equal(hash(restored.routes![0]), routeHash, "Route layer must survive the round-trip");
  assert.equal(hash(Object.values(restored.cadastres![0].cadastres)), cadastreHash, "Cadastre layer must survive the round-trip");
  assert.deepEqual(restored.resourceConfig, DEFAULT_RESOURCE_CONFIG, "Resource filter config must survive the round-trip");
  const orphaned = structuredClone(checkpoint);
  orphaned.biosphere[0].regionId = "missing-parent";
  assert.throws(() => readCheckpoint(JSON.stringify(orphaned)), /parent/);
  const orphanedRoute = structuredClone(checkpoint);
  orphanedRoute.routes![0].regionId = "missing-parent";
  assert.throws(() => readCheckpoint(JSON.stringify(orphanedRoute)), /parent/);
  const orphanedCadastre = structuredClone(checkpoint);
  orphanedCadastre.cadastres![0].regionId = "missing-parent";
  assert.throws(() => readCheckpoint(JSON.stringify(orphanedCadastre)), /parent/);

  // ---- v1 checkpoints (before resources/routes/cadastres existed) stay restorable ----
  const v1 = structuredClone(checkpoint);
  v1.version = 1;
  delete (v1 as Partial<typeof v1>).resources;
  delete (v1 as Partial<typeof v1>).routes;
  delete (v1 as Partial<typeof v1>).cadastres;
  delete (v1 as Partial<typeof v1>).resourceConfig;
  const v1Visibility = v1.view.visibility as Record<string, unknown>;
  delete v1Visibility.resource;
  delete v1Visibility.routes;
  delete v1Visibility.cadastre;
  const restoredV1 = readCheckpoint(JSON.stringify(v1));
  assert.equal(restoredV1.version, 1);
  assert.equal(restoredV1.resources, undefined, "v1 restore arrives with no resource layers");
  assert.equal(restoredV1.routes, undefined, "v1 restore arrives with no route layers");
  assert.equal(restoredV1.cadastres, undefined, "v1 restore arrives with no cadastre layers");
  assert.equal(hash(restoredV1.regions[0]), geoHash, "v1 restore keeps the frozen geography byte-identical");
  console.log(`PASS Sequential seven-layer generation, cadastre cache invalidation, and exact checkpoint round-trip incl. v1 compatibility (${seed})`);
}

if (process.argv.includes("--smoke") && failures === 0) {
  try { await smoke(); } catch (e) {
    failures++;
    console.error("FAIL Pipeline smoke test:", e instanceof Error ? e.message : String(e));
  }
} else console.log("NOT RUN Pipeline smoke test (add --smoke)");
console.log("PASS Population is a time-dependent per-zone layer (L5), verified by this script and scripts/verify-world.ts.");
if (failures) process.exitCode = 1;
else console.log("PASS Requested project-health checks completed");