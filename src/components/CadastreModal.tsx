import { useState } from "react";
import type { GeneratedRegion, GenProgress } from "../world/types";
import type { HumanLayerResult, Settlement } from "../world/human/human-types";
import type { PopulationLayerResult } from "../world/population/population-types";
import type { CadastreConfig, CadastreLayerResult, SettlementMorphology } from "../world/cadastre/cadastre-types";
import { generateCadastreLayer, peekCachedCadastre, hasCachedCadastre } from "../world/cadastre/cadastre-cache";
import { X, Sparkles, Building2, ShieldCheck, Compass, Loader2 } from "lucide-react";
import { TIER_LABELS } from "../world/human/settlement-catalog";

interface Props {
  open: boolean;
  onClose: () => void;
  region: GeneratedRegion | null;
  human: HumanLayerResult | null;
  population: PopulationLayerResult | null;
  cadastreLayer: CadastreLayerResult | null;
  onCadastreGenerated: (result: CadastreLayerResult) => void;
  onFocusSettlement?: (s: Settlement) => void;
}

export function CadastreModal({
  open,
  onClose,
  region,
  human,
  population,
  cadastreLayer,
  onCadastreGenerated,
  onFocusSettlement,
}: Props) {
  const [density, setDensity] = useState(1.0);
  const [pitchMult, setPitchMult] = useState(1.0);
  const [customSeed, setCustomSeed] = useState("");
  const [morphologyOverride, setMorphologyOverride] = useState<SettlementMorphology | "auto">("auto");
  const [wallsEnabled, setWallsEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenProgress | null>(null);

  if (!open || !region || !human) return null;

  const handleGenerateAll = async () => {
    setBusy(true);
    setProgress({ stage: 1, totalStages: 1, stageName: "Surveying Region Cadastre", percent: 5, featuresCount: 0, elapsedMs: 0 });
    try {
      const cfg: CadastreConfig = {
        buildingDensity: density,
        roofPitchMultiplier: pitchMult,
        customSeed: customSeed.trim() || undefined,
        forceMorphology: morphologyOverride === "auto" ? undefined : morphologyOverride,
        enableDefensiveWalls: wallsEnabled,
      };
      const result = await generateCadastreLayer(
        region,
        human.settlements,
        population?.model,
        cfg,
        setProgress
      );
      onCadastreGenerated(result);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const totalSettlements = human.settlements.length;
  const existingCadastresCount = cadastreLayer
    ? cadastreLayer.cadastres.size
    : human.settlements.filter((s) => peekCachedCadastre(region.descriptor.id, s.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-purple-500/30 bg-slate-950 p-6 text-zinc-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">
                Layer 5 — Cadastre & Roofs Generator
              </h2>
              <p className="text-xs text-zinc-400">
                Google Earth for Fantasy World Lite · {region.descriptor.name}
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

        {/* Content */}
        <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1 text-xs">
          {/* Status banner */}
          <div className="rounded-xl border border-purple-500/25 bg-purple-950/20 p-3.5">
            <div className="flex items-center justify-between font-semibold text-purple-200">
              <span>Cadastral Status</span>
              <span className="font-mono text-[11px]">
                {existingCadastresCount} / {totalSettlements} settlements surveyed
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
              This layer runs an on-demand JIT generator that simulates street networks, property parcels,
              and directional sun-shaded pitched roofs (gable, hip, thatch, slate, terracotta) down to individual cottages.
            </p>
          </div>

          {/* Generator Controls */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-zinc-200">Building Density</label>
                <span className="font-mono text-purple-300">{density.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={density}
                onChange={(e) => setDensity(parseFloat(e.target.value))}
                className="w-full accent-purple-400"
              />
              <p className="text-[10px] text-zinc-400">
                Lower for sparse agrarian hamlets; higher for fortified dense city quarters.
              </p>
            </div>

            <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-zinc-200">Roof Pitch Multiplier</label>
                <span className="font-mono text-purple-300">{pitchMult.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.4"
                step="0.1"
                value={pitchMult}
                onChange={(e) => setPitchMult(parseFloat(e.target.value))}
                className="w-full accent-purple-400"
              />
              <p className="text-[10px] text-zinc-400">
                Steeper pitches shed snow in northern biomes; flatter roofs suit arid climates.
              </p>
            </div>
          </div>

          {/* Universal Morphology Archetype & Defense Enceinte */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <label className="font-semibold text-zinc-200">Morphology Archetype</label>
              <select
                value={morphologyOverride}
                onChange={(e) => setMorphologyOverride(e.target.value as SettlementMorphology | "auto")}
                className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-purple-400 focus:outline-none"
              >
                <option value="auto">Auto (Context-Driven Archetype)</option>
                <option value="walled_concentric">Walled Concentric (Watabou Enceinte)</option>
                <option value="linear_ribbon">Linear Ribbon (Roadside Strip Crofts)</option>
                <option value="waterfront_port">Waterfront Port (Quays & Jetties)</option>
                <option value="crossroads_market">Crossroads Market (Village Green)</option>
              </select>
              <p className="text-[10px] text-zinc-400">
                Auto detects waterways for quays, stone curtain walls for cities, and ribbon crofts for hamlets.
              </p>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div>
                <label className="font-semibold text-zinc-200">Defensive Enceinte</label>
                <p className="mt-1 text-[10px] text-zinc-400">
                  Encloses towns and cities within stone curtain walls, bastion towers, and fortified gatehouses.
                </p>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={wallsEnabled}
                  onChange={(e) => setWallsEnabled(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-purple-500 focus:ring-purple-400"
                />
                <span className="text-xs text-zinc-200">Enable City Curtain Walls</span>
              </label>
            </div>
          </div>

          {/* Custom Seed Override */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-300">
              Architectural Custom Seed (Optional)
            </label>
            <input
              type="text"
              placeholder={`Default: ${region.seed}::cadastre`}
              value={customSeed}
              onChange={(e) => setCustomSeed(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white placeholder-zinc-600 focus:border-purple-400 focus:outline-none"
            />
          </div>

          {/* Settlements Quick-List */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Settlements Ready for Roof-Level Exploration
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2">
              {human.settlements.slice(0, 15).map((s) => {
                const isCached = hasCachedCadastre(region.descriptor.id, s.id);
                const cachedPlan = peekCachedCadastre(region.descriptor.id, s.id);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 transition hover:bg-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <span>{s.glyph}</span>
                      <span className="font-semibold text-white">{s.name}</span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {TIER_LABELS[s.tier]}
                      </span>
                      {cachedPlan && (
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-[9px] text-purple-300">
                          {cachedPlan.morphology.replace("_", " ")}
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                          isCached
                            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "bg-white/5 text-zinc-500"
                        }`}
                      >
                        {isCached ? `${cachedPlan?.buildings.length || 0} blds` : "on-demand"}
                      </span>
                    </div>
                    {onFocusSettlement && (
                      <button
                        onClick={() => {
                          onFocusSettlement(s);
                          onClose();
                        }}
                        className="flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] text-purple-300 transition hover:bg-purple-500/25"
                      >
                        <Compass className="h-3 w-3" /> Zoom to Roofs
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress Indicator */}
          {progress && (
            <div className="space-y-1 rounded-xl border border-purple-500/30 bg-purple-950/30 p-3">
              <div className="flex items-center justify-between text-[11px] font-medium text-purple-200">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress.stageName}
                </span>
                <span className="font-mono">{progress.percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full bg-purple-400 transition-all duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <div className="text-[11px] text-zinc-400">
            {cadastreLayer ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="h-4 w-4" /> {cadastreLayer.stats.totalBuildings.toLocaleString()} buildings surveyed & verified
              </span>
            ) : (
              <span>Ready to survey all settlement cadastre plans</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              Close
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-purple-400 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Surveying...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Survey All Cadastres (L5)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
