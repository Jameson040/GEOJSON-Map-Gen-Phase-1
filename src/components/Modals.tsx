import { useState, useEffect } from "react";
import type {
  ConflictRecord,
  GenProgress,
  PlanetConfig,
  RegionConfig,
  RegionDescriptor,
} from "../world/types";
import {
  X,
  Globe2,
  Sparkles,
  Play,
  Zap,
  Sliders,
  Activity,
  Mountain,
  Sun,
  Snowflake,
  Waves,
  Search,
  Layers3,
  Cpu,
  GitBranch,
  Boxes,
  Ruler,
} from "lucide-react";
import { SIZE_PROFILES, DETAIL_MULTIPLIER, formatArea, formatKm } from "../world/size-classes";

// ---------------------------------------------------------------------------
function Shell({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  wide,
  locked,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  locked?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm">
      <div
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-2 text-teal-400">{icon}</div>
            <div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <p className="text-xs text-zinc-400">{subtitle}</p>
            </div>
          </div>
          {!locked && (
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="space-y-5 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/60 px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}

function Progress({ p }: { p: GenProgress }) {
  return (
    <div className="space-y-2.5 rounded-xl border border-teal-500/30 bg-teal-950/40 p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-teal-300">
          <Zap className="h-3.5 w-3.5 animate-pulse text-teal-400" />
          Stage {p.stage}/{p.totalStages} · {p.stageName}
        </span>
        <span className="font-mono font-bold text-teal-400">{p.percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-150"
          style={{ width: `${p.percent}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[11px] text-zinc-400">
        <span>
          features <strong className="text-white">{p.featuresCount.toLocaleString()}</strong>
        </span>
        <span>{p.elapsedMs} ms</span>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="font-mono text-teal-400">
          {step < 1 ? value.toFixed(1) : value}
          {unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-teal-400"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 1 — planet setup
// ---------------------------------------------------------------------------

export function PlanetSetupModal({
  open,
  onClose,
  onGenerate,
  busy,
  progress,
  current,
  loadedRegionCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  onGenerate: (c: PlanetConfig) => void;
  busy: boolean;
  progress: GenProgress | null;
  current: PlanetConfig;
  loadedRegionCount?: number;
}) {
  const [seed, setSeed] = useState(current.seed);
  const [continentCount, setContinentCount] = useState(current.continentCount);
  const [tectonicActivity, setTectonic] = useState(current.tectonicActivity);
  const [islandDensity, setIslands] = useState(current.islandDensity);
  const [polarIceExtent, setIce] = useState(current.polarIceExtent);
  const [oceanLevel, setOcean] = useState(current.oceanLevel);

  useEffect(() => {
    if (!open) return;
    setSeed(current.seed);
    setContinentCount(current.continentCount);
    setTectonic(current.tectonicActivity);
    setIslands(current.islandDensity);
    setIce(current.polarIceExtent);
    setOcean(current.oceanLevel);
  }, [open, current]);

  if (!open) return null;

  const randomise = () => {
    const c = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
    setSeed(s);
  };

  return (
    <Shell
      title="Tier 1 — Planetary Macro Pass"
      subtitle="Continents, island arcs, plates and ocean basins only. A few hundred features; instant."
      icon={<Globe2 className="h-5 w-5" />}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <span className="text-xs text-zinc-400">Detail is deferred to per-region tabs</span>
          <div className="flex items-center gap-2">
            {!busy && (
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white">
                Cancel
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                onGenerate({
                  seed: seed.trim() || "terra",
                  continentCount,
                  tectonicActivity,
                  islandDensity,
                  polarIceExtent,
                  oceanLevel,
                })
              }
              className="flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400 disabled:opacity-50"
            >
              {busy ? <Zap className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {busy ? "Forming…" : "Form Planet"}
            </button>
          </div>
        </>
      }
    >
      {loadedRegionCount > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-200">
          <strong className="text-amber-300">Heads up:</strong> Generating a new planet will replace the current
          planetary map and clear your <strong>{loadedRegionCount}</strong> generated Tier-2 region tab
          {loadedRegionCount > 1 ? "s" : ""}. To regenerate only a single continent or island, use{" "}
          <strong className="text-amber-300">Re-roll Region</strong> or <strong className="text-amber-300">Region Seed</strong> inside that region&apos;s tab.
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs leading-relaxed text-zinc-400">
        <span className="font-semibold text-teal-400">Cascading workflow.</span> This pass builds only the
        planet-scale skeleton, so it stays light forever. Each landmass it produces is published as a{" "}
        <span className="font-mono text-zinc-300">RegionDescriptor</span> (lon/lat, area, climate band, plate
        membership, convergence vectors). Opening a region tab runs Tier 2 against that descriptor to build its
        mountains, rivers and biomes on demand.
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Planet Seed</label>
          <button onClick={randomise} disabled={busy} className="flex items-center gap-1 text-xs text-teal-400 transition hover:text-teal-300">
            <Sparkles className="h-3.5 w-3.5" /> Randomise
          </button>
        </div>
        <input
          value={seed}
          disabled={busy}
          onChange={(e) => setSeed(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 font-mono text-sm text-white outline-none transition focus:border-teal-400"
        />
      </div>

      <div className="space-y-4 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Sliders className="h-3.5 w-3.5" /> Macro Parameters
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Slider label="Continental plates" value={continentCount} min={3} max={8} step={1} disabled={busy} onChange={setContinentCount} />
          <Slider label="Tectonic activity" value={tectonicActivity} min={0.4} max={1.8} step={0.1} unit="×" disabled={busy} onChange={setTectonic} />
          <Slider label="Island arc density" value={islandDensity} min={0.3} max={2.2} step={0.1} unit="×" disabled={busy} onChange={setIslands} />
          <Slider label="Polar ice extent" value={polarIceExtent} min={0.2} max={2} step={0.1} unit="×" disabled={busy} onChange={setIce} />
          <Slider label="Ocean level" value={oceanLevel} min={0.7} max={1.3} step={0.05} unit="×" disabled={busy} onChange={setOcean} />
        </div>
      </div>

      {busy && progress && <Progress p={progress} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Tier 2 — region detail
// ---------------------------------------------------------------------------

const LEVELS: { id: RegionConfig["detailLevel"]; name: string; badge: string; desc: string; color: string }[] = [
  { id: "sketch", name: "Sketch", badge: "~1–3K", desc: "Fast overview pass", color: "text-sky-400" },
  { id: "standard", name: "Standard", badge: "~5–12K", desc: "Balanced regional atlas", color: "text-teal-400" },
  { id: "high", name: "High", badge: "~15–35K", desc: "Dense tributary networks", color: "text-amber-400" },
  { id: "ultra", name: "Ultra", badge: "40–90K", desc: "Every capillary stream", color: "text-rose-400" },
];

export function RegionGenerateModal({
  open,
  region,
  initialConfig,
  onClose,
  onGenerate,
  busy,
  progress,
}: {
  open: boolean;
  region: RegionDescriptor | null;
  initialConfig?: RegionConfig | null;
  onClose: () => void;
  onGenerate: (c: RegionConfig) => void;
  busy: boolean;
  progress: GenProgress | null;
}) {
  const [level, setLevel] = useState<RegionConfig["detailLevel"]>(initialConfig?.detailLevel ?? "standard");
  const [riverDensity, setRivers] = useState(initialConfig?.riverDensity ?? 1);
  const [reliefIntensity, setRelief] = useState(initialConfig?.reliefIntensity ?? 1);
  const [moisture, setMoisture] = useState(initialConfig?.moisture ?? 1);
  const [glaciation, setGlaciation] = useState(initialConfig?.glaciation ?? 1);
  const [regionSeedInput, setRegionSeedInput] = useState(
    initialConfig?.customSeed ?? region?.regionSeed ?? ""
  );

  useEffect(() => {
    if (!region) return;
    setLevel(initialConfig?.detailLevel ?? "standard");
    setRivers(initialConfig?.riverDensity ?? 1);
    setRelief(initialConfig?.reliefIntensity ?? 1);
    setMoisture(initialConfig?.moisture ?? 1);
    setGlaciation(initialConfig?.glaciation ?? 1);
    setRegionSeedInput(initialConfig?.customSeed ?? region.regionSeed);
  }, [region, initialConfig, open]);

  if (!open || !region) return null;

  const randomiseRegionSeed = () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let tag = "";
    for (let i = 0; i < 6; i++) tag += chars[Math.floor(Math.random() * chars.length)];
    setRegionSeedInput(`${region.id}::${tag}`);
  };

  const mult = { sketch: 0.25, standard: 1, high: 2.2, ultra: 4.2 }[level];
  const estimate = Math.round(region.detailBudget * mult);

  return (
    <Shell
      title={`Tier 2 — ${region.name}`}
      subtitle="Regional detail generated for this landmass only (planet & other tabs stay untouched)"
      icon={<Layers3 className="h-5 w-5" />}
      onClose={onClose}
      locked={busy}
      wide
      footer={
        <>
          <span className="font-mono text-xs text-zinc-400">
            est. ~{estimate.toLocaleString()} features · seed{" "}
            <strong className="text-amber-300">{regionSeedInput.trim() || region.regionSeed}</strong>
          </span>
          <div className="flex items-center gap-2">
            {!busy && (
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white">
                Cancel
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                onGenerate({
                  detailLevel: level,
                  riverDensity,
                  reliefIntensity,
                  moisture,
                  glaciation,
                  customSeed: regionSeedInput.trim() || region.regionSeed,
                })
              }
              className="flex items-center gap-2 rounded-lg bg-amber-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? <Zap className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {busy ? "Generating…" : initialConfig ? "Regenerate Region" : "Generate Region"}
            </button>
          </div>
        </>
      }
    >
      {/* inherited data */}
      <div className="rounded-xl border border-teal-500/20 bg-teal-950/20 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-400">
          <GitBranch className="h-3.5 w-3.5" /> Inherited from Tier 1
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:grid-cols-3">
          <Kv k="Kind" v={region.kind} />
          <Kv k="Centroid" v={`${Math.abs(region.lat).toFixed(1)}°${region.lat >= 0 ? "N" : "S"} ${Math.abs(region.lon).toFixed(1)}°${region.lon >= 0 ? "E" : "W"}`} />
          <Kv k="Area" v={formatArea(region.areaKm2)} />
          <Kv k="Climate band" v={region.climateZone} />
          <Kv k="Plate" v={region.plateName} />
          <Kv k="Spans equator" v={region.spansEquator ? "yes" : "no"} />
          <Kv k="Polar contact" v={region.touchesPole ? "yes" : "no"} />
          <Kv k="Hotspot" v={region.hotspot ? "yes" : "no"} />
          <Kv k="Region seed" v={region.regionSeed} mono />
        </div>
        {region.convergentEdges.length > 0 && (
          <div className="mt-2.5 border-t border-white/10 pt-2.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Convergence vectors → fold belt orientation</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {region.convergentEdges.map((e, i) => (
                <span key={i} className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  {((e.angle * 180) / Math.PI).toFixed(0)}° · {e.type} · {e.strength.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        )}
        {region.adjacentSeas.length > 0 && (
          <p className="mt-2 text-[11px] text-zinc-500">Washed by {region.adjacentSeas.join(", ")}</p>
        )}
      </div>

      {/* Size compartment prerequisites */}
      {(() => {
        const P = SIZE_PROFILES[region.sizeClass];
        return (
          <div className="rounded-xl border p-3.5" style={{ borderColor: `${P.color}40`, background: `${P.color}0d` }}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: P.color }}>
                <Ruler className="h-3.5 w-3.5" /> Size compartment · {P.label}
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                √A = {formatKm(region.linearScaleKm)} · blocks of {formatKm(P.compartmentKm)}
              </span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-300">{P.description}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:grid-cols-4">
              <Kv k="Fold belts" v={P.relief.ranges[1] === 0 ? "none · massif" : `${P.relief.ranges[0]}–${P.relief.ranges[1]}`} />
              <Kv k="Summit ceiling" v={`${P.relief.maxElevation.toLocaleString()} m`} />
              <Kv k="Max Strahler" v={String(P.hydro.maxStrahler)} />
              <Kv k="Lake radius" v={`≤ ${formatKm(P.hydro.lakeRadiusKm[1])}`} />
              <Kv k="Biome patch" v={`${formatKm(P.biome.radiusKm[0])}–${formatKm(P.biome.radiusKm[1])}`} />
              <Kv k="Volcano cap" v={`${P.volcano.hotspot} hotspot / ${P.volcano.subduction} arc`} />
              <Kv k="Tributary reach" v={`≤ ${formatKm(P.hydro.tributaryReachKm[1])}`} />
              <Kv k="Snap tolerance" v={formatKm(P.hydro.snapKm)} />
            </div>
          </div>
        );
      })()}

      {/* Region-Only Seed Input */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Region Seed (For {region.name} Only)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setRegionSeedInput(region.regionSeed)}
              className="text-[11px] text-zinc-400 transition hover:text-white"
            >
              Reset default
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={randomiseRegionSeed}
              className="flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-400/25"
            >
              <Sparkles className="h-3.5 w-3.5" /> Randomise Region Seed
            </button>
          </div>
        </div>
        <input
          value={regionSeedInput}
          disabled={busy}
          onChange={(e) => setRegionSeedInput(e.target.value)}
          placeholder={region.regionSeed}
          className="w-full rounded-lg border border-white/15 bg-slate-950/70 px-3.5 py-2 font-mono text-sm text-white outline-none transition focus:border-amber-400"
        />
        <p className="mt-1 text-[11px] text-zinc-400">
          Changing or randomising this seed regenerates mountains, rivers, lakes, and biomes on{" "}
          <strong className="text-zinc-200">{region.name}</strong> only — your planet and other region tabs are
          preserved.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Detail Level</label>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              disabled={busy}
              onClick={() => setLevel(l.id)}
              className={`flex flex-col rounded-xl border p-3 text-left transition ${
                level === l.id
                  ? "border-amber-400 bg-white/10 shadow-md ring-1 ring-amber-400/50"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
              }`}
            >
              <span className="text-sm font-medium text-white">{l.name}</span>
              <span className={`mt-0.5 font-mono text-[11px] ${l.color}`}>
                ~{Math.round(region.detailBudget * DETAIL_MULTIPLIER[l.id]).toLocaleString()} f
              </span>
              <span className="mt-1 text-[11px] text-zinc-500">{l.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-white/10 pt-4 md:grid-cols-2">
        <Slider label="River network density" value={riverDensity} min={0.3} max={2.5} step={0.1} unit="×" disabled={busy} onChange={setRivers} />
        <Slider label="Relief intensity" value={reliefIntensity} min={0.4} max={2} step={0.1} unit="×" disabled={busy} onChange={setRelief} />
        <Slider label="Atmospheric moisture" value={moisture} min={0.3} max={2} step={0.1} unit="×" disabled={busy} onChange={setMoisture} />
        <Slider label="Glaciation" value={glaciation} min={0} max={2} step={0.1} unit="×" disabled={busy} onChange={setGlaciation} />
      </div>

      {busy && progress && <Progress p={progress} />}
    </Shell>
  );
}

function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wide text-zinc-500">{k}</span>
      <span className={`block truncate capitalize text-zinc-200 ${mono ? "font-mono text-[10px] normal-case" : ""}`}>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adaptation log
// ---------------------------------------------------------------------------

const BADGES: Record<string, { label: string; cls: string; Icon: any }> = {
  orogeny: { label: "OROGENY", cls: "border-amber-500/40 bg-amber-500/20 text-amber-300", Icon: Mountain },
  rainshadow: { label: "RAIN SHADOW", cls: "border-yellow-500/40 bg-yellow-500/20 text-yellow-300", Icon: Sun },
  glaciation: { label: "GLACIATION", cls: "border-cyan-500/40 bg-cyan-500/20 text-cyan-300", Icon: Snowflake },
  drainage: { label: "DRAINAGE", cls: "border-sky-500/40 bg-sky-500/20 text-sky-300", Icon: Waves },
  cross: { label: "WATER GAP", cls: "border-violet-500/40 bg-violet-500/20 text-violet-300", Icon: Waves },
  contain: { label: "ACCRETION", cls: "border-emerald-500/40 bg-emerald-500/20 text-emerald-300", Icon: Activity },
  inherit: { label: "INHERIT", cls: "border-teal-500/40 bg-teal-500/20 text-teal-300", Icon: GitBranch },
  erode: { label: "EROSION", cls: "border-rose-500/40 bg-rose-500/20 text-rose-300", Icon: Activity },
  merge: { label: "MERGE", cls: "border-teal-500/40 bg-teal-500/20 text-teal-300", Icon: Activity },
  displace: { label: "DISPLACE", cls: "border-sky-500/40 bg-sky-500/20 text-sky-300", Icon: Activity },
  rift: { label: "RIFT", cls: "border-orange-500/40 bg-orange-500/20 text-orange-300", Icon: Activity },
  volcanism: { label: "VOLCANISM", cls: "border-red-500/40 bg-red-500/20 text-red-300", Icon: Activity },
  reshape: { label: "RESHAPE", cls: "border-lime-500/40 bg-lime-500/20 text-lime-300", Icon: Globe2 },
};

export function LogModal({
  open,
  onClose,
  logs,
}: {
  open: boolean;
  onClose: () => void;
  logs: ConflictRecord[];
}) {
  const [tier, setTier] = useState<"all" | 1 | 2>("all");
  const [q, setQ] = useState("");
  if (!open) return null;

  const list = logs.filter(
    (l) => (tier === "all" || l.tier === tier) && (!q || l.description.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <Shell
      title="Geological Adaptation Log"
      subtitle="How overlapping features were reconciled across both tiers"
      icon={<Activity className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="text-xs text-zinc-400">
            <strong className="text-white">{list.length}</strong> events
          </span>
          <button onClick={onClose} className="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/15">
            Close
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(
            [
              ["all", "All tiers"],
              [1, "Tier 1 · Planet"],
              [2, "Tier 2 · Region"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={String(id)}
              onClick={() => setTier(id as any)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tier === id ? "bg-teal-500 font-bold text-slate-950" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 outline-none focus:border-teal-400"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        {list.map((l, i) => {
          const b = BADGES[l.kind] ?? BADGES.merge;
          const Icon = b.Icon;
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20">
              <div className={`shrink-0 rounded-lg border p-2 ${b.cls}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.cls}`}>
                    {b.label}
                  </span>
                  <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    Tier {l.tier}
                  </span>
                  {l.relatedFeatureName && (
                    <span className="text-[11px] text-zinc-500">
                      → <strong className="text-zinc-300">{l.relatedFeatureName}</strong>
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-zinc-300">{l.description}</p>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="p-12 text-center text-xs text-zinc-500">No matching events.</div>}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Architecture note
// ---------------------------------------------------------------------------

export function ArchitectureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Shell
      title="Cascading Architecture"
      subtitle="Why block-wise generation beats one monolithic 100K pass"
      icon={<Cpu className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="text-xs text-zinc-400">TypeScript / V8 · no Python required</span>
          <button onClick={onClose} className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400">
            Got it
          </button>
        </>
      }
    >
      <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-3.5 text-xs leading-relaxed text-zinc-300">
        <span className="font-semibold text-rose-400">The problem with the flat approach.</span> Generating
        100K entities in one pass meant every one of them lived in memory, in one spatial index, and was
        candidate for every hover test and every repaint — even when you were looking at a single bay. Frame
        cost scaled with the whole planet instead of with what was on screen.
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Boxes className="h-4 w-4 text-teal-400" /> Two-tier cascade
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-teal-500/30 bg-teal-950/20 p-3">
            <span className="mb-1 block font-bold text-teal-400">Tier 1 · Planet (always resident)</span>
            <ul className="space-y-1 text-xs text-zinc-300">
              <li>• Tectonic plates, continents, island arcs</li>
              <li>• Ocean basins, trenches, polar caps</li>
              <li>• ~200–400 features · a few milliseconds</li>
              <li>• Publishes a <span className="font-mono">RegionDescriptor</span> per landmass</li>
            </ul>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
            <span className="mb-1 block font-bold text-amber-400">Tier 2 · Region (on demand, per tab)</span>
            <ul className="space-y-1 text-xs text-zinc-300">
              <li>• Fold belts oriented by inherited convergence vectors</li>
              <li>• Summits, volcanoes, plateaus, lakes</li>
              <li>• Full Strahler 1–5 dendritic drainage</li>
              <li>• Biomes from inherited latitude + rain shadow</li>
              <li>• 5K–90K features, but only for the open region</li>
            </ul>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <GitBranch className="h-4 w-4 text-teal-400" /> What actually cascades
        </h3>
        <div className="space-y-1.5 text-xs text-zinc-300">
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <strong className="text-teal-300">Deterministic child seeds.</strong>{" "}
            <span className="font-mono text-[11px]">regionSeed = planetSeed + "::" + regionId</span> — the same
            continent always regenerates identically, and two regions never interfere.
          </p>
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <strong className="text-teal-300">Physical inheritance.</strong> The lon/lat drives rainfall,
            temperature and snowline; plate convergence vectors set the strike and height of every fold belt;
            the Tier-1 outline becomes a rasterised land mask so nothing spawns in the sea.
          </p>
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <strong className="text-teal-300">Coast-distance flow field.</strong> Rivers march down the
            gradient of a distance transform computed from the inherited coastline, so they genuinely run from
            the interior to the shore, and dead-end basins become endorheic lakes.
          </p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Zap className="h-4 w-4 text-amber-400" /> Why it stays light
        </h3>
        <ul className="space-y-1 text-xs text-zinc-400">
          <li>• Each tab owns its own spatial grid sized to its own bounds — tight cells at every scale.</li>
          <li>• Frustum culling plus per-feature LOD means only what's on screen is ever drawn.</li>
          <li>• Regions are unloadable; closing or unloading frees their memory immediately.</li>
          <li>• Render loop is rAF-coalesced and DPR-capped at 2× for crisp but cheap output.</li>
        </ul>
      </div>
    </Shell>
  );
}
