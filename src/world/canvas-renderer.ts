import type { BBox, MapFeature, Pt, RegionCompartment, RegionDescriptor } from "./types";
import type { ThemeColors } from "./themes";
import { biomeColor } from "./themes";
import { PLANET_WIDTH, PLANET_HEIGHT, KM_PER_UNIT } from "./constants";
import {
  drawCoastalEchoRipples,
  drawArtisticMountainRange,
  drawArtisticPeak,
  drawArtisticForestGroves,
  drawArtisticSettlementIcon,
  drawIlluminatedScrollBanner,
  drawArtisticOceanTitles,
  drawArtisticTitleCartouche,
} from "./artistic-cartography";
import type { SettlementCadastre } from "./cadastre/cadastre-types";
import { drawSettlementCadastre } from "./cadastre/cadastre-renderer";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderLayers {
  landmasses: boolean;
  seas: boolean;
  tectonics: boolean;
  relief: boolean;
  peaks: boolean;
  volcanoes: boolean;
  rivers: boolean;
  lakes: boolean;
  biomes: boolean;
  routes?: boolean;
  graticule: boolean;
  labels: boolean;
  regionOverlay: boolean;
  compartments: boolean;
}

export const DEFAULT_LAYERS: RenderLayers = {
  landmasses: true,
  seas: true,
  tectonics: false,
  relief: true,
  peaks: true,
  volcanoes: true,
  rivers: true,
  lakes: true,
  biomes: true,
  routes: true,
  graticule: true,
  labels: true,
  regionOverlay: true,
  compartments: false,
};

export interface RenderInput {
  features: MapFeature[];
  viewport: Viewport;
  theme: ThemeColors;
  layers: RenderLayers;
  /** World-space extent the camera fits at zoom = 1. */
  bounds: BBox;
  selected: MapFeature | null;
  hovered: MapFeature | null;
  /** Tier-1 only: outlines of regions, highlighted for "open as tab". */
  regions?: RegionDescriptor[];
  detailedRegionIds?: Set<string>;
  activeRegionId?: string | null;
  /** Tier-2 only: processing blocks of the active region. */
  compartments?: RegionCompartment[];
  mode: "planet" | "region";
  /** Layer 3 (biosphere) overlay — additive, drawn above geography. */
  bioOverlay?: BioOverlayItem[];
  /** Layer 2 (geological wealth & fantasy minerals) overlay */
  resourceOverlay?: ResourceOverlayItem[];
  /** Layer 6 (routes & trade networks) overlay — veins connecting settlements */
  routeOverlay?: RouteOverlayItem[];
  /** Layer 4 (settlements) overlay — additive, drawn above the biosphere. */
  humanOverlay?: HumanOverlayItem[];
  /** Layer 7 (cadastre) — streets, parcels, and pitched roofs (Google Earth Fantasy Lite) */
  cadastres?: SettlementCadastre[];
  /** World title for decorative cartouche (e.g. "Great Gidding") */
  worldTitle?: string;
  showChrome?: boolean;
}

export interface RouteOverlayItem {
  id: string;
  name: string;
  type: string;
  points: Pt[];
  lengthKm: number;
  paved: boolean;
  bridgesCount: number;
  tradeGoods: string[];
  lodZoom: number;
}

export interface ResourceOverlayItem {
  x: number;
  y: number;
  glyph: string;
  name: string;
  category: string;
  color: string;
  abundance: number;
  lod: number;
}

export interface HumanOverlayItem {
  x: number;
  y: number;
  glyph: string;
  color: string;
  /** 0 nomadic … 5 metropolis */
  rank: number;
  name: string;
  lod: number;
  tier?: string;
  type?: string;
}

/** Minimal draw contract for Layer-3 populations (keeps layers decoupled). */
export interface BioOverlayItem {
  x: number;
  y: number;
  rUnits: number;
  color: string;
  glyph: string;
  lod: number;
  abundance: number;
}

export interface RenderReport {
  drawn: number;
  ms: number;
}

