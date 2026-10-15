import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { BBox, GeneratedRegion, MapFeature, MapThemeId, Pt, RegionCompartment, RegionDescriptor } from "../world/types";
import { MapRenderer, type Viewport, type RenderLayers, type BioOverlayItem, type ResourceOverlayItem, type HumanOverlayItem, type RouteOverlayItem } from "../world/canvas-renderer";
import type { BioFeature } from "../world/bio/bio-types";
import type { ResourceDepositNode } from "../world/resources/resource-types";
import { KIND_LABELS } from "../world/bio/species-catalog";
import type { Settlement } from "../world/human/human-types";
import type { ZonePopulation } from "../world/population/population-types";
import type { RouteFeature } from "../world/routes/route-types";
import { SETTLEMENT_BY_TYPE, TIER_COLORS, TIER_LABELS, TIER_RANK } from "../world/human/settlement-catalog";
import { SpatialGrid } from "../world/spatial-index";
import { MAP_THEMES, FEATURE_LABELS } from "../world/themes";
import { formatLatLon, PLANET_WIDTH, wrapWorldX } from "../world/constants";
import { ZoomIn, ZoomOut, Maximize2, Crosshair, Gauge, Layers } from "lucide-react";
import type { CadastreConfig, SettlementCadastre } from "../world/cadastre/cadastre-types";
import { getCadastreForSettlement } from "../world/cadastre/cadastre-cache";
import { MapLegend } from "./MapLegend";

function geographicFeatureVisible(f: MapFeature, layers: RenderLayers): boolean {
  switch (f.properties.featureType) {
    case "continent": case "island": case "coastline": case "ice_cap": return layers.landmasses;
    case "sea": return layers.seas;
    case "trench": case "plate_boundary": return layers.tectonics;
    case "mountain_range": case "plateau": return layers.relief;
    case "mountain": return layers.peaks;
    case "volcano": return layers.volcanoes;
    case "river": return layers.rivers;
    case "lake": return layers.lakes;
    default: return layers.biomes;
  }
}

interface Props {
  grid: SpatialGrid;
  bounds: BBox;
  themeId: MapThemeId;
  layers: RenderLayers;
  mode: "planet" | "region";
  selected: MapFeature | null;
  onSelect: (f: MapFeature | null) => void;
  focusTarget: { bbox: BBox; nonce: number } | null;
  /** Planet mode only */
  regions?: RegionDescriptor[];
  detailedRegionIds?: Set<string>;
  activeRegionId?: string | null;
  onOpenRegion?: (r: RegionDescriptor) => void;
  minimapFeatures?: MapFeature[];
  compartments?: RegionCompartment[];
  /** Layer 1 regional detail (for JIT cadastre generation) */
  region?: GeneratedRegion;
  /** Layer 3 (biosphere) overlay — read-only, drawn above geography. */
  bio?: { items: { feature: BioFeature; color: string }[]; visible: boolean };
  /** Layer 2 (geological mineral deposits) overlay */
  resources?: { items: ResourceDepositNode[]; visible: boolean };
  /** Layer 4 (settlements) overlay — read-only, drawn above the biosphere. */
  human?: { items: Settlement[]; visible: boolean };
  /** Layer 5 (population) data — attaches occupancy & era data to settlements. */
  population?: { model: Map<string, ZonePopulation>; visible: boolean; era?: string };
  /** Layer 6 (trade routes & roads) overlay — connecting settlements across terrain */
  routes?: { items: RouteFeature[]; visible: boolean };
  /** Layer 7 (cadastre) overlay — street networks, parcels, and pitched roofs */
  cadastre?: { visible: boolean; config?: CadastreConfig };
  onRenderError?: (error: unknown) => void;
}

