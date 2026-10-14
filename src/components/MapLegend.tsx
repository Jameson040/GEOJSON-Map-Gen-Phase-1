import { useState } from "react";
import type { MapThemeId } from "../world/types";
import { MAP_THEMES } from "../world/themes";

/**
 * Cartographic legend: what every line style and marker shape on the map
 * means. Shown in region view; colours mirror `canvas-renderer.ts` exactly
 * (both the Modern Atlas and Fantasy Ink palettes).
 */

interface LegendLine {
  label: string;
  hint: string;
  color: string;
  width: number;
  dash?: string;
  /** Second stroke on top (used for the double-cased King's Highway). */
  spine?: { color: string; width: number };
}

interface LegendMarker {
  label: string;
  hint: string;
  shape: "square" | "diamond" | "circle" | "glyph";
  color: string;
  glyph?: string;
}

function routeLines(isInk: boolean): LegendLine[] {
  if (isInk) {
    return [
      {
        label: "King's Highway",
        hint: "Paved trunk road between cities & capitals",
        color: "rgba(78, 48, 24, 0.85)",
        width: 3.2,
        spine: { color: "rgba(245, 235, 215, 0.6)", width: 1.4 },
      },
      {
        label: "Market Arterial",
        hint: "Paved regional road, towns to cities",
        color: "rgba(92, 58, 28, 0.8)",
        width: 2.2,
      },
      {
        label: "Byway / Feeder Track",
        hint: "Unpaved rural track to villages & hamlets",
        color: "rgba(120, 78, 38, 0.7)",
        width: 2,
        dash: "4 4",
      },
      {
        label: "Mountain Pass Trail",
        hint: "Defended crossing over rugged crests",
        color: "rgba(146, 36, 24, 0.85)",
        width: 2,
        dash: "3 4",
      },
      {
        label: "Sea Lane",
        hint: "Maritime shipping channel between ports",
        color: "rgba(18, 98, 120, 0.65)",
        width: 2,
        dash: "4 6",
      },
    ];
  }
  return [
    {
      label: "King's Highway",
      hint: "Paved trunk road between cities & capitals",
      color: "#f59e0b",
      width: 3.2,
    },
    {
      label: "Market Arterial",
      hint: "Paved regional road, towns to cities",
      color: "#f97316",
      width: 2.4,
    },
    {
      label: "Byway / Feeder Track",
      hint: "Unpaved rural track to villages & hamlets",
      color: "#b45309",
      width: 2.2,
      dash: "5 4",
    },
    {
      label: "Mountain Pass Trail",
      hint: "High pass through mountain ranges",
      color: "#ef4444",
      width: 2.2,
      dash: "4 4",
    },
    {
      label: "Sea Lane",
      hint: "Maritime shipping channel between ports",
      color: "rgba(56, 189, 248, 0.75)",
      width: 2.2,
      dash: "4 6",
    },
  ];
}

function settlementMarkers(isInk: boolean): LegendMarker[] {
  if (isInk) {
    return [
      { label: "Capital / Metropolis", hint: "Fortified castle & keep", shape: "glyph", color: "#1a241f", glyph: "🏰" },
      { label: "City", hint: "Walled town with towers", shape: "glyph", color: "#1a241f", glyph: "🏛️" },
      { label: "Town / Village", hint: "Cluster of cottages", shape: "glyph", color: "#1a241f", glyph: "🏘️" },
    ];
  }
  return [
    { label: "Metropolis / Capital", hint: "Highest-order settlement", shape: "square", color: "#f43f5e" },
    { label: "City", hint: "Regional hub", shape: "square", color: "#f59e0b" },
    { label: "Town", hint: "Market town", shape: "diamond", color: "#38bdf8" },
    { label: "Village / Hamlet", hint: "Rural settlement", shape: "circle", color: "#a3e635" },
  ];
}

function LineSwatch({ line }: { line: LegendLine }) {
  return (
    <svg width="34" height="12" viewBox="0 0 34 12" className="shrink-0">
      <line x1="1" y1="6" x2="33" y2="6" stroke={line.color} strokeWidth={line.width} strokeLinecap="round" strokeDasharray={line.dash} />
      {line.spine && (
        <line x1="1" y1="6" x2="33" y2="6" stroke={line.spine.color} strokeWidth={line.spine.width} strokeLinecap="round" strokeDasharray={line.dash} />
      )}
    </svg>
  );
}

function MarkerSwatch({ m }: { m: LegendMarker }) {
  if (m.shape === "glyph") {
    return (
      <span className="inline-flex h-3 w-[34px] shrink-0 items-center justify-center text-[12px] leading-none">{m.glyph}</span>
    );
  }
  return (
    <svg width="34" height="12" viewBox="0 0 34 12" className="shrink-0">
      {m.shape === "square" && <rect x="13" y="2" width="8" height="8" fill={m.color} stroke="rgba(0,0,0,0.75)" strokeWidth="1" />}
      {m.shape === "diamond" && <polygon points="17,2 22,6 17,10 12,6" fill={m.color} stroke="rgba(0,0,0,0.75)" strokeWidth="1" />}
      {m.shape === "circle" && <circle cx="17" cy="6" r="4" fill={m.color} stroke="rgba(0,0,0,0.75)" strokeWidth="1" />}
    </svg>
  );
}

export function MapLegend({ themeId, raised }: { themeId: MapThemeId; raised?: boolean }) {
  const [open, setOpen] = useState(true);
  const isInk = !!MAP_THEMES[themeId].isFantasyInk;
  const lines = routeLines(isInk);
  const markers = settlementMarkers(isInk);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`absolute left-3 z-20 max-w-[15rem] ${raised ? "bottom-3 md:bottom-[7.4rem]" : "bottom-3"}`}
    >
      <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/85 text-[10.5px] shadow-xl backdrop-blur-md">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 font-semibold text-zinc-200 transition hover:bg-white/5"
          title="Toggle map legend"
        >
          <span>🗺️ Map Legend</span>
          <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>⌃</span>
        </button>
        {open && (
          <div className="border-t border-white/10 px-2.5 py-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Roads & Trade Routes</div>
            <ul className="space-y-1.5">
              {lines.map((l) => (
                <li key={l.label} className="flex items-center gap-2" title={l.hint}>
                  <LineSwatch line={l} />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight text-zinc-200">{l.label}</span>
                    <span className="block leading-tight text-zinc-500">{l.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mb-1 mt-2.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Settlements</div>
            <ul className="space-y-1.5">
              {markers.map((m) => (
                <li key={m.label} className="flex items-center gap-2" title={m.hint}>
                  <MarkerSwatch m={m} />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight text-zinc-200">{m.label}</span>
                    <span className="block leading-tight text-zinc-500">{m.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-white/10 pt-1.5 leading-snug text-zinc-500">
              Roads follow the terrain — they avoid peaks, keep to river valleys, and bridge rivers at the narrowest going.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