export class MapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  resize(w: number, h: number) {
    // Cap DPR at 2 — beyond that the pixel cost outweighs the visible gain.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  get cssWidth() {
    return this.canvas.width / this.dpr;
  }
  get cssHeight() {
    return this.canvas.height / this.dpr;
  }

  private baseScale(bounds: BBox) {
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    return Math.min(this.cssWidth / bw, this.cssHeight / bh);
  }

  scaleFor(vp: Viewport, bounds: BBox) {
    return this.baseScale(bounds) * vp.zoom;
  }

  worldToScreen(p: Pt, vp: Viewport, bounds: BBox): Pt {
    const s = this.scaleFor(vp, bounds);
    return [this.cssWidth / 2 + (p[0] - vp.x) * s, this.cssHeight / 2 + (p[1] - vp.y) * s];
  }

  screenToWorld(p: Pt, vp: Viewport, bounds: BBox): Pt {
    const s = this.scaleFor(vp, bounds);
    return [vp.x + (p[0] - this.cssWidth / 2) / s, vp.y + (p[1] - this.cssHeight / 2) / s];
  }

  visibleBBox(vp: Viewport, bounds: BBox): BBox {
    const tl = this.screenToWorld([0, 0], vp, bounds);
    const br = this.screenToWorld([this.cssWidth, this.cssHeight], vp, bounds);
    return { minX: tl[0], minY: tl[1], maxX: br[0], maxY: br[1] };
  }

  // -------------------------------------------------------------------------
  render(input: RenderInput): RenderReport {
    const t0 = performance.now();
    const { features, viewport: vp, theme, layers, bounds, mode } = input;
    const ctx = this.ctx;
    const W = this.cssWidth;
    const H = this.cssHeight;
    const s = this.scaleFor(vp, bounds);
    const toX = (x: number) => W / 2 + (x - vp.x) * s;
    const toY = (y: number) => H / 2 + (y - vp.y) * s;
    /** Keep every feature intact, but choose the periodic copy nearest camera. */
    const featureToX = (f: MapFeature) => {
      if (mode !== "planet" || f.properties.featureType === "ice_cap") return toX;
      const cx = (f.bbox.minX + f.bbox.maxX) / 2;
      const shift = Math.round((vp.x - cx) / PLANET_WIDTH) * PLANET_WIDTH;
      return (x: number) => toX(x + shift);
    };

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = theme.ocean;
    ctx.fillRect(0, 0, W, H);

    // Bucket by type once
    const B = {
      sea: [] as MapFeature[],
      trench: [] as MapFeature[],
      plate: [] as MapFeature[],
      iceCap: [] as MapFeature[],
      land: [] as MapFeature[],
      coast: [] as MapFeature[],
      biome: [] as MapFeature[],
      plateau: [] as MapFeature[],
      range: [] as MapFeature[],
      lake: [] as MapFeature[],
      river: [] as MapFeature[],
      peak: [] as MapFeature[],
      volcano: [] as MapFeature[],
    };
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      switch (f.properties.featureType) {
        case "sea":
          B.sea.push(f);
          break;
        case "trench":
          B.trench.push(f);
          break;
        case "plate_boundary":
          B.plate.push(f);
          break;
        case "ice_cap":
          B.iceCap.push(f);
          break;
        case "continent":
        case "island":
          B.land.push(f);
          break;
        case "coastline":
          B.coast.push(f);
          break;
        case "mountain_range":
          B.range.push(f);
          break;
        case "plateau":
          B.plateau.push(f);
          break;
        case "lake":
          B.lake.push(f);
          break;
        case "river":
          B.river.push(f);
          break;
        case "mountain":
          B.peak.push(f);
          break;
        case "volcano":
          B.volcano.push(f);
          break;
        default:
          B.biome.push(f);
      }
    }

    let drawn = 0;

    // --- 1. Ocean basins ---------------------------------------------------
    if (layers.seas) {
      for (const f of B.sea) {
        this.poly(f, theme.sea, "transparent", 0, featureToX(f), toY);
        drawn++;
      }
      if (theme.isFantasyInk && layers.labels) {
        drawArtisticOceanTitles(ctx, B.sea, toX, toY, s);
      }
    }

    // --- 2. Tectonics ------------------------------------------------------
    if (layers.tectonics) {
      ctx.setLineDash([6, 5]);
      for (const f of B.plate) {
        this.line(f, theme.plateBoundary, 1.4, featureToX(f), toY);
        drawn++;
      }
      ctx.setLineDash([]);
      for (const f of B.trench) {
        this.line(f, theme.trench, Math.max(2, 4 * Math.min(1.6, s * 40)), featureToX(f), toY);
        drawn++;
      }
    }

    // --- 3. Polar caps -----------------------------------------------------
    if (layers.landmasses) {
      for (const f of B.iceCap) {
        if (mode === "planet") {
          for (const shift of [-PLANET_WIDTH, 0, PLANET_WIDTH]) {
            this.poly(f, theme.iceCap, "transparent", 0, (x) => toX(x + shift), toY);
          }
        } else {
          this.poly(f, theme.iceCap, "transparent", 0, toX, toY);
        }
        drawn++;
      }
    }

    // --- 4. Landmasses -----------------------------------------------------
    // In region mode the Tier-2 detailed coastline replaces the macro outline.
    const landLayer = mode === "region" && B.coast.length ? B.coast : B.land;
    const landStrokeW = Math.max(0.6, Math.min(2.4, s * (mode === "region" ? 6 : 220)));

    // Artistic Cartography: Multiple concentric coastal water ripples / tide echo lines
    if (theme.isFantasyInk && layers.landmasses && landLayer.length) {
      drawCoastalEchoRipples(ctx, landLayer, toX, toY, s);
    }

    if (layers.landmasses) {
      for (const f of landLayer) {
        const isIsland = f.properties.featureType === "island";
        this.poly(
          f,
          isIsland ? theme.island : theme.land,
          isIsland ? theme.islandStroke : theme.landStroke,
          theme.isFantasyInk ? 1.6 : landStrokeW,
          featureToX(f),
          toY
        );
        drawn++;
      }
    }

    // --- 5. Biomes, clipped to the land silhouette -------------------------
    if (layers.biomes && B.biome.length && landLayer.length) {
      ctx.save();
      ctx.beginPath();
      for (const l of landLayer) this.tracePolygon(l, featureToX(l), toY);
      ctx.clip();
      for (const f of B.biome) {
        if (theme.isFantasyInk && f.properties.featureType === "forest") {
          drawArtisticForestGroves(ctx, f, { toX: featureToX(f), toY, scale: s });
        } else {
          this.poly(f, biomeColor(f.properties.featureType, theme), "transparent", 0, featureToX(f), toY);
        }
        drawn++;
      }
      ctx.restore();
    }

    // --- 6. Plateaus & mountain ranges -------------------------------------
    if (layers.relief) {
      for (const f of B.plateau) {
        this.poly(f, theme.plateau, "transparent", 0, featureToX(f), toY);
        drawn++;
      }
      for (const f of B.range) {
        if (theme.isFantasyInk) {
          drawArtisticMountainRange(ctx, f, { toX: featureToX(f), toY, scale: s });
        } else {
          this.poly(f, theme.range, theme.rangeStroke, Math.min(1.5, landStrokeW), featureToX(f), toY);
        }
        drawn++;
      }
    }

    // --- 7. Rivers (thin -> thick so trunks sit on top) --------------------
    if (layers.rivers && B.river.length) {
      B.river.sort((a, b) => (a.properties.strahlerOrder ?? 1) - (b.properties.strahlerOrder ?? 1));
      const maxW = mode === "region" ? Math.max(3.2, Math.min(18, 3.2 * Math.pow(Math.max(1, vp.zoom), 0.45))) : 3.2;
      const widthScale = Math.min(maxW, Math.max(0.35, Math.sqrt(s * (mode === "region" ? 9 : 180))));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const f of B.river) {
        const o = f.properties.strahlerOrder ?? 1;
        const tx = featureToX(f);
        ctx.strokeStyle = theme.river[o] ?? theme.river[1];
        ctx.lineWidth = Math.max(0.45, (0.3 + o * 0.5) * widthScale);
        ctx.beginPath();
        const co = f.geometry.coordinates as Pt[];
        ctx.moveTo(tx(co[0][0]), toY(co[0][1]));
        for (let i = 1; i < co.length; i++) ctx.lineTo(tx(co[i][0]), toY(co[i][1]));
        ctx.stroke();
        drawn++;
      }

      // Elegant cursive/italic river lettering (Great Gidding: "River Pennant", "River Saith")
      if (theme.isFantasyInk && layers.labels && vp.zoom > 1.3) {
        ctx.save();
        ctx.font = "italic 600 10px 'Baskerville', 'Georgia', 'Palatino', serif";
        ctx.fillStyle = "#1e2e34";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(240, 245, 230, 0.95)";
        ctx.shadowBlur = 4;
        const labeledRivers = B.river.filter((r) => (r.properties.strahlerOrder ?? 1) >= 4);
        for (const r of labeledRivers) {
          const co = r.geometry.coordinates as Pt[];
          if (co.length < 4) continue;
          const midIdx = Math.floor(co.length / 2);
          const p1 = co[midIdx];
          const p2 = co[midIdx + 1] || co[midIdx];
          const mx = featureToX(r)((p1[0] + p2[0]) / 2);
          const my = toY((p1[1] + p2[1]) / 2);
          if (mx < 0 || mx > W || my < 0 || my > H) continue;

          // Align label with river direction
          const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
          const rot = ang > Math.PI / 2 ? ang - Math.PI : ang < -Math.PI / 2 ? ang + Math.PI : ang;
          ctx.save();
          ctx.translate(mx, my - 6);
          ctx.rotate(rot);
          ctx.fillText(r.properties.name, 0, 0);
          ctx.restore();
        }
        ctx.restore();
      }
    }

    // --- 8. Lakes ----------------------------------------------------------
    if (layers.lakes) {
      for (const f of B.lake) {
        this.poly(f, theme.lake, theme.lakeStroke, Math.min(1.2, landStrokeW), featureToX(f), toY);
        drawn++;
      }

      // Delicate italic lake lettering (Great Gidding: "Lake Morcant", "Lake Humber")
      if (theme.isFantasyInk && layers.labels && vp.zoom > 1.1) {
        ctx.save();
        ctx.font = "italic 600 10.5px 'Baskerville', 'Georgia', serif";
        ctx.fillStyle = "#1c2a30";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(235, 245, 245, 0.9)";
        ctx.shadowBlur = 3;
        for (const f of B.lake) {
          const area = f.properties.areaKm2 ?? 0;
          if (area < 60) continue;
          const b = f.bbox;
          const cx = featureToX(f)((b.minX + b.maxX) / 2);
          const cy = toY((b.minY + b.maxY) / 2);
          if (cx < 0 || cx > W || cy < 0 || cy > H) continue;
          ctx.fillText(f.properties.name, cx, cy);
        }
        ctx.restore();
      }
    }

    // --- 9. Summits --------------------------------------------------------
    if (layers.peaks && B.peak.length) {
      if (theme.isFantasyInk) {
        for (const f of B.peak) {
          drawArtisticPeak(ctx, f, { toX: featureToX(f), toY, scale: s });
          drawn++;
        }

        // Floating illuminated parchment banner over highest peak (like "Grimalkin's Peak" in reference!)
        if (layers.labels && B.peak.length > 0) {
          const sorted = [...B.peak].sort((a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0));
          const tallest = sorted[0];
          if (tallest && (tallest.properties.elevation ?? 0) > 3000) {
            const p = tallest.geometry.coordinates as Pt;
            const px = featureToX(tallest)(p[0]);
            const py = toY(p[1]);
            if (px >= 30 && px <= W - 30 && py >= 30 && py <= H - 30) {
              drawIlluminatedScrollBanner(ctx, px, py - 20, tallest.properties.name, `${tallest.properties.elevation}m`);
            }
          }
        }
      } else {
        for (const f of B.peak) {
          drawArtisticPeak(ctx, f, { toX: featureToX(f), toY, scale: s }, {
            sunlitFill: theme.peak,
            shadowFill: "rgba(0, 0, 0, 0.45)",
            inkStroke: "rgba(0, 0, 0, 0.65)",
            hatchStroke: "rgba(0, 0, 0, 0.55)",
            snowFill: theme.peakSnow,
          });
          drawn++;
        }

        if (layers.labels && vp.zoom > 2.4) {
          ctx.font = "600 10px Inter, system-ui, sans-serif";
          ctx.fillStyle = theme.peakLabel;
          ctx.shadowColor = "rgba(255,255,255,0.65)";
          ctx.shadowBlur = 3;
          const sorted = [...B.peak]
            .sort((a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0))
            .slice(0, 40);
          for (const f of sorted) {
            const p = f.geometry.coordinates as Pt;
            const x = featureToX(f)(p[0]);
            const y = toY(p[1]);
            if (x < 0 || x > W || y < 0 || y > H) continue;
            ctx.fillText(`${f.properties.name} · ${f.properties.elevation}m`, x + 8, y + 3);
          }
          ctx.shadowBlur = 0;
        }
      }
    }

    // --- 10. Volcanoes -----------------------------------------------------
    if (layers.volcanoes) {
      const sizeScale = Math.min(1.8, Math.max(0.6, Math.sqrt(s * (mode === "region" ? 12 : 240))));
      for (const f of B.volcano) {
        const p = f.geometry.coordinates as Pt;
        const x = featureToX(f)(p[0]);
        const y = toY(p[1]);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const r = Math.max(2.4, Math.min(9, 3.4 * sizeScale));
        if (f.properties.isActiveVolcano) {
          ctx.globalAlpha = 0.32;
          ctx.fillStyle = theme.volcanoGlow;
          ctx.beginPath();
          ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = theme.volcano;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (r > 3) {
          ctx.fillStyle = f.properties.isActiveVolcano ? "#ffe9a8" : "rgba(0,0,0,0.55)";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
        drawn++;
      }
    }

    // --- 11. Region affordances (planet tab only) --------------------------
    if (mode === "planet" && layers.regionOverlay && input.regions) {
      for (const reg of input.regions) {
        const detailed = input.detailedRegionIds?.has(reg.id);
        const active = input.activeRegionId === reg.id;
        if (!detailed && !active) continue;
        ctx.save();
        ctx.strokeStyle = active ? theme.select : "rgba(45,212,191,0.85)";
        ctx.lineWidth = active ? 2.6 : 1.8;
        ctx.setLineDash(active ? [] : [7, 5]);
        ctx.shadowColor = ctx.strokeStyle as string;
        ctx.shadowBlur = 9;
        ctx.beginPath();
        const o = reg.outline;
        const shift = Math.round((vp.x - (reg.bbox.minX + reg.bbox.maxX) / 2) / PLANET_WIDTH) * PLANET_WIDTH;
        ctx.moveTo(toX(o[0][0] + shift), toY(o[0][1]));
        for (let i = 1; i < o.length; i++) ctx.lineTo(toX(o[i][0] + shift), toY(o[i][1]));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- 11b. Processing compartments (region tab only) --------------------
    if (mode === "region" && layers.compartments && input.compartments?.length) {
      const blocks = input.compartments;
      let maxDensity = 1e-9;
      for (const b of blocks) maxDensity = Math.max(maxDensity, b.featureCount / Math.max(1e-6, b.landKm2));
      ctx.save();
      ctx.font = "600 9px Inter, system-ui, sans-serif";
      for (const b of blocks) {
        const x0 = toX(b.bbox.minX);
        const y0 = toY(b.bbox.minY);
        const x1 = toX(b.bbox.maxX);
        const y1 = toY(b.bbox.maxY);
        if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
        const density = b.featureCount / Math.max(1e-6, b.landKm2) / maxDensity;
        ctx.fillStyle = `rgba(251,191,36,${(0.04 + density * 0.2).toFixed(3)})`;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = "rgba(251,191,36,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        if (x1 - x0 > 46 && y1 - y0 > 26) {
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(15,23,42,0.75)";
          ctx.fillRect(x0 + 3, y0 + 3, 40, 13);
          ctx.fillStyle = "#fcd34d";
          ctx.fillText(`#${b.id} · ${b.featureCount}`, x0 + 6, y0 + 13);
        }
      }
      ctx.restore();
    }

    // --- 11c. Layer 3: biosphere overlay (region tab only, additive) -------
    if (mode === "region" && input.bioOverlay?.length) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const it of input.bioOverlay) {
        if (vp.zoom < it.lod) continue;
        const x = toX(it.x);
        const y = toY(it.y);
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
        const rPx = Math.max(3, Math.min(60, it.rUnits * s));
        ctx.globalAlpha = 0.14 + it.abundance * 0.05;
        ctx.fillStyle = it.color;
        ctx.beginPath();
        ctx.arc(x, y, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, rPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const gPx = Math.max(9, Math.min(26, rPx * 0.9));
        if (gPx >= 9) {
          ctx.font = `${gPx}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.fillText(it.glyph, x, y);
        }
        drawn++;
      }
      ctx.restore();
    }

    // --- 11c-1. Geological & Mineral Wealth Overlay ---
    if (mode === "region" && input.resourceOverlay?.length) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const it of input.resourceOverlay) {
        if (vp.zoom < it.lod) continue;
        const x = toX(it.x);
        const y = toY(it.y);
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;

        const r = Math.max(5, Math.min(14, (it.abundance * 2.5 + 4) * Math.min(1.5, Math.sqrt(vp.zoom))));
        ctx.fillStyle = it.color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.font = `${Math.max(9, Math.min(16, r * 1.2))}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.fillText(it.glyph, x, y);

        if (layers.labels && vp.zoom > 3.0) {
          ctx.font = "600 9.5px 'Baskerville', 'Georgia', serif";
          ctx.fillStyle = theme.isFantasyInk ? "#18231c" : "#f1f5f9";
          ctx.shadowColor = theme.isFantasyInk ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
          ctx.shadowBlur = 3;
          ctx.fillText(it.name, x, y + r + 8);
          ctx.shadowBlur = 0;
        }
        drawn++;
      }
      ctx.restore();
    }

    // --- 11c-2. Layer 7: Cadastre & Rooftops (Google Earth Satellite View Lite) ---
    if (mode === "region" && input.cadastres?.length) {
      for (const cad of input.cadastres) {
        drawSettlementCadastre({
          ctx,
          cadastre: cad,
          toX,
          toY,
          scale: s,
          zoom: vp.zoom,
          isFantasyInk: theme.isFantasyInk,
        });
        drawn += cad.buildings.length + cad.streets.length;
      }
    }

    // --- 11c-3. Layer 6: Trade Routes & Road Network ---
    if (mode === "region" && input.routeOverlay?.length && (layers.routes ?? true)) {
      ctx.save();
      for (const rt of input.routeOverlay) {
        if (vp.zoom < rt.lodZoom) continue;
        const pts = rt.points;
        if (pts.length < 2) continue;

        const isSea = rt.type === "sea_lane";
        const isHwy = rt.type === "highway";
        const isPass = rt.type === "mountain_pass";

        ctx.beginPath();
        ctx.moveTo(toX(pts[0][0]), toY(pts[0][1]));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(toX(pts[i][0]), toY(pts[i][1]));
        }

        if (isSea) {
          ctx.strokeStyle = theme.isFantasyInk ? "rgba(18, 98, 120, 0.65)" : "rgba(56, 189, 248, 0.75)";
          ctx.lineWidth = Math.max(1, 1.4 * Math.min(1.8, Math.sqrt(vp.zoom)));
          ctx.setLineDash([4, 6]);
          ctx.stroke();
        } else if (theme.isFantasyInk) {
          if (isHwy) {
            // King's highway in antique cartography: double-cased or bold sepia track
            ctx.strokeStyle = "rgba(78, 48, 24, 0.85)";
            ctx.lineWidth = Math.max(1.8, 2.4 * Math.min(2.0, Math.sqrt(vp.zoom)));
            ctx.setLineDash([]);
            ctx.stroke();

            // Inner lighter spine
            ctx.strokeStyle = "rgba(245, 235, 215, 0.6)";
            ctx.lineWidth = Math.max(0.8, 1.2 * Math.min(2.0, Math.sqrt(vp.zoom)));
            ctx.stroke();
          } else if (isPass) {
            // Mountain pass: red-brown dashed trail
            ctx.strokeStyle = "rgba(146, 36, 24, 0.85)";
            ctx.lineWidth = Math.max(1.2, 1.6 * Math.min(1.8, Math.sqrt(vp.zoom)));
            ctx.setLineDash([3, 4]);
            ctx.stroke();
          } else {
            // Regional market road / byway: earthy dashed trail
            ctx.strokeStyle = rt.paved ? "rgba(92, 58, 28, 0.8)" : "rgba(120, 78, 38, 0.7)";
            ctx.lineWidth = Math.max(1.0, 1.5 * Math.min(1.8, Math.sqrt(vp.zoom)));
            ctx.setLineDash(rt.paved ? [] : [4, 4]);
            ctx.stroke();
          }
        } else {
          // Standard / Modern Atlas
          if (isHwy) {
            ctx.strokeStyle = rt.paved ? "#f59e0b" : "#d97706";
            ctx.lineWidth = Math.max(2.0, 2.8 * Math.min(2.2, Math.sqrt(vp.zoom)));
            ctx.setLineDash([]);
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 3;
            ctx.stroke();
            ctx.shadowBlur = 0;
          } else if (isPass) {
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = Math.max(1.4, 1.8 * Math.min(1.8, Math.sqrt(vp.zoom)));
            ctx.setLineDash([4, 4]);
            ctx.stroke();
          } else {
            ctx.strokeStyle = rt.paved ? "#f97316" : "#b45309";
            ctx.lineWidth = Math.max(1.2, 1.6 * Math.min(1.8, Math.sqrt(vp.zoom)));
            ctx.setLineDash(rt.paved ? [] : [5, 4]);
            ctx.stroke();
          }
        }
        drawn++;
      }
      ctx.restore();
    }

    // --- 11d. Layer 4: settlements (region tab only, above biosphere) ------
    if (mode === "region" && input.humanOverlay?.length) {
      ctx.save();
      const hasCadastreOnScreen = (input.cadastres?.length ?? 0) > 0 && vp.zoom >= 45;
      const ordered = [...input.humanOverlay].sort((a, b) => a.rank - b.rank);
      for (const it of ordered) {
        if (vp.zoom < it.lod) continue;
        const x = toX(it.x);
        const y = toY(it.y);
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;

        if (theme.isFantasyInk) {
          // Illustrated medieval architectural icon (castle/keep/tower/village/monastery)
          if (!hasCadastreOnScreen) {
            drawArtisticSettlementIcon(ctx, x, y, it.tier || "village", it.type || "farming_village", s);
          }

          // Clean hand-lettered label beside icon (Great Gidding style)
          if (layers.labels && (it.rank >= 2 || vp.zoom > 1.8)) {
            ctx.font = `italic bold ${it.rank >= 4 ? 12 : it.rank === 3 ? 11 : 9.5}px 'Baskerville', 'Georgia', 'Palatino', serif`;
            ctx.fillStyle = "#16231c";
            ctx.textAlign = hasCadastreOnScreen ? "center" : "left";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(245, 240, 225, 0.95)";
            ctx.shadowBlur = 4;
            const labelX = hasCadastreOnScreen ? x : x + 12;
            const labelY = hasCadastreOnScreen ? y - 36 : y;
            ctx.fillText(it.name, labelX, labelY);
            ctx.shadowBlur = 0;
          }

          // Illuminated parchment ribbon banner for capitals & metropolises (like "The Weald" / "Rhos Vale" in reference!)
          if (layers.labels && (it.type === "capital_city" || it.rank >= 5 || (it.rank >= 4 && vp.zoom > 1.8))) {
            drawIlluminatedScrollBanner(ctx, x, y - 26, it.name, "Capital Realm");
          }
        } else {
          const base = 4 + it.rank * 2.2;
          const r = Math.max(3, Math.min(16, base * Math.min(1.6, Math.max(0.7, Math.sqrt(vp.zoom)))));

          if (!hasCadastreOnScreen) {
            ctx.globalAlpha = 0.28;
            ctx.fillStyle = it.color;
            ctx.beginPath();
            ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = it.color;
            ctx.strokeStyle = "rgba(0,0,0,0.75)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            if (it.rank >= 4) {
              ctx.rect(x - r, y - r, r * 2, r * 2);
            } else if (it.rank === 3) {
              ctx.moveTo(x, y - r);
              ctx.lineTo(x + r, y);
              ctx.lineTo(x, y + r);
              ctx.lineTo(x - r, y);
              ctx.closePath();
            } else {
              ctx.arc(x, y, r, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.stroke();
            if (r >= 7) {
              ctx.font = `${Math.round(r * 1.3)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(it.glyph, x, y);
            }
          }

          if (layers.labels && (it.rank >= 3 || vp.zoom > 4)) {
            ctx.font = `${it.rank >= 4 ? "700 11px" : "600 10px"} Inter, system-ui, sans-serif`;
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.shadowColor = "rgba(0,0,0,0.9)";
            ctx.shadowBlur = 4;
            ctx.fillText(it.name, x, y + (hasCadastreOnScreen ? -16 : r + 9));
            ctx.shadowBlur = 0;
          }
        }
        drawn++;
      }
      ctx.restore();
    }

    // --- 11e. Provincial Realm Lettering (Great Gidding: "ILRAETH", "WESTERSKELD") ---
    if (theme.isFantasyInk && layers.labels) {
      if (mode === "region" && input.activeRegionId && input.regions) {
        const reg = input.regions.find((r) => r.id === input.activeRegionId);
        if (reg) {
          ctx.save();
          const rx = toX(reg.centroid[0]);
          const ry = toY(reg.centroid[1]);
          if (rx >= 20 && rx <= W - 20 && ry >= 20 && ry <= H - 20) {
            const raw = reg.name.toUpperCase().replace(/\s+(ISLAND|ISLE|CONTINENT)$/, "");
            const spaced = raw.split("").join("  ");
            ctx.font = "bold 20px 'Cinzel', 'Baskerville', 'Palatino', serif";
            ctx.fillStyle = "rgba(42, 56, 32, 0.45)"; // earthy dark ink lettering
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(spaced, rx, ry);
          }
          ctx.restore();
        }
      } else if (mode === "planet" && input.regions) {
        ctx.save();
        ctx.font = "bold 15px 'Cinzel', 'Baskerville', 'Palatino', serif";
        ctx.fillStyle = "rgba(42, 56, 32, 0.38)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const reg of input.regions.slice(0, 8)) {
          const rx = toX(reg.centroid[0]);
          const ry = toY(reg.centroid[1]);
          if (rx >= 20 && rx <= W - 20 && ry >= 20 && ry <= H - 20) {
            const raw = reg.name.toUpperCase().replace(/\s+(ISLAND|ISLE|CONTINENT)$/, "");
            const spaced = raw.split("").join(" ");
            ctx.fillText(spaced, rx, ry);
          }
        }
        ctx.restore();
      }
    }

    // --- 12. Graticule -----------------------------------------------------
    const chrome = input.showChrome !== false;
    if (chrome && layers.graticule) this.graticule(toX, toY, theme, vp, W, H);

    // --- 13. Highlights ----------------------------------------------------
    if (input.selected) this.highlight(input.selected, theme.select, 3, featureToX(input.selected), toY);
    if (input.hovered && input.hovered !== input.selected)
      this.highlight(input.hovered, theme.hover, 1.8, featureToX(input.hovered), toY);

    // --- 14. Scale bar & Title Cartouche ------------------------------------
    if (chrome) {
      this.scaleBar(W, H, s, theme);
      if (theme.isFantasyInk) {
        drawArtisticTitleCartouche(ctx, input.worldTitle || "Great Gidding", W, H);
      }
    }

    ctx.restore();
    return { drawn, ms: performance.now() - t0 };
  }

  // -------------------------------------------------------------------------
  private tracePolygon(f: MapFeature, toX: (n: number) => number, toY: (n: number) => number) {
    const ctx = this.ctx;
    const draw = (rings: Pt[][]) => {
      for (const ring of rings) {
        if (!ring || ring.length < 2) continue;
        ctx.moveTo(toX(ring[0][0]), toY(ring[0][1]));
        for (let i = 1; i < ring.length; i++) ctx.lineTo(toX(ring[i][0]), toY(ring[i][1]));
        ctx.closePath();
      }
    };
    if (f.geometry.type === "Polygon") draw(f.geometry.coordinates as Pt[][]);
    else if (f.geometry.type === "MultiPolygon")
      for (const poly of f.geometry.coordinates as Pt[][][]) draw(poly);
  }

  private poly(
    f: MapFeature,
    fill: string,
    stroke: string,
    sw: number,
    toX: (n: number) => number,
    toY: (n: number) => number
  ) {
    const ctx = this.ctx;
    ctx.beginPath();
    this.tracePolygon(f, toX, toY);
    ctx.fillStyle = fill;
    ctx.fill();
    if (sw > 0 && stroke !== "transparent") {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
  }

  private line(
    f: MapFeature,
    stroke: string,
    sw: number,
    toX: (n: number) => number,
    toY: (n: number) => number
  ) {
    const ctx = this.ctx;
    const co = f.geometry.coordinates as Pt[];
    if (!co || co.length < 2) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(toX(co[0][0]), toY(co[0][1]));
    for (let i = 1; i < co.length; i++) ctx.lineTo(toX(co[i][0]), toY(co[i][1]));
    ctx.stroke();
  }

  private highlight(
    f: MapFeature,
    color: string,
    w: number,
    toX: (n: number) => number,
    toY: (n: number) => number
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    if (f.geometry.type === "Point") {
      const p = f.geometry.coordinates as Pt;
      ctx.beginPath();
      ctx.arc(toX(p[0]), toY(p[1]), 13, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.geometry.type === "LineString") {
      this.line(f, color, w + 1, toX, toY);
    } else {
      ctx.beginPath();
      this.tracePolygon(f, toX, toY);
      ctx.stroke();
    }
    ctx.restore();
  }

  private graticule(
    toX: (n: number) => number,
    toY: (n: number) => number,
    theme: ThemeColors,
    vp: Viewport,
    W: number,
    H: number
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = theme.graticule;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);

    const latLines: { y: number; label: string; major?: boolean }[] = [
      { y: PLANET_HEIGHT * 0.5, label: "Equator 0°", major: true },
      { y: PLANET_HEIGHT * (0.5 - 23.5 / 180), label: "Tropic of Cancer 23.5°N" },
      { y: PLANET_HEIGHT * (0.5 + 23.5 / 180), label: "Tropic of Capricorn 23.5°S" },
      { y: PLANET_HEIGHT * (0.5 - 66.5 / 180), label: "Arctic Circle 66.5°N" },
      { y: PLANET_HEIGHT * (0.5 + 66.5 / 180), label: "Antarctic Circle 66.5°S" },
    ];
    // Extra 10° parallels appear once you're zoomed in
    if (vp.zoom > 3) {
      for (let lat = -80; lat <= 80; lat += 10) {
        if (lat === 0) continue;
        latLines.push({ y: PLANET_HEIGHT * (0.5 - lat / 180), label: `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}` });
      }
    }

    for (const l of latLines) {
      const y = toY(l.y);
      if (y < -10 || y > H + 10) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const meridianStep = vp.zoom > 3 ? 10 : 30;
    for (let lon = -180; lon <= 180; lon += meridianStep) {
      const worldX = ((lon + 180) / 360) * PLANET_WIDTH;
      for (const k of [-1, 0, 1]) {
        const x = toX(worldX + k * PLANET_WIDTH);
        if (x < -10 || x > W + 10) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    ctx.font = "9px Inter, system-ui, sans-serif";
    ctx.fillStyle = theme.graticuleLabel;
    for (const l of latLines) {
      const y = toY(l.y);
      if (y < 12 || y > H - 4) continue;
      ctx.fillText(l.label, 8, y - 3);
    }
    ctx.restore();
  }

  private scaleBar(W: number, H: number, scale: number, theme: ThemeColors) {
    const ctx = this.ctx;
    const kmPerPx = KM_PER_UNIT / scale;
    const target = 150;
    const raw = target * kmPerPx;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, raw))));
    let nice = pow;
    if (raw / pow >= 5) nice = 5 * pow;
    else if (raw / pow >= 2) nice = 2 * pow;
    const barPx = nice / kmPerPx;
    const x = W - barPx - 22;
    const y = H - 18;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x - 10, y - 21, barPx + 20, 29);
    ctx.strokeStyle = theme.hudText;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + barPx, y);
    ctx.lineTo(x + barPx, y - 5);
    ctx.stroke();
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.fillStyle = theme.hudText;
    ctx.textAlign = "center";
    ctx.fillText(`${nice >= 1 ? nice.toLocaleString() : nice.toFixed(1)} km`, x + barPx / 2, y - 8);
    ctx.textAlign = "left";
    ctx.restore();
  }
}