export function MapViewer({
  grid,
  bounds,
  themeId,
  layers,
  mode,
  selected,
  onSelect,
  focusTarget,
  regions,
  detailedRegionIds,
  activeRegionId,
  onOpenRegion,
  minimapFeatures,
  compartments,
  region,
  bio,
  resources,
  human,
  population,
  routes,
  cadastre,
  onRenderError,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestDraw = useRef<() => void>(() => {});
  const renderErrorReported = useRef(false);
  const dragRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({
    active: false,
    x: 0,
    y: 0,
    moved: false,
  });

  const centre = useMemo<Viewport>(
    () => ({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom: 1 }),
    [bounds]
  );

  const [vp, setVp] = useState<Viewport>(centre);
  const [focusFilter, setFocusFilter] = useState<"all" | "geo" | "bio" | "human">("all");
  const [hovered, setHovered] = useState<MapFeature | null>(null);
  const [hoveredBio, setHoveredBio] = useState<BioFeature | null>(null);
  const [hoveredHuman, setHoveredHuman] = useState<Settlement | null>(null);
  const [hoverRegion, setHoverRegion] = useState<RegionDescriptor | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [perf, setPerf] = useState({ drawn: 0, ms: 0 });

  useEffect(() => setVp(centre), [centre]);

  useEffect(() => { renderErrorReported.current = false; }, [grid, themeId]);

  useEffect(() => {
    if (!bio?.visible || focusFilter === "geo" || focusFilter === "human") setHoveredBio(null);
    if (!human?.visible || focusFilter === "geo" || focusFilter === "bio") setHoveredHuman(null);
  }, [bio?.visible, human?.visible, focusFilter]);

  useEffect(() => {
    setHovered((f) => f && !geographicFeatureVisible(f, layers) ? null : f);
  }, [layers]);

  // Layer 3 overlay, precomputed for the renderer (read-only view of bio data)
  const bioOverlay = useMemo<BioOverlayItem[] | undefined>(() => {
    if (focusFilter === "geo" || focusFilter === "human") return undefined;
    if (!bio?.visible || !bio.items.length) return undefined;
    return bio.items.map(({ feature, color }) => ({
      x: feature.point[0],
      y: feature.point[1],
      rUnits: feature.radiusUnits,
      color,
      glyph: feature.glyph,
      lod: feature.lodZoom,
      abundance: feature.abundance,
    }));
  }, [bio, focusFilter]);

  const resourceOverlay = useMemo<ResourceOverlayItem[] | undefined>(() => {
    if (focusFilter === "geo" || focusFilter === "human") return undefined;
    if (!resources?.visible || !resources.items.length) return undefined;
    return resources.items.map((res) => ({
      x: res.point[0],
      y: res.point[1],
      glyph: res.glyph,
      name: res.name,
      category: res.category,
      color: res.category === "fantasy_mineral" ? "#c084fc" : res.category === "metal_ore" ? "#f59e0b" : "#e2e8f0",
      abundance: res.abundance,
      lod: 1.0,
    }));
  }, [resources, focusFilter]);

  const humanOverlay = useMemo<HumanOverlayItem[] | undefined>(() => {
    if (focusFilter === "geo" || focusFilter === "bio") return undefined;
    if (!human?.visible || !human.items.length) return undefined;
    return human.items.map((s) => ({
      x: s.point[0],
      y: s.point[1],
      glyph: s.glyph,
      color: TIER_COLORS[s.tier],
      rank: TIER_RANK[s.tier],
      name: s.name,
      lod: s.lodZoom,
      tier: s.tier,
      type: s.type,
    }));
  }, [human, focusFilter]);

  const routeOverlay = useMemo<RouteOverlayItem[] | undefined>(() => {
    if (focusFilter === "geo" || focusFilter === "bio") return undefined;
    if (!routes?.visible || !routes.items.length) return undefined;
    return routes.items.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      points: r.points,
      lengthKm: r.lengthKm,
      paved: r.paved,
      bridgesCount: r.bridgesCount,
      tradeGoods: r.tradeGoods,
      lodZoom: r.lodZoom,
    }));
  }, [routes, focusFilter]);

  // ---- setup & resize -----------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new MapRenderer(canvasRef.current);
    let previousSize = "";
    const onResize = () => {
      if (!wrapRef.current || !rendererRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const size = `${r.width}:${r.height}:${window.devicePixelRatio}`;
      if (size === previousSize) return;
      previousSize = size;
      rendererRef.current.resize(r.width, r.height);
      latestDraw.current();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- draw (rAF-coalesced) ----------------------------------------------
  const draw = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const r = rendererRef.current;
      if (!r) return;
      try {
      const theme = MAP_THEMES[themeId] ?? MAP_THEMES.atlas;
      const view = r.visibleBBox(vp, bounds);
      let visible: MapFeature[];
      if (mode !== "planet") {
        visible = grid.query(view, vp.zoom);
      } else {
        // The planet is cylindrical: split an off-edge viewport into wrapped
        // longitude intervals and deduplicate their spatial-index results.
        const span = view.maxX - view.minX;
        const byId = new Map<string, MapFeature>();
        if (span >= PLANET_WIDTH) {
          for (const f of grid.query(bounds, vp.zoom)) byId.set(f.id, f);
        } else {
          const k0 = Math.floor(view.minX / PLANET_WIDTH);
          const k1 = Math.floor(view.maxX / PLANET_WIDTH);
          for (let k = k0; k <= k1; k++) {
            const minX = Math.max(0, view.minX - k * PLANET_WIDTH);
            const maxX = Math.min(PLANET_WIDTH, view.maxX - k * PLANET_WIDTH);
            if (minX > maxX) continue;
            for (const f of grid.query({ minX, maxX, minY: view.minY, maxY: view.maxY }, vp.zoom)) {
              byId.set(f.id, f);
            }
          }
        }
        visible = [...byId.values()];
      }
      const activeRegName = mode === "region" && activeRegionId && regions
        ? regions.find((reg) => reg.id === activeRegionId)?.name
        : undefined;
      const worldTitle = activeRegName
        ? (activeRegName.startsWith("The ") ? activeRegName : activeRegName)
        : "Great Gidding";

      let visibleCadastres: SettlementCadastre[] | undefined;
      if (mode === "region" && region && human?.items && (cadastre?.visible ?? true) && vp.zoom >= 20) {
        const padX = (view.maxX - view.minX) * 0.15;
        const padY = (view.maxY - view.minY) * 0.15;
        const inside = human.items.filter(
          (st) =>
            st.point[0] >= view.minX - padX &&
            st.point[0] <= view.maxX + padX &&
            st.point[1] >= view.minY - padY &&
            st.point[1] <= view.maxY + padY
        );
        if (inside.length > 0) {
          visibleCadastres = inside.map((st) =>
            getCadastreForSettlement(region, st, population?.model?.get(st.id), cadastre?.config)
          );
        }
      }

      const report = r.render({
        features: visible,
        viewport: vp,
        theme,
        layers,
        bounds,
        selected,
        hovered,
        regions,
        detailedRegionIds,
        activeRegionId,
        compartments,
        mode,
        bioOverlay,
        resourceOverlay,
        routeOverlay,
        humanOverlay,
        cadastres: visibleCadastres,
        worldTitle,
      });
      setPerf({ drawn: report.drawn, ms: Math.round(report.ms * 10) / 10 });
      } catch (error) {
        if (!renderErrorReported.current) {
          renderErrorReported.current = true;
          onRenderError?.(error);
        }
      }
    });
  }, [vp, bounds, grid, themeId, layers, selected, hovered, regions, detailedRegionIds, activeRegionId, compartments, mode, bioOverlay, resourceOverlay, routeOverlay, humanOverlay, region, human, routes, cadastre, population, onRenderError]);

  useEffect(() => {
    latestDraw.current = draw;
    draw();
  }, [draw]);

  // ---- focus / fly-to -----------------------------------------------------
  useEffect(() => {
    if (!focusTarget || !rendererRef.current) return;
    const b = focusTarget.bbox;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    const tw = Math.max(bw * 0.004, b.maxX - b.minX);
    const th = Math.max(bh * 0.004, b.maxY - b.minY);
    const z = Math.min(60, Math.max(1, Math.min(bw / tw, bh / th) * 0.55));
    setVp({ x: cx, y: cy, zoom: z });
  }, [focusTarget, bounds]);

  // ---- interaction --------------------------------------------------------
  const localPoint = (e: React.MouseEvent): Pt | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { active: true, x: e.clientX, y: e.clientY, moved: false };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    const sp = localPoint(e);
    if (!r || !sp) return;
    const world = r.screenToWorld(sp, vp, bounds);
    const wp: Pt = mode === "planet" ? [wrapWorldX(world[0]), world[1]] : world;
    setCursor(wp);

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      const s = r.scaleFor(vp, bounds);
      setVp((p) => ({
        ...p,
        x: mode === "planet" ? wrapWorldX(p.x - dx / s) : p.x - dx / s,
        y: p.y - dy / s,
      }));
      return;
    }

    const s = r.scaleFor(vp, bounds);

    // Layer 4 hover has top priority (settlements sit on top of everything).
    if (human?.visible && human.items.length) {
      let best: Settlement | null = null;
      let bestD = 16 / s;
      for (const st of human.items) {
        if (vp.zoom < st.lodZoom) continue;
        const d = Math.hypot(st.point[0] - wp[0], st.point[1] - wp[1]);
        if (d < bestD) {
          bestD = d;
          best = st;
        }
      }
      if (best) {
        setHoveredHuman(best);
        setHoveredBio(null);
        setHovered(null);
        setHoverRegion(null);
        return;
      }
      setHoveredHuman(null);
    }

    // Layer 3 hover takes precedence when the biosphere overlay is visible.
    if (bio?.visible && bio.items.length) {
      let bestBio: BioFeature | null = null;
      let bestD = Infinity;
      for (const { feature } of bio.items) {
        if (vp.zoom < feature.lodZoom) continue;
        const dx = feature.point[0] - wp[0];
        const dy = feature.point[1] - wp[1];
        const d = Math.hypot(dx, dy);
        const reach = Math.max(feature.radiusUnits, 14 / s);
        if (d <= reach && d < bestD) {
          bestD = d;
          bestBio = feature;
        }
      }
      if (bestBio) {
        setHoveredBio(bestBio);
        setHovered(null);
        setHoverRegion(null);
        return;
      }
      setHoveredBio(null);
    }

    const picked = grid.pick(wp, 14 / s, vp.zoom);
    const hit = picked && geographicFeatureVisible(picked, layers) ? picked : null;
    setHovered(hit);

    if (mode === "planet" && regions) {
      const reg =
        hit && (hit.properties.featureType === "continent" || hit.properties.featureType === "island")
          ? regions.find((x) => x.id === hit.id) ?? null
          : null;
      setHoverRegion(reg);
    }
  };

  const onMouseUp = () => {
    dragRef.current.active = false;
  };

  const onClick = () => {
    if (dragRef.current.moved) return;
    onSelect(hovered);
  };

  const onDoubleClick = () => {
    if (mode === "planet" && hoverRegion && onOpenRegion) onOpenRegion(hoverRegion);
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = rendererRef.current;
    const sp = localPoint(e as unknown as React.MouseEvent);
    if (!r || !sp) return;
    const anchor = r.screenToWorld(sp, vp, bounds);
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const maxZoom = mode === "planet" ? 80 : 25000;
    const minZoom = mode === "planet" ? 1 : 0.8;
    const zoom = Math.max(minZoom, Math.min(maxZoom, vp.zoom * factor));
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    const ns = Math.min(r.cssWidth / bw, r.cssHeight / bh) * zoom;
    setVp({
      x:
        mode === "planet"
          ? wrapWorldX(anchor[0] - (sp[0] - r.cssWidth / 2) / ns)
          : anchor[0] - (sp[0] - r.cssWidth / 2) / ns,
      y: anchor[1] - (sp[1] - r.cssHeight / 2) / ns,
      zoom,
    });
  };

  const zoomBy = (f: number) =>
    setVp((p) => ({
      ...p,
      zoom: Math.max(mode === "planet" ? 1 : 0.8, Math.min(mode === "planet" ? 80 : 25000, p.zoom * f)),
    }));
  const reset = () => setVp(centre);

  // ---- minimap ------------------------------------------------------------
  const minimap = useMemo(() => {
    const src = minimapFeatures ?? [];
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    return src.slice(0, 200).map((f) => {
      const ring = (f.geometry.coordinates?.[0] ?? []) as Pt[];
      const step = Math.max(1, Math.floor(ring.length / 70));
      const pts: string[] = [];
      for (let i = 0; i < ring.length; i += step) {
        pts.push(
          `${(((ring[i][0] - bounds.minX) / bw) * 100).toFixed(2)},${(((ring[i][1] - bounds.minY) / bh) * 100).toFixed(2)}`
        );
      }
      return { id: f.id, points: pts.join(" ") };
    });
  }, [minimapFeatures, bounds]);

  const viewRect = useMemo(() => {
    const r = rendererRef.current;
    if (!r) return null;
    const v = r.visibleBBox(vp, bounds);
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const left = ((v.minX - bounds.minX) / bw) * 100;
    const top = ((v.minY - bounds.minY) / bh) * 100;
    return {
      left: Math.max(0, Math.min(100, left)),
      top: Math.max(0, Math.min(100, top)),
      width: Math.max(0, Math.min(100 - Math.max(0, left), ((v.maxX - v.minX) / bw) * 100)),
      height: Math.max(0, Math.min(100 - Math.max(0, top), ((v.maxY - v.minY) / bh) * 100)),
    };
  }, [vp, bounds]);

  const theme = MAP_THEMES[themeId] ?? MAP_THEMES.atlas;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden select-none cursor-grab active:cursor-grabbing"
      style={{ background: theme.ocean }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        onMouseUp();
        setHovered(null);
        setHoveredBio(null);
        setHoveredHuman(null);
        setHoverRegion(null);
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* Quick layer focus filter pills (Declutters screen on demand) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/85 p-1 text-[11px] font-medium shadow-xl backdrop-blur-md"
      >
        <button
          onClick={() => setFocusFilter("all")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            focusFilter === "all" ? "bg-teal-500 font-bold text-slate-950 shadow" : "text-zinc-400 hover:text-white"
          }`}
          title="Show all active world layers"
        >
          <Layers className="h-3 w-3" /> All
        </button>
        <button
          onClick={() => setFocusFilter("geo")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            focusFilter === "geo" ? "bg-teal-400 font-bold text-slate-950 shadow" : "text-zinc-400 hover:text-white"
          }`}
          title="Focus on physical terrain, rivers, peaks and biomes"
        >
          🗺️ Geo
        </button>
        <button
          onClick={() => setFocusFilter("bio")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            focusFilter === "bio" ? "bg-lime-400 font-bold text-slate-950 shadow" : "text-zinc-400 hover:text-white"
          }`}
          title="Focus on flora and fauna populations"
        >
          🌿 Bio
        </button>
        <button
          onClick={() => setFocusFilter("human")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            focusFilter === "human" ? "bg-orange-400 font-bold text-slate-950 shadow" : "text-zinc-400 hover:text-white"
          }`}
          title="Focus on settlements, habitable zones and population"
        >
          🏘️ Civ
        </button>
      </div>

      {/* zoom controls */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute right-3 top-3 z-20 flex flex-col gap-1 rounded-lg border border-white/10 bg-slate-900/80 p-1 shadow-xl backdrop-blur-md"
      >
        <button onClick={() => zoomBy(1.4)} title="Zoom in" className="rounded-md p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Zoom out" className="rounded-md p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={reset} title="Fit extent" className="rounded-md p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white">
          <Maximize2 className="h-4 w-4" />
        </button>
        {mode === "region" && (
          <>
            <span className="my-0.5 h-px w-full bg-white/10" />
            <button
              onClick={() => zoomBy(vp.zoom < 20 ? 25 / vp.zoom : 1)}
              title="District scale (25x)"
              className={`rounded px-1 py-0.5 font-mono text-[9px] font-semibold transition ${
                vp.zoom >= 20 && vp.zoom < 90 ? "bg-teal-500/30 text-teal-200" : "text-zinc-400 hover:text-white"
              }`}
            >
              25×
            </button>
            <button
              onClick={() => zoomBy(vp.zoom < 90 ? 120 / vp.zoom : 1)}
              title="Town street scale (120x)"
              className={`rounded px-1 py-0.5 font-mono text-[9px] font-semibold transition ${
                vp.zoom >= 90 && vp.zoom < 300 ? "bg-amber-500/30 text-amber-200" : "text-zinc-400 hover:text-white"
              }`}
            >
              120×
            </button>
            <button
              onClick={() => zoomBy(vp.zoom < 300 ? 450 / vp.zoom : 1)}
              title="Village roof view (450x)"
              className={`rounded px-1 py-0.5 font-mono text-[9px] font-semibold transition ${
                vp.zoom >= 300 ? "bg-purple-500/30 text-purple-200" : "text-zinc-400 hover:text-white"
              }`}
            >
              450×
            </button>
          </>
        )}
      </div>

      {/* legend */}
      {mode === "region" && (routes?.visible || human?.visible) && (
        <MapLegend themeId={themeId} raised={minimap.length > 0} />
      )}

      {/* minimap */}
      {minimap.length > 0 && (
        <div className="absolute bottom-3 left-3 z-20 hidden md:block">
          <div className="relative h-24 w-48 overflow-hidden rounded-lg border border-white/15 bg-slate-950/85 p-1 shadow-2xl backdrop-blur-md">
            <div className="relative h-full w-full overflow-hidden rounded bg-slate-900/60">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                {minimap.map((m) => (
                  <polygon key={m.id} points={m.points} fill="#2dd4bf" opacity={0.42} />
                ))}
              </svg>
              {viewRect && (
                <div
                  className="pointer-events-none absolute rounded-sm border-2 border-amber-400 bg-amber-400/15"
                  style={{
                    left: `${viewRect.left}%`,
                    top: `${viewRect.top}%`,
                    width: `${viewRect.width}%`,
                    height: `${viewRect.height}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* HUD */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-3 rounded-md border border-white/10 bg-slate-900/80 px-2.5 py-1.5 font-mono text-[10px] text-zinc-300 backdrop-blur-md">
        <span className="flex items-center gap-1">
          <Crosshair className="h-3 w-3 text-teal-400" />
          {cursor ? formatLatLon(cursor[0], cursor[1]) : "—"}
        </span>
        <span className="h-3 w-px bg-white/15" />
        <span>{vp.zoom.toFixed(1)}×</span>
        {vp.zoom >= 30 && (
          <>
            <span className="h-3 w-px bg-white/15" />
            <span className="font-semibold text-purple-300">
              🏛️ {vp.zoom >= 200 ? "Cottage Roofs" : "Cadastre"}
            </span>
          </>
        )}
        <span className="h-3 w-px bg-white/15" />
        <span className="flex items-center gap-1" title="Features drawn this frame / frame time">
          <Gauge className="h-3 w-3 text-emerald-400" />
          {perf.drawn.toLocaleString()} @ {perf.ms}ms
        </span>
      </div>

      {/* Layer 4 hover card */}
      {hoveredHuman && (
        <div className="pointer-events-auto absolute left-3 top-14 z-30 max-w-xs rounded-lg border border-orange-500/40 bg-slate-950/92 px-3 py-2 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{hoveredHuman.glyph}</span>
            <span className="text-sm font-semibold text-white">{hoveredHuman.name}</span>
            <span
              className="rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ borderColor: `${TIER_COLORS[hoveredHuman.tier]}66`, background: `${TIER_COLORS[hoveredHuman.tier]}22`, color: TIER_COLORS[hoveredHuman.tier] }}
            >
              {TIER_LABELS[hoveredHuman.tier]}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-zinc-400">
            <div>
              {SETTLEMENT_BY_TYPE.get(hoveredHuman.type)?.name} · capacity{" "}
              <span className="font-mono text-zinc-200">{hoveredHuman.popCap.toLocaleString()}</span> · habitation{" "}
              <span className="font-mono text-zinc-200">
                {hoveredHuman.habitation === "lived_now"
                  ? "lived now"
                  : hoveredHuman.habitation === "ancient_pulse"
                  ? "ancient (ruin)"
                  : "potential"}
              </span>
            </div>
            {hoveredHuman.waterSource && <div>Water <span className="text-zinc-200">{hoveredHuman.waterSource}</span></div>}
            {hoveredHuman.resourceRoles.length > 0 && (
              <div>Nearby resources <span className="text-zinc-200">{hoveredHuman.resourceRoles.slice(0, 4).join(", ")}</span></div>
            )}
            <div className="text-zinc-500 italic">{hoveredHuman.origin}</div>
          </div>
          {/* Layer 5 population enhancement when active */}
          {(() => {
            const zpop = population?.model?.get(hoveredHuman.id);
            if (!zpop) {
              return (
                <div className="mt-1.5 rounded border border-orange-400/25 bg-orange-400/10 px-1.5 py-1 text-[10px] text-orange-200/80">
                  Layer 4 · Habitable zone — structure only.
                </div>
              );
            }
            return (
              <div className="mt-1.5 space-y-0.5 rounded border border-sky-400/30 bg-sky-950/40 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-sky-200 font-semibold">
                  <span>👥 {zpop.occupancy.toLocaleString()} inhabitants</span>
                  <span className="text-zinc-400">({Math.round((zpop.usagePercent ?? 0) * 100)}% cap)</span>
                </div>
                <div className="text-zinc-400">
                  Density: {zpop.densityPerKm2.toFixed(1)}/km² · {population?.era ? population.era.replace(/_/g, " ") : "contemporary"}
                </div>
                {zpop.foodShortage && (
                  <div className="font-medium text-amber-300">⚠️ Local food shortage</div>
                )}
              </div>
            );
          })()}

          {/* Quick jump to roof level view */}
          <button
            onClick={() => {
              setVp({ x: hoveredHuman.point[0], y: hoveredHuman.point[1], zoom: 450 });
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-purple-500/40 bg-purple-500/20 px-2 py-1 font-mono text-[10px] font-semibold text-purple-200 transition hover:bg-purple-500/35"
          >
            🏛️ Zoom to Roofs (450×)
          </button>
        </div>
      )}

      {/* Layer 3 hover card */}
      {hoveredBio && !hovered && !hoveredHuman && (
        <div className="pointer-events-none absolute left-3 top-14 z-30 max-w-xs rounded-lg border border-lime-500/40 bg-slate-950/92 px-3 py-2 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{hoveredBio.glyph}</span>
            <span className="text-sm font-semibold text-white">{hoveredBio.name}</span>
            <span className="rounded border border-lime-500/30 bg-lime-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-lime-300">
              {KIND_LABELS[hoveredBio.kind]}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-zinc-400">
            <div>
              Roles <span className="font-mono text-zinc-200">{hoveredBio.roles.join(", ")}</span>
            </div>
            <div>
              Abundance{" "}
              <span className="font-mono text-zinc-200">
                {hoveredBio.abundance === 3 ? "abundant" : hoveredBio.abundance === 2 ? "common" : "sparse"}
              </span>
              {hoveredBio.irrigated && <span className="ml-1 text-sky-300">· irrigated</span>}
            </div>
            <div className="text-zinc-500 italic">{hoveredBio.origin}</div>
          </div>
          <div className="mt-1.5 rounded border border-lime-400/25 bg-lime-400/10 px-1.5 py-1 text-[10px] text-lime-200/80">
            Layer 3 · Biosphere — overlays the frozen geography
          </div>
        </div>
      )}

      {/* hover card */}
      {hovered && (
        <div className="pointer-events-none absolute left-3 top-14 z-30 max-w-xs rounded-lg border border-teal-500/40 bg-slate-950/92 px-3 py-2 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{hovered.properties.name}</span>
            <span className="rounded border border-teal-500/30 bg-teal-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-300">
              {FEATURE_LABELS[hovered.properties.featureType]}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-zinc-400">
            {hovered.properties.elevation !== undefined && (
              <div>Elevation <span className="font-mono text-zinc-200">{hovered.properties.elevation.toLocaleString()} m</span></div>
            )}
            {hovered.properties.depth !== undefined && (
              <div>Depth <span className="font-mono text-zinc-200">{hovered.properties.depth.toLocaleString()} m</span></div>
            )}
            {hovered.properties.lengthKm !== undefined && (
              <div>
                Length <span className="font-mono text-zinc-200">{hovered.properties.lengthKm.toLocaleString()} km</span>
                {hovered.properties.strahlerOrder !== undefined && (
                  <span className="text-zinc-500"> · order {hovered.properties.strahlerOrder}</span>
                )}
              </div>
            )}
            {hovered.properties.areaKm2 !== undefined && (
              <div>Area <span className="font-mono text-zinc-200">{hovered.properties.areaKm2.toLocaleString()} km²</span></div>
            )}
          </div>
          {hoverRegion && (
            <div className="mt-1.5 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-1 text-[10px] font-semibold text-amber-300">
              {detailedRegionIds?.has(hoverRegion.id)
                ? "Detail generated — double-click to open its tab"
                : "Double-click to generate Tier-2 detail in a new tab"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
