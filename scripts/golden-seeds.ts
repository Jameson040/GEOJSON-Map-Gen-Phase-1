// ---------------------------------------------------------------------------
// GOLDEN-SEED HARNESS
//
// Locks the Tier-1 pipeline (generate → finetune → verify) to a fixed corpus of
// seeds so that no improvement can silently change an already-passing world.
//
//   npx tsx scripts/golden-seeds.ts            check mode (CI default)
//   npx tsx scripts/golden-seeds.ts --update   refresh the snapshot
//
// Snapshot rules:
//   • A seed that previously PASSED must keep the exact same cartographic
//     content hash — any byte difference is a regression and fails the run.
//   • A seed that previously passed must never start failing a check.
//   • A seed that previously FAILED may change freely (improvements are
//     reported as INFO and never fail the run). Fail→pass is an improvement.
//   • The corpus membership itself is locked: adding/removing seeds requires
//     a deliberate --update.
//
// The corpus is the deterministic 60-seed robustness sweep
// (makeRng("seed-robustness-corpus"), 8-char alphanumeric ids) plus the two
// canonical project seeds used by `npm run verify` and CI.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePlanetMacro } from "../src/world/tier1-planet";
import { finetunePlanetShapes } from "../src/world/tier1-finetune";
import { verifyPlanetMacro } from "../src/world/verifier";
import { makeRng } from "../src/world/rng";
import type { PlanetMacro } from "../src/world/types";

const SNAPSHOT_PATH = new URL("./golden-seeds.json", import.meta.url).pathname;
const UPDATE = process.argv.includes("--update");

const CORPUS_LOCK = "seed-robustness-corpus";
const CANONICAL_SEEDS = ["terra-novus", "meridian-3"] as const;

function corpusSeeds(): string[] {
  const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rng = makeRng(CORPUS_LOCK);
  const sweep = Array.from({ length: 60 }, () =>
    Array.from({ length: 8 }, () => ALPHA[Math.floor(rng() * 36)]).join(""),
  );
  return [...sweep, ...CANONICAL_SEEDS];
}

const DEFAULT_CONFIG = {
  continentCount: 5, // must mirror App.tsx DEFAULT_PLANET (tier1 clamps 3..8)
  oceanLevel: 1,
  tectonicActivity: 1,
  islandDensity: 1,
  polarIceExtent: 1,
} as const;

// Stable stringify: recursively sorted keys, dropped volatile fields.
function canonicalize(value: unknown): string {
  const drop = new Set(["elapsedMs", "generationTimeMs", "processedAt", "timestamp"]);
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (drop.has(k)) continue;
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

/** Content hash of everything cartographic the pipeline emits. */
function macroHash(macro: PlanetMacro): string {
  const payload = {
    features: macro.features,
    rawFeatures: macro.rawFeatures ?? [],
    regions: macro.regions,
    plates: macro.plates,
    stats: macro.stats,
    shape: macro.shape
      ? {
          seamX: macro.shape.seamX,
          longitudeRotationDeg: macro.shape.longitudeRotationDeg,
          records: macro.shape.records,
          reshaped: macro.shape.reshaped,
          softened: macro.shape.softened,
          keptRaw: macro.shape.keptRaw,
          sutured: macro.shape.sutured,
          accreted: macro.shape.accreted,
        }
      : null,
  };
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

interface SeedResult {
  passed: boolean;
  failingChecks: string[];
  hash: string;
}

async function runSeed(seed: string): Promise<SeedResult> {
  const macro = finetunePlanetShapes(
    await generatePlanetMacro({ seed, ...DEFAULT_CONFIG }),
  );
  const report = verifyPlanetMacro(macro);
  return {
    passed: report.passedAll,
    failingChecks: report.checks.filter((c) => !c.passed).map((c) => c.id),
    hash: macroHash(macro),
  };
}

interface Snapshot {
  version: 1;
  corpusLock: string;
  seeds: Record<string, SeedResult>;
}

async function main() {
  const seeds = corpusSeeds();
  const snapshot: Snapshot = { version: 1, corpusLock: CORPUS_LOCK, seeds: {} };
  const t0 = Date.now();

  for (const seed of seeds) {
    const result = await runSeed(seed);
    snapshot.seeds[seed] = result;
    if (!UPDATE) process.stdout.write(result.passed ? "." : "F");
  }
  const passCount = Object.values(snapshot.seeds).filter((s) => s.passed).length;
  const total = seeds.length;
  console.log(`\n${passCount}/${total} seeds pass (${((passCount / total) * 100).toFixed(0)}%) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (UPDATE) {
    mkdirSync(new URL(".", import.meta.url).pathname, { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
    const failing = seeds.filter((s) => !snapshot.seeds[s].passed);
    console.log(`Snapshot written: ${SNAPSHOT_PATH}`);
    console.log(
      failing.length
        ? `Known-failing seeds locked in as failing (${failing.length}): ${failing.join(", ")}`
        : "All corpus seeds pass.",
    );
    return;
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`FAIL: ${SNAPSHOT_PATH} not found — run \`npm run seeds:update\` once to create it.`);
    process.exit(1);
  }
  const prev = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;

  let regressions = 0;
  let improvements = 0;
  const report = (seed: string, msg: string) => console.log(`  ${seed}: ${msg}`);

  for (const seed of seeds) {
    const before = prev.seeds[seed];
    const now = snapshot.seeds[seed];
    if (!before) {
      regressions++;
      report(seed, "FAIL — seed missing from snapshot (run seeds:update deliberately)");
      continue;
    }
    if (before.passed && !now.passed) {
      regressions++;
      report(seed, `FAIL — was passing, now fails: ${now.failingChecks.join(", ")}`);
      continue;
    }
    if (before.passed && before.hash !== now.hash) {
      regressions++;
      report(seed, "FAIL — was passing but cartographic output changed (golden hash mismatch)");
      continue;
    }
    if (!before.passed && now.passed) {
      improvements++;
      report(seed, "INFO — was failing, now passes (run seeds:update to lock the improvement)");
      continue;
    }
    if (!before.passed && before.failingChecks.join("|") !== now.failingChecks.join("|")) {
      improvements++;
      report(
        seed,
        `INFO — failing checks changed [${before.failingChecks.join(", ")}] → [${now.failingChecks.join(", ")}]`,
      );
    }
  }
  for (const seed of Object.keys(prev.seeds)) {
    if (!seeds.includes(seed)) {
      regressions++;
      report(seed, "FAIL — seed was removed from the corpus");
    }
  }

  if (regressions > 0) {
    console.error(`\nFAIL: ${regressions} regression(s), ${improvements} improvement(s).`);
    process.exit(1);
  }
  console.log(`OK: no regressions on ${total} golden seeds${improvements ? ` (${improvements} improvement(s) — refresh snapshot with seeds:update)` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
