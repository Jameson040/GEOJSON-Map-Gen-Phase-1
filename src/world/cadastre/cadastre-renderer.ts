import type { SettlementCadastre } from "./cadastre-types";
import { ROOF_MATERIAL_PALETTES } from "./cadastre-catalog";

// ---------------------------------------------------------------------------
// SATELLITE CADASTRE CANVAS RENDERER
//
// Renders top-down historical fantasy urbanism and rural belts:
//   - Agricultural farm fields with parallel crop furrow lines.
//   - Cattle ranches and paddocks with post-and-rail timber fences.
//   - Patrician mansions with private walled estate gardens and slate roofs.
//   - Peasant hovels and cottages in organic clusters.
//   - Central Market Square with the public Town Well, historic Inn, and Temple.
//   - Directional SE ground cast shadows, multi-pitch roof facets, and chimney stacks.
// ---------------------------------------------------------------------------

export interface CadastreRenderOptions {
  ctx: CanvasRenderingContext2D;
  cadastre: SettlementCadastre;
  toX: (x: number) => number;
  toY: (y: number) => number;
  scale: number;             // Screen pixels per world unit
  zoom: number;              // Current viewport zoom
  isFantasyInk?: boolean;
}

export function drawSettlementCadastre(opts: CadastreRenderOptions): void {
  const { ctx, cadastre, toX, toY, scale, zoom } = opts;
  const metersToPx = scale / 5560;

  // =========================================================================
  // Pass 0: Parcels, Farm Fields, Furrows & Cattle Paddocks
  // =========================================================================
  if (zoom >= 25) {
    ctx.save();

    for (const pcl of cadastre.parcels) {
      if (pcl.boundary.length < 3) continue;

      ctx.beginPath();
      ctx.moveTo(toX(pcl.boundary[0][0]), toY(pcl.boundary[0][1]));
      for (let i = 1; i < pcl.boundary.length; i++) {
        ctx.lineTo(toX(pcl.boundary[i][0]), toY(pcl.boundary[i][1]));
      }
      ctx.closePath();

      // Parcel Fill
      if (pcl.fillColor) {
        ctx.fillStyle = pcl.fillColor;
        ctx.fill();
      } else if (pcl.landUse === "plaza") {
        ctx.fillStyle = "rgba(180, 168, 145, 0.28)";
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(170, 155, 130, 0.08)";
        ctx.fill();
      }

      // Parcel boundary stroke
      ctx.strokeStyle =
        pcl.landUse === "mansion_estate"
          ? "rgba(90, 85, 75, 0.45)"
          : pcl.landUse === "cattle_ranch"
          ? "rgba(100, 75, 45, 0.35)"
          : pcl.landUse === "farm_field"
          ? "rgba(130, 110, 80, 0.3)"
          : "rgba(120, 113, 108, 0.25)";
      ctx.lineWidth = Math.max(0.6, Math.min(1.8, 0.5 * metersToPx));
      ctx.stroke();

      // Crop Furrow Lines (Agricultural Farm Fields)
      if (pcl.furrows && pcl.furrows.length > 0 && zoom >= 35) {
        ctx.save();
        ctx.strokeStyle = "rgba(85, 65, 40, 0.22)";
        ctx.lineWidth = Math.max(0.5, 0.6 * metersToPx);
        ctx.beginPath();
        for (const [f1, f2] of pcl.furrows) {
          ctx.moveTo(toX(f1[0]), toY(f1[1]));
          ctx.lineTo(toX(f2[0]), toY(f2[1]));
        }
        ctx.stroke();
        ctx.restore();
      }

      // Wooden Post-and-Rail Fences / Stone Walls
      if (pcl.fences && pcl.fences.length > 0 && zoom >= 30) {
        ctx.save();
        const isEstate = pcl.landUse === "mansion_estate";
        ctx.strokeStyle = isEstate ? "rgba(70, 65, 60, 0.65)" : "rgba(95, 65, 35, 0.6)";
        ctx.lineWidth = Math.max(0.8, (isEstate ? 1.0 : 0.7) * metersToPx);

        for (const [p1, p2] of pcl.fences) {
          ctx.beginPath();
          ctx.moveTo(toX(p1[0]), toY(p1[1]));
          ctx.lineTo(toX(p2[0]), toY(p2[1]));
          ctx.stroke();

          // Render fence posts at endpoints at deep zoom
          if (zoom >= 80) {
            const postR = Math.max(1.0, 0.6 * metersToPx);
            ctx.fillStyle = isEstate ? "#52525b" : "#451a03";
            ctx.beginPath();
            ctx.arc(toX(p1[0]), toY(p1[1]), postR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // =========================================================================
  // Pass 0B: Village Pond / Water Feature
  // =========================================================================
  if (cadastre.civicPond && cadastre.civicPond.polygon.length >= 3) {
    ctx.save();
    const pond = cadastre.civicPond;
    ctx.beginPath();
    ctx.moveTo(toX(pond.polygon[0][0]), toY(pond.polygon[0][1]));
    for (let i = 1; i < pond.polygon.length; i++) {
      ctx.lineTo(toX(pond.polygon[i][0]), toY(pond.polygon[i][1]));
    }
    ctx.closePath();

    // Shimmering pond water fill
    ctx.fillStyle = "#528594";
    ctx.fill();

    // Shoreline ripple
    ctx.strokeStyle = "rgba(180, 215, 225, 0.45)";
    ctx.lineWidth = Math.max(1.0, 1.2 * metersToPx);
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================================
  // Pass 0C: Waterfront Wooden Piers & Jetties
  // =========================================================================
  if (cadastre.waterfront && zoom >= 20) {
    ctx.save();
    ctx.lineCap = "butt";

    for (const pier of cadastre.waterfront.piers) {
      const x1 = toX(pier.start[0]);
      const y1 = toY(pier.start[1]);
      const x2 = toX(pier.end[0]);
      const y2 = toY(pier.end[1]);
      const pierWidthPx = Math.max(2.5, pier.widthM * metersToPx);

      // Pier drop shadow into water
      ctx.strokeStyle = "rgba(10, 30, 45, 0.5)";
      ctx.lineWidth = pierWidthPx + Math.max(1.0, 1.2 * metersToPx);
      ctx.beginPath();
      ctx.moveTo(x1 + 1.5, y1 + 1.5);
      ctx.lineTo(x2 + 1.5, y2 + 1.5);
      ctx.stroke();

      // Wooden timber deck
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = pierWidthPx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Lighter plank center
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = Math.max(1.0, pierWidthPx * 0.6);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Wooden bollards/posts at pier tip
      if (zoom >= 45) {
        ctx.fillStyle = "#451a03";
        ctx.beginPath();
        ctx.arc(x2, y2, Math.max(1.2, 0.8 * metersToPx), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // =========================================================================
  // Pass 1: Street Network & Plazas
  // =========================================================================
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const str of cadastre.streets) {
    if (str.points.length < 2) continue;
    const roadPx = Math.max(1.8, str.widthM * metersToPx);

    // Street casing / shoulder
    ctx.beginPath();
    ctx.moveTo(toX(str.points[0][0]), toY(str.points[0][1]));
    for (let i = 1; i < str.points.length; i++) {
      ctx.lineTo(toX(str.points[i][0]), toY(str.points[i][1]));
    }
    ctx.strokeStyle = "rgba(68, 64, 60, 0.38)";
    ctx.lineWidth = roadPx + Math.max(1.0, 1.2 * metersToPx);
    ctx.stroke();

    // Street surface
    let surfaceColor = "#a89f91"; // dirt default
    if (str.surface === "cobblestone") surfaceColor = "#78716c";
    else if (str.surface === "paved_stone") surfaceColor = "#94a3b8";
    else if (str.surface === "gravel") surfaceColor = "#b59e7a";

    ctx.strokeStyle = surfaceColor;
    ctx.lineWidth = roadPx;
    ctx.stroke();
  }
  ctx.restore();

  // =========================================================================
  // Pass 1B: Defensive Curtain Walls, Towers & Gatehouses (Watabou Enceinte)
  // =========================================================================
  if (cadastre.defense && zoom >= 20) {
    const def = cadastre.defense;
    const wallThickPx = Math.max(2.5, def.wallThicknessM * metersToPx);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Curtain wall ground shadow (SE Azimuth)
    ctx.strokeStyle = "rgba(15, 23, 42, 0.4)";
    ctx.lineWidth = wallThickPx + Math.max(1.5, 2.0 * metersToPx);
    for (const wallSeg of def.curtainWalls) {
      if (wallSeg.length < 2) continue;
      ctx.beginPath();
      const sOffX = 1.5 * metersToPx;
      const sOffY = 1.5 * metersToPx;
      ctx.moveTo(toX(wallSeg[0][0]) + sOffX, toY(wallSeg[0][1]) + sOffY);
      for (let i = 1; i < wallSeg.length; i++) {
        ctx.lineTo(toX(wallSeg[i][0]) + sOffX, toY(wallSeg[i][1]) + sOffY);
      }
      ctx.stroke();
    }

    // 2. Main stone curtain wall base
    ctx.strokeStyle = "#3f3f46"; // Dark quarried stone
    ctx.lineWidth = wallThickPx;
    for (const wallSeg of def.curtainWalls) {
      if (wallSeg.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(toX(wallSeg[0][0]), toY(wallSeg[0][1]));
      for (let i = 1; i < wallSeg.length; i++) {
        ctx.lineTo(toX(wallSeg[i][0]), toY(wallSeg[i][1]));
      }
      ctx.stroke();
    }

    // 3. Parapet wall walkway
    ctx.strokeStyle = "#71717a"; // Lighter stone walkway
    ctx.lineWidth = Math.max(1.0, wallThickPx * 0.45);
    for (const wallSeg of def.curtainWalls) {
      if (wallSeg.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(toX(wallSeg[0][0]), toY(wallSeg[0][1]));
      for (let i = 1; i < wallSeg.length; i++) {
        ctx.lineTo(toX(wallSeg[i][0]), toY(wallSeg[i][1]));
      }
      ctx.stroke();
    }

    // 4. Defensive Bastion Towers
    for (const tow of def.towers) {
      const tx = toX(tow.center[0]);
      const ty = toY(tow.center[1]);
      const towR = Math.max(2.8, tow.radiusM * metersToPx);

      // Tower shadow
      ctx.fillStyle = "rgba(15, 23, 42, 0.42)";
      ctx.beginPath();
      ctx.arc(tx + 2, ty + 2, towR, 0, Math.PI * 2);
      ctx.fill();

      // Stone tower body
      ctx.fillStyle = "#3f3f46";
      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = Math.max(0.6, 0.8 * metersToPx);
      ctx.beginPath();
      ctx.arc(tx, ty, towR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tower conical roof or battlement
      ctx.fillStyle = tow.isGateTower ? "#1e293b" : "#475569";
      ctx.beginPath();
      ctx.arc(tx, ty, towR * 0.72, 0, Math.PI * 2);
      ctx.fill();

      // Spire tip / arrow slit dot
      if (zoom >= 60) {
        ctx.fillStyle = "#f8fafc";
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(0.8, 0.5 * metersToPx), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Gatehouses
    for (const gate of def.gates) {
      const gx = toX(gate.center[0]);
      const gy = toY(gate.center[1]);
      if (zoom >= 30) {
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(gate.roadAngleRad);
        const gW = Math.max(4.0, gate.widthM * metersToPx);
        const gD = Math.max(3.0, gate.depthM * metersToPx);

        // Stone gate lintel / arch
        ctx.fillStyle = "#27272a";
        ctx.fillRect(-gD / 2, -gW / 2, gD, gW);

        // Inner carriageway opening
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(-gD / 2, -(gW - 2) / 2, gD, gW - 2);

        // Iron portcullis grate at deep zoom
        if (zoom >= 75) {
          ctx.strokeStyle = "#09090b";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -(gW - 2) / 2);
          ctx.lineTo(0, (gW - 2) / 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // =========================================================================
  // Pass 2: Ground Cast Shadows (SE Azimuth)
  // =========================================================================
  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 42, 0.44)";

  for (const b of cadastre.buildings) {
    if (b.shadowPolygon.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(toX(b.shadowPolygon[0][0]), toY(b.shadowPolygon[0][1]));
    for (let i = 1; i < b.shadowPolygon.length; i++) {
      ctx.lineTo(toX(b.shadowPolygon[i][0]), toY(b.shadowPolygon[i][1]));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // =========================================================================
  // Pass 3: Pitched Roofs, Facets & Architectural Character
  // =========================================================================
  for (const b of cadastre.buildings) {
    const palette = ROOF_MATERIAL_PALETTES[b.roofMaterial] ?? ROOF_MATERIAL_PALETTES.thatch;

    // --- 3A. Special Building: The Town Well ---
    if (b.buildingType === "well") {
      ctx.save();
      const wx = toX(b.center[0]);
      const wy = toY(b.center[1]);
      const wellRadiusPx = Math.max(3.5, 2.0 * metersToPx);

      // Cobblestone well apron ring
      ctx.fillStyle = "rgba(120, 113, 108, 0.5)";
      ctx.beginPath();
      ctx.arc(wx, wy, wellRadiusPx + Math.max(1.5, 1.2 * metersToPx), 0, Math.PI * 2);
      ctx.fill();

      // Stone wellhead wall
      ctx.fillStyle = "#57534e";
      ctx.strokeStyle = "#292524";
      ctx.lineWidth = Math.max(0.8, 0.6 * metersToPx);
      ctx.beginPath();
      ctx.arc(wx, wy, wellRadiusPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Deep water pool inside
      ctx.fillStyle = "#1e3a8a";
      ctx.beginPath();
      ctx.arc(wx, wy, wellRadiusPx * 0.65, 0, Math.PI * 2);
      ctx.fill();

      // Wooden crossbar winch
      if (zoom >= 40) {
        ctx.strokeStyle = "#78350f";
        ctx.lineWidth = Math.max(1.0, 0.8 * metersToPx);
        ctx.beginPath();
        ctx.moveTo(wx - wellRadiusPx, wy);
        ctx.lineTo(wx + wellRadiusPx, wy);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }

    // --- 3B. Special Building: Windmill Sails ---
    if (b.buildingType === "windmill") {
      // Draw conical roof
      for (const f of b.facets) {
        if (f.polygon.length < 3) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(toX(f.polygon[0][0]), toY(f.polygon[0][1]));
        for (let i = 1; i < f.polygon.length; i++) {
          ctx.lineTo(toX(f.polygon[i][0]), toY(f.polygon[i][1]));
        }
        ctx.closePath();
        ctx.fillStyle = f.color;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Draw 4 rotating cross sails
      if (zoom >= 35) {
        ctx.save();
        const wmx = toX(b.center[0]);
        const wmy = toY(b.center[1]);
        const sailLenPx = Math.max(8.0, 7.5 * metersToPx);

        ctx.strokeStyle = "#451a03"; // Dark timber spars
        ctx.lineWidth = Math.max(1.2, 1.0 * metersToPx);

        for (let s = 0; s < 4; s++) {
          const sAng = b.orientationRad + (s * Math.PI) / 2;
          const endX = wmx + sailLenPx * Math.cos(sAng);
          const endY = wmy + sailLenPx * Math.sin(sAng);

          ctx.beginPath();
          ctx.moveTo(wmx, wmy);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          // White canvas sail lattice
          if (zoom >= 70) {
            ctx.fillStyle = "rgba(245, 245, 240, 0.75)";
            const perpX = -Math.sin(sAng) * Math.max(2.5, 2.0 * metersToPx);
            const perpY = Math.cos(sAng) * Math.max(2.5, 2.0 * metersToPx);
            ctx.beginPath();
            ctx.moveTo(wmx + perpX * 0.3, wmy + perpY * 0.3);
            ctx.lineTo(endX + perpX, endY + perpY);
            ctx.lineTo(endX, endY);
            ctx.closePath();
            ctx.fill();
          }
        }
        if (zoom >= 260) {
          ctx.font = "italic bold 10px 'Baskerville', 'Georgia', serif";
          ctx.fillStyle = "#0f172a";
          ctx.textAlign = "center";
          ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
          ctx.shadowBlur = 4;
          ctx.fillText("Windmill", wmx, wmy - b.lengthM * metersToPx * 0.75);
        }
        ctx.restore();
      }
      continue;
    }

    // --- 3C. Special Building: Market Stalls Striped Awning ---
    if (b.buildingType === "market_stall") {
      ctx.save();
      for (const f of b.facets) {
        if (f.polygon.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(toX(f.polygon[0][0]), toY(f.polygon[0][1]));
        for (let i = 1; i < f.polygon.length; i++) {
          ctx.lineTo(toX(f.polygon[i][0]), toY(f.polygon[i][1]));
        }
        ctx.closePath();
        ctx.fillStyle = f.color;
        ctx.fill();

        // Striped awning accents
        ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
        ctx.lineWidth = Math.max(0.6, 0.8 * metersToPx);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }

    // --- 3D. Standard Pitched Gabled & Hipped Roofs ---
    for (const f of b.facets) {
      if (f.polygon.length < 3) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX(f.polygon[0][0]), toY(f.polygon[0][1]));
      for (let i = 1; i < f.polygon.length; i++) {
        ctx.lineTo(toX(f.polygon[i][0]), toY(f.polygon[i][1]));
      }
      ctx.closePath();

      ctx.fillStyle = f.color;
      ctx.fill();

      // Subtle slope boundary stroke
      ctx.strokeStyle = "rgba(20, 20, 20, 0.32)";
      ctx.lineWidth = Math.max(0.5, 0.6 * metersToPx);
      ctx.stroke();
      ctx.restore();
    }

    // Pass 3E: Ridge Crest Highlight Line
    if (b.ridgeLine && b.ridgeLine.length === 2 && zoom >= 35) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX(b.ridgeLine[0][0]), toY(b.ridgeLine[0][1]));
      ctx.lineTo(toX(b.ridgeLine[1][0]), toY(b.ridgeLine[1][1]));
      ctx.strokeStyle = palette.ridgeHex;
      ctx.lineWidth = Math.max(1.0, Math.min(2.5, 1.2 * metersToPx));
      ctx.stroke();
      ctx.restore();
    }

    // Pass 3F: Chimneys (Multiple stacks for Mansions & Inns)
    if (zoom >= 140 && b.chimneys && b.chimneys.length > 0) {
      ctx.save();
      const chimSizePx = Math.max(2.0, Math.min(6.0, 1.4 * metersToPx));
      for (const ch of b.chimneys) {
        const cx = toX(ch[0]);
        const cy = toY(ch[1]);
        // Chimney shadow
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(cx + 1, cy + 1, chimSizePx, chimSizePx);
        // Chimney stone cap
        ctx.fillStyle = b.buildingType === "manor" ? "#475569" : "#78350f";
        ctx.fillRect(cx - chimSizePx / 2, cy - chimSizePx / 2, chimSizePx, chimSizePx);
        // Flue hole
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(cx - chimSizePx / 4, cy - chimSizePx / 4, chimSizePx / 2, chimSizePx / 2);
      }
      ctx.restore();
    }

    // Pass 3G: Micro-labels & Named Fantasy Establishments
    if (zoom >= 75) {
      const hasEst = b.establishment !== undefined;
      const isKeyCivic =
        b.buildingType === "chapel" ||
        b.buildingType === "cathedral" ||
        b.buildingType === "temple" ||
        b.buildingType === "townhall" ||
        b.buildingType === "keep" ||
        b.buildingType === "inn" ||
        b.buildingType === "tavern" ||
        b.buildingType === "manor" ||
        b.buildingType === "watermill" ||
        b.buildingType === "blacksmith";

      if (hasEst || (zoom >= 180 && isKeyCivic)) {
        ctx.save();
        const bx = toX(b.center[0]);
        const by = toY(b.center[1]);

        ctx.font = zoom >= 140
          ? "italic bold 10.5px 'Baskerville', 'Georgia', serif"
          : "italic bold 8.5px 'Baskerville', 'Georgia', serif";
        ctx.fillStyle = "#0f172a";
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
        ctx.shadowBlur = 4;

        const mainLabel = b.establishment ? b.establishment.name : (
          b.buildingType === "cathedral" ? "Great Cathedral" :
          b.buildingType === "temple" ? "Sanctuary" :
          b.buildingType === "townhall" ? "Town Hall" :
          b.buildingType === "keep" ? "Citadel Keep" :
          b.buildingType === "inn" ? "Coaching Inn" :
          b.buildingType === "tavern" ? "Tavern" :
          b.buildingType === "blacksmith" ? "Blacksmith Forge" :
          b.buildingType === "manor" ? "Patrician Manor" :
          b.buildingType === "watermill" ? "Watermill" : "Chapel"
        );
        ctx.fillText(mainLabel, bx, by - b.lengthM * metersToPx * 0.75);

        // Secondary trade / proprietor subtitle at extreme zoom
        if (zoom >= 180 && b.establishment) {
          ctx.font = "normal 8px 'Inter', sans-serif";
          ctx.fillStyle = "#475569";
          ctx.fillText(b.establishment.proprietor, bx, by - b.lengthM * metersToPx * 0.75 + 10);
        }
        ctx.restore();
      }
    }
  }
}
