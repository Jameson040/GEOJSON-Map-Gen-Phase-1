import type { GenProgress, Pt, VerificationReport } from "../types";
import type { SettlementTier } from "../human/human-types";

// ---------------------------------------------------------------------------
// LAYER 6 — ROADS & TRADE ROUTES (Inter-Settlement Connective Tissue)
//
// Connects the settlements of Layer 4 across the terrain of Layer 1.
// Follows physical cost-distance rules: river valleys, mountain passes,
// and natural harbors, with historical Central Place hierarchy.
// ---------------------------------------------------------------------------

export type RouteType =
  | "highway"        // King's highway / imperial paved trunk road (capitals & cities)
  | "arterial"       // Regional market road (towns to cities, town to town)
  | "byway"          // Rural feeder track (hamlets, farming villages, resource camps to market)
  | "mountain_pass"  // Defended high-altitude pass through rugged mountain crests
  | "sea_lane";      // Maritime shipping channel connecting coastal ports

export interface RouteFeature {
  id: string;
  layer: "routes";
  name: string;
  type: RouteType;
  startSettlementId: string;
  startSettlementName: string;
  startTier: SettlementTier;
  endSettlementId: string;
  endSettlementName: string;
  endTier: SettlementTier;
  /** Ordered coordinates in world-space forming the curved path. */
  points: Pt[];
  /** Geographical path length in kilometers. */
  lengthKm: number;
  /** Straight-line distance between start and end. */
  straightKm: number;
  /** Sinuosity ratio = lengthKm / straightKm (1.0 = straight line, 1.4 = winding valley). */
  sinuosity: number;
  /** Whether the route is paved with stone or packed earth / gravel. */
  paved: boolean;
  /** River crossings along this route requiring bridges or fords. */
  bridgesCount: number;
  /** Mountain saddles traversed. */
  mountainPassesCount: number;
  /** Trade goods that flow along this route. */
  tradeGoods: string[];
  /** Minimum camera zoom level to render this route (0 for highways, 1.5 for byways). */
  lodZoom: number;
}

export interface RouteConfig {
  /** Multiplier for overall network density (0.5 = sparse trunk only, 1.5 = dense web). */
  density: number;
  /** Include coastal maritime shipping routes between ports. */
  coastalShipping: boolean;
  /** Target share of major highways to pave with stone (0.1 to 0.8). */
  pavedHighwayShare: number;
  /** Custom seed override. */
  customSeed?: string;
}

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  density: 1.0,
  coastalShipping: true,
  pavedHighwayShare: 0.45,
};

export interface RouteStats {
  totalRoutes: number;
  totalKm: number;
  highwaysKm: number;
  arterialsKm: number;
  bywaysKm: number;
  seaLanesKm: number;
  highwaysCount: number;
  arterialsCount: number;
  bywaysCount: number;
  seaLanesCount: number;
  pavedKm: number;
  bridgesCount: number;
  connectedSettlementsCount: number;
  connectivityRatio: number; // 0..1 ratio of non-nomadic settlements connected to network
  longestRouteName: string;
  longestRouteKm: number;
}

export interface RouteFinetuneReport {
  rawRoutesCount: number;
  prunedDuplicates: number;
  relocatedOffOcean: number;
  bridgesAdded: number;
  finalRoutesCount: number;
  droppedByRule: Record<string, number>;
  elapsedMs: number;
}

export interface RouteLayerResult {
  regionId: string;
  regionName: string;
  config: RouteConfig;
  seedUsed: string;
  routes: RouteFeature[];
  rawRoutes: RouteFeature[];
  stats: RouteStats;
  report: RouteFinetuneReport;
  verifyBefore: VerificationReport;
  verifyAfter: VerificationReport;
  generatedAt: number;
}

export type RouteProgressFn = (p: GenProgress) => void;
