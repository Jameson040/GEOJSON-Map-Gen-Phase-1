import type { MapFeature } from "../world/types";
import { FEATURE_LABELS } from "../world/themes";
import { formatLatLon } from "../world/constants";
import {
  X,
  Target,
  Mountain,
  Waves,
  Flame,
  TreePine,
  Sun,
  Snowflake,
  Compass,
  Layers3,
  Wind,
  Thermometer,
  Droplets,
  Globe2,
} from "lucide-react";

export function Inspector({
  feature,
  onClose,
  onFocus,
}: {
  feature: MapFeature | null;
  onClose: () => void;
  onFocus: (f: MapFeature) => void;
}) {
  if (!feature) return null;
  const p = feature.properties;

  const Icon = (() => {
    switch (p.featureType) {
      case "mountain":
      case "mountain_range":
      case "plateau":
        return Mountain;
      case "river":
      case "lake":
      case "sea":
      case "wetland":
        return Waves;
      case "volcano":
        return Flame;
      case "forest":
      case "savanna":
      case "grassland":
        return TreePine;
      case "desert":
        return Sun;
      case "glacier":
      case "ice_cap":
      case "tundra":
        return Snowflake;
      case "continent":
      case "island":
      case "coastline":
        return Globe2;
      default:
        return Compass;
    }
  })();

  const centre: [number, number] = [
    (feature.bbox.minX + feature.bbox.maxX) / 2,
    (feature.bbox.minY + feature.bbox.maxY) / 2,
  ];

  return (
    <div className="absolute left-3 top-3 z-40 flex max-h-[84%] w-[19rem] flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900/96 shadow-2xl backdrop-blur-md md:w-[22rem]">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 bg-slate-950/60 p-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2.5">
            <Icon className="h-5 w-5 text-teal-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-300">
                {FEATURE_LABELS[p.featureType]}
              </span>
              <span className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[9px] text-zinc-500">
                Tier {p.tier}
              </span>
            </div>
            <h3 className="mt-0.5 truncate text-base font-bold text-white">{p.name}</h3>
            {p.regionName && (
              <p className="truncate text-[10px] text-zinc-500">in {p.regionName}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1 text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-3.5 text-xs">
        <div className="grid grid-cols-2 gap-2">
          {p.elevation !== undefined && <Stat label="Elevation" value={`${p.elevation.toLocaleString()} m`} tone="amber" />}
          {p.prominence !== undefined && <Stat label="Prominence" value={`${p.prominence.toLocaleString()} m`} />}
          {p.depth !== undefined && <Stat label="Depth" value={`${p.depth.toLocaleString()} m`} tone="sky" />}
          {p.lengthKm !== undefined && <Stat label="Length" value={`${p.lengthKm.toLocaleString()} km`} tone="sky" />}
          {p.strahlerOrder !== undefined && <Stat label="Strahler order" value={`Order ${p.strahlerOrder}`} tone="teal" />}
          {p.dischargeM3s !== undefined && <Stat label="Discharge" value={`${p.dischargeM3s.toLocaleString()} m³/s`} />}
          {p.basinAreaKm2 !== undefined && <Stat label="Basin area" value={`${p.basinAreaKm2.toLocaleString()} km²`} />}
          {p.areaKm2 !== undefined && <Stat label="Area" value={`${p.areaKm2.toLocaleString()} km²`} />}
          {p.annualRainfallMm !== undefined && (
            <Stat label="Rainfall" value={`${p.annualRainfallMm.toLocaleString()} mm/yr`} tone="sky" icon={<Droplets className="h-3 w-3" />} />
          )}
          {p.meanTempC !== undefined && (
            <Stat label="Mean temp" value={`${p.meanTempC} °C`} icon={<Thermometer className="h-3 w-3" />} />
          )}
          {p.climateZone && <Stat label="Climate zone" value={p.climateZone} />}
          {p.windward !== undefined && (
            <Stat
              label="Aspect"
              value={p.windward ? "Windward" : "Leeward (rain shadow)"}
              tone={p.windward ? "teal" : "amber"}
              icon={<Wind className="h-3 w-3" />}
            />
          )}
          {p.isActiveVolcano !== undefined && (
            <Stat label="Status" value={p.isActiveVolcano ? "Active vent" : "Dormant"} tone={p.isActiveVolcano ? "rose" : undefined} />
          )}
          {p.volcanoType && <Stat label="Volcano type" value={p.volcanoType} />}
          {p.mouthType && <Stat label="Outflow" value={p.mouthType.replace(/_/g, " ")} />}
        </div>

        {p.drainsToName && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-2.5">
            <span className="text-[10px] uppercase tracking-wide text-sky-400">Drains into</span>
            <p className="text-[12px] font-medium text-zinc-200">{p.drainsToName}</p>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-zinc-300">
            <Compass className="h-3.5 w-3.5 text-teal-400" /> Location
          </div>
          <p className="font-mono text-[11px] text-zinc-400">{formatLatLon(centre[0], centre[1])}</p>
        </div>

        {p.geologicalOrigin && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-zinc-300">
              <Layers3 className="h-3.5 w-3.5 text-teal-400" /> Genesis
            </div>
            <p className="text-[11px] italic leading-relaxed text-zinc-400">{p.geologicalOrigin}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/60 p-2.5">
        <span className="font-mono text-[10px] text-zinc-500">{feature.geometry.type}</span>
        <button
          onClick={() => onFocus(feature)}
          className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/20 px-3 py-1.5 text-xs font-semibold text-teal-300 transition hover:bg-teal-500 hover:text-slate-950"
        >
          <Target className="h-3.5 w-3.5" /> Zoom to
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "amber" | "sky" | "teal" | "rose";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "amber"
      ? "text-amber-300"
      : tone === "sky"
      ? "text-sky-300"
      : tone === "teal"
      ? "text-teal-300"
      : tone === "rose"
      ? "text-rose-300"
      : "text-zinc-200";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
        {icon} {label}
      </span>
      <span className={`block truncate text-[12px] font-semibold capitalize ${color}`}>{value}</span>
    </div>
  );
}
