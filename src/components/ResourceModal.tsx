import { useState, useEffect } from "react";
import type { GeneratedRegion } from "../world/types";
import type {
  ResourceCategory,
  ResourceFilterConfig,
  ResourceLayerResult,
  ResourcePresetId,
} from "../world/resources/resource-types";
import {
  MASTER_RESOURCE_CATALOG,
  RESOURCE_CATEGORY_LABELS,
} from "../world/resources/resource-catalog";
import {
  DEFAULT_RESOURCE_CONFIG,
  RESOURCE_PRESETS,
  applyPreset,
  toggleResource,
  isResourceActive,
} from "../world/resources/resource-filter";
import { generateResourceLayer } from "../world/resources";
import {
  X,
  Sparkles,
  Flame,
  CheckCircle2,
  SlidersHorizontal,
  RotateCcw,
  Pickaxe,
  Search,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  region: GeneratedRegion | null;
  existing: ResourceLayerResult | null;
  onResourceGenerated?: (result: ResourceLayerResult) => void;
  onApplyConfig?: (config: ResourceFilterConfig) => Promise<void> | void;
}

export function ResourceModal({
  open,
  onClose,
  region,
  existing,
  onResourceGenerated,
  onApplyConfig,
}: Props) {
  const [config, setConfig] = useState<ResourceFilterConfig>(
    existing?.config ?? DEFAULT_RESOURCE_CONFIG
  );
  const [activeCategory, setActiveCategory] = useState<ResourceCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing?.config) {
      setConfig(existing.config);
    }
  }, [existing]);

  if (!open || !region) return null;

  const handlePresetChange = (presetId: ResourcePresetId) => {
    setConfig((prev) => applyPreset(presetId, prev));
  };

  const handleToggleResource = (resId: string, currentlyActive: boolean) => {
    setConfig((prev) => toggleResource(prev, resId, !currentlyActive));
  };

  const handleGenerate = async () => {
    setBusy(true);
    try {
      if (onApplyConfig) {
        await onApplyConfig(config);
      } else {
        const result = await generateResourceLayer(region, config);
        onResourceGenerated?.(result);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Filter catalog by category and search
  const filteredCatalog = MASTER_RESOURCE_CATALOG.filter((res) => {
    if (activeCategory !== "all" && res.category !== activeCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        res.name.toLowerCase().includes(q) ||
        res.mineralOrCommonName.toLowerCase().includes(q) ||
        res.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = MASTER_RESOURCE_CATALOG.filter((r) => isResourceActive(r, config)).length;
  const excludedCount = MASTER_RESOURCE_CATALOG.length - activeCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-amber-500/30 bg-slate-950 p-6 text-zinc-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40">
              <Pickaxe className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">
                World Material & Geological Wealth Registry
              </h2>
              <p className="text-xs text-zinc-400">
                Natural Earths, Ores, Building Stones + Fantasy Add-ons · {region.descriptor.name}
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
          {/* Preset Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                World Era & Mineral Preset
              </label>
              <span className="font-mono text-[10px] text-zinc-400">
                {activeCount} active · {excludedCount} excluded
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(RESOURCE_PRESETS) as ResourcePresetId[])
                .filter((p) => p !== "custom")
                .map((pKey) => {
                  const p = RESOURCE_PRESETS[pKey];
                  const isSelected = config.preset === pKey;
                  return (
                    <button
                      key={pKey}
                      type="button"
                      onClick={() => handlePresetChange(pKey)}
                      className={`flex flex-col rounded-xl border p-2.5 text-left transition ${
                        isSelected
                          ? "border-amber-400/80 bg-amber-950/30 text-amber-200 ring-1 ring-amber-400/50"
                          : "border-white/10 bg-black/40 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                      }`}
                    >
                      <span className="font-semibold text-white">{p.label}</span>
                      <span className="mt-1 line-clamp-2 text-[10px] text-zinc-400">
                        {p.description}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Quick World Feature Toggles */}
          <div className="rounded-xl border border-white/10 bg-black/30 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-300 text-[11px] uppercase tracking-wider">
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400" />
              <span>World Era & Magic Switches</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* Fantasy Minerals Toggle */}
              <label className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/40 p-2.5 cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={config.includeFantasy}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      preset: "custom",
                      includeFantasy: e.target.checked,
                    }))
                  }
                  className="rounded border-white/20 bg-black text-amber-500 focus:ring-0"
                />
                <div>
                  <div className="font-semibold text-white flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-purple-400" /> Fantasy Minerals
                  </div>
                  <div className="text-[10px] text-zinc-400">Mithril, Adamantine, Ley-crystals</div>
                </div>
              </label>

              {/* Fossil Fuels Master Toggle */}
              <label className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/40 p-2.5 cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={config.includeCoal}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      preset: "custom",
                      includeCoal: e.target.checked,
                      includeFossilFuels: e.target.checked || prev.includePetroleum || prev.includeNaturalGas,
                    }))
                  }
                  className="rounded border-white/20 bg-black text-amber-500 focus:ring-0"
                />
                <div>
                  <div className="font-semibold text-white flex items-center gap-1">
                    <Flame className="h-3 w-3 text-amber-500" /> Coal Seams
                  </div>
                  <div className="text-[10px] text-zinc-400">Black & Brown Coal (Bituminous/Lignite)</div>
                </div>
              </label>

              {/* Petroleum / Gas Toggle */}
              <label className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/40 p-2.5 cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={config.includePetroleum || config.includeNaturalGas}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      preset: "custom",
                      includePetroleum: e.target.checked,
                      includeNaturalGas: e.target.checked,
                      includeFossilFuels: prev.includeCoal || e.target.checked,
                    }))
                  }
                  className="rounded border-white/20 bg-black text-amber-500 focus:ring-0"
                />
                <div>
                  <div className="font-semibold text-white flex items-center gap-1">
                    <Flame className="h-3 w-3 text-sky-400" /> Petroleum & Gas
                  </div>
                  <div className="text-[10px] text-zinc-400">Crude oil seeps & eternal flames</div>
                </div>
              </label>
            </div>
          </div>

          {/* Granular Catalog Filter Strip */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveCategory("all")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    activeCategory === "all"
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                      : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  All ({MASTER_RESOURCE_CATALOG.length})
                </button>
                {(Object.keys(RESOURCE_CATEGORY_LABELS) as ResourceCategory[]).map((cat) => {
                  const meta = RESOURCE_CATEGORY_LABELS[cat];
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeCategory === cat
                          ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                          : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span>{meta.glyph}</span>
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Search box */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search metals, clays, stones..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 rounded-lg border border-white/10 bg-black/40 pl-8 pr-3 py-1 font-mono text-[11px] text-white placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Catalog Grid */}
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-2">
              {filteredCatalog.map((res) => {
                const active = isResourceActive(res, config);
                return (
                  <div
                    key={res.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 transition ${
                      active ? "bg-white/5 hover:bg-white/10" : "bg-black/20 opacity-50 hover:opacity-80"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => handleToggleResource(res.id, active)}
                        className="rounded border-white/20 bg-black text-amber-500 focus:ring-0"
                      />
                      <span className="text-base">{res.glyph}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{res.name}</span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            ({res.mineralOrCommonName})
                          </span>
                          {res.isFantasy && (
                            <span className="rounded bg-purple-500/20 px-1 py-0.2 font-mono text-[9px] text-purple-300">
                              Fantasy
                            </span>
                          )}
                          {res.isFossilFuel && (
                            <span className="rounded bg-amber-500/20 px-1 py-0.2 font-mono text-[9px] text-amber-300">
                              Fossil Fuel
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-1 text-[10px] text-zinc-400">
                          {res.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="capitalize text-zinc-400">{res.rarity}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          active
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : "bg-red-500/10 text-red-400 border border-red-500/30"
                        }`}
                      >
                        {active ? "Active" : "Omitted"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            {existing ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> {existing.stats.totalDeposits} geological deposits active in region
              </span>
            ) : (
              <span>Ready to survey natural minerals & fantasy ores</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" /> Surveying Geology...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Survey & Deploy Resources
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
