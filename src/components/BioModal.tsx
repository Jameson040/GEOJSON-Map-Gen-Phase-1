import { useState, useEffect } from "react";
import type { GenProgress, GeneratedRegion } from "../world/types";
import type { BioConfig, BioLayerResult } from "../world/bio/bio-types";
import { SPECIES_CATALOG, CATEGORY_COLORS, KIND_LABELS, REQUIRED_ROLES } from "../world/bio/species-catalog";
import { downloadText } from "../world/export-geojson";
import { xToLon, yToLat } from "../world/constants";
import {
  X,
  Leaf,
  Play,
  Zap,
  Sparkles,
  CheckCircle2,
  XCircle,
  Download,
  BookOpen,
  ClipboardList,
  Eye,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Layer 2 — Biosphere control panel. Generation config, finetune ledger,
// verifier before/after, and the imported species catalog (FAO EcoCrop).
// ---------------------------------------------------------------------------

export function BioModal({
  open,
  onClose,
  region,
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
  existing: BioLayerResult | null;
  busy: boolean;
  progress: GenProgress | null;
  onGenerate: (cfg: BioConfig) => void;
  showRaw: boolean;
  onToggleRaw: (v: boolean) => void;
}) {
  const [richness, setRichness] = useState(1);
  const [wildShare, setWildShare] = useState(1);
  const [seed, setSeed] = useState("");
  const [tab, setTab] = useState<"generate" | "results" | "catalog">("generate");

  useEffect(() => {
    if (!open) return;
    setRichness(existing?.config.richness ?? 1);
    setWildShare(existing?.config.wildShare ?? 1);
    setSeed(existing?.config.customSeed ?? "");
    setTab(existing ? "results" : "generate");
  }, [open, region?.descriptor.id, existing]);

  if (!open || !region) return null;

  const exportBioGeoJSON = () => {
    if (!existing) return;
    const fc = {
      type: "FeatureCollection",
      metadata: {
        generator: "Terra Ex Nihilo — Layer 2 Biosphere",
        layer: "bio",
        region: existing.regionName,
        seed: existing.seedUsed,
        source: "Species envelopes imported from FAO EcoCrop (github.com/OpenCLIM/ecocrop), tweaked",
      },
      features: existing.populations.map((p) => ({
        type: "Feature",
        id: p.id,
        geometry: { type: "Point", coordinates: [xToLon(p.point[0]), yToLat(p.point[1])] },
        properties: {
          species: p.speciesId,
          name: p.name,
          kind: p.kind,
          category: p.category,
          roles: p.roles,
          abundance: p.abundance,
          irrigated: !!p.irrigated,
          origin: p.origin,
        },
      })),
    };
    downloadText(
      `bio-${existing.regionName.replace(/\s+/g, "-").toLowerCase()}.geojson`,
      JSON.stringify(fc, null, 2)
    );
  };

  const r = existing?.report;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-lime-500/25 bg-lime-500/10 p-2 text-lime-400">
              <Leaf className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Layer 2 — Flora &amp; Fauna · {region.descriptor.name}</h2>
              <p className="text-xs text-zinc-400">
                Builds on the frozen geography — creative scatter, then rule-based finetune. Geography is never modified.
              </p>
            </div>
          </div>
          {!busy && (
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-950/40 px-6 py-2.5 text-xs">
          {(
            [
              ["generate", "Generate", Sparkles],
              ["results", "Finetune & Verify", ClipboardList],
              ["catalog", "Species Catalog", BookOpen],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
                tab === id ? "border border-lime-500/40 bg-lime-500/20 text-lime-300" : "text-zinc-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-xs">
          {tab === "generate" && (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 leading-relaxed text-zinc-400">
                <strong className="text-lime-400">Same doctrine as every layer.</strong> Generation scatters
                species populations with no rules at all — rice on glaciers, tuna in deserts. The Finetune then
                drops, relocates or adds populations against the frozen geography: EcoCrop climate envelopes,
                habitat domains, river/lake water reach, forage for herds, density caps, and a food-security
                guarantee so Layer 3 (settlements) always finds staple, protein, vegetables, timber and forage
                where the climate allows them.
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-zinc-300">Population richness</span>
                    <span className="font-mono text-lime-400">{richness.toFixed(1)}×</span>
                  </div>
                  <input type="range" min={0.5} max={2} step={0.1} value={richness} disabled={busy}
                    onChange={(e) => setRichness(Number(e.target.value))} className="w-full cursor-pointer accent-lime-400" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-zinc-300">Wild fauna share</span>
                    <span className="font-mono text-lime-400">{wildShare.toFixed(1)}×</span>
                  </div>
                  <input type="range" min={0.5} max={1.5} step={0.1} value={wildShare} disabled={busy}
                    onChange={(e) => setWildShare(Number(e.target.value))} className="w-full cursor-pointer accent-lime-400" />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Biosphere Seed (rerollable)</span>
                  <button disabled={busy} onClick={() => setSeed(Math.random().toString(36).slice(2, 8))}
                    className="flex items-center gap-1 text-xs text-lime-400 transition hover:text-lime-300">
                    <Sparkles className="h-3.5 w-3.5" /> Randomize
                  </button>
                </div>
                <input value={seed} disabled={busy} onChange={(e) => setSeed(e.target.value)}
                  placeholder="default (deterministic per region)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 font-mono text-sm text-white outline-none transition focus:border-lime-400" />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Rerolling the biosphere regenerates only this layer — the geography beneath is untouched.
                </p>
              </div>
              {busy && progress && (
                <div className="space-y-2 rounded-xl border border-lime-500/30 bg-lime-950/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-lime-300">
                      <Zap className="h-3.5 w-3.5 animate-pulse" /> Stage {progress.stage}/{progress.totalStages} · {progress.stageName}
                    </span>
                    <span className="font-mono font-bold text-lime-400">{progress.percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full bg-gradient-to-r from-lime-500 to-emerald-400 transition-all duration-150" style={{ width: `${progress.percent}%` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "results" && !existing && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-zinc-400">
              No biosphere generated yet for this region. Run it from the Generate tab.
            </div>
          )}
          {tab === "results" && existing && r && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Metric label="Creative raw" value={r.rawCount} />
                <Metric label="Kept in place" value={r.keptAsIs} tone="text-emerald-300" />
                <Metric label="Relocated" value={r.relocated} tone="text-sky-300" />
                <Metric label="Dropped" value={r.dropped} tone="text-rose-300" />
                <Metric label="Added (food security)" value={r.added} tone="text-amber-300" />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Drops by rule</span>
                <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                  {Object.entries(r.droppedByRule).map(([k, v]) => (
                    <span key={k} className="rounded border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{k} ×{v}</span>
                  ))}
                  {Object.keys(r.droppedByRule).length === 0 && <span className="text-zinc-500">none</span>}
                </div>
                {r.addedForRoles.length > 0 && (
                  <>
                    <span className="mt-2 block text-[10px] uppercase tracking-wider text-zinc-500">Food-security additions</span>
                    <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                      {r.addedForRoles.map((a) => (
                        <span key={a} className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{a}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[existing.verifyBefore, existing.verifyAfter].map((v, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${i === 1 && v.passedAll ? "border-emerald-500/30 bg-emerald-950/20" : "border-white/10 bg-white/[0.02]"}`}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-semibold text-white">{i === 0 ? "Before finetune (raw)" : "After finetune"}</span>
                      <span className={`font-mono text-[11px] ${v.passedAll ? "text-emerald-300" : "text-rose-300"}`}>
                        {v.passedChecks}/{v.totalChecks} · {v.totalViolations}v
                      </span>
                    </div>
                    <div className="space-y-1">
                      {v.checks.map((c) => (
                        <div key={c.id} className="flex items-start gap-1.5 text-[11px]">
                          {c.passed ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />}
                          <span className="text-zinc-300">{c.title}
                            {!c.passed && <span className="text-zinc-500"> — {c.violationCount}v</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Human-dependency coverage</span>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                  {REQUIRED_ROLES.map((req) => {
                    const ok = existing.populations.some((p) => p.roles.includes(req.role as never));
                    return (
                      <span key={req.role} className={`rounded border px-1.5 py-0.5 ${ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-600 bg-white/5 text-zinc-500"}`}>
                        {ok ? "✓" : "—"} {req.label}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-zinc-500">
                  {existing.stats.populations} populations · {existing.stats.species} species · {existing.stats.irrigatedFarms} irrigated farms · staples: {existing.stats.staples.join(", ") || "none (climate-excluded)"}
                </p>
              </div>
            </>
          )}

          {tab === "catalog" && (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-400">
                <strong className="text-lime-400">Imported dataset.</strong> Plant climate envelopes come from the{" "}
                <span className="font-mono text-zinc-300">FAO EcoCrop database</span> (EcoCrop_DB.csv,
                github.com/OpenCLIM/ecocrop — TMIN/TMAX, RMIN/RMAX, ALTMX per species), trimmed from 2,568 species
                to the {SPECIES_CATALOG.length} that human settlement depends on and simplified to annual-mean
                envelopes. Animal ranges follow FAO/FAOSTAT husbandry &amp; fisheries data.
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead className="bg-white/5 uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="px-2 py-1.5">Species</th>
                      <th className="px-2 py-1.5">Kind</th>
                      <th className="px-2 py-1.5">T °C</th>
                      <th className="px-2 py-1.5">Rain mm</th>
                      <th className="px-2 py-1.5">Roles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {SPECIES_CATALOG.map((s) => (
                      <tr key={s.id} className="text-zinc-300">
                        <td className="px-2 py-1">
                          <span className="mr-1">{s.glyph}</span>
                          <span style={{ color: CATEGORY_COLORS[s.category] }}>{s.name}</span>
                        </td>
                        <td className="px-2 py-1 text-zinc-500">{KIND_LABELS[s.kind]}</td>
                        <td className="px-2 py-1">{s.tMin}…{s.tMax}</td>
                        <td className="px-2 py-1">{s.rMax >= 9000 ? `${s.rMin}+` : `${s.rMin}…${s.rMax}`}</td>
                        <td className="px-2 py-1 text-zinc-500">{s.roles.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-2">
            {existing && (
              <>
                <button
                  onClick={() => onToggleRaw(!showRaw)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    showRaw ? "border-rose-500/40 bg-rose-500/20 text-rose-300" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {showRaw ? `Showing RAW scatter (${existing.rawPopulations.length})` : "Compare raw scatter on map"}
                </button>
                <button onClick={exportBioGeoJSON}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10">
                  <Download className="h-3.5 w-3.5" /> Bio GeoJSON
                </button>
              </>
            )}
          </div>
          <button
            disabled={busy}
            onClick={() => onGenerate({ richness, wildShare, customSeed: seed.trim() || undefined })}
            className="flex items-center gap-2 rounded-lg bg-lime-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-lime-500/20 transition hover:bg-lime-400 disabled:opacity-50"
          >
            {busy ? <Zap className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            {busy ? "Growing…" : existing ? "Regenerate Biosphere" : "Generate Biosphere"}
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
