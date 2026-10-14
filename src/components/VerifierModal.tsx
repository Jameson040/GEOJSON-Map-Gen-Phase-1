import { useState } from "react";
import type {
  GeneratedRegion,
  PlanetMacro,
  VerificationCheck,
  VerificationReport,
} from "../world/types";
import { verifyPlanetMacro } from "../world/verifier";
import { ARCHETYPE_INFO } from "../world/tier1-finetune";
import { downloadText } from "../world/export-geojson";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Wrench,
  Flame,
  Waves,
  Mountain,
  Eye,
  Download,
  Terminal,
} from "lucide-react";

interface VerifierModalProps {
  open: boolean;
  onClose: () => void;
  macro: PlanetMacro | null;
  regions: Map<string, GeneratedRegion>;
  activeRegionId: string | null;
  showRawMode: boolean;
  onToggleRawMode: (v: boolean) => void;
}

export function VerifierModal({
  open,
  onClose,
  macro,
  regions,
  activeRegionId,
  showRawMode,
  onToggleRawMode,
}: VerifierModalProps) {
  const loadedList = [...regions.values()];
  const defaultRegionId =
    activeRegionId && regions.has(activeRegionId)
      ? activeRegionId
      : loadedList[0]?.descriptor.id ?? "planet";

  const [selectedTarget, setSelectedTarget] = useState<string>(defaultRegionId);
  const [viewTab, setViewTab] = useState<"checks" | "finetune" | "cli">("checks");

  if (!open || !macro) return null;

  const macroReport: VerificationReport = verifyPlanetMacro(macro);
  const currentRegion =
    selectedTarget !== "planet"
      ? regions.get(selectedTarget) ?? loadedList[0] ?? null
      : null;

  const macroRawReport: VerificationReport | null = macro.rawFeatures
    ? verifyPlanetMacro({ ...macro, features: macro.rawFeatures })
    : null;
  const activeReport = currentRegion ? currentRegion.verificationAfter : macroReport;
  const beforeReport = currentRegion ? currentRegion.verificationBefore : macroRawReport;
  const ft = currentRegion?.finetune ?? null;

  const exportReportJson = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      planetVerification: macroReport,
      regions: loadedList.map((r) => ({
        regionId: r.descriptor.id,
        regionName: r.descriptor.name,
        detailLevel: r.config.detailLevel,
        finetuneReport: r.finetune,
        verificationBeforeFinetune: r.verificationBefore,
        verificationAfterFinetune: r.verificationAfter,
      })),
    };
    downloadText(
      `verification-report-${macro.config.seed}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className={`rounded-xl border p-2 ${
                activeReport.passedAll
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"
              }`}
            >
              {activeReport.passedAll ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <ShieldAlert className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">
                  Finetune Stage &amp; Geomorphic Verifier
                </h2>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                    activeReport.passedAll
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                      : "border-rose-500/30 bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {activeReport.passedAll
                    ? `ALL ${activeReport.totalChecks}/${activeReport.totalChecks} CHECKS PASSED`
                    : `${activeReport.totalViolations} VIOLATIONS`}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Post-generation conflict resolution &amp; spatial invariant verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Target Selector + Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/40 px-6 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Target:
            </span>
            <button
              onClick={() => setSelectedTarget("planet")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                selectedTarget === "planet"
                  ? "bg-teal-500 font-bold text-slate-950"
                  : "bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              Tier 1 · Planet ({macroReport.passedChecks}/{macroReport.totalChecks})
            </button>
            {loadedList.map((r) => (
              <button
                key={r.descriptor.id}
                onClick={() => setSelectedTarget(r.descriptor.id)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  currentRegion?.descriptor.id === r.descriptor.id
                    ? "bg-amber-400 font-bold text-slate-950"
                    : "bg-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                Tier 2 · {r.descriptor.name} ({r.verificationAfter.passedChecks}/
                {r.verificationAfter.totalChecks})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {(
              [
                ["checks", "Invariant Checks"],
                ["finetune", "Finetune Ledger"],
                ["cli", "Verifier Script"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewTab(id)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  viewTab === id
                    ? "border border-teal-500/40 bg-teal-500/20 text-teal-300"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-xs">
          {loadedList.length === 0 && selectedTarget !== "planet" && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4 text-zinc-300">
              No Tier-2 region has been generated yet. Double-click any continent on the map or click{" "}
              <strong className="text-amber-300">Generate</strong> in the Region Cascade sidebar to run Tier-2
              generation + the Finetune Stage.
            </div>
          )}

          {/* Summary Banner for Region Before vs After */}
          {currentRegion && ft && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-teal-500/25 bg-teal-950/15 p-4 md:grid-cols-4">
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400">
                  Raw Violations Found
                </span>
                <span className="font-mono text-lg font-bold text-rose-400">
                  {beforeReport?.totalViolations.toLocaleString() ?? 0}
                </span>
                <span className="block text-[10px] text-zinc-500">
                  before Finetune Stage ({beforeReport?.passedChecks}/{beforeReport?.totalChecks} checks passed)
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400">
                  Post-Finetune Violations
                </span>
                <span className="font-mono text-lg font-bold text-emerald-400">
                  {activeReport.totalViolations}
                </span>
                <span className="block text-[10px] text-emerald-400/80">
                  {activeReport.passedChecks}/{activeReport.totalChecks} geomorphic rules passed ✓
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400">
                  Rivers Repaired / Pruned
                </span>
                <span className="font-mono text-lg font-bold text-sky-300">
                  {ft.riversRaw.toLocaleString()} → {ft.riversKept.toLocaleString()}
                </span>
                <span className="block text-[10px] text-zinc-500">
                  {ft.riversSnappedConfluence.toLocaleString()} snapped to Y-confluences
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400">
                  Volcanoes Filtered
                </span>
                <span className="font-mono text-lg font-bold text-amber-300">
                  {ft.volcanoesRaw} → {ft.volcanoesKept}
                </span>
                <span className="block text-[10px] text-zinc-500">
                  {ft.volcanoesDroppedCraton} stray craton vents removed
                </span>
              </div>
            </div>
          )}

          {/* TAB 1: INVARIANT CHECKS */}
          {viewTab === "checks" && (
            <div className="space-y-2.5">
              {activeReport.checks.map((chk: VerificationCheck) => {
                const rawChk = beforeReport?.checks.find((b) => b.id === chk.id);
                return (
                  <div
                    key={chk.id}
                    className={`rounded-xl border p-3.5 transition ${
                      chk.passed
                        ? "border-white/10 bg-white/[0.02]"
                        : "border-rose-500/40 bg-rose-950/20"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {chk.passed ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">{chk.title}</span>
                            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                              {chk.category}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-zinc-400">{chk.rule}</p>
                          <p className="mt-1 font-mono text-[11px] text-teal-300">{chk.details}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end font-mono text-[10px]">
                        {rawChk && rawChk.violationCount > 0 && (
                          <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-300">
                            Raw: {rawChk.violationCount.toLocaleString()} violations →{" "}
                            <strong className="text-emerald-300">{chk.violationCount}</strong>
                          </span>
                        )}
                        {(!rawChk || rawChk.violationCount === 0) && (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                            {chk.violationCount === 0 ? "PASS · 0 violations" : `${chk.violationCount} violations`}
                          </span>
                        )}
                      </div>
                    </div>

                    {rawChk && rawChk.sampleViolations.length > 0 && chk.passed && (
                      <div className="mt-2 rounded-lg border border-white/5 bg-black/30 px-3 py-1.5 text-[10px] text-zinc-400">
                        <span className="font-semibold text-amber-300">
                          Examples resolved by Finetune Stage:{" "}
                        </span>
                        {rawChk.sampleViolations.slice(0, 2).join(" • ")}
                      </div>
                    )}

                    {!chk.passed && chk.sampleViolations.length > 0 && (
                      <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-950/30 px-3 py-1.5 text-[10px] text-rose-300">
                        {chk.sampleViolations.join(" • ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: FINETUNE LEDGER */}
          {viewTab === "finetune" && !currentRegion && macro.shape && (
            <div className="space-y-3">
              <div className="rounded-xl border border-teal-500/25 bg-teal-950/15 p-3 text-[11px] leading-relaxed text-zinc-300">
                <strong className="text-teal-300">Tier-1 shape finetune.</strong> Each landmass keeps its centroid
                and area but is rebuilt from a real-world archetype (stretch, taper and bend along a tectonic or
                inherited axis, plus peninsulas, gulfs and a fractal coast). Candidates that self-cross, hit a
                neighbour or swallow a sea are retried along another axis or at lower intensity.{" "}
                <span className="font-mono text-zinc-400">
                  {macro.shape.reshaped} reshaped · {macro.shape.softened} softened · {macro.shape.keptRaw} kept raw ·{" "}
                  {macro.shape.sutured} sutured · {macro.shape.accreted} accreted · seam rotated{" "}
                  {Math.abs(macro.shape.longitudeRotationDeg).toFixed(1)}° through ocean · {macro.shape.elapsedMs} ms
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="px-3 py-2">Landmass</th>
                      <th className="px-3 py-2">Archetype</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Aspect</th>
                      <th className="px-3 py-2">Solidity</th>
                      <th className="px-3 py-2">Pen / Gulf</th>
                      <th className="px-3 py-2">Shift</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {macro.shape.records
                      .filter((r) => r.archetype !== "none" && (r.kind === "continent" || r.aspectAfter > 0))
                      .sort((a, b) => Number(b.kind === "continent") - Number(a.kind === "continent"))
                      .slice(0, 40)
                      .map((r) => (
                        <tr key={r.id} className="text-zinc-300">
                          <td className="px-3 py-1.5">
                            <span className={r.kind === "continent" ? "font-semibold text-white" : ""}>{r.name}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            {ARCHETYPE_INFO[r.archetype as keyof typeof ARCHETYPE_INFO]?.label ?? r.archetype}
                          </td>
                          <td
                            className={`px-3 py-1.5 ${
                              r.status === "reshaped" ? "text-emerald-300" : r.status === "softened" ? "text-amber-300" : "text-zinc-500"
                            }`}
                          >
                            {r.status}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.aspectBefore} → <span className="text-teal-300">{r.aspectAfter}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            {r.solidityBefore} → <span className="text-teal-300">{r.solidityAfter}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            {r.peninsulas} / {r.gulfs}
                          </td>
                          <td className="px-3 py-1.5">{r.centroidShiftKm} km</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {viewTab === "finetune" && (currentRegion || !macro.shape) && (
            <div className="space-y-4">
              {!ft ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-zinc-400">
                  Select a generated Tier-2 region tab above to inspect its Finetune Stage breakdown.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {/* River Topological Repair */}
                  <div className="rounded-xl border border-sky-500/25 bg-sky-950/15 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-300">
                      <Waves className="h-4 w-4" /> River Topology Repair
                    </div>
                    <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
                      Eliminates X-crossings, rivers meeting and separating, ocean-bay leaps, and
                      100K parallel valley crowding.
                    </p>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <LedgerRow label="Raw river segments" value={ft.riversRaw.toLocaleString()} />
                      <LedgerRow
                        label="Snapped to Y-confluences"
                        value={ft.riversSnappedConfluence.toLocaleString()}
                        tone="teal"
                      />
                      <LedgerRow
                        label="Clipped at coastline"
                        value={ft.riversClippedCoast.toLocaleString()}
                        tone="sky"
                      />
                      <LedgerRow
                        label="Terminated at lake rims"
                        value={ft.riversClippedLake.toLocaleString()}
                        tone="sky"
                      />
                      <LedgerRow
                        label="Braids / parallel dropped"
                        value={ft.riversDroppedBraidOrCrowd.toLocaleString()}
                        tone="rose"
                      />
                      <LedgerRow
                        label="Short stubs dropped"
                        value={ft.riversDroppedStub.toLocaleString()}
                        tone="rose"
                      />
                      <div className="border-t border-white/10 pt-1.5">
                        <LedgerRow
                          label="Clean rivers retained"
                          value={ft.riversKept.toLocaleString()}
                          tone="emerald"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Volcano Tectonic Reconciliation */}
                  <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                      <Flame className="h-4 w-4" /> Volcano Arc Filter
                    </div>
                    <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
                      Removes random volcanoes scattered across flat craton shields and enforces
                      subduction/hotspot arc spacing.
                    </p>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <LedgerRow label="Raw volcanoes spawned" value={ft.volcanoesRaw} />
                      <LedgerRow
                        label="Dropped (off-arc craton)"
                        value={ft.volcanoesDroppedCraton}
                        tone="rose"
                      />
                      <LedgerRow
                        label="Dropped (water / crowded)"
                        value={ft.volcanoesDroppedWaterOrCrowd}
                        tone="rose"
                      />
                      <div className="border-t border-white/10 pt-1.5">
                        <LedgerRow
                          label="Valid arc vents kept"
                          value={ft.volcanoesKept}
                          tone="emerald"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Peaks, Lakes & Biomes */}
                  <div className="rounded-xl border border-teal-500/25 bg-teal-950/15 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-300">
                      <Mountain className="h-4 w-4" /> Summits, Lakes &amp; Biomes
                    </div>
                    <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
                      Purges peaks inside lakes, deduplicates stacked summits, and removes
                      coast-breaching or overlapping lakes.
                    </p>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <LedgerRow label="Raw summits" value={ft.peaksRaw.toLocaleString()} />
                      <LedgerRow
                        label="Crowded / in-lake dropped"
                        value={ft.peaksDroppedWaterOrCrowd.toLocaleString()}
                        tone="rose"
                      />
                      <LedgerRow
                        label="Summits kept"
                        value={ft.peaksKept.toLocaleString()}
                        tone="emerald"
                      />
                      <div className="border-t border-white/10 pt-1.5">
                        <LedgerRow label="Raw lakes" value={ft.lakesRaw} />
                        <LedgerRow
                          label="Rescaled (Zipf basin cap)"
                          value={ft.lakesRescaled}
                          tone="sky"
                        />
                        <LedgerRow
                          label="Excess / clustered dropped"
                          value={ft.lakesDroppedOverlapOrCoast}
                          tone="rose"
                        />
                        <LedgerRow label="Lakes kept" value={ft.lakesKept} tone="emerald" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLI VERIFIER SCRIPT */}
          {viewTab === "cli" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950 p-3.5">
                <div className="flex items-center gap-2.5">
                  <Terminal className="h-4 w-4 text-teal-400" />
                  <div>
                    <span className="font-semibold text-white">
                      Standalone Verifier Script (`scripts/verify-world.ts`)
                    </span>
                    <p className="text-[11px] text-zinc-400">
                      Run via <code className="text-teal-300">npx vite-node scripts/verify-world.ts</code> to
                      verify Tier 1 &amp; Tier 2 across Standard, High, and Ultra (100K) scales.
                    </p>
                  </div>
                </div>
                <button
                  onClick={exportReportJson}
                  className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/20 px-3 py-1.5 text-xs font-semibold text-teal-300 transition hover:bg-teal-500 hover:text-slate-950"
                >
                  <Download className="h-3.5 w-3.5" /> Export Report JSON
                </button>
              </div>

              <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
{`// Invariant summary enforced by src/world/verifier.ts & scripts/verify-world.ts:
1. [PRESENCE]  presence_core_geography     — Coastline, ranges, peaks, rivers, and biomes exist
2. [PLACEMENT] peaks_on_dry_land           — 0 summits in ocean or lakes; >= 10 km prominence spacing
3. [TECTONICS] volcanoes_tectonic_and_dry  — 0 stray craton vents; restricted to subduction/hotspot arcs
4. [HYDROLOGY] lakes_inland_and_disjoint   — 0 coast-breaching lakes; 0 overlapping lake basins
5. [HYDROLOGY] rivers_on_land_no_ocean     — 100% of river vertices on land; 0 ocean bay leaps
6. [HYDROLOGY] rivers_no_lake_passthrough  — 0 rivers passing through lake interiors
7. [HYDROLOGY] rivers_no_crossings_braids  — 0 X-crossings or meet-and-separate braids (planar tree)
8. [HYDROLOGY] rivers_valid_termini        — 0 hanging tributaries; all mouths reach parent, lake, or sea
9. [CLIMATE]   glaciers_cold_or_high       — 100% of glaciers <= 2°C or >= 2400 m snowline
10.[CLIMATE]   biomes_anchored_on_land     — 100% of biome patches cover land (islet-safe rule)
11.[SCALE]     size_class_conformance      — ranges, summit ceiling, Strahler depth, lake & biome radii
                                              and feature budget all inside the landmass's size class

// All tolerances (summit spacing, vent spacing, snap radius, coast reach, min river
// length) are read from the land-size compartment, so a 1 km² skerry and a
// 35M km² supercontinent are each judged at their own scale.`}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-2">
            {currentRegion && (
              <button
                onClick={() => onToggleRawMode(!showRawMode)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  showRawMode
                    ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                    : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                {showRawMode
                  ? "Map Showing: RAW Pre-Finetune (Click for Finetuned)"
                  : "Compare on Map: Toggle Raw Pre-Finetune"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportReportJson}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" /> Download Verification JSON
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-teal-400"
            >
              <Wrench className="h-3.5 w-3.5" /> Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LedgerRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "teal" | "sky" | "rose" | "emerald";
}) {
  const col =
    tone === "teal"
      ? "text-teal-300"
      : tone === "sky"
      ? "text-sky-300"
      : tone === "rose"
      ? "text-rose-400"
      : tone === "emerald"
      ? "text-emerald-400 font-bold"
      : "text-zinc-200";
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className={col}>{value}</span>
    </div>
  );
}
