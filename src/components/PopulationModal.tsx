import { useState, useEffect } from "react";
import type { GenProgress, GeneratedRegion } from "../world/types";
import type { HumanLayerResult } from "../world/human/human-types";
import { SETTLEMENT_BY_TYPE } from "../world/human/settlement-catalog";
import type { PopulationConfig, PopulationLayerResult } from "../world/population/population-types";
import { ERA_META } from "../world/population/population-types";
import { downloadText } from "../world/export-geojson";
import { X, Play, Zap, Sparkles, CheckCircle2, XCircle, Download, BookOpen, ClipboardList, Users } from "lucide-react";

export function PopulationModal({
  open,
  onClose,
  region,
  zones,
  existing,
  busy,
  progress,
  onGenerate,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  region: GeneratedRegion | null;
  zones: HumanLayerResult | null;
  existing: PopulationLayerResult | null;
  busy: boolean;
  progress: GenProgress | null;
  onGenerate: (cfg: PopulationConfig) => void;
  onClear: () => void;
}) {
  const [era, setEra] = useState<PopulationConfig["era"]>("current");
  const [year, setYear] = useState(2026);
  const [targetScale, setTargetScale] = useState(1);
  const [seed, setSeed] = useState("");
  const [tab, setTab] = useState<"generate" | "results" | "catalog">("generate");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEra(existing?.config.era ?? "current");
    setYear(existing?.config.year ?? 2026);
    setTargetScale(existing?.config.targetScale ?? 1);
    setSeed(existing?.config.customSeed ?? "");
    setTab(existing ? "results" : "generate");
    setSelectedZone(null);
  }, [open, region?.descriptor.id, existing]);

  if (!open || !region) return null;

  const r = existing?.report;
  const totalPopulation = existing ? [...existing.model.values()].reduce((s, p) => s + p.occupancy, 0) : 0;
  const usedZones = existing ? [...existing.model.values()].filter((p) => p.occupancy > 0).length : 0;
  void usedZones;

  const exportGeoJSON = () => {
    if (!existing || !zones) return;
    const zoneById = new Map(zones.settlements.map((s) => [s.id, s]));
    downloadText(
      `population-${existing.regionName.replace(/\s+/g, "-").toLowerCase()}-${existing.config.era}.geojson`,
      JSON.stringify(
        {
          type: "FeatureCollection",
          metadata: {
            generator: "Terra Ex Nihilo — Layer 5 Population",
            region: existing.regionName,
            era: existing.config.era,
            year: existing.config.year,
            targetScale: existing.config.targetScale,
            seed: existing.seedUsed,
            contract: "Time-dependent people as generative history structure, attached to Layer-4 habitable zones (which carry no population). Re-runnable & scrubbable.",
          },
          features: [...existing.model.entries()].map(([zoneId, p]) => {
            const z = zoneById.get(zoneId)!;
            return {
              type: "Feature",
              id: `pop_${zoneId}`,
              geometry: { type: "Point", coordinates: [z.point[0], z.point[1]] },
              properties: {
                zoneId,
                site: z.name,
                siteType: z.type,
                tier: z.tier,
                habitation: z.habitation,
                occupancy: p.occupancy,
                usagePercent: p.usagePercent,
                densityPerKm2: p.densityPerKm2,
                hardCap: p.hardCap,
                confidence: p.confidence,
                foodShortage: p.foodShortage,
                backcastYears: p.backcastYears,
                forwardCastYears: p.forwardCastYears,
                phases: p.phases,
                drivers: p.drivers,
              },
            };
          }),
        },
        null,
        2
      )
    );
  };

  const zonePopulation = selectedZone && existing ? existing.model.get(selectedZone) ?? null : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2 text-sky-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Layer 5 — Population · {region.descriptor.name}</h2>
              <p className="text-xs text-zinc-400">Time-dependent actual people on top of the zones of L4, feeding on layers L1 + L3 beneath.</p>
            </div>
          </div>
          {!busy && (
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-950/40 px-6 py-2.5 text-xs">
          {([["generate", "Generate", Sparkles], ["results", "Finetune & Verify", ClipboardList], ["catalog", "Zones in Play", BookOpen]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${tab === id ? "border border-sky-500/40 bg-sky-500/20 text-sky-300" : "text-zinc-400 hover:text-white"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-xs">
          {!zones && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 p-3 text-amber-200">
              <strong>Layer 4 missing.</strong> Generate Habitable Zones for this region first.
            </div>
          )}

          {tab === "generate" && (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 leading-relaxed text-zinc-300">
                <strong className="text-sky-300">Population belongs to time</strong>, not to the settlement's identity. Generation models an occupancy curve for every zone. Finetune applies era truth (a metropolis-era world and an early-forager world are different realisations of the same geography), hunger rules (surplus people move to the biosphere, not get fed locally), ruin/revival discipline, and capacity limits. Nothing in L1, L2 or L3 is changed.
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Era</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(ERA_META) as (keyof typeof ERA_META)[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setEra(k)}
                        className={`rounded-lg border px-2 py-1.5 text-left transition ${era === k ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"}`}
                      >
                        <span className="block text-[12px] font-medium text-white">{ERA_META[k].label}</span>
                        <span className="block text-[10px] leading-tight text-zinc-500">{ERA_META[k].description}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between"><span className="text-zinc-300">Year (junction for the curves)</span><span className="font-mono text-sky-300">{year}</span></div>
                    <input type="number" min={-2000} max={2400} step={1} value={year} onChange={(e) => setYear(Math.round(Number(e.target.value) || 0))}
                      className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span className="text-zinc-300">Population scale (1B → 8B analogue)</span>
                      <span className="font-mono text-sky-300">{targetScale.toFixed(2)}×</span>
                    </div>
                    <input type="range" min={0.1} max={8} step={0.1} value={targetScale} onChange={(e) => setTargetScale(Number(e.target.value))} className="w-full cursor-pointer accent-sky-400" />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Population Seed (rerollable)</span>
                      <button disabled={busy} onClick={() => setSeed(Math.random().toString(36).slice(2, 8))} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
                        <Sparkles className="h-3.5 w-3.5" /> Randomize
                      </button>
                    </div>
                    <input value={seed} disabled={busy} onChange={(e) => setSeed(e.target.value)} placeholder="default (deterministic per region+era)"
                      className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400" />
                  </div>
                </div>
              </div>
              {busy && progress && (
                <div className="space-y-2 rounded-xl border border-sky-500/30 bg-sky-950/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-sky-300"><Zap className="h-3.5 w-3.5 animate-pulse" /> Stage {progress.stage}/{progress.totalStages} · {progress.stageName}</span>
                    <span className="font-mono font-bold text-sky-400">{progress.percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-150" style={{ width: `${progress.percent}%` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "results" && !existing && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-zinc-400">No population model generated yet.</div>}
          {tab === "results" && existing && r && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Metric label="Actual people" value={totalPopulation} tone="text-sky-300" />
                <Metric label="Used zones" value={`${usedZones}/${existing.model.size}`} />
                <Metric label="Hunger zones" value={r.foodShortageZones} tone="text-rose-300" />
                <Metric label="Relocated to biosphere" value={r.movedToBiosphere} tone="text-amber-300" />
                <Metric label="Ruins revived" value={r.revived} tone="text-emerald-300" />
                <Metric label="Finetune time" value={r.elapsedMs} suffix="ms" />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Finetune rules applied</span>
                <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                  {Object.entries(r.droppedByRule).map(([k, v]) => <span key={k} className="rounded border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{k} ×{v}</span>)}
                  {Object.keys(r.droppedByRule).length === 0 && <span className="text-zinc-500">none</span>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[existing.verifyBefore, existing.verifyAfter].map((v, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${i === 1 && v.passedAll ? "border-emerald-500/30 bg-emerald-950/20" : "border-white/10 bg-white/[0.02]"}`}>
                    <div className="mb-1.5 flex items-center justify-between"><span className="font-semibold text-white">{i === 0 ? "Before finetune (raw)" : "After finetune"}</span><span className={`font-mono text-[11px] ${v.passedAll ? "text-emerald-300" : "text-rose-300"}`}>{v.passedChecks}/{v.totalChecks} · {v.totalViolations}v</span></div>
                    <div className="space-y-1">
                      {v.checks.map((c) => (
                        <div key={c.id} className="flex items-start gap-1.5 text-[11px]">
                          {c.passed ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />}
                          <span className="text-zinc-300">{c.title}{!c.passed && <span className="text-zinc-500"> — {c.violationCount}v</span>}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "catalog" && (
            <>
              {!existing ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-zinc-400">Generate a population model first to inspect zones.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
                    <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10">
                      <table className="w-full text-left font-mono text-[10px]">
                        <thead className="sticky top-0 bg-white/5 uppercase tracking-wider text-zinc-400"><tr><th className="px-2 py-1.5">Zone</th><th className="px-2 py-1.5">Era usage</th><th className="px-2 py-1.5">Occupancy</th><th className="px-2 py-1.5">Usage</th><th className="px-2 py-1.5">Hab.</th></tr></thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {zones!.settlements.map((z) => {
                            const p = existing.model.get(z.id)!;
                            const selected = selectedZone === z.id;
                            return (
                              <tr key={z.id} onClick={() => setSelectedZone(selected ? null : z.id)}
                                className={`cursor-pointer text-zinc-300 transition hover:bg-sky-500/10 ${selected ? "bg-sky-500/15" : ""}`}>
                                <td className="px-2 py-1"><span className="mr-1">{z.glyph}</span>{z.name}</td>
                                <td className="px-2 py-1">{SETTLEMENT_BY_TYPE.get(z.type)!.name}</td>
                                <td className="px-2 py-1">{p.occupancy.toLocaleString()}</td>
                                <td className="px-2 py-1 text-zinc-400">{p.usagePercent}%</td>
                                <td className="px-2 py-1 text-zinc-500">{z.habitation === "lived_now" ? "now" : z.habitation === "ancient_pulse" ? "ancient" : "pot."}{p.confidence === 0 ? " · model" : ` · ${p.confidence}`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      {zonePopulation && zones ? (() => {
                        const s = zones.settlements.find((x) => x.id === selectedZone)!;
                        return (
                          <div className="space-y-2.5 text-[11px]">
                            <div>
                              <div className="flex items-center gap-2">
                                <span>{s.glyph}</span>
                                <span className="font-semibold text-white">{s.name}</span>
                              </div>
                              <div className="mt-0.5 text-zinc-400">{s.habitation === "lived_now" ? "lived now" : s.habitation === "ancient_pulse" ? "ancient (ruin)" : "potential"} · confidence {zonePopulation.confidence === 2 ? "observed" : zonePopulation.confidence === 1 ? "signal" : "modelled"}</div>
                            </div>
                            <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 p-2 font-mono">
                              <div className="text-lg font-bold text-sky-200">{zonePopulation.occupancy.toLocaleString()}</div>
                              <div className="mt-0.5 text-[10px] text-zinc-400">actual occupants · usage {zonePopulation.usagePercent}% · density {zonePopulation.densityPerKm2}/km²</div>
                              <div className="mt-0.5 text-[10px] text-zinc-400">hard cap {zonePopulation.hardCap.toLocaleString()} · {zonePopulation.foodShortage ? "⚠ hunger" : "fed"}</div>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Timeline · junction at year {existing!.config.year}</span>
                              <div className="mt-1 space-y-1">
                                {zonePopulation.phases.map((ph, i) => (
                                  <div key={i} className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-2 py-1">
                                    <span className="capitalize text-zinc-300">{ph.phase}</span>
                                    <span className="font-mono text-zinc-500">{ph.startYear}→{ph.endYear}</span>
                                    <span className="font-mono text-zinc-300">{ph.endPopulation.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Drivers</span>
                              <div className="mt-1 flex flex-wrap gap-1 font-mono text-[9px]">
                                {Object.entries(zonePopulation.drivers).map(([k, v]) => (
                                  <span key={k} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-zinc-300">{k}: {v}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="p-6 text-center text-zinc-500">Select a zone to see its history</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-2">
            {existing && (
              <>
                <button onClick={exportGeoJSON} className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10">
                  <Download className="h-3.5 w-3.5" /> Population GeoJSON
                </button>
                <button onClick={onClear} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50">
                  Scrub population
                </button>
              </>
            )}
            <span className="hidden rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] text-zinc-500 lg:inline-block">
              seed {existing?.seedUsed.split("::").slice(-2).join("::") ?? "—"}
            </span>
          </div>
          <button disabled={busy || !zones} onClick={() => onGenerate({ era, year, targetScale, customSeed: seed.trim() || undefined })}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition">
            {busy ? <Zap className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            {busy ? "Modelling…" : existing ? "Regenerate Population" : "Generate Population"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone, suffix }: { label: string; value: string | number; tone?: string; suffix?: string }) {
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
      <span className="block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`font-mono text-lg font-bold ${tone ?? "text-zinc-200"}`}>{display}{suffix ?? ""}</span>
    </div>
  );
}
