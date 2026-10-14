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

  const { generateRouteLayer } = await import("../src/world/routes/route-generate");
  const route = await generateRouteLayer(region, human.settlements);
  assert.equal(hash(region), geoHash, "Route layer changed frozen geography");
  assert.equal(hash(bio), bioHash, "Route layer changed frozen biosphere");
  assert.equal(hash(human), humanHash, "Route layer changed frozen settlements");
  assert(route.verifyAfter.passedAll, "Route verifier failed");
  assert(route.routes.length > 0, "No routes were generated");
  console.log(`PASS Route network generated: ${route.routes.length} routes, ${route.stats.totalKm} km, ${route.stats.connectedSettlementsCount} connected settlements`);
  const checkpoint = createCheckpoint({
    macro,
    regions: new Map([[descriptor.id, region]]),
    biosphere: new Map([[descriptor.id, bio]]),
    humans: new Map([[descriptor.id, human]]),
    view: {
      tabs: [{ id: "planet", kind: "planet", title: "Planet" }, { id: `region:${descriptor.id}`, kind: "region", title: descriptor.name, regionId: descriptor.id }],
      activeTabId: `region:${descriptor.id}`,
      themeId: "atlas",
      layers: DEFAULT_LAYERS,
      visibility: { geo: true, bio: true, human: true },
      raw: { geography: false, biosphere: false, human: false },
    },
  });
  const restored = readCheckpoint(JSON.stringify(checkpoint));
  assert.equal(hash(restored.regions[0]), geoHash);
  assert.equal(hash(restored.biosphere[0]), bioHash);
  assert.equal(hash(restored.humans[0]), hash(human));
  const orphaned = structuredClone(checkpoint);
  orphaned.biosphere[0].regionId = "missing-parent";
  assert.throws(() => readCheckpoint(JSON.stringify(orphaned)), /parent/);
  console.log(`PASS Sequential three-layer generation and exact checkpoint round-trip (${seed})`);
}

if (process.argv.includes("--smoke") && failures === 0) {
  try { await smoke(); } catch (e) {
    failures++;
    console.error("FAIL Pipeline smoke test:", e instanceof Error ? e.message : String(e));
  }
} else console.log("NOT RUN Pipeline smoke test (add --smoke)");
console.log("PENDING Population must move to a time-dependent, per-settlement layer; legacy data is preserved for backup.");
if (failures) process.exitCode = 1;
else console.log("PASS Requested project-health checks completed");