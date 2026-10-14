import { useState, useMemo } from "react";
import type {
  GeneratedRegion,
  MapFeature,
  MapThemeId,
  PlanetMacro,
  RegionDescriptor,
} from "../world/types";
import type { RenderLayers } from "../world/canvas-renderer";
import { MAP_THEMES, FEATURE_LABELS } from "../world/themes";
import type { LandSizeClass } from "../world/types";
import { SIZE_CLASS_ORDER, SIZE_PROFILES, formatArea, formatKm } from "../world/size-classes";
import { SizeClassBadge } from "./SizeClassModal";
import type { PopulationLayerResult } from "../world/population/population-types";
import { ERA_META } from "../world/population/population-types";
import { WORLD_LAYERS, LAYER_BY_ID, layerStatuses, worldTotals, buildMasterLedger, type WorldLayerId, type RegionLayerState } from "../world/layers";
import type { BioLayerResult } from "../world/bio/bio-types";
import type { HumanLayerResult } from "../world/human/human-types";
import type { CadastreLayerResult } from "../world/cadastre/cadastre-types";
import type { ResourceLayerResult } from "../world/resources";
import type { RouteLayerResult } from "../world/routes";
import { TIER_ORDER, TIER_LABELS, TIER_COLORS } from "../world/human/settlement-catalog";
import {
  Search,
  ChevronRight,
  Globe2,
  Layers,
  Check,
  Mountain,
  Waves,
  Flame,
  TreePine,
  Grid3x3,
  Tag,
  Palette,
  Database,
  Trash2,
  Sparkles,
  CircleDot,
  Activity,
  Gauge,
  HardDrive,
  Copy,
  Navigation,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Region Browser — the cascade hub. Every landmass Tier 1 produced is listed
// here with its lon/lat, area and detail status.
// ---------------------------------------------------------------------------

interface RegionBrowserProps {
  regions: RegionDescriptor[];
  detail: Map<string, GeneratedRegion>;
  resources?: Map<string, ResourceLayerResult>;
  bios?: Map<string, BioLayerResult>;
  humans?: Map<string, HumanLayerResult>;
  pops?: Map<string, PopulationLayerResult>;
  routes?: Map<string, RouteLayerResult>;
  cadastres?: Map<string, CadastreLayerResult>;
  activeRegionId: string | null;
  onOpen: (r: RegionDescriptor) => void;
  onRerollRegion?: (r: RegionDescriptor) => void;
  onConfigureRegion?: (r: RegionDescriptor) => void;
  onLocate: (r: RegionDescriptor) => void;
  onUnload: (id: string) => void;
  /** Open / generate a higher layer for a region (bio, human…). */
  onLayer?: (r: RegionDescriptor, layer: WorldLayerId) => void;
}

/** Compact L1 · L2 · L3 strip shown on every region card. */
function LayerStrip({
  geo,
  resource,
  bio,
  human,
  population,
  routes,
  cadastre,
  onLayer,
}: {
  geo: GeneratedRegion | null;
  resource?: ResourceLayerResult | null;
  bio: BioLayerResult | null;
  human: HumanLayerResult | null;
  population: PopulationLayerResult | null;
  routes?: RouteLayerResult | null;
  cadastre?: CadastreLayerResult | null;
  onLayer?: (layer: WorldLayerId) => void;
}) {
  const statuses = layerStatuses({ geo, resource, bio, human, population, routes, cadastre });
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {statuses.map((s) => {
        const def = LAYER_BY_ID[s.id];
        const pass = s.verify?.passedAll;
        const cls = s.present
          ? "border-transparent text-slate-950 font-bold"
          : s.available
          ? "border-dashed text-zinc-300 hover:bg-white/10"
          : "border-white/10 text-zinc-600";
        return (
          <button
            key={s.id}
            disabled={!s.present && !s.available}
            onClick={(e) => {
              e.stopPropagation();
              onLayer?.(s.id);
            }}
            title={
              s.present
                ? `${def.label}: ${s.count.toLocaleString()} · verifier ${s.verify?.passedChecks}/${s.verify?.totalChecks}${pass ? " ✓" : ""}${s.stale ? ` · STALE (newer ${s.staleInputs.join(", ")})` : ""}`
                : s.available
                ? `Generate ${def.label} (L${def.index}) for this region`
                : `${def.label} needs L${def.index - 1} first`
            }
            className={`flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${cls}`}
            style={{
              background: s.present ? def.color : undefined,
              borderColor: s.present ? def.color : s.available ? `${def.color}80` : undefined,
            }}
          >
            {def.glyph} L{def.index}
            {s.present && typeof s.count === "number" && <span className="ml-0.5 opacity-80">{s.count >= 1000 ? `${(s.count / 1000).toFixed(1)}k` : s.count}</span>}
            {s.present && s.stale && <span className="ml-0.5 opacity-90">↻</span>}
            {s.present && pass === false && <span className="text-rose-900">!</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RegionBrowser({
  regions,
  detail,
  resources,
  bios,
  humans,
  pops,
  routes,
  cadastres,
  activeRegionId,
  onOpen,
  onRerollRegion,
  onConfigureRegion,
  onLocate,
  onUnload,
  onLayer,
}: RegionBrowserProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "continent" | "island" | "loaded">("all");
  const [classFilter, setClassFilter] = useState<LandSizeClass | "any">("any");

  const list = useMemo(() => {
    return regions.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (classFilter !== "any" && r.sizeClass !== classFilter) return false;
      if (filter === "continent") return r.kind === "continent";
      if (filter === "island") return r.kind === "island";
      if (filter === "loaded") return detail.has(r.id);
      return true;
    });
  }, [regions, q, filter, detail, classFilter]);

  const loadedCount = detail.size;
  const loadedFeatures = [...detail.values()].reduce((s, r) => s + r.features.length, 0);
  const loadedKb = [...detail.values()].reduce((s, r) => s + r.stats.approxMemoryKb, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900 text-xs shadow-xl">
      <div className="shrink-0 border-b border-white/10 bg-slate-950/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
            <Globe2 className="h-3.5 w-3.5 text-teal-400" /> Region Cascade
          </span>
          <span className="font-mono text-[10px] text-zinc-500">{list.length} regions</span>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search landmass…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 outline-none transition focus:border-teal-400"
          />
        </div>

        <div className="mt-2 flex items-center gap-1">
          {(
            [
              ["all", "All"],
              ["continent", "Continents"],
              ["island", "Islands"],
              ["loaded", `Loaded ${loadedCount ? `(${loadedCount})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                filter === id
                  ? "bg-teal-500 font-bold text-slate-950"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            onClick={() => setClassFilter("any")}
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold transition ${
              classFilter === "any" ? "bg-white/20 text-white" : "bg-white/5 text-zinc-500 hover:text-white"
            }`}
          >
            Any size
          </button>
          {SIZE_CLASS_ORDER.map((id) => {
            const p = SIZE_PROFILES[id];
            const n = regions.filter((r) => r.sizeClass === id).length;
            if (!n) return null;
            const on = classFilter === id;
            return (
              <button
                key={id}
                onClick={() => setClassFilter(on ? "any" : id)}
                className="rounded border px-1.5 py-0.5 text-[9px] font-semibold transition"
                style={{
                  borderColor: on ? p.color : `${p.color}33`,
                  background: on ? `${p.color}33` : "transparent",
                  color: p.color,
                }}
              >
                {p.short} {n}
              </button>
            );
          })}
        </div>

        {loadedCount > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" /> {loadedFeatures.toLocaleString()} detail features resident
            </span>
            <span className="font-mono">{(loadedKb / 1024).toFixed(1)} MB</span>
          </div>
        )}
      </div>

      <div className="flex-1 divide-y divide-white/[0.04] overflow-y-auto">
        {list.map((r) => {
          const loaded = detail.get(r.id);
          const active = activeRegionId === r.id;
          return (
            <div
              key={r.id}
              className={`group p-2.5 transition ${active ? "bg-teal-500/10" : "hover:bg-white/[0.05]"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onLocate(r)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        loaded ? "bg-emerald-400" : "bg-zinc-600"
                      }`}
                    />
                    <span className="truncate text-[12px] font-semibold text-zinc-100 group-hover:text-teal-300">
                      {r.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-zinc-500">
                    <span className="capitalize text-zinc-400">{r.kind}</span>
                    <span>
                      {Math.abs(r.lat).toFixed(1)}°{r.lat >= 0 ? "N" : "S"} {Math.abs(r.lon).toFixed(1)}°
                      {r.lon >= 0 ? "E" : "W"}
                    </span>
                    <span>{formatArea(r.areaKm2)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <SizeClassBadge cls={r.sizeClass} compact />
                    <Chip>{r.climateZone}</Chip>
                    <Chip>{r.plateName}</Chip>
                    {r.convergentEdges.length > 0 && (
                      <Chip tone="amber">{r.convergentEdges.length} convergent</Chip>
                    )}
                    {r.hotspot && <Chip tone="rose">hotspot</Chip>}
                  </div>
                </button>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => onOpen(r)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition ${
                      loaded
                        ? "bg-white/10 text-teal-300 hover:bg-white/15"
                        : "bg-teal-500 text-slate-950 hover:bg-teal-400"
                    }`}
                  >
                    {loaded ? "Open" : "Generate"}
                    <ChevronRight className="h-3 w-3" />
                  </button>
                  {loaded && (
                    <div className="flex items-center gap-2">
                      {onRerollRegion && (
                        <button
                          onClick={() => onRerollRegion(r)}
                          title="Regenerate this region only with a new random seed"
                          className="flex items-center gap-0.5 text-[9px] text-amber-400 transition hover:text-amber-300"
                        >
                          <Sparkles className="h-2.5 w-2.5" /> re-roll
                        </button>
                      )}
                      {onConfigureRegion && (
                        <button
                          onClick={() => onConfigureRegion(r)}
                          title="Change seed or parameters for this region"
                          className="text-[9px] text-teal-400 transition hover:text-teal-300"
                        >
                          seed
                        </button>
                      )}
                      <button
                        onClick={() => onUnload(r.id)}
                        title="Free this region's memory"
                        className="flex items-center gap-1 text-[9px] text-zinc-500 transition hover:text-rose-400"
                      >
                        <Trash2 className="h-2.5 w-2.5" /> unload
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {loaded && (
                <div className="mt-1.5 grid grid-cols-5 gap-1 rounded-md border border-white/5 bg-black/25 px-2 py-1 font-mono text-[9px] text-zinc-400">
                  <span title="Detail features">{loaded.features.length.toLocaleString()} f</span>
                  <span title="Summits">{loaded.stats.peaks.toLocaleString()} pk</span>
                  <span title="River segments">{loaded.stats.riverSegments.toLocaleString()} riv</span>
                  <span title="Generation time">{loaded.stats.generationTimeMs}ms</span>
                  <span
                    title="Geomorphic Verifier Status"
                    className={
                      loaded.verificationAfter.passedAll ? "text-emerald-400 font-bold" : "text-amber-400"
                    }
                  >
                    ✓ {loaded.verificationAfter.passedChecks}/{loaded.verificationAfter.totalChecks}
                  </span>
                </div>
              )}
              {loaded && (
                <LayerStrip
                  geo={loaded}
                  resource={resources?.get(r.id) ?? null}
                  bio={bios?.get(r.id) ?? null}
                  human={humans?.get(r.id) ?? null}
                  population={pops?.get(r.id) ?? null}
                  routes={routes?.get(r.id) ?? null}
                  cadastre={cadastres?.get(r.id) ?? null}
                  onLayer={onLayer ? (layer) => onLayer(r, layer) : undefined}
                />
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="p-6 text-center text-[11px] text-zinc-500">No regions match.</div>
        )}
      </div>
    </div>
  );
}

function Chip({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "amber" | "rose" }) {
  const tones = {
    zinc: "border-white/10 bg-white/5 text-zinc-400",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  };
  return (
    <span className={`rounded border px-1 py-px text-[9px] capitalize ${tones[tone]}`}>{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Layers + theme panel
// ---------------------------------------------------------------------------

/** World-layer visibility + status, independent of the cartographic layers. */
export interface WorldLayerView {
  visible: Record<WorldLayerId, boolean>;
  onToggle: (id: WorldLayerId) => void;
  /** Per-layer status for the active region (null on the planet tab). */
  active: RegionLayerState | null;
  onGenerate?: (id: WorldLayerId) => void;
}

interface LayersPanelProps {
  layers: RenderLayers;
  onToggle: (k: keyof RenderLayers) => void;
  themeId: MapThemeId;
  onTheme: (t: MapThemeId) => void;
  counts: Partial<Record<keyof RenderLayers, number>>;
  mode: "planet" | "region";
  world?: WorldLayerView;
}

export function LayersPanel({ layers, onToggle, themeId, onTheme, counts, mode, world }: LayersPanelProps) {
  const worldStatuses = world?.active ? layerStatuses(world.active) : null;
  const items: { key: keyof RenderLayers; label: string; icon: any; tier?: 1 | 2 }[] = [
    { key: "landmasses", label: "Landmasses", icon: Globe2 },
    { key: "seas", label: "Ocean Basins", icon: Waves, tier: 1 },
    { key: "tectonics", label: "Plates & Trenches", icon: Activity, tier: 1 },
    { key: "relief", label: "Ranges & Plateaus", icon: Mountain, tier: 2 },
    { key: "peaks", label: "Summits", icon: Mountain, tier: 2 },
    { key: "volcanoes", label: "Volcanoes", icon: Flame, tier: 2 },
    { key: "rivers", label: "Rivers", icon: Waves, tier: 2 },
    { key: "lakes", label: "Lakes", icon: CircleDot, tier: 2 },
    { key: "biomes", label: "Biomes", icon: TreePine, tier: 2 },
    { key: "routes", label: "Roads & Trade Routes", icon: Navigation, tier: 2 },
    { key: "graticule", label: "Graticule", icon: Grid3x3 },
    { key: "labels", label: "Summit Labels", icon: Tag },
    { key: "regionOverlay", label: "Region Outlines", icon: Sparkles, tier: 1 },
    { key: "compartments", label: "Processing Compartments", icon: Grid3x3, tier: 2 },
  ];

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* ---- World layers (the stack of bricks) ---- */}
      <div className="rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
          <Layers className="h-3.5 w-3.5 text-lime-400" /> World Layers
        </div>
        <div className="space-y-1">
          {[...WORLD_LAYERS].reverse().map((l) => {
            const st = worldStatuses?.find((s) => s.id === l.id) ?? null;
            const on = world?.visible[l.id] ?? true;
            const present = st?.present ?? (l.id === "geo");
            const available = st?.available ?? false;
            return (
              <div
                key={l.id}
                className={`flex items-center justify-between rounded-lg border px-2 py-1.5 ${
                  present ? "border-white/10 bg-white/[0.05]" : "border-dashed border-white/10"
                }`}
              >
                <button
                  onClick={() => world?.onToggle(l.id)}
                  disabled={!present || !world}
                  className="flex items-center gap-2 text-left disabled:opacity-50"
                  title={present ? "Toggle visibility on the map" : l.description}
                >
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition ${
                      on && present ? "border-transparent text-slate-950" : "border-zinc-600 bg-black/40"
                    }`}
                    style={{ background: on && present ? l.color : undefined }}
                  >
                    {on && present && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </span>
                  <span>{l.glyph}</span>
                  <span>
                    <span className="text-[11px] text-zinc-200">
                      L{l.index} · {l.label}
                    </span>
                    <span className="block text-[9px] text-zinc-500">{l.dependsOn ? `built on L${LAYER_BY_ID[l.dependsOn].index}` : "foundation · frozen"}</span>
                  </span>
                </button>
                <span className="flex items-center gap-1.5 font-mono text-[10px]">
                  {st?.present && (
                    <>
                      {st.stale && (
                        <span
                          title={`Stale: an input layer (${st.staleInputs.join(", ")}) was regenerated after this layer. Re-generate it to pick up the newer inputs.`}
                          className="rounded border border-amber-400/40 bg-amber-400/15 px-1 py-0.5 text-[9px] font-bold text-amber-300"
                        >
                          stale
                        </span>
                      )}
                      <span className="text-zinc-400">{st.count.toLocaleString()}</span>
                      <span className={st.verify?.passedAll ? "text-emerald-400" : "text-amber-400"}>
                        {st.verify?.passedChecks}/{st.verify?.totalChecks}
                      </span>
                    </>
                  )}
                  {!st?.present && available && world?.onGenerate && (
                    <button
                      onClick={() => world.onGenerate?.(l.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-950"
                      style={{ background: l.color }}
                    >
                      Generate
                    </button>
                  )}
                  {!st?.present && !available && mode === "region" && (
                    <span className="text-zinc-600">needs L{l.index - 1}</span>
                  )}
                  {mode === "planet" && l.id !== "geo" && <span className="text-zinc-600">per region</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
          <Palette className="h-3.5 w-3.5 text-teal-400" /> Cartographic Theme
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.values(MAP_THEMES).map((t) => {
            const isGidding = t.id === "gidding";
            return (
              <button
                key={t.id}
                onClick={() => onTheme(t.id)}
                className={`flex items-center justify-between rounded-lg border p-2 text-left transition ${
                  isGidding ? "col-span-2 bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-slate-900 border-amber-500/40" : ""
                } ${
                  themeId === t.id
                    ? "border-amber-400 bg-white/10 text-white ring-1 ring-amber-400/50 shadow-sm"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded border border-black/50 shadow-sm"
                    style={{ background: t.land }}
                  />
                  <span className="truncate text-[11px] font-medium">
                    {isGidding ? "✦ Great Gidding (Hand-Inked Fantasy)" : t.short}
                  </span>
                </span>
                {themeId === t.id && <Check className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
          <Layers className="h-3.5 w-3.5 text-teal-400" /> Layers
        </div>
        <div className="space-y-0.5">
          {items.map((it) => {
            const on = layers[it.key];
            const Icon = it.icon;
            const dim = it.tier !== undefined && it.tier !== (mode === "planet" ? 1 : 2);
            return (
              <button
                key={it.key}
                onClick={() => onToggle(it.key)}
                className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 transition ${
                  on ? "border-white/10 bg-white/[0.06] text-zinc-200" : "border-transparent text-zinc-500 hover:bg-white/[0.03]"
                } ${dim ? "opacity-45" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition ${
                      on ? "border-teal-400 bg-teal-500 text-slate-950" : "border-zinc-600 bg-black/40"
                    }`}
                  >
                    {on && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </span>
                  <Icon className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-[11px]">{it.label}</span>
                </span>
                {counts[it.key] !== undefined && (
                  <span className="font-mono text-[10px] text-zinc-500">
                    {counts[it.key]!.toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats panel
// ---------------------------------------------------------------------------

export function StatsPanel({
  macro,
  region,
  detailCount,
  residentFeatures,
  onOpenVerifier,
  regions,
  resources,
  bios,
  humans,
  pops,
  cadastres,
  routes,
  activeResource,
  activeBio,
  activeHuman,
  activePop,
  activeRoute,
  activeCadastre,
}: {
  macro: PlanetMacro;
  region: GeneratedRegion | null;
  detailCount: number;
  residentFeatures: number;
  onOpenVerifier?: () => void;
  regions?: Map<string, GeneratedRegion>;
  resources?: Map<string, ResourceLayerResult>;
  bios?: Map<string, BioLayerResult>;
  humans?: Map<string, HumanLayerResult>;
  pops?: Map<string, PopulationLayerResult>;
  cadastres?: Map<string, CadastreLayerResult>;
  routes?: Map<string, RouteLayerResult>;
  activeResource?: ResourceLayerResult | null;
  activeBio?: BioLayerResult | null;
  activeHuman?: HumanLayerResult | null;
  activePop?: PopulationLayerResult | null;
  activeRoute?: RouteLayerResult | null;
  activeCadastre?: CadastreLayerResult | null;
}) {
  const [filter, setFilter] = useState<"all" | "macro" | "geo" | "resource" | "bio" | "human" | "population" | "routes" | "cadastre">("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const totals = useMemo(() => {
    return regions && bios && humans && pops ? worldTotals(regions, bios, humans, pops, cadastres, resources, routes) : null;
  }, [regions, bios, humans, pops, cadastres, resources, routes]);

  const copyLedgerJSON = () => {
    if (!regions || !bios || !humans || !pops) return;
    const ledger = buildMasterLedger(regions, bios, humans, pops, macro.regions.length, cadastres, resources, routes);
    navigator.clipboard.writeText(JSON.stringify(ledger, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const match = (k: string, v?: unknown) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return k.toLowerCase().includes(query) || (v !== undefined && String(v).toLowerCase().includes(query));
  };

  return (
    <div className="space-y-2.5 text-xs">
      {/* ---- Data Hub Action Header ---- */}
      <div className="rounded-xl border border-white/10 bg-slate-900/90 p-2.5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
            <Database className="h-3.5 w-3.5 text-teal-400" /> World Data Hub
          </span>
          <button
            onClick={copyLedgerJSON}
            className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
            title="Copy structured world census and all layer data as JSON"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-400" />}
            {copied ? "Copied JSON!" : "Copy JSON"}
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search world metrics (e.g. population, river, peak, staple)..."
            className="w-full rounded-lg border border-white/10 bg-black/40 py-1.5 pl-7 pr-2.5 text-[11px] text-white placeholder-zinc-500 focus:border-teal-400 focus:outline-none"
          />
        </div>

        {/* Layer category filter pills */}
        <div className="mt-2 flex flex-wrap gap-1">
          {[
            { id: "all", label: "All Data" },
            { id: "macro", label: "Planet Macro" },
            { id: "geo", label: "L1 Geography" },
            { id: "resource", label: "L2 Resources" },
            { id: "bio", label: "L3 Biosphere" },
            { id: "human", label: "L4 Habitable Sites" },
            { id: "population", label: "L5 Demographics" },
            { id: "routes", label: "L6 Roads & Trade" },
            { id: "cadastre", label: "L7 Cadastre" },
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setFilter(pill.id as typeof filter)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                filter === pill.id
                  ? "bg-teal-500 font-bold text-slate-950 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- World layers summary ---- */}
      {(filter === "all" || filter === "macro") && totals && (
        <Card title="World Layers Stack" icon={<Layers className="h-3.5 w-3.5 text-lime-400" />}>
          {[...WORLD_LAYERS].reverse().map((l) => {
            const t = totals.find((x) => x.id === l.id);
            if (!t) return null;
            return (
              <div key={l.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold text-zinc-100">
                    <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                    {l.glyph} L{l.index} · {l.label}
                  </span>
                  <span className={`font-mono text-[10px] ${t.regions === 0 ? "text-zinc-600" : t.allPassing ? "text-emerald-400" : "text-amber-400"}`}>
                    {t.regions === 0 ? "not generated" : t.allPassing ? "all verified ✓" : "has violations"}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <Row k="Regions" v={`${t.regions} / ${macro.regions.length}`} mono />
                  <Row k={l.id === "geo" ? "Features" : l.id === "bio" ? "Populations" : l.id === "human" ? "Settlements" : l.id === "population" ? "Modelled Zones" : "Plots"} v={t.count.toLocaleString()} mono accent="teal" />
                  {t.extra.map((e) => (
                    <Row key={e.k} k={e.k} v={e.v} mono />
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {(filter === "all" || filter === "macro") && (
        <Card title="Tier 1 — Planetary Macro" icon={<Globe2 className="h-3.5 w-3.5 text-teal-400" />}>
          {match("Seed", macro.stats.seed) && <Row k="Seed" v={macro.stats.seed} mono />}
          {match("Macro features", macro.stats.macroFeatures) && <Row k="Macro features" v={macro.stats.macroFeatures.toLocaleString()} mono accent="teal" />}
          {match("Generation time", macro.stats.generationTimeMs) && <Row k="Generation time" v={`${macro.stats.generationTimeMs} ms`} mono accent="emerald" />}
          {match("Continents", macro.stats.continents) && <Row k="Continents" v={macro.stats.continents} mono />}
          {match("Islands", macro.stats.islands) && <Row k="Islands" v={macro.stats.islands} mono />}
          {match("Tectonic plates", macro.stats.plates) && <Row k="Tectonic plates" v={macro.stats.plates} mono />}
          {match("Ocean basins", macro.stats.seas) && <Row k="Ocean basins" v={macro.stats.seas} mono />}
          {match("Land coverage", macro.stats.landCoveragePercent) && <Row k="Land coverage" v={`${macro.stats.landCoveragePercent}%`} mono />}
          {match("Total land area", macro.stats.totalLandAreaKm2) && <Row k="Total land" v={`${(macro.stats.totalLandAreaKm2 / 1e6).toFixed(1)}M km²`} mono />}
          {match("Detailable regions", macro.regions.length) && <Row k="Detailable regions" v={macro.regions.length} mono accent="amber" />}
          {macro.shape && match("Shape finetune", macro.shape.reshaped) && (
            <Row
              k="Shape finetune"
              v={`${macro.shape.reshaped + macro.shape.softened} reshaped · ${macro.shape.sutured + macro.shape.accreted} merged`}
              mono
              accent="emerald"
            />
          )}
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Size compartments</span>
            {SIZE_CLASS_ORDER.map((id) => (
              <div key={id} className="flex items-center justify-between">
                <SizeClassBadge cls={id} />
                <span className="font-mono text-[11px] text-zinc-300">{macro.stats.sizeClassCounts[id] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(filter === "all" || filter === "geo") && (
        <Card title="Tier 2 — Resident Detail" icon={<Database className="h-3.5 w-3.5 text-amber-400" />}>
          {match("Regions loaded", detailCount) && <Row k="Regions loaded" v={detailCount} mono accent="amber" />}
          {match("Detail features", residentFeatures) && <Row k="Detail features" v={residentFeatures.toLocaleString()} mono accent="teal" />}
          <p className="pt-1 text-[10px] leading-relaxed text-zinc-500">
            Only opened regions hold detail in memory. Unload a region from the cascade list to release it
            instantly — the planet map never carries their weight.
          </p>
        </Card>
      )}

      {(filter === "all" || filter === "geo") && region && (
        <Card
          title={`Active Region — ${region.descriptor.name}`}
          icon={<Gauge className="h-3.5 w-3.5 text-emerald-400" />}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-[11px] text-zinc-500">Size class</span>
            <SizeClassBadge cls={region.sizeClass} />
          </div>
          {match("Land area", region.descriptor.areaKm2) && <Row k="Land area" v={formatArea(region.descriptor.areaKm2)} mono />}
          {match("Linear scale", region.descriptor.linearScaleKm) && <Row k="Linear scale (√A)" v={formatKm(region.descriptor.linearScaleKm)} mono />}
          {match("Compartments", region.compartments.length) && <Row k="Compartments" v={`${region.compartments.length} blocks`} mono accent="amber" />}
          {match("Region seed", region.seed) && <Row k="Region seed" v={region.seed} mono accent="teal" />}
          {match("Detail level", region.config.detailLevel) && <Row k="Detail level" v={region.config.detailLevel} mono accent="amber" />}
          {match("Features", region.stats.totalFeatures) && <Row k="Features" v={region.stats.totalFeatures.toLocaleString()} mono accent="teal" />}
          {match("Generated in", region.stats.generationTimeMs) && <Row k="Generated in" v={`${region.stats.generationTimeMs} ms`} mono accent="emerald" />}
          {match("Memory", region.stats.approxMemoryKb) && <Row k="Memory" v={`${(region.stats.approxMemoryKb / 1024).toFixed(2)} MB`} mono />}
          {match("Mountain ranges", region.stats.mountainRanges) && <Row k="Mountain ranges" v={region.stats.mountainRanges} mono />}
          {match("Summits", region.stats.peaks) && <Row k="Summits" v={region.stats.peaks.toLocaleString()} mono />}
          {match("Volcanoes", region.stats.volcanoes) && <Row k="Volcanoes" v={region.stats.volcanoes.toLocaleString()} mono />}
          {match("River systems", region.stats.rivers) && <Row k="River systems" v={region.stats.rivers.toLocaleString()} mono />}
          {match("River segments", region.stats.riverSegments) && <Row k="River segments" v={region.stats.riverSegments.toLocaleString()} mono />}
          {match("Total river length", region.stats.totalRiverLengthKm) && (
            <Row
              k="Total river length"
              v={`${region.stats.totalRiverLengthKm.toLocaleString()} km`}
              mono
              accent="sky"
            />
          )}
          {match("Lakes", region.stats.lakes) && <Row k="Lakes" v={region.stats.lakes.toLocaleString()} mono />}
          {match("Biome polygons", region.stats.biomes) && <Row k="Biome polygons" v={region.stats.biomes.toLocaleString()} mono />}
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
            <Row k="Highest summit" v={`${region.stats.highestPeak.name}`} />
            <Row k="" v={`${region.stats.highestPeak.elevation.toLocaleString()} m`} mono accent="amber" />
            <Row k="Longest river" v={region.stats.longestRiver.name} />
            <Row k="" v={`${region.stats.longestRiver.lengthKm.toLocaleString()} km`} mono accent="sky" />
          </div>
        </Card>
      )}

      {(filter === "all" || filter === "geo") && region && (
        <Card
          title="Stage 8 — Finetune & Verifier"
          icon={<Check className="h-3.5 w-3.5 text-teal-400" />}
        >
          <Row
            k="Verifier status"
            v={`${region.verificationAfter.passedChecks}/${region.verificationAfter.totalChecks} passed`}
            mono
            accent="emerald"
          />
          <Row
            k="Violations fixed"
            v={`${region.verificationBefore.totalViolations.toLocaleString()} → ${region.verificationAfter.totalViolations}`}
            mono
            accent="teal"
          />
          <Row
            k="Raw → Finetuned"
            v={`${region.finetune.rawFeatureCount.toLocaleString()} → ${region.finetune.finalFeatureCount.toLocaleString()}`}
            mono
          />
          <Row
            k="Y-confluences snapped"
            v={region.finetune.riversSnappedConfluence.toLocaleString()}
            mono
            accent="sky"
          />
          <Row
            k="Braids/stubs pruned"
            v={(region.finetune.riversDroppedBraidOrCrowd + region.finetune.riversDroppedStub).toLocaleString()}
            mono
          />
          {onOpenVerifier && (
            <button
              onClick={onOpenVerifier}
              className="mt-2 w-full rounded-lg border border-teal-500/30 bg-teal-500/15 py-1.5 text-[11px] font-semibold text-teal-300 transition hover:bg-teal-500 hover:text-slate-950"
            >
              Inspect Full Verifier Report
            </button>
          )}
        </Card>
      )}

      {(filter === "all" || filter === "resource") && region && activeResource && (
        <Card title="L2 — Geological Resources (this region)" icon={<span className="text-sm leading-none">⛏️</span>}>
          {match("Total deposits", activeResource.stats.totalDeposits) && (
            <Row k="Total deposits" v={activeResource.stats.totalDeposits.toLocaleString()} mono accent="amber" />
          )}
          {match("Metal ores", activeResource.stats.metalsCount) && (
            <Row k="Metal ores" v={activeResource.stats.metalsCount.toLocaleString()} mono />
          )}
          {match("Clays & earths", activeResource.stats.claysCount) && (
            <Row k="Clays & earths" v={activeResource.stats.claysCount.toLocaleString()} mono />
          )}
          {match("Masonry stones", activeResource.stats.stonesCount) && (
            <Row k="Masonry stones" v={activeResource.stats.stonesCount.toLocaleString()} mono />
          )}
          {match("Salts & chemicals", activeResource.stats.saltsCount) && (
            <Row k="Salts & chemicals" v={activeResource.stats.saltsCount.toLocaleString()} mono />
          )}
          {match("Fuels & energy", activeResource.stats.fuelsCount) && (
            <Row k="Fuels & energy" v={activeResource.stats.fuelsCount.toLocaleString()} mono accent={activeResource.stats.fuelsCount > 0 ? "amber" : undefined} />
          )}
          {match("Gems & lapidary", activeResource.stats.gemsCount) && (
            <Row k="Gems & lapidary" v={activeResource.stats.gemsCount.toLocaleString()} mono />
          )}
          {match("Mythic / Fantasy", activeResource.stats.fantasyCount) && (
            <Row k="Mythic / Fantasy" v={activeResource.stats.fantasyCount.toLocaleString()} mono accent="emerald" />
          )}
          <div className="mt-1 border-t border-white/10 pt-1.5">
            <Row
              k="Active catalog"
              v={`${activeResource.stats.activeCatalogSize} minerals (${activeResource.config.preset})`}
              mono
            />
          </div>
        </Card>
      )}

      {(filter === "all" || filter === "bio") && region && activeBio && (
        <Card title="L3 — Flora & Fauna (this region)" icon={<span className="text-sm leading-none">🌿</span>}>
          {match("Populations", activeBio.stats.populations) && <Row k="Populations" v={activeBio.stats.populations.toLocaleString()} mono accent="teal" />}
          {match("Species present", activeBio.stats.species) && <Row k="Species present" v={activeBio.stats.species} mono />}
          {match("Crops", activeBio.stats.byKind.crop) && <Row k="Crops · Livestock" v={`${activeBio.stats.byKind.crop} · ${activeBio.stats.byKind.livestock}`} mono />}
          {match("Wild", activeBio.stats.byKind.wild) && <Row k="Wild · Support flora" v={`${activeBio.stats.byKind.wild} · ${activeBio.stats.byKind.flora}`} mono />}
          {match("Irrigated farms", activeBio.stats.irrigatedFarms) && <Row k="Irrigated farms" v={activeBio.stats.irrigatedFarms} mono accent="sky" />}
          {match("Finetune", activeBio.report.finalCount) && <Row k="Finetune" v={`${activeBio.report.rawCount} raw → ${activeBio.report.finalCount}`} mono />}
          <Row
            k="Verifier"
            v={`${activeBio.verifyBefore.totalViolations}v → ${activeBio.verifyAfter.totalViolations}v · ${activeBio.verifyAfter.passedChecks}/${activeBio.verifyAfter.totalChecks}`}
            mono
            accent={activeBio.verifyAfter.passedAll ? "emerald" : "amber"}
          />
          <div className="mt-1 border-t border-white/10 pt-1.5">
            <Row k="Staples" v={activeBio.stats.staples.slice(0, 4).join(", ") || "none (climate)"} />
            <Row k="Proteins" v={activeBio.stats.proteins.slice(0, 3).join(", ") || "—"} />
          </div>
        </Card>
      )}

      {(filter === "all" || filter === "population") && region && activePop && (
        <Card title="L4 — Population (time)" icon={<span className="text-sm leading-none">👥</span>}>
          {match("Era", activePop.config.era) && <Row k="Era" v={ERA_META[activePop.config.era].label} />}
          {match("Year", activePop.config.year) && <Row k="Year" v={String(activePop.config.year)} mono />}
          {match("Scale", activePop.config.targetScale) && <Row k="Scale" v={`${activePop.config.targetScale.toFixed(2)}×`} mono accent="sky" />}
          {match("Actual people", activePop.report.finalOccupancy) && <Row k="Actual people" v={activePop.report.finalOccupancy.toLocaleString()} mono accent="teal" />}
          {match("Zones modelled", activePop.report.zonesModelled) && <Row k="Zones modelled" v={String(activePop.report.zonesModelled)} mono />}
          {match("Hunger zones", activePop.report.foodShortageZones) && <Row k="Hunger zones" v={String(activePop.report.foodShortageZones)} mono accent={activePop.report.foodShortageZones > 0 ? "amber" : undefined} />}
          {match("Ruins revived", activePop.report.revived) && <Row k="Ruins revived" v={String(activePop.report.revived)} mono accent="emerald" />}
          <Row
            k="Verifier"
            v={`${activePop.verifyBefore.totalViolations}v → ${activePop.verifyAfter.totalViolations}v · ${activePop.verifyAfter.passedChecks}/${activePop.verifyAfter.totalChecks}`}
            mono
            accent={activePop.verifyAfter.passedAll ? "emerald" : "amber"}
          />
        </Card>
      )}

      {(filter === "all" || filter === "human") && region && activeHuman && (
        <Card title="L3 — Habitable Zones (this region)" icon={<span className="text-sm leading-none">🏘️</span>}>
          {match("Zones", activeHuman.stats.zones) && <Row k="Zones" v={activeHuman.stats.zones.toLocaleString()} mono accent="teal" />}
          {match("Structural capacity", activeHuman.stats.totalCapacity) && <Row k="Structural capacity" v={activeHuman.stats.totalCapacity.toLocaleString()} mono accent="amber" />}
          <Row k="Capitals" v={activeHuman.settlements.filter((s) => s.type === "capital_city").length} mono />
          <Row
            k="Habitation"
            v={`${activeHuman.stats.byHabitation.lived_now} now · ${activeHuman.stats.byHabitation.ancient_pulse} ancient · ${activeHuman.stats.byHabitation.potential} potential`}
            mono
          />
          <div className="mt-1 space-y-0.5 border-t border-white/10 pt-1.5">
            {TIER_ORDER.map((t) => (
              <div key={t} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: TIER_COLORS[t] }} />
                  {TIER_LABELS[t]}
                </span>
                <span className="font-mono text-[11px] text-zinc-200">{activeHuman.stats.byTier[t]}</span>
              </div>
            ))}
          </div>
          {activeHuman.stats.bestSite && (
            <div className="mt-1 border-t border-white/10 pt-1.5">
              <Row k="Best site" v={activeHuman.stats.bestSite.name} />
              <Row k="" v={`capacity ${activeHuman.stats.bestSite.capacity.toFixed(2)} · ${activeHuman.stats.bestSite.type.replace(/_/g, " ")}`} mono accent="amber" />
            </div>
          )}
          <Row
            k="Finetune"
            v={`${activeHuman.report.rawCount} raw → ${activeHuman.report.finalCount} · ${activeHuman.report.demotions} demotions`}
            mono
          />
          <Row
            k="Verifier"
            v={`${activeHuman.verifyBefore.totalViolations}v → ${activeHuman.verifyAfter.totalViolations}v · ${activeHuman.verifyAfter.passedChecks}/${activeHuman.verifyAfter.totalChecks}`}
            mono
            accent={activeHuman.verifyAfter.passedAll ? "emerald" : "amber"}
          />
        </Card>
      )}

      {/* ---- L6 Trade Routes & Roads ---- */}
      {(filter === "all" || filter === "routes") && region && activeRoute && (
        <Card title="L6 — Trade Routes & Roads (this region)" icon={<span className="text-sm leading-none">🛣️</span>}>
          {match("Total network", activeRoute.stats.totalKm) && (
            <Row k="Total network" v={`${activeRoute.stats.totalKm.toLocaleString()} km`} mono accent="teal" />
          )}
          {match("Routes", activeRoute.stats.totalRoutes) && (
            <Row k="Routes mapped" v={activeRoute.stats.totalRoutes.toLocaleString()} mono />
          )}
          {match("Connected settlements", activeRoute.stats.connectedSettlementsCount) && (
            <Row
              k="Connected sites"
              v={`${activeRoute.stats.connectedSettlementsCount} (${Math.round(activeRoute.stats.connectivityRatio * 100)}% reach)`}
              mono
              accent="emerald"
            />
          )}
          {match("Highways", activeRoute.stats.highwaysKm) && (
            <Row k="Royal Highways" v={`${activeRoute.stats.highwaysKm.toLocaleString()} km (${activeRoute.stats.highwaysCount})`} mono accent="amber" />
          )}
          {match("Arterials", activeRoute.stats.arterialsKm) && (
            <Row k="Market arterials" v={`${activeRoute.stats.arterialsKm.toLocaleString()} km (${activeRoute.stats.arterialsCount})`} mono />
          )}
          {match("Byways", activeRoute.stats.bywaysKm) && (
            <Row k="Rural byways" v={`${activeRoute.stats.bywaysKm.toLocaleString()} km (${activeRoute.stats.bywaysCount})`} mono />
          )}
          {match("Sea lanes", activeRoute.stats.seaLanesKm) && (
            <Row k="Coastal sea lanes" v={`${activeRoute.stats.seaLanesKm.toLocaleString()} km (${activeRoute.stats.seaLanesCount})`} mono accent="sky" />
          )}
          {match("Paved roads", activeRoute.stats.pavedKm) && (
            <Row k="Paved stone share" v={`${activeRoute.stats.pavedKm.toLocaleString()} km`} mono accent="amber" />
          )}
          {match("Bridges & Fords", activeRoute.stats.bridgesCount) && (
            <Row k="Bridges / fords" v={activeRoute.stats.bridgesCount.toLocaleString()} mono />
          )}
          <div className="mt-1 border-t border-white/10 pt-1.5">
            <Row
              k="Longest route"
              v={`${activeRoute.stats.longestRouteName} (${activeRoute.stats.longestRouteKm} km)`}
            />
            <Row
              k="Primary goods"
              v={Array.from(new Set(activeRoute.routes.flatMap((r) => r.tradeGoods))).slice(0, 4).join(", ") || "General provisions"}
            />
          </div>
          <Row
            k="Verifier"
            v={`${activeRoute.verifyBefore.totalViolations}v → ${activeRoute.verifyAfter.totalViolations}v · ${activeRoute.verifyAfter.passedChecks}/${activeRoute.verifyAfter.totalChecks}`}
            mono
            accent={activeRoute.verifyAfter.passedAll ? "emerald" : "amber"}
          />
        </Card>
      )}

      {/* ---- L7 Cadastre (Extensible Ready) ---- */}
      {(filter === "all" || filter === "cadastre") && (
        <Card title="L7 — Cadastre & Roofs (Google Earth Lite)" icon={<span className="text-sm leading-none">🏛️</span>}>
          <Row k="Status" v={activeCadastre ? "Surveyed & Verified" : "JIT Active (Zoom In)"} mono accent="emerald" />
          <Row k="Architecture" v="Burgage plots, street graph, roofs" />
          {activeCadastre ? (
            <>
              <Row k="Surveyed buildings" v={activeCadastre.stats.totalBuildings.toLocaleString()} mono accent="teal" />
              <Row k="Street network" v={`${activeCadastre.stats.totalStreetsKm.toFixed(1)} km mapped`} mono />
              <Row k="Total roof area" v={`${(activeCadastre.stats.totalRoofAreaKm2 * 1000).toFixed(1)}k m²`} mono />
              <Row k="Settlements" v={`${activeCadastre.stats.settlementsCount} surveyed`} accent="amber" />
              <Row
                k="Verifier"
                v={activeCadastre.stats.allPassing ? "✓ ALL PASS" : "Conflicts resolved"}
                mono
                accent={activeCadastre.stats.allPassing ? "emerald" : "amber"}
              />
            </>
          ) : (
            <>
              <Row k="Micro scale" v="Top-down house footprints (~0.5m/px)" mono accent="sky" />
              <Row k="Render style" v="Directional 3D sun-shadows & gables" />
              <Row k="JIT Virtualization" v="On-demand camera zoom triggering" mono accent="teal" />
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
        {icon} {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  accent?: "teal" | "amber" | "emerald" | "sky";
}) {
  const color =
    accent === "teal"
      ? "text-teal-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : accent === "sky"
      ? "text-sky-300"
      : "text-zinc-200";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-[11px] text-zinc-500">{k}</span>
      <span className={`truncate text-right text-[11px] ${mono ? "font-mono" : ""} ${color} capitalize`}>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landmark list for the active region
// ---------------------------------------------------------------------------

export function LandmarkList({
  features,
  onSelect,
}: {
  features: MapFeature[];
  onSelect: (f: MapFeature) => void;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"top" | "mountain" | "river" | "lake" | "volcano">("top");

  const list = useMemo(() => {
    let pool = features;
    if (tab === "top") {
      pool = features
        .filter(
          (f) =>
            (f.properties.featureType === "mountain" && (f.properties.elevation ?? 0) > 3000) ||
            (f.properties.featureType === "river" && (f.properties.strahlerOrder ?? 0) >= 4) ||
            f.properties.featureType === "mountain_range" ||
            (f.properties.featureType === "lake" && (f.properties.areaKm2 ?? 0) > 2000)
        )
        .slice(0, 400);
    } else {
      pool = features.filter((f) => f.properties.featureType === tab);
    }
    const filtered = q ? pool.filter((f) => f.properties.name.toLowerCase().includes(q.toLowerCase())) : pool;
    return [...filtered]
      .sort(
        (a, b) =>
          (b.properties.elevation ?? b.properties.lengthKm ?? b.properties.areaKm2 ?? 0) -
          (a.properties.elevation ?? a.properties.lengthKm ?? a.properties.areaKm2 ?? 0)
      )
      .slice(0, 120);
  }, [features, q, tab]);

  const icon = (t: string) =>
    t === "mountain" || t === "mountain_range" ? (
      <Mountain className="h-3.5 w-3.5 text-amber-400" />
    ) : t === "volcano" ? (
      <Flame className="h-3.5 w-3.5 text-rose-500" />
    ) : t === "river" ? (
      <Waves className="h-3.5 w-3.5 text-sky-400" />
    ) : t === "lake" ? (
      <CircleDot className="h-3.5 w-3.5 text-sky-300" />
    ) : (
      <TreePine className="h-3.5 w-3.5 text-emerald-400" />
    );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900 text-xs shadow-xl">
      <div className="shrink-0 border-b border-white/10 bg-slate-950/50 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search features…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 outline-none focus:border-teal-400"
          />
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {(
            [
              ["top", "Notable"],
              ["mountain", "Summits"],
              ["river", "Rivers"],
              ["lake", "Lakes"],
              ["volcano", "Volcanoes"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                tab === id
                  ? "bg-teal-500 font-bold text-slate-950"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 divide-y divide-white/[0.04] overflow-y-auto">
        {list.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelect(f)}
            className="group flex w-full items-center justify-between p-2.5 text-left transition hover:bg-white/[0.06]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5">
                {icon(f.properties.featureType)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-zinc-200 group-hover:text-teal-300">
                  {f.properties.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-zinc-500">
                  {FEATURE_LABELS[f.properties.featureType]}
                  {f.properties.elevation !== undefined && ` · ${f.properties.elevation.toLocaleString()} m`}
                  {f.properties.lengthKm !== undefined && ` · ${f.properties.lengthKm.toLocaleString()} km`}
                  {f.properties.areaKm2 !== undefined &&
                    f.properties.elevation === undefined &&
                    ` · ${f.properties.areaKm2.toLocaleString()} km²`}
                </span>
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition group-hover:text-teal-400" />
          </button>
        ))}
        {list.length === 0 && (
          <div className="p-6 text-center text-[11px] text-zinc-500">Nothing here yet.</div>
        )}
      </div>
    </div>
  );
}
