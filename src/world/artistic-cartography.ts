import type { MapFeature, Pt } from "./types";

// ---------------------------------------------------------------------------
// ARTISTIC CARTOGRAPHY RENDERER — "The Isles of Great Gidding" Style
//
// Procedural hand-drawn fantasy cartography:
//  1. Isometric shaded mountain ridges with NW sunlit slopes & SE hatched shading
//  2. Multi-ring coastal water echoes (concentric tide ripple lines)
//  3. Hand-inked forest canopy clusters & groves
//  4. Medieval architectural settlement icons (castles, towers, gabled villages, abbeys)
//  5. Illuminated parchment scrolls & ribbon banners
//  6. Calligraphic ocean lettering & map title cartouche
// ---------------------------------------------------------------------------

export interface CartoTransform {
  toX: (x: number) => number;
  toY: (y: number) => number;
  scale: number;
}

// ---------------------------------------------------------------------------
// 1. Coastal Echo Ripples (the concentric antique waterlines)
// ---------------------------------------------------------------------------
export function drawCoastalEchoRipples(
  ctx: CanvasRenderingContext2D,
  landLayer: MapFeature[],
  toX: (x: number) => number,
  toY: (y: number) => number,
  scale: number
) {
  if (!landLayer.length) return;

  ctx.save();
  // Trace all land polygons into a path
  const traceAllLand = () => {
    ctx.beginPath();
    for (const l of landLayer) {
      const rings = l.geometry.type === "Polygon"
        ? (l.geometry.coordinates as Pt[][])
        : (l.geometry.coordinates as Pt[][][]).flat();
      for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        ctx.moveTo(toX(ring[0][0]), toY(ring[0][1]));
        for (let i = 1; i < ring.length; i++) {
          ctx.lineTo(toX(ring[i][0]), toY(ring[i][1]));
        }
        ctx.closePath();
      }
    }
  };

  // Ring 1: Dark ink shoreline shadow (immediate water rim)
  traceAllLand();
  ctx.strokeStyle = "rgba(18, 32, 40, 0.45)";
  ctx.lineWidth = Math.max(3, 5 * Math.min(1.8, Math.sqrt(scale * 120)));
  ctx.stroke();

  // Ring 2: Primary water ripple (crisp, delicate line ~4px out)
  traceAllLand();
  ctx.strokeStyle = "rgba(180, 215, 230, 0.22)";
  ctx.lineWidth = Math.max(7, 10 * Math.min(1.8, Math.sqrt(scale * 120)));
  ctx.stroke();

  // Ring 3: Secondary outer ripple line (~9px out)
  traceAllLand();
  ctx.strokeStyle = "rgba(180, 215, 230, 0.12)";
  ctx.lineWidth = Math.max(13, 18 * Math.min(1.8, Math.sqrt(scale * 120)));
  ctx.stroke();

  // Ring 4: Faint tertiary ripple line (~16px out)
  traceAllLand();
  ctx.strokeStyle = "rgba(180, 215, 230, 0.05)";
  ctx.lineWidth = Math.max(20, 28 * Math.min(1.8, Math.sqrt(scale * 120)));
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 2. Isometric Shaded Mountain Massifs (Great Gidding hand-inked ridges)
// ---------------------------------------------------------------------------
export function drawArtisticMountainRange(
  ctx: CanvasRenderingContext2D,
  f: MapFeature,
  t: CartoTransform
) {
  const rings = f.geometry.coordinates as Pt[][];
  if (!rings || !rings.length || rings[0].length < 4) return;
  const ring = rings[0];
  const { toX, toY, scale } = t;

  // Compute bounding box on screen
  const sPts = ring.map(([x, y]) => [toX(x), toY(y)] as Pt);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of sPts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < 6) return;

  ctx.save();

  // Base parchment underlay for mountain massif
  ctx.beginPath();
  ctx.moveTo(sPts[0][0], sPts[0][1]);
  for (let i = 1; i < sPts.length; i++) ctx.lineTo(sPts[i][0], sPts[i][1]);
  ctx.closePath();
  ctx.fillStyle = "#829768"; // slightly elevated olive tone
  ctx.fill();

  // Divide the mountain ribbon into longitudinal centerline and transverse spurs
  const n = Math.floor(sPts.length / 2);
  const leftFlank: Pt[] = [];
  const rightFlank: Pt[] = [];
  for (let i = 0; i < n; i++) leftFlank.push(sPts[i]);
  for (let i = sPts.length - 1; i >= n; i--) rightFlank.push(sPts[i]);

  const numSpurs = Math.max(3, Math.min(28, Math.floor(span / 24)));
  const spine: Pt[] = [];

  // Generate main ridge spine
  for (let j = 0; j <= numSpurs; j++) {
    const frac = j / numSpurs;
    const lIdx = Math.min(leftFlank.length - 1, Math.floor(frac * (leftFlank.length - 1)));
    const rIdx = Math.min(rightFlank.length - 1, Math.floor(frac * (rightFlank.length - 1)));
    const lp = leftFlank[lIdx];
    const rp = rightFlank[rIdx];
    // Center spine with slight natural wobble
    const wobble = Math.sin(j * 1.8) * 4;
    const cx = (lp[0] + rp[0]) / 2 + wobble;
    const cy = (lp[1] + rp[1]) / 2 - Math.abs(wobble) * 0.5; // elevate crest upward
    spine.push([cx, cy]);
  }

  // Draw mountain facets: NW illuminated slope (sunlit) vs SE shaded slope (hatched)
  for (let j = 0; j < numSpurs; j++) {
    const c1 = spine[j];
    const c2 = spine[j + 1];
    const frac1 = j / numSpurs;
    const frac2 = (j + 1) / numSpurs;

    const l1 = leftFlank[Math.min(leftFlank.length - 1, Math.floor(frac1 * (leftFlank.length - 1)))];
    const l2 = leftFlank[Math.min(leftFlank.length - 1, Math.floor(frac2 * (leftFlank.length - 1)))];
    const r1 = rightFlank[Math.min(rightFlank.length - 1, Math.floor(frac1 * (rightFlank.length - 1)))];
    const r2 = rightFlank[Math.min(rightFlank.length - 1, Math.floor(frac2 * (rightFlank.length - 1)))];

    // Determine which side is NW (sunlit) vs SE (shadow)
    // Sunlight vector comes from [-1, -1] (North-West)
    const midSpine: Pt = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
    const midLeft: Pt = [(l1[0] + l2[0]) / 2, (l1[1] + l2[1]) / 2];
    const vLx = midLeft[0] - midSpine[0];
    const vLy = midLeft[1] - midSpine[1];
    // Dot product with sun direction (-1, -1)
    const leftSunDot = -vLx - vLy;

    const sunP1 = leftSunDot > 0 ? l1 : r1;
    const sunP2 = leftSunDot > 0 ? l2 : r2;
    const shadeP1 = leftSunDot > 0 ? r1 : l1;
    const shadeP2 = leftSunDot > 0 ? r2 : l2;

    // 1. Draw Sunlit Slope (Warm bone/cream stone tone)
    ctx.beginPath();
    ctx.moveTo(c1[0], c1[1]);
    ctx.lineTo(c2[0], c2[1]);
    ctx.lineTo(sunP2[0], sunP2[1]);
    ctx.lineTo(sunP1[0], sunP1[1]);
    ctx.closePath();
    ctx.fillStyle = j % 2 === 0 ? "#ded9c8" : "#cfc8b4"; // alternating light stone
    ctx.fill();

    // Subtle sunlit ridge highlight stroke
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. Draw Shadow Slope (Dark olive-stone with hand-inked cross hatching)
    ctx.beginPath();
    ctx.moveTo(c1[0], c1[1]);
    ctx.lineTo(c2[0], c2[1]);
    ctx.lineTo(shadeP2[0], shadeP2[1]);
    ctx.lineTo(shadeP1[0], shadeP1[1]);
    ctx.closePath();
    ctx.fillStyle = j % 2 === 0 ? "#434739" : "#363b2f"; // dark rock shade
    ctx.fill();

    // Hand-drawn parallel pen hachures down the shadow slope
    ctx.strokeStyle = "rgba(22, 28, 20, 0.65)";
    ctx.lineWidth = 0.8;
    const numHachures = 4;
    for (let h = 1; h <= numHachures; h++) {
      const ht = h / (numHachures + 1);
      const startX = c1[0] + (c2[0] - c1[0]) * ht;
      const startY = c1[1] + (c2[1] - c1[1]) * ht;
      const endX = shadeP1[0] + (shadeP2[0] - shadeP1[0]) * ht;
      const endY = shadeP1[1] + (shadeP2[1] - shadeP1[1]) * ht;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      // Slight natural curve to hachure stroke
      const midX = (startX + endX) / 2 + (j % 2 === 0 ? 1.5 : -1.5);
      const midY = (startY + endY) / 2;
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }
  }

  // Draw sharp hand-inked rocky ridge crest line
  ctx.strokeStyle = "#1b231a"; // dark ink
  ctx.lineWidth = Math.max(1.2, 1.8 * Math.min(2, Math.sqrt(scale * 120)));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(spine[0][0], spine[0][1]);
  for (let j = 1; j < spine.length; j++) {
    ctx.lineTo(spine[j][0], spine[j][1]);
  }
  ctx.stroke();

  // Draw outer ridge base ink outline
  ctx.strokeStyle = "rgba(27, 35, 26, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sPts[0][0], sPts[0][1]);
  for (let i = 1; i < sPts.length; i++) ctx.lineTo(sPts[i][0], sPts[i][1]);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3. Hand-Drawn Tolkien Peak Crags (Authentic human-inked mountain massifs)
