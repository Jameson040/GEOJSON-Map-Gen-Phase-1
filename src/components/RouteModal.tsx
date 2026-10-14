import { useState, useEffect } from "react";
import type { GeneratedRegion, GenProgress } from "../world/types";
import type { Settlement } from "../world/human/human-types";
import type { ResourceLayerResult } from "../world/resources";
import type { RouteConfig, RouteLayerResult } from "../world/routes";
import { DEFAULT_ROUTE_CONFIG, generateRouteLayer } from "../world/routes";
import {
  X,
  Navigation,
  CheckCircle2,
  SlidersHorizontal,
  RotateCcw,
  Anchor,
  Sparkles,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  region: GeneratedRegion | null;
  settlements: Settlement[];
  resources?: ResourceLayerResult | null;
  existing: RouteLayerResult | null;
  busy?: boolean;
  progress?: GenProgress | null;
  onGenerate?: (cfg: RouteConfig) => Promise<void> | void;
  onRouteGenerated?: (result: RouteLayerResult) => void;
}

export function RouteModal({
  open,
  onClose,
  region,
  settlements,
  resources,
  existing,
  busy: externalBusy,
  progress: externalProgress,
  onGenerate,
  onRouteGenerated,
}: Props) {
  const [config, setConfig] = useState<RouteConfig>(
    existing?.config ?? DEFAULT_ROUTE_CONFIG
  );
  const [internalBusy, setInternalBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  const busy = externalBusy || internalBusy;

  useEffect(() => {
    if (existing?.config) {
      setConfig(existing.config);
    }
  }, [existing]);

  if (!open || !region) return null;

  const handleGenerate = async () => {
    if (onGenerate) {
      await onGenerate(config);
      onClose();
      return;
    }
    setInternalBusy(true);
    setProgressMsg("Tracing terrain valleys & mountain passes...");
    try {
      const result = await generateRouteLayer(
        region,
        settlements,
        config,
        (p) => setProgressMsg(`${p.stageName} (${p.percent}%)`),
        resources
      );
      onRouteGenerated?.(result);
      onClose();
    } catch (err) {
      console.error("Failed to generate routes:", err);
    } finally {
      setInternalBusy(false);
      setProgressMsg(null);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_ROUTE_CONFIG);
  };

  const stats = existing?.stats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-neutral-900 border border-neutral-700/80 shadow-2xl overflow-hidden text-neutral-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">
                Road & Trade Route Network (L6)
              </h2>
              <p className="text-xs text-neutral-400">
                Terrain-aware royal highways, market roads, and coastal shipping lanes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stats if available */}
          {stats && (
            <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs text-amber-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Network Active in {region.descriptor.name}
                </span>
                <span>{stats.connectivityRatio * 100}% of settlements linked</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800">
                  <div className="text-lg font-bold text-amber-300">
                    {stats.totalKm.toLocaleString()} km
                  </div>
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">Total Track</div>
                </div>
                <div className="p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800">
                  <div className="text-lg font-bold text-amber-300">
                    {stats.highwaysCount}
                  </div>
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">Royal Highways</div>
                </div>
                <div className="p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800">
                  <div className="text-lg font-bold text-amber-300">
                    {stats.arterialsCount + stats.bywaysCount}
                  </div>
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">Market Roads</div>
                </div>
                <div className="p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800">
                  <div className="text-lg font-bold text-amber-300">
                    {stats.bridgesCount}
                  </div>
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">River Bridges</div>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Controls */}
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-amber-400" />
              Network Synthesis Parameters
            </h3>

            {/* Density Slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-300">Route Web Density</span>
                <span className="text-amber-400 font-mono">{config.density.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.density}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, density: parseFloat(e.target.value) }))
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
              <p className="text-[11px] text-neutral-500">
                Controls how many tributary feeder roads branch out to smaller villages and camps.
              </p>
            </div>

            {/* Paved Highway Share */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-300">Paved Stone Highways</span>
                <span className="text-amber-400 font-mono">
                  {Math.round(config.pavedHighwayShare * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                value={config.pavedHighwayShare}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    pavedHighwayShare: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
              <p className="text-[11px] text-neutral-500">
                Proportion of major arterial corridors paved with imperial stone rather than packed dirt.
              </p>
            </div>

            {/* Coastal Shipping */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-950/50 border border-neutral-800">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-neutral-200 flex items-center gap-1.5">
                  <Anchor className="w-3.5 h-3.5 text-cyan-400" />
                  Coastal Maritime Shipping Channels
                </div>
                <div className="text-[11px] text-neutral-400">
                  Connect coastal ports across navigable waterways with oceanic shipping reaches.
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.coastalShipping}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, coastalShipping: e.target.checked }))
                }
                className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
              />
            </div>

            {/* Custom Seed */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Network Seed (Optional)
              </label>
              <input
                type="text"
                placeholder="Leave blank for regional deterministic seed"
                value={config.customSeed ?? ""}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    customSeed: e.target.value.trim() || undefined,
                  }))
                }
                className="w-full px-3 py-2 text-xs rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-200 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-800 bg-neutral-950/60">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <div className="flex items-center gap-3">
            {(externalProgress?.stageName || progressMsg) && (
              <span className="text-xs text-amber-400 font-mono animate-pulse">
                {externalProgress ? `${externalProgress.stageName} (${externalProgress.percent}%)` : progressMsg}
              </span>
            )}
            <button
              onClick={handleGenerate}
              disabled={busy || settlements.length < 2}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-neutral-950 text-xs font-semibold hover:bg-amber-400 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-lg shadow-amber-500/20"
            >
              <Sparkles className="w-4 h-4" />
              {busy ? "Engineering Network..." : existing ? "Re-Route Network" : "Construct Trade Network"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
