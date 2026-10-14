import { useState } from "react";
import type { GeneratedRegion, LandSizeClass, PlanetMacro, RegionDescriptor } from "../world/types";
import {
  SIZE_CLASS_ORDER,
  SIZE_PROFILES,
  budgetFor,
  formatArea,
  formatKm,
  type SizeProfile,
} from "../world/size-classes";
import { X, Ruler, Mountain, Waves, Flame, TreePine, Boxes, ChevronRight, Ban, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  macro: PlanetMacro | null;
  detail: Map<string, GeneratedRegion>;
  onOpenRegion: (r: RegionDescriptor) => void;
}

export function SizeClassModal({ open, onClose, macro, detail, onOpenRegion }: Props) {
  const [sel, setSel] = useState<LandSizeClass>("small_island");
  if (!open || !macro) return null;

  const P = SIZE_PROFILES[sel];
  const members = macro.regions.filter((r) => r.sizeClass === sel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Land-Size Compartments</h2>
              <p className="text-xs text-zinc-400">
                Each landmass's area picks a size class, and the class sets every Tier-2 limit: scales, counts,
                drainage depth and verifier tolerances.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Class strip */}
        <div className="grid grid-cols-3 gap-2 border-b border-white/10 bg-slate-950/40 p-4 md:grid-cols-6">
          {SIZE_CLASS_ORDER.map((id) => {
            const p = SIZE_PROFILES[id];
            const n = macro.stats.sizeClassCounts[id] ?? 0;
            const active = id === sel;
            return (
              <button
                key={id}
                onClick={() => setSel(id)}
                className={`flex flex-col rounded-xl border p-2.5 text-left transition ${
                  active ? "border-white/40 bg-white/10 ring-1 ring-white/30" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="text-xs font-semibold text-white">{p.label}</span>
                </span>
                <span className="mt-1 font-mono text-[10px] text-zinc-400">
                  {p.minKm2 === 0 ? "<" : `${formatArea(p.minKm2)} –`} {Number.isFinite(p.maxKm2) ? formatArea(p.maxKm2) : "∞"}
                </span>
                <span className="mt-1 font-mono text-[11px] font-bold" style={{ color: p.color }}>
                  {n} on this planet
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 text-xs lg:grid-cols-[1fr_300px]">
          {/* Prerequisites */}
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: P.color }} />
                <span className="text-sm font-semibold text-white">{P.label}</span>
                <span className="text-[11px] text-zinc-500">{P.example}</span>
              </div>
              <p className="mt-1.5 leading-relaxed text-zinc-300">{P.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {P.requires.map((r) => (
                  <span key={r} className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> requires {r.replace("_", " ")}
                  </span>
                ))}
                {P.forbids.map((r) => (
                  <span key={r} className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">
                    <Ban className="h-3 w-3" /> forbids {r.replace("_", " ")}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Section icon={<Boxes className="h-3.5 w-3.5 text-amber-300" />} title="Budget & Processing">
                <Kv k="Feature budget" v={`${P.budget.min.toLocaleString()} – ${P.budget.max.toLocaleString()}`} />
                <Kv k="Density" v={`${P.budget.perKm2} / km²`} />
                <Kv k="Land-mask raster" v={`${P.maskResolution} cells`} />
                <Kv k="Compartment block" v={formatKm(P.compartmentKm)} />
                <Kv k="Coastal inlets" v={`≤ ${formatKm(P.coast.fjordKm)}`} />
              </Section>
              <Section icon={<Mountain className="h-3.5 w-3.5 text-amber-300" />} title="Relief">
                <Kv k="Fold belts" v={P.relief.ranges[1] === 0 ? "none (central massif)" : `${P.relief.ranges[0]} – ${P.relief.ranges[1]}`} />
                {P.relief.ranges[1] > 0 && (
                  <Kv k="Belt width" v={`${formatKm(P.relief.rangeWidthKm[0])} – ${formatKm(P.relief.rangeWidthKm[1])}`} />
                )}
                <Kv k="Summit ceiling" v={`${P.relief.maxElevation.toLocaleString()} m`} />
                <Kv k="Max summits" v={P.relief.maxPeaks.toLocaleString()} />
                <Kv k="Summit spacing" v={`≥ ${formatKm(P.relief.peakSpacingKm)}`} />
              </Section>
              <Section icon={<Waves className="h-3.5 w-3.5 text-sky-300" />} title="Hydrology">
                <Kv k="Max Strahler order" v={String(P.hydro.maxStrahler)} />
                <Kv k="Trunk rivers" v={`${P.hydro.trunks[0]} – ${P.hydro.trunks[1]} (1 per ${formatKm(P.hydro.trunkSpacingKm)})`} />
                <Kv k="Tributary reach" v={`${formatKm(P.hydro.tributaryReachKm[0])} – ${formatKm(P.hydro.tributaryReachKm[1])}`} />
                <Kv k="Lakes" v={`${P.hydro.lakes[0]} – ${P.hydro.lakes[1]}, r ≤ ${formatKm(P.hydro.lakeRadiusKm[1])}`} />
                <Kv k="Confluence snap" v={formatKm(P.hydro.snapKm)} />
              </Section>
              <Section icon={<Flame className="h-3.5 w-3.5 text-rose-300" />} title="Volcanism & Biomes">
                <Kv k="Hotspot / arc cap" v={`${P.volcano.hotspot} / ${P.volcano.subduction}`} />
                <Kv k="Collision / passive" v={`${P.volcano.collision} / ${P.volcano.passive}`} />
                <Kv k="Vent spacing" v={`≥ ${formatKm(P.volcano.spacingKm)}`} />
                <Kv k="Biome patches" v={`${P.biome.count[0]} – ${P.biome.count[1]}`} />
                <Kv k="Patch radius" v={`${formatKm(P.biome.radiusKm[0])} – ${formatKm(P.biome.radiusKm[1])}`} />
              </Section>
            </div>
          </div>

          {/* Members */}
          <div className="flex min-h-[16rem] flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/50">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white">
                <TreePine className="h-3.5 w-3.5 text-emerald-400" /> {P.label} landmasses
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{members.length}</span>
            </div>
            <div className="flex-1 divide-y divide-white/[0.05] overflow-y-auto">
              {members.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onOpenRegion(r);
                    onClose();
                  }}
                  className="group flex w-full items-center justify-between px-3 py-2 text-left transition hover:bg-white/[0.06]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${detail.has(r.id) ? "bg-emerald-400" : "bg-zinc-600"}`} />
                      <span className="truncate text-[11px] font-medium text-zinc-200 group-hover:text-teal-300">{r.name}</span>
                    </span>
                    <span className="block font-mono text-[10px] text-zinc-500">
                      {formatArea(r.areaKm2)} · √A {formatKm(r.linearScaleKm)} · ~{budgetFor(r.areaKm2, P).toLocaleString()} f
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-teal-400" />
                </button>
              ))}
              {members.length === 0 && (
                <div className="p-6 text-center text-[11px] text-zinc-500">No landmass of this size on this planet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
        {icon} {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-zinc-500">{k}</span>
      <span className="truncate text-right font-mono text-[11px] text-zinc-200">{v}</span>
    </div>
  );
}

/** Small colour-coded badge reused across the UI. */
export function SizeClassBadge({ cls, compact }: { cls: LandSizeClass; compact?: boolean }) {
  const p: SizeProfile = SIZE_PROFILES[cls];
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1 py-px text-[9px] font-semibold"
      style={{ borderColor: `${p.color}55`, background: `${p.color}1a`, color: p.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
      {compact ? p.short : p.label}
    </span>
  );
}