// ---------------------------------------------------------------------------

function makePeakRng(seedStr: string): () => number {
  let s = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    s = Math.imul(s ^ seedStr.charCodeAt(i), 16777619) >>> 0;
  }
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PeakStyleOptions {
  sunlitFill?: string;
  shadowFill?: string;
  inkStroke?: string;
  hatchStroke?: string;
  snowFill?: string;
}

export function drawArtisticPeak(
  ctx: CanvasRenderingContext2D,
  f: MapFeature,
  t: CartoTransform,
  style?: PeakStyleOptions
) {
  const p = f.geometry.coordinates as Pt;
  const x = t.toX(p[0]);
  const y = t.toY(p[1]);
  const elev = f.properties.elevation ?? 2000;
  const size = Math.max(9, Math.min(26, (elev / 1200) * 4.6 * Math.min(2, Math.sqrt(t.scale * 120))));

  const seed = `${f.properties.id || f.properties.name || ""}_${p[0].toFixed(3)}_${p[1].toFixed(3)}`;
  const rng = makePeakRng(seed);

  const sunlitFill = style?.sunlitFill ?? "#ded8c7";
  const shadowFill = style?.shadowFill ?? "#353a2e";
  const inkStroke = style?.inkStroke ?? "#182117";
  const hatchStroke = style?.hatchStroke ?? "#151b14";
  const snowFill = style?.snowFill ?? "#fbf9f4";

  ctx.save();

  const drawSinglePeak = (
    baseX: number,
    baseY: number,
    w: number,
    h: number,
    leanOffset: number,
    ridgeWobble: number,
    includeSnow: boolean
  ) => {
    const apexX = baseX + leanOffset;
    const apexY = baseY - h;

    const leftFootX = baseX - w;
    const rightFootX = baseX + w * 0.95;
    const footY = baseY + h * 0.12;

    const lMidX = baseX - w * 0.58 + leanOffset * 0.4;
    const lMidY = baseY - h * 0.48;
    const lStepX = lMidX + w * 0.05;
    const lStepY = lMidY - h * 0.05;

    const rMidX = baseX + w * 0.52 + leanOffset * 0.4;
    const rMidY = baseY - h * 0.48;
    const rStepX = rMidX - w * 0.05;
    const rStepY = rMidY - h * 0.05;

    const spineMidX = baseX + leanOffset * 0.5 + ridgeWobble;
    const spineMidY = baseY - h * 0.42;
    const spineLowX = baseX + ridgeWobble * 0.6;
    const spineLowY = baseY - h * 0.1;
    const spineBaseX = baseX + leanOffset * 0.15;
    const spineBaseY = footY - h * 0.04;

    // --- Pass 1: Sunlit (Left) Face ---
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.quadraticCurveTo(lStepX, lStepY, lMidX, lMidY);
    ctx.quadraticCurveTo(baseX - w * 0.8, baseY - h * 0.15, leftFootX, footY);
    ctx.quadraticCurveTo(baseX - w * 0.3, footY + h * 0.03, spineBaseX, spineBaseY);
    ctx.lineTo(spineLowX, spineLowY);
    ctx.lineTo(spineMidX, spineMidY);
    ctx.lineTo(apexX, apexY);
    ctx.closePath();
    ctx.fillStyle = sunlitFill;
    ctx.fill();

    // Delicate sunlit rock ledge ticks
    ctx.strokeStyle = "rgba(24, 33, 23, 0.28)";
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(lMidX + w * 0.08, lMidY);
    ctx.lineTo(lMidX + w * 0.22, lMidY + h * 0.04);
    ctx.moveTo(baseX - w * 0.35, baseY - h * 0.25);
    ctx.lineTo(baseX - w * 0.2, baseY - h * 0.22);
    ctx.stroke();

    // --- Pass 2: Shadow (Right) Face ---
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(spineMidX, spineMidY);
    ctx.lineTo(spineLowX, spineLowY);
    ctx.lineTo(spineBaseX, spineBaseY);
    ctx.quadraticCurveTo(baseX + w * 0.35, footY + h * 0.03, rightFootX, footY);
    ctx.quadraticCurveTo(baseX + w * 0.78, baseY - h * 0.15, rMidX, rMidY);
    ctx.quadraticCurveTo(rStepX, rStepY, apexX, apexY);
    ctx.closePath();
    ctx.fillStyle = shadowFill;
    ctx.fill();

    // --- Pass 3: Hand-inked slope hachures on shadow face ---
    ctx.strokeStyle = hatchStroke;
    ctx.lineWidth = Math.max(0.6, Math.min(1.1, w * 0.06));
    ctx.lineCap = "round";

    const hachureCount = Math.max(4, Math.min(9, Math.floor(h / 3.2)));
    for (let k = 1; k <= hachureCount; k++) {
      const frac = k / (hachureCount + 1);
      const startX = apexX + (spineBaseX - apexX) * frac + (k % 2 === 0 ? 0.8 : -0.8);
      const startY = apexY + (spineBaseY - apexY) * frac;
      const endX = apexX + (rightFootX - apexX) * (frac * 0.95 + 0.12);
      const endY = apexY + (footY - apexY) * (frac * 0.9 + 0.15);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      const cpX = (startX + endX) / 2 + w * 0.08;
      const cpY = (startY + endY) / 2 - h * 0.02;
      ctx.quadraticCurveTo(cpX, cpY, endX, endY);
      ctx.stroke();
    }

    // --- Pass 4: Snowcap on high summits ---
    if (includeSnow) {
      ctx.fillStyle = snowFill;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      const snowLeftX = apexX - w * 0.28;
      const snowLeftY = apexY + h * 0.24;
      ctx.lineTo(snowLeftX, snowLeftY);
      ctx.lineTo(apexX - w * 0.12, apexY + h * 0.18);
      ctx.lineTo(spineMidX, apexY + h * 0.28);
      ctx.lineTo(apexX + w * 0.14, apexY + h * 0.2);
      const snowRightX = apexX + w * 0.26;
      const snowRightY = apexY + h * 0.24;
      ctx.lineTo(snowRightX, snowRightY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = inkStroke;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(snowLeftX, snowLeftY);
      ctx.lineTo(apexX - w * 0.12, apexY + h * 0.18);
      ctx.lineTo(spineMidX, apexY + h * 0.28);
      ctx.lineTo(apexX + w * 0.14, apexY + h * 0.2);
      ctx.lineTo(snowRightX, snowRightY);
      ctx.stroke();
    }

    // --- Pass 5: Hand-inked outer contour linework ---
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = Math.max(0.85, Math.min(1.6, w * 0.08));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Left flank stroke
    ctx.beginPath();
    ctx.moveTo(leftFootX, footY);
    ctx.quadraticCurveTo(baseX - w * 0.8, baseY - h * 0.15, lMidX, lMidY);
    ctx.quadraticCurveTo(lStepX, lStepY, apexX, apexY);
    ctx.stroke();

    // Right flank stroke
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.quadraticCurveTo(rStepX, rStepY, rMidX, rMidY);
    ctx.quadraticCurveTo(baseX + w * 0.78, baseY - h * 0.15, rightFootX, footY);
    ctx.stroke();

    // Flared foothill base ground line
    ctx.beginPath();
    ctx.moveTo(leftFootX - w * 0.08, footY + h * 0.02);
    ctx.quadraticCurveTo(leftFootX, footY, baseX, footY + h * 0.04);
    ctx.quadraticCurveTo(rightFootX, footY, rightFootX + w * 0.08, footY + h * 0.02);
    ctx.stroke();

    // Distinct hand-inked central arête crest line
    ctx.lineWidth = Math.max(1.1, Math.min(2.0, w * 0.1));
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(spineMidX, spineMidY);
    ctx.lineTo(spineLowX, spineLowY);
    ctx.lineTo(spineBaseX, spineBaseY);
    ctx.stroke();
  };

  // 1. Companion shoulder peak (~65% of mountains have one)
  const hasShoulder = rng() < 0.65;
  if (hasShoulder) {
    const shoulderLeft = rng() < 0.5;
    const shoulderScale = 0.58 + rng() * 0.22;
    const shOffsetX = (shoulderLeft ? -1 : 1) * size * (0.65 + rng() * 0.25);
    const shOffsetY = -size * 0.08;
    const shW = size * shoulderScale * 0.85;
    const shH = size * (1.1 + rng() * 0.3) * shoulderScale;
    const shLean = (rng() - 0.5) * 0.2 * shW;
    const shWobble = (rng() - 0.5) * 0.3 * shW;

    drawSinglePeak(
      x + shOffsetX,
      y + shOffsetY,
      shW,
      shH,
      shLean,
      shWobble,
      elev > 4200
    );
  }

  // 2. Main dominant peak
  const mainH = size * (1.2 + rng() * 0.35);
  const mainW = size * (0.95 + rng() * 0.25);
  const mainLean = (rng() - 0.5) * 0.28 * mainW;
  const mainWobble = (rng() - 0.5) * 0.3 * mainW;

  drawSinglePeak(x, y, mainW, mainH, mainLean, mainWobble, elev > 3800);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 4. Hand-Drawn Forest Canopy Groves (Scalloped tree clumps)
// ---------------------------------------------------------------------------
export function drawArtisticForestGroves(
  ctx: CanvasRenderingContext2D,
  f: MapFeature,
  t: CartoTransform
) {
  const rings = f.geometry.coordinates as Pt[][];
  if (!rings || !rings.length) return;
  const ring = rings[0];
  const { toX, toY } = t;

  const sPts = ring.map(([x, y]) => [toX(x), toY(y)] as Pt);
  if (sPts.length < 4) return;

  ctx.save();

  // 1. Base organic green woodland wash
  ctx.beginPath();
  ctx.moveTo(sPts[0][0], sPts[0][1]);
  for (let i = 1; i < sPts.length; i++) ctx.lineTo(sPts[i][0], sPts[i][1]);
  ctx.closePath();
  ctx.fillStyle = "rgba(68, 98, 48, 0.55)"; // rich sage moss
  ctx.fill();

  // 2. Hand-drawn scalloped tree canopy clumps along border and inside
  const stride = Math.max(3, Math.floor(sPts.length / 16));
  ctx.fillStyle = "#3e5b2b"; // darker leaf green
  ctx.strokeStyle = "#182613"; // dark ink
  ctx.lineWidth = 0.9;

  for (let i = 0; i < sPts.length; i += stride) {
    const p = sPts[i];
    const r = 4.5 + (i % 3) * 1.5;

    // Small scalloped canopy mound
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Second smaller overlapping crown puff
    ctx.beginPath();
    ctx.arc(p[0] + r * 0.6, p[1] - r * 0.2, r * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tiny tree trunk tick mark
    ctx.strokeStyle = "#251c10";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1] + r);
    ctx.lineTo(p[0], p[1] + r + 2.5);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 5. Illustrated Medieval Settlement Icons (Great Gidding architecture)
// ---------------------------------------------------------------------------
export function drawArtisticSettlementIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: string,
  type: string,
  scale: number
) {
  ctx.save();
  ctx.translate(x, y);

  // Scale icon size gently with zoom
  const s = Math.max(0.85, Math.min(1.5, Math.sqrt(scale * 100)));
  ctx.scale(s, s);

  // Common colors from reference image
  const stoneColor = "#f0ebd9"; // pale warm sandstone
  const stoneShadow = "#c8bfab"; // shaded sandstone wall
  const inkColor = "#1a241f"; // dark ink
  const roofColor = "#8c4428"; // terracotta/timber roof

  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = "miter";
  ctx.lineCap = "square";

  if (tier === "metropolis" || type === "capital_city" || type === "fortress_city") {
    // ---- GRAND FORTIFIED CASTLE & KEEP ----
    // Drop shadow
    ctx.fillStyle = "rgba(20, 32, 25, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 7, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Curtain wall
    ctx.fillStyle = stoneShadow;
    ctx.fillRect(-10, -2, 20, 8);
    ctx.strokeRect(-10, -2, 20, 8);

    // Left round tower
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-11, -8, 6, 14);
    ctx.strokeRect(-11, -8, 6, 14);
    // Left crenelations
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-12, -10, 8, 2.5);
    ctx.strokeRect(-12, -10, 8, 2.5);

    // Right round tower
    ctx.fillStyle = stoneShadow;
    ctx.fillRect(5, -8, 6, 14);
    ctx.strokeRect(5, -8, 6, 14);
    // Right crenelations
    ctx.fillStyle = stoneColor;
    ctx.fillRect(4, -10, 8, 2.5);
    ctx.strokeRect(4, -10, 8, 2.5);

    // High central keep
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-4, -12, 8, 14);
    ctx.strokeRect(-4, -12, 8, 14);
    // Central keep crenelations
    ctx.fillRect(-5, -14, 10, 2.5);
    ctx.strokeRect(-5, -14, 10, 2.5);

    // Conical roof or flag on capital
    if (type === "capital_city" || tier === "metropolis") {
      ctx.fillStyle = roofColor;
      ctx.beginPath();
      ctx.moveTo(-5, -14);
      ctx.lineTo(0, -20);
      ctx.lineTo(5, -14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Golden pennant flag
      ctx.strokeStyle = "#1a241f";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(0, -24);
      ctx.lineTo(4, -22);
      ctx.lineTo(0, -20);
      ctx.fillStyle = "#e5a823";
      ctx.fill();
      ctx.stroke();
    }

    // Arched portcullis gatehouse
    ctx.fillStyle = "#1e1e1a";
    ctx.beginPath();
    ctx.arc(0, 6, 2.5, Math.PI, 0);
    ctx.rect(-2.5, 3.5, 5, 2.5);
    ctx.fill();
  } else if (tier === "city" || tier === "town" || type.includes("town") || type.includes("port")) {
    // ---- WALLED TOWN / TWIN TOWERS ----
    ctx.fillStyle = "rgba(20, 32, 25, 0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 10, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Connecting wall
    ctx.fillStyle = stoneShadow;
    ctx.fillRect(-6, 0, 12, 5);
    ctx.strokeRect(-6, 0, 12, 5);

    // Left tower
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-8, -6, 5, 11);
    ctx.strokeRect(-8, -6, 5, 11);
    ctx.fillRect(-9, -8, 7, 2);
    ctx.strokeRect(-9, -8, 7, 2);

    // Right tower
    ctx.fillStyle = stoneShadow;
    ctx.fillRect(3, -6, 5, 11);
    ctx.strokeRect(3, -6, 5, 11);
    ctx.fillRect(2, -8, 7, 2);
    ctx.strokeRect(2, -8, 7, 2);

    // Gate
    ctx.fillStyle = "#1e1e1a";
    ctx.beginPath();
    ctx.arc(0, 5, 1.8, Math.PI, 0);
    ctx.fill();
  } else if (tier === "village" || type.includes("village")) {
    // ---- VILLAGE COTTAGES WITH CHURCH SPIRE ----
    ctx.fillStyle = "rgba(20, 32, 25, 0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 4, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Left cottage with gable roof
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-7, -1, 5, 5);
    ctx.strokeRect(-7, -1, 5, 5);
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(-8, -1);
    ctx.lineTo(-4.5, -5);
    ctx.lineTo(-1, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center church steeple
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-2, -3, 4, 7);
    ctx.strokeRect(-2, -3, 4, 7);
    ctx.fillStyle = "#3b4845"; // slate steeple
    ctx.beginPath();
    ctx.moveTo(-2.5, -3);
    ctx.lineTo(0, -9);
    ctx.lineTo(2.5, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Right cottage
    ctx.fillStyle = stoneColor;
    ctx.fillRect(2, 0, 5, 4);
    ctx.strokeRect(2, 0, 5, 4);
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(4.5, -3.5);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "monastery") {
    // ---- MONASTERY ABBEY ----
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-5, -3, 10, 7);
    ctx.strokeRect(-5, -3, 10, 7);
    // Bell tower
    ctx.fillRect(1, -9, 4, 7);
    ctx.strokeRect(1, -9, 4, 7);
    // Cloister arch
    ctx.fillStyle = "#1e1e1a";
    ctx.beginPath();
    ctx.arc(-2, 4, 1.5, Math.PI, 0);
    ctx.fill();
  } else {
    // ---- SOLITARY CRENELLATED TOWER (Moelfre / Aberdaron / Watchtower) ----
    ctx.fillStyle = "rgba(20, 32, 25, 0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main tower shaft
    ctx.fillStyle = stoneColor;
    ctx.fillRect(-3, -5, 6, 10);
    ctx.strokeRect(-3, -5, 6, 10);

    // Overhanging battlements & crenelations
    ctx.fillRect(-4, -7.5, 8, 2.5);
    ctx.strokeRect(-4, -7.5, 8, 2.5);

    // Slit windows & door
    ctx.fillStyle = "#1e1e1a";
    ctx.fillRect(-0.6, -2, 1.2, 2.5);
    ctx.beginPath();
    ctx.arc(0, 5, 1.2, Math.PI, 0);
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 6. Illuminated Parchment Banners (The iconic fantasy ribbon scrolls!)
// ---------------------------------------------------------------------------
export function drawIlluminatedScrollBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  title: string,
  subtext?: string
) {
  ctx.save();
  ctx.font = "italic bold 11px 'Baskerville', 'Georgia', 'Palatino', serif";
  const metrics = ctx.measureText(title);
  const textW = Math.max(50, metrics.width);
  const bw = textW + 28; // banner width
  const bh = 18; // banner height
  const x = cx - bw / 2;
  const y = cy - bh / 2;

  // Drop shadow under scroll
  ctx.fillStyle = "rgba(15, 26, 32, 0.4)";
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 3, bw, bh, 3);
  ctx.fill();

  // Left & Right folded swallowtail tails (behind banner)
  const tailW = 12;
  const tailH = 14;

  // Left tail
  ctx.fillStyle = "#baa888"; // darker parchment shadow
  ctx.strokeStyle = "#221c15";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 3, y + 2);
  ctx.lineTo(x - tailW, y - 1);
  ctx.lineTo(x - tailW + 4, y + tailH / 2);
  ctx.lineTo(x - tailW, y + tailH);
  ctx.lineTo(x + 3, y + bh - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right tail
  ctx.beginPath();
  ctx.moveTo(x + bw - 3, y + 2);
  ctx.lineTo(x + bw + tailW, y - 1);
  ctx.lineTo(x + bw + tailW - 4, y + tailH / 2);
  ctx.lineTo(x + bw + tailW, y + tailH);
  ctx.lineTo(x + bw - 3, y + bh - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Main parchment ribbon body with curved arched edges
  const grad = ctx.createLinearGradient(0, y, 0, y + bh);
  grad.addColorStop(0, "#fefcf6"); // bright cream
  grad.addColorStop(0.5, "#f3ecdb"); // warm parchment
  grad.addColorStop(1, "#dfd3bc"); // shaded bottom edge

  ctx.fillStyle = grad;
  ctx.strokeStyle = "#261d15"; // crisp dark brown-black ink
  ctx.lineWidth = 1.3;

  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.quadraticCurveTo(cx, y - 1.5, x + bw, y + 3);
  ctx.lineTo(x + bw, y + bh - 3);
  ctx.quadraticCurveTo(cx, y + bh + 1.5, x, y + bh - 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Delicate inner ink frame line
  ctx.strokeStyle = "rgba(100, 75, 45, 0.35)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x + 2.5, y + 4.5);
  ctx.quadraticCurveTo(cx, y + 0.5, x + bw - 2.5, y + 4.5);
  ctx.lineTo(x + bw - 2.5, y + bh - 4.5);
  ctx.quadraticCurveTo(cx, y + bh - 0.5, x + 2.5, y + bh - 4.5);
  ctx.closePath();
  ctx.stroke();

  // Lettering: Black hand-drawn medieval calligraphy
  ctx.fillStyle = "#1b140d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic bold 11.5px 'Baskerville', 'Georgia', 'Palatino', serif";
  ctx.fillText(title, cx, cy);

  if (subtext) {
    ctx.font = "italic 8px 'Georgia', serif";
    ctx.fillStyle = "#5c4d3c";
    ctx.fillText(subtext, cx, cy + bh * 0.9);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 7. Calligraphic Sea Titles with Wide Tracking & Map Title Cartouche
// ---------------------------------------------------------------------------
export function drawArtisticOceanTitles(
  ctx: CanvasRenderingContext2D,
  seas: MapFeature[],
  toX: (x: number) => number,
  toY: (y: number) => number,
  scale: number
) {
  if (!seas.length) return;
  ctx.save();

  // Wide letter-spaced capitals across the water (Great Gidding style: S K E L D I S H   C H A N N E L)
  ctx.fillStyle = "rgba(190, 220, 235, 0.35)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const s of seas) {
    const ring = s.geometry.coordinates[0] as Pt[];
    if (!ring || ring.length < 3) continue;
    let cx = 0, cy = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; }
    cx /= ring.length;
    cy /= ring.length;

    const sx = toX(cx);
    const sy = toY(cy);

    // Format title with wide tracking: "O R C A D I A N   O C E A N"
    const rawName = s.properties.name.toUpperCase();
    const spaced = rawName.split("").join(" ");

    const fontSize = Math.max(10, Math.min(22, 14 * Math.min(1.8, Math.sqrt(scale * 120))));
    ctx.font = `italic 600 ${fontSize}px 'Baskerville', 'Georgia', serif`;
    ctx.fillText(spaced, sx, sy);
  }

  ctx.restore();
}

export function drawArtisticTitleCartouche(
  ctx: CanvasRenderingContext2D,
  worldName: string,
  _W: number,
  H: number
) {
  ctx.save();
  // Bottom-left corner placement like in reference
  const x = 32;
  const y = H - 65;

  ctx.textAlign = "left";
  ctx.fillStyle = "#d8e6eb"; // soft parchment glow

  ctx.font = "italic 15px 'Georgia', 'Palatino', serif";
  ctx.fillText("The", x + 16, y);
  ctx.font = "bold 20px 'Cinzel', 'Baskerville', 'Georgia', serif";
  ctx.fillText("Isles", x + 12, y + 20);
  ctx.font = "italic 13px 'Georgia', serif";
  ctx.fillText("of", x + 58, y + 19);

  // Large decorative title
  ctx.font = "bold 26px 'Cinzel', 'Baskerville', 'Palatino', serif";
  ctx.fillStyle = "#f0f6f8";
  ctx.fillText(worldName, x, y + 46);

  ctx.font = "italic 10px 'Georgia', serif";
  ctx.fillStyle = "rgba(180, 210, 225, 0.6)";
  ctx.fillText("procedural cartography", x + 12, y + 62);

  ctx.restore();
}
