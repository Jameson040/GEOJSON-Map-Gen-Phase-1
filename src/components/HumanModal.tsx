import { useState, useEffect } from "react";
import type { GenProgress, GeneratedRegion } from "../world/types";
import type { BioLayerResult } from "../world/bio/bio-types";
import type { HumanConfig, HumanLayerResult } from "../world/human/human-types";
import { SETTLEMENT_CATALOG, TIER_COLORS, TIER_LABELS, TIER_ORDER } from "../world/human/settlement-catalog";
import { downloadText } from "../world/export-geojson";
import { xToLon, yToLat } from "../world/constants";
import { X, Play, Zap, Sparkles, CheckCircle2, XCircle, Download, BookOpen, ClipboardList, Eye, Home } from "lucide-react";

export function HumanModal({
  open,
  onClose,
  region,
  bio,
  existing,
  busy,
  progress,
  onGenerate,
  showRaw,
  onToggleRaw,
}: {
  open: boolean;
  onClose: () => void;
  region: GeneratedRegion | null;
  bio: BioLayerResult | null;
  existing: HumanLayerResult | null;
  busy: boolean;
  progress: GenProgress | null;
  onGenerate: (cfg: HumanConfig) => void;
  showRaw: boolean;
  onToggleRaw: (v: boolean) => void;
}) {
  const [density, setDensity] = useState(1);
  const [urbanisation, setUrbanisation] = useState(0.4);
  const [seed, setSeed] = useState("");
  const [tab, setTab] = useState<"generate" | "results" | "catalog">("generate");
  useEffect(() => {
    if (!open) return;
    setDensity(existing?.config.density ?? 1);
    setUrbanisation(existing?.config.urbanisation ?? 0.4);
    setSeed(existing?.config.customSeed ?? "");
    setTab(existing ? "results" : "generate");
  }, [open, region?.descriptor.id, existing]);
  if (!open || !region) return null;

  const r = existing?.report;
  const exportGeoJSON = () => {
    if (!existing) return;
    downloadText(
      `habitable-zones-${existing.regionName.replace(/\s+/g, "-").toLowerCase()}.geojson`,
      JSON.stringify(
        {
          type: "FeatureCollection",
          metadata: { generator: "Terra Ex Nihilo — Layer 4 Habitable Zones", layer: "human", region: existing.regionName, seed: existing.seedUsed, note: "STRUCTURE ONLY: no population. Population is Layer 5, time-dependent and generated per zone." },
          features: existing.settlements.map((s) => ({
            type: "Feature",
            id: s.id,
            geometry: { type: "Point", coordinates: [xToLon(s.point[0]), yToLat(s.point[1])] },
            properties: {
              name: s.name,
              type: s.type,
              tier: s.tier,
              habitation: s.habitation,
              capacityScore: s.capacity,
              popCapStructural: s.popCap,
              water: s.waterSource,
              resourceRoles: s.resourceRoles,
              traits: s.siteTraits,
              origin: s.origin,
            },
          })),
        },
        null,
        2
      )
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-orange-500/25 bg-orange-500/10 p-2 text-orange-400">
              <Home className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Layer 4 — Habitable Zones · {region.descriptor.name}</h2>
              <p className="text-xs text-zinc-400">Sited on frozen L1, supplied-read from frozen L3. This layer marks only livable places — population is Layer 5.</p>
            </div>
          </div>
          {!busy && (
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-950/40 px-6 py-2.5 text-xs">
          {([["generate", "Generate", Sparkles], ["results", "Finetune & Verify", ClipboardList], ["catalog", "Settlement Catalog", BookOpen]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${tab === id ? "border border-orange-500/40 bg-orange-500/20 text-orange-300" : "text-zinc-400 hover:text-white"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-xs">
          {!bio && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 p-3 text-amber-200">
              <strong>Layer 3 missing.</strong> Settlements must be fed — generate the Biosphere (L3) for this region first.
            </div>
          )}

          {tab === "generate" && (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 leading-relaxed text-zinc-200">
                <strong className="text-orange-400">Generation</strong> marks candidate habitable zones everywhere — a metropolis site mid-desert, a fishing site on a summit. <strong className="text-orange-400">Finetune</strong> resolves each against the frozen layers: livable ground &amp; terrain, fresh water in reach, required resource roles reachable from L2, structural carrying capacity (over-built sites are <em>demoted</em>), spacing, area-scaled caps, and hierarchy.
              </div>
              <div className="rounded-xl border border-orange-500/30 bg-orange-950/20 p-3 text-[11px] leading-relaxed text-orange-200/90">
                <strong>The population contract.</strong> This layer holds only structure: site type, tier, habitation evidence (lived now / ancient-pulse / potential), water and resource reach, capacity band and capacity score — never a headcount. Population is <strong>Layer 5</strong>, generated per zone from all three layers beneath, time-dependent (1B → 8B worlds), and designed to be re-run or scrubbed without touching these lower layers.
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between"><span className="text-zinc-300">Settlement density</span><span className="font-mono text-orange-400">{density.toFixed(1)}×</span></div>
                  <input type="range" min={0.5} max={2} step={0.1} value={density} disabled={busy} onChange={(e) => setDensity(Number(e.target.value))} className="w-full cursor-pointer accent-orange-400" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between"><span className="text-zinc-300">Urbanisation</span><span className="font-mono text-orange-400">{Math.round(urbanisation * 100)}%</span></div>
                  <input type="range" min={0} max={1} step={0.05} value={urbanisation} disabled={busy} onChange={(e) => setUrbanisation(Number(e.target.value))} className="w-full cursor-pointer accent-orange-400" />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Settlement Seed (rerollable)</span>
                  <button disabled={busy} onClick={() => setSeed(Math.random().toString(36).slice(2, 8))} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"><Sparkles className="h-3.5 w-3.5" /> Randomize</button>
                </div>
                <input value={seed} disabled={busy} onChange={(e) => setSeed(e.target.value)} placeholder="default (deterministic per region)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 font-mono text-sm text-white outline-none transition focus:border-orange-400" />
              </div>
              {busy && progress && (
                <div className="space-y-2 rounded-xl border border-orange-500/30 bg-orange-950/30 p-4">
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium text-orange-300"><Zap className="h-3.5 w-3.5 animate-pulse" /> Stage {progress.stage}/{progress.totalStages} · {progress.stageName}</span><span className="font-mono font-bold text-orange-400">{progress.percent}%</span></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-150" style={{ width: `${progress.percent}%` }} /></div>
                </div>
              )}
            </>
          )}

          {tab === "results" && !existing && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-zinc-400">No settlements generated yet for this region.</div>}
          {tab === "results" && existing && r && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Metric label="Raw founded" value={r.rawCount} />
                <Metric label="Kept" value={r.keptAsIs} tone="text-emerald-300" />
                <Metric label="Relocated" value={r.relocated} tone="text-sky-300" />
                <Metric label="Demotions" value={r.demotions} tone="text-amber-300" />
                <Metric label="Dropped" value={r.dropped} tone="text-rose-300" />
                <Metric label="Final" value={r.finalCount} tone="text-orange-300" />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Drops by rule</span>
                <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                  {Object.entries(r.droppedByRule).map(([k, v]) => <span key={k} className="rounded border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{k} ×{v}</span>)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Hierarchy · {existing.stats.zones} zones · structural capacity {existing.stats.totalCapacity.toLocaleString()}</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                  {TIER_ORDER.map((t) => (
                    <span key={t} className="rounded border px-1.5 py-0.5 font-mono" style={{ borderColor: `${TIER_COLORS[t]}55`, background: `${TIER_COLORS[t]}18`, color: TIER_COLORS[t] }}>
                      {TIER_LABELS[t]} {existing.stats.byTier[t]}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">lived now ⛏ {existing.stats.byHabitation.lived_now}</span>
                  <span className="rounded border border-zinc-500/25 bg-zinc-500/10 px-1.5 py-0.5 text-zinc-300">ancient · pulses {existing.stats.byHabitation.ancient_pulse}</span>
                  <span className="rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-sky-300">potential {existing.stats.byHabitation.potential}</span>
                </div>
                {existing.stats.bestSite && (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Best site: <strong className="text-zinc-200">{existing.stats.bestSite.name}</strong> — capacity score {existing.stats.bestSite.capacity.toFixed(2)} · {existing.stats.bestSite.type.replace(/_/g, " ")}
                  </p>
                )}
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
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-400">
                <strong className="text-orange-400">{SETTLEMENT_CATALOG.length} habitable-site kinds</strong> across six tiers, from seasonal camps to a port-metropolis candidate. Capacities are <em>structural bands</em> — the land's headroom for Layer 5, not people. Each lists hard site needs (answered by L1), reachable food roles (answered by L3), water reach, supply radius and spacing.
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead className="bg-white/5 uppercase tracking-wider text-zinc-400"><tr><th className="px-2 py-1.5">Kind</th><th className="px-2 py-1.5">Tier</th><th className="px-2 py-1.5">Capacity band (structural, not headcount)</th><th className="px-2 py-1.5">Needs (L1)</th><th className="px-2 py-1.5">Food (L2)</th><th className="px-2 py-1.5">Water · Spacing</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {SETTLEMENT_CATALOG.map((d) => (
                      <tr key={d.type} className="text-zinc-300">
                        <td className="px-2 py-1"><span className="mr-1">{d.glyph}</span>{d.name}</td>
                        <td className="px-2 py-1" style={{ color: TIER_COLORS[d.tier] }}>{TIER_LABELS[d.tier]}</td>
                        <td className="px-2 py-1">{d.popCap[0].toLocaleString()}–{d.popCap[1].toLocaleString()}</td>
                        <td className="px-2 py-1 text-zinc-400">{d.needs.join(", ") || "—"}</td>
                        <td className="px-2 py-1 text-zinc-400">{d.foodRoles.join(", ") || "—"}</td>
                        <td className="px-2 py-1 text-zinc-500">{d.waterKm} km · {d.spacingKm} km</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-2">
            {existing && (
              <>
                <button onClick={() => onToggleRaw(!showRaw)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${showRaw ? "border-rose-500/40 bg-rose-500/20 text-rose-300" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"}`}>
                  <Eye className="h-3.5 w-3.5" />{showRaw ? `Showing RAW founding (${existing.rawSettlements.length})` : "Compare raw founding on map"}
                </button>
                <button onClick={exportGeoJSON} className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"><Download className="h-3.5 w-3.5" /> Settlements GeoJSON</button>
              </>
            )}
          </div>
          <button disabled={busy || !bio} onClick={() => onGenerate({ density, urbanisation, customSeed: seed.trim() || undefined })}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 disabled:opacity-50">
            {busy ? <Zap className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            {busy ? "Founding…" : existing ? "Regenerate Settlements" : "Generate Settlements"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
      <span className="block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`font-mono text-lg font-bold ${tone ?? "text-zinc-200"}`}>{value.toLocaleString()}</span>
    </div>
  );
}
