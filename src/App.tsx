import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  BBox,
  ConflictRecord,
  GenProgress,
  MapFeature,
  MapThemeId,
  PlanetConfig,
  PlanetMacro,
  RegionConfig,
  RegionDescriptor,
  WorkspaceTab,
} from "./world/types";
import { generatePlanetMacro } from "./world/tier1-planet";
import { generateRegionDetail } from "./world/tier2-region";
import { SpatialGrid } from "./world/spatial-index";
import { DEFAULT_LAYERS, type RenderLayers } from "./world/canvas-renderer";
import { PLANET_WIDTH, PLANET_HEIGHT } from "./world/constants";
import { MapViewer } from "./components/MapViewer";
import { TabBar } from "./components/TabBar";
import { Inspector } from "./components/Inspector";
import { RegionBrowser, LayersPanel, StatsPanel, LandmarkList } from "./components/Sidebar";
import {
  PlanetSetupModal,
  RegionGenerateModal,
  LogModal,
  ArchitectureModal,
} from "./components/Modals";
import { VerifierModal } from "./components/VerifierModal";
import { SizeClassModal } from "./components/SizeClassModal";
import { ResourceModal } from "./components/ResourceModal";
import { generateResourceLayer, DEFAULT_RESOURCE_CONFIG, type ResourceFilterConfig } from "./world/resources";
import { BioModal } from "./components/BioModal";
import { generateBioLayer } from "./world/bio/bio-generate";
import type { BioConfig } from "./world/bio/bio-types";
import { CATEGORY_COLORS } from "./world/bio/species-catalog";
import { HumanModal } from "./components/HumanModal";
import { generateHumanLayer } from "./world/human/human-generate";
import type { HumanConfig } from "./world/human/human-types";
import { PopulationModal } from "./components/PopulationModal";
import { generatePopulationLayer } from "./world/population/population-generate";
import type { PopulationConfig } from "./world/population/population-types";
import { CadastreModal } from "./components/CadastreModal";
import { generateCadastreLayer } from "./world/cadastre/cadastre-cache";
import { RouteModal } from "./components/RouteModal";
import { generateRouteLayer } from "./world/routes/route-generate";
import type { RouteConfig } from "./world/routes/route-types";
import type { WorldLayerId } from "./world/layers";
import { LAYER_BY_ID } from "./world/layers";
import { BackupModal } from "./components/BackupModal";
import { RecoveryBoundary } from "./components/RecoveryBoundary";
import { createCheckpoint, deserializeCadastres, deserializePopulations, type WorkspaceCheckpoint } from "./workspace/checkpoint";
import { useWorldLayers } from "./workspace/world-store";
import { exportMacroGeoJSON, exportRegionWorldGeoJSON, downloadText } from "./world/export-geojson";
import {
  Globe2,
  Sliders,
  Download,
  Activity,
  Cpu,
  Layers,
  Compass,
  Sparkles,
  BarChart3,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  Ruler,
  Archive,
  AlertTriangle,
  X,
} from "lucide-react";
import { SIZE_PROFILES } from "./world/size-classes";
import { finetunePlanetShapes } from "./world/tier1-finetune";
import { GenerationGate } from "./workspace/generation-gate";

const PLANET_BOUNDS: BBox = { minX: 0, minY: 0, maxX: PLANET_WIDTH, maxY: PLANET_HEIGHT };

const DEFAULT_PLANET: PlanetConfig = {
  seed: "terra-novus",
  continentCount: 5,
  oceanLevel: 1,
  tectonicActivity: 1,
  islandDensity: 1,
  polarIceExtent: 1,
};

const PLANET_TAB: WorkspaceTab = { id: "planet", kind: "planet", title: "Planet" };

export default function App() {
  // ---- Tier 1 ----
  const [planetConfig, setPlanetConfig] = useState<PlanetConfig>(DEFAULT_PLANET);
  const [macro, setMacro] = useState<PlanetMacro | null>(null);
  const [macroBusy, setMacroBusy] = useState(false);
  const [macroProgress, setMacroProgress] = useState<GenProgress | null>(null);

  // ---- Tier 2 cache + world layer store ----
  const world = useWorldLayers();
  const {
    regionDetail, resourceLayers, bioLayers, humanLayers, popLayers, routeLayers, cadastreLayers,
    grids: regionGrids,
    setLayer: setWorldLayer,
    invalidateAbove: invalidateWorldAbove,
    removeLayer: removeWorldLayer,
    unloadRegion: unloadWorldRegion,
    clearAll: clearWorld,
    replaceAll: replaceWorld,
  } = world;
  const [regionBusy, setRegionBusy] = useState<string | null>(null);
  const [regionProgress, setRegionProgress] = useState<GenProgress | null>(null);
  const [pendingRegion, setPendingRegion] = useState<RegionDescriptor | null>(null);

  // ---- Workspace ----
  const [tabs, setTabs] = useState<WorkspaceTab[]>([PLANET_TAB]);
  const [activeTabId, setActiveTabId] = useState("planet");

  // ---- View state ----
  const [themeId, setThemeId] = useState<MapThemeId>("gidding");
  const [layers, setLayers] = useState<RenderLayers>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<MapFeature | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ bbox: BBox; nonce: number; tabId: string } | null>(null);
  const focusNonce = useRef(0);

  // ---- UI ----
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"regions" | "layers" | "stats">("regions");
  const [showSetup, setShowSetup] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const [showVerifier, setShowVerifier] = useState(false);
  const [showRawMode, setShowRawMode] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  // ---- Layer: geological resources (metals, earths, stones, salts, fuels, fantasy) ----
  const [resourceConfig, setResourceConfig] = useState<ResourceFilterConfig>(DEFAULT_RESOURCE_CONFIG);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [resourceVisible, setResourceVisible] = useState(true);

  // ---- Layer 3: biosphere (separate layer, geography stays frozen) ----
  const [bioBusy, setBioBusy] = useState(false);
  const [bioProgress, setBioProgress] = useState<GenProgress | null>(null);
  const [showBioModal, setShowBioModal] = useState(false);
  const [bioVisible, setBioVisible] = useState(true);
  const [bioShowRaw, setBioShowRaw] = useState(false);

  // ---- Layer 4: habitable zones (separate layer, L1 + L2 + L3 stay frozen) ----
  const [humanBusy, setHumanBusy] = useState(false);
  const [humanProgress, setHumanProgress] = useState<GenProgress | null>(null);
  const [showHumanModal, setShowHumanModal] = useState(false);
  const [humanVisible, setHumanVisible] = useState(true);
  const [humanShowRaw, setHumanShowRaw] = useState(false);
  const [popBusy, setPopBusy] = useState(false);
  const [popProgress, setPopProgress] = useState<GenProgress | null>(null);
  const [showPopModal, setShowPopModal] = useState(false);
  const [popVisible, setPopVisible] = useState(true);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeProgress, setRouteProgress] = useState<GenProgress | null>(null);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeVisible, setRouteVisible] = useState(true);
  const [cadastreVisible, setCadastreVisible] = useState(true);
  const [cadastreBusy, setCadastreBusy] = useState(false);
  const [showCadastreModal, setShowCadastreModal] = useState(false);
  const [geoVisible, setGeoVisible] = useState(true);
  const [showBackup, setShowBackup] = useState(false);

  const generationGate = useRef(new GenerationGate());
  const initialGenerationStarted = useRef(false);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [workflowIssue, setWorkflowIssue] = useState<{ title: string; detail: string } | null>(null);
  const isBusy = activeJob !== null || cadastreBusy || resourceBusy || routeBusy;

  const beginJob = useCallback((label: string) => {
    const release = generationGate.current.begin(label);
    if (!release) {
      setWorkflowIssue({
        title: "A generation job is already running",
        detail: `Wait for ${generationGate.current.activeJob} to finish. No second job was started.`,
      });
      return null;
    }
    setActiveJob(label);
    setWorkflowIssue(null);
    return () => {
      release();
      setActiveJob(null);
    };
  }, []);

  const reportFailure = useCallback((title: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    setWorkflowIssue({ title, detail: `${detail}. The last completed workspace has been preserved.` });
    console.error(title, error);
  }, []);

  // -------------------------------------------------------------------------
  // Tier 1 generation
  // -------------------------------------------------------------------------
  const runMacro = useCallback(async (cfg: PlanetConfig) => {
    const finish = beginJob("planet generation");
    if (!finish) return;
    setMacroBusy(true);
    setMacroProgress({ stage: 1, totalStages: 6, stageName: "Initialising", percent: 2, featuresCount: 0, elapsedMs: 0 });
    try {
      const rawMacro = await generatePlanetMacro(cfg, setMacroProgress);
      setMacroProgress((p) => ({
        stage: 6,
        totalStages: 6,
        stageName: "Finetune: reshaping continents from real-world archetypes",
        percent: 97,
        featuresCount: rawMacro.features.length,
        elapsedMs: p?.elapsedMs ?? 0,
      }));
      await new Promise((r) => setTimeout(r, 0));
      // Post-generation shape finetune: same places & sizes, realistic silhouettes
      const result = finetunePlanetShapes(rawMacro);
      setMacro(result);
      setPlanetConfig(cfg);
      // A new planet invalidates every region and every layer built on them
      // (routes + cadastres included: region IDs restart per planet)
      clearWorld();
      setTabs([PLANET_TAB]);
      setActiveTabId("planet");
      setSelected(null);
      setFocusTarget(null);
      setShowRawMode(false);
      setShowResourceModal(false);
      setShowBioModal(false);
      setShowHumanModal(false);
    } catch (e) {
      reportFailure("Planet generation failed", e);
    } finally {
      setMacroBusy(false);
      setShowSetup(false);
      finish();
    }
  }, [beginJob, reportFailure, clearWorld]);

  useEffect(() => {
    if (initialGenerationStarted.current) return;
    initialGenerationStarted.current = true;
    runMacro(DEFAULT_PLANET);
  }, [runMacro]);

  useEffect(() => {
    if (regionDetail.size === 0) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [regionDetail.size]);

  const requestPlanetGeneration = useCallback((cfg: PlanetConfig) => {
    if (generationGate.current.activeJob) return;
    if (regionDetail.size > 0 && !window.confirm(
      `Replace this planet and discard ${regionDetail.size} generated regions and their higher layers? Save a backup first. This does not reroll a single region.`
    )) return;
    void runMacro(cfg);
  }, [regionDetail.size, runMacro]);

  // -------------------------------------------------------------------------
  // Tier 2 generation
  // -------------------------------------------------------------------------
  const openRegionTab = useCallback((r: RegionDescriptor) => {
    setTabs((prev) =>
      prev.some((t) => t.regionId === r.id)
        ? prev
        : [...prev, { id: `region:${r.id}`, kind: "region", title: r.name, regionId: r.id }]
    );
    setActiveTabId(`region:${r.id}`);
    setSelected(null);
    setFocusTarget(null);
    setShowBioModal(false);
    setShowHumanModal(false);
  }, []);

  const requestRegion = useCallback(
    (r: RegionDescriptor) => {
      if (generationGate.current.activeJob) return;
      if (regionDetail.has(r.id)) {
        openRegionTab(r);
        return;
      }
      setPendingRegion(r);
    },
    [regionDetail, openRegionTab]
  );

  const runRegionFor = useCallback(
    async (r: RegionDescriptor, cfg: RegionConfig) => {
      if (!macro?.regions.some((parent) => parent.id === r.id && parent.regionSeed === r.regionSeed)) {
        reportFailure("Region generation rejected", new Error("This region does not belong to the current planet"));
        return;
      }
      const finish = beginJob(`geography for ${r.name}`);
      if (!finish) return;
      setRegionBusy(r.id);
      setRegionProgress({
        stage: 1,
        totalStages: 8,
        stageName: "Initialising",
        percent: 2,
        featuresCount: 0,
        elapsedMs: 0,
      });
      try {
        const result = await generateRegionDetail(r, cfg, setRegionProgress);
        setWorldLayer(r.id, "geo", result);
        // Regenerated geography invalidates every layer built on it
        invalidateWorldAbove(r.id, "geo");
        setFocusTarget(null);
        setShowRawMode(false);
        openRegionTab(r);
      } catch (e) {
        reportFailure(`Geography generation failed for ${r.name}`, e);
      } finally {
        setRegionBusy(null);
        setPendingRegion(null);
        finish();
      }
    },
    [macro, beginJob, reportFailure, openRegionTab, setWorldLayer, invalidateWorldAbove]
  );

  const runRegion = useCallback(
    async (cfg: RegionConfig) => {
      if (!pendingRegion) return;
      await runRegionFor(pendingRegion, cfg);
    },
    [pendingRegion, runRegionFor]
  );

  /** Regenerate ONLY this continent/island with a fresh random seed, preserving the planet and all other tabs. */
  const rerollRegion = useCallback(
    (r: RegionDescriptor) => {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      let tag = "";
      for (let i = 0; i < 6; i++) tag += chars[Math.floor(Math.random() * chars.length)];
      const existing = regionDetail.get(r.id)?.config;
      const nextCfg: RegionConfig = {
        detailLevel: existing?.detailLevel ?? "standard",
        riverDensity: existing?.riverDensity ?? 1,
        reliefIntensity: existing?.reliefIntensity ?? 1,
        moisture: existing?.moisture ?? 1,
        glaciation: existing?.glaciation ?? 1,
        customSeed: `${r.id}::${tag}`,
      };
      void runRegionFor(r, nextCfg);
    },
    [regionDetail, runRegionFor]
  );

  /** Open the Region Generate modal for an already-loaded (or unloaded) region to edit its seed or sliders. */
  const configureRegion = useCallback((r: RegionDescriptor) => {
    if (generationGate.current.activeJob) return;
    setPendingRegion(r);
  }, []);

  const unloadRegion = useCallback((id: string) => {
    if (generationGate.current.activeJob) {
      setWorkflowIssue({ title: "Cannot unload during generation", detail: "Wait until the active job finishes." });
      return;
    }
    unloadWorldRegion(id);
    setSelected(null);
    setFocusTarget(null);
    setTabs((prev) => prev.filter((t) => t.regionId !== id));
    setActiveTabId((cur) => (cur === `region:${id}` ? "planet" : cur));
  }, [unloadWorldRegion]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTabId((cur) => (cur === id ? "planet" : cur));
  }, []);

  // -------------------------------------------------------------------------
  // Active view resolution
  // -------------------------------------------------------------------------
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? PLANET_TAB;
  const activeRegion = activeTab.regionId ? regionDetail.get(activeTab.regionId) ?? null : null;
  const mode: "planet" | "region" = activeTab.kind;

  // ---- Geological resources for active region ----
  const activeResource = activeTab.regionId ? resourceLayers.get(activeTab.regionId) ?? null : null;

  const runResource = useCallback(
    async (cfg: ResourceFilterConfig) => {
      if (!activeRegion) return;
      const finish = beginJob(`geological resources for ${activeRegion.descriptor.name}`);
      if (!finish) return;
      setResourceBusy(true);
      try {
        const result = await generateResourceLayer(activeRegion, cfg);
        setWorldLayer(activeRegion.descriptor.id, "resource", result);
        setResourceConfig(cfg);
        setResourceVisible(true);
      } catch (e) {
        reportFailure("Resource generation failed", e);
        setShowResourceModal(false);
      } finally {
        setResourceBusy(false);
        finish();
      }
    },
    [activeRegion, beginJob, reportFailure, setWorldLayer]
  );

  // ---- Layer 3 handles for the active region ----
  const activeBio = activeTab.regionId ? bioLayers.get(activeTab.regionId) ?? null : null;

  const runBio = useCallback(
    async (cfg: BioConfig) => {
      if (!activeRegion) return;
      const finish = beginJob(`biosphere for ${activeRegion.descriptor.name}`);
      if (!finish) return;
      setBioBusy(true);
      setBioProgress({ stage: 1, totalStages: 4, stageName: "Initialising", percent: 2, featuresCount: 0, elapsedMs: 0 });
      try {
        const result = await generateBioLayer(activeRegion, cfg, setBioProgress);
        setWorldLayer(activeRegion.descriptor.id, "bio", result);
        // A new biosphere invalidates settlement + population + route + cadastre layers fed by it
        invalidateWorldAbove(activeRegion.descriptor.id, "bio");
        setBioVisible(true);
        setBioShowRaw(false);
      } catch (e) {
        reportFailure("Biosphere generation failed", e);
        setShowBioModal(false);
      } finally {
        setBioBusy(false);
        setBioProgress(null);
        finish();
      }
    },
    [activeRegion, beginJob, reportFailure, setWorldLayer, invalidateWorldAbove]
  );

  const bioItems = useMemo(() => {
    if (!activeBio) return [];
    const src = bioShowRaw ? activeBio.rawPopulations : activeBio.populations;
    return src.map((feature) => ({ feature, color: CATEGORY_COLORS[feature.category] }));
  }, [activeBio, bioShowRaw]);

  const activeHuman = activeTab.regionId ? humanLayers.get(activeTab.regionId) ?? null : null;
  const activePop = activeTab.regionId ? popLayers.get(activeTab.regionId) ?? null : null;
  const activeRoute = activeTab.regionId ? routeLayers.get(activeTab.regionId) ?? null : null;
  const activeCadastre = activeTab.regionId ? cadastreLayers.get(activeTab.regionId) ?? null : null;

  const runPop = useCallback(
    async (cfg: PopulationConfig) => {
      if (!activeRegion || !activeBio || !activeHuman) return;
      if (activeHuman.regionId !== activeRegion.descriptor.id || activeBio.regionId !== activeRegion.descriptor.id) {
        reportFailure("Population generation rejected", new Error("the zone, biosphere and geography refer to different regions"));
        return;
      }
      const finish = beginJob(`population for ${activeRegion.descriptor.name}`);
      if (!finish) return;
      setPopBusy(true);
      setPopProgress({ stage: 1, totalStages: 4, stageName: "Initialising", percent: 2, featuresCount: 0, elapsedMs: 0 });
      try {
        const result = await generatePopulationLayer(activeRegion, activeBio, activeHuman, cfg, setPopProgress);
        setWorldLayer(activeRegion.descriptor.id, "population", result);
        // A new population model re-scales every cadastre roof: evict them (JIT refills on zoom)
        invalidateWorldAbove(activeRegion.descriptor.id, "population");
      } catch (e) {
        reportFailure("Population generation failed", e);
      } finally {
        setPopBusy(false);
        setPopProgress(null);
        finish();
      }
    },
    [activeRegion, activeBio, activeHuman, beginJob, reportFailure, setWorldLayer, invalidateWorldAbove]
  );

  const clearPopulation = useCallback(() => {
    if (!activeTab.regionId) return;
    removeWorldLayer(activeTab.regionId, "population");
  }, [activeTab.regionId, removeWorldLayer]);

  const runHuman = useCallback(
    async (cfg: HumanConfig) => {
      if (!activeRegion || !activeBio) return;
      if (activeBio.regionId !== activeRegion.descriptor.id) {
        reportFailure("Human layer generation rejected", new Error("Biosphere and geography refer to different regions"));
        return;
      }
      const finish = beginJob(`human layer for ${activeRegion.descriptor.name}`);
      if (!finish) return;
      setHumanBusy(true);
      setHumanProgress({ stage: 1, totalStages: 4, stageName: "Initialising", percent: 2, featuresCount: 0, elapsedMs: 0 });
      try {
        const activeRes = activeRegion ? resourceLayers.get(activeRegion.descriptor.id) ?? null : null;
        const result = await generateHumanLayer(activeRegion, activeBio, cfg, setHumanProgress, activeRes);
        setWorldLayer(activeRegion.descriptor.id, "human", result);
        // Invalidate higher layers dependent on settlements
        invalidateWorldAbove(activeRegion.descriptor.id, "human");
        setHumanVisible(true);
        setHumanShowRaw(false);
      } catch (e) {
        reportFailure("Human layer generation failed", e);
        setShowHumanModal(false);
      } finally {
        setHumanBusy(false);
        setHumanProgress(null);
        finish();
      }
    },
    [activeRegion, activeBio, resourceLayers, beginJob, reportFailure, setWorldLayer, invalidateWorldAbove]
  );

  const humanItems = useMemo(() => {
    if (!activeHuman) return [];
    return humanShowRaw ? activeHuman.rawSettlements : activeHuman.settlements;
  }, [activeHuman, humanShowRaw]);

  const routeItems = useMemo(() => {
    if (!activeRoute) return [];
    return activeRoute.routes;
  }, [activeRoute]);

  const runRoute = useCallback(
    async (cfg: RouteConfig) => {
      if (!activeRegion || !activeHuman) return;
      if (activeHuman.regionId !== activeRegion.descriptor.id) {
        reportFailure("Route layer generation rejected", new Error("Human settlements and geography refer to different regions"));
        return;
      }
      const finish = beginJob(`route network for ${activeRegion.descriptor.name}`);
      if (!finish) return;
      setRouteBusy(true);
      setRouteProgress({ stage: 1, totalStages: 5, stageName: "Analyzing Terrain Valleys", percent: 10, featuresCount: 0, elapsedMs: 0 });
      try {
        const activeRes = activeRegion ? resourceLayers.get(activeRegion.descriptor.id) ?? null : null;
        const result = await generateRouteLayer(activeRegion, activeHuman.settlements, cfg, setRouteProgress, activeRes);
        setWorldLayer(activeRegion.descriptor.id, "routes", result);
        setRouteVisible(true);
      } catch (e) {
        reportFailure("Route network generation failed", e);
        setShowRouteModal(false);
      } finally {
        setRouteBusy(false);
        setRouteProgress(null);
        finish();
      }
    },
    [activeRegion, activeHuman, resourceLayers, beginJob, reportFailure, setWorldLayer]
  );

  /** Open (or generate) a world layer for a region from the sidebar strip. */
  const openLayerFor = useCallback(
    (r: RegionDescriptor, layer: WorldLayerId) => {
      if (generationGate.current.activeJob) return;
      if (layer === "geo") {
        requestRegion(r);
        return;
      }
      // higher layers live in the region tab
      if (!regionDetail.has(r.id)) return;
      openRegionTab(r);
      if (layer === "resource") setShowResourceModal(true);
      if (layer === "bio") setShowBioModal(true);
      if (layer === "human" && bioLayers.has(r.id)) setShowHumanModal(true);
      if (layer === "population" && humanLayers.has(r.id)) setShowPopModal(true);
      if (layer === "routes" && humanLayers.has(r.id)) setShowRouteModal(true);
      if (layer === "cadastre" && humanLayers.has(r.id)) setShowCadastreModal(true);
    },
    [regionDetail, bioLayers, humanLayers, requestRegion, openRegionTab]
  );

  /** Workflow optimization: Run full automated cascade (L1 Geo -> L2 Res -> L3 Bio -> L4 Sites -> L5 Pop -> L6 Roads -> L7 Cadastre) */
  const runFullCascade = useCallback(
    async (descriptor: RegionDescriptor) => {
      const finish = beginJob(`full cascade for ${descriptor.name}`);
      if (!finish) return;
      try {
        setWorkflowIssue(null);
        openRegionTab(descriptor);

        // Step 1: Geography
        setRegionBusy(descriptor.id);
        setRegionProgress({ stage: 1, totalStages: 8, stageName: "Synthesizing Geography", percent: 10, featuresCount: 0, elapsedMs: 0 });
        let geo = regionDetail.get(descriptor.id);
        if (!geo) {
          geo = await generateRegionDetail(descriptor, { detailLevel: "standard", riverDensity: 1, reliefIntensity: 1, moisture: 1, glaciation: 1 }, setRegionProgress);
          setWorldLayer(descriptor.id, "geo", geo);
        }
        setRegionBusy(null);
        setRegionProgress(null);

        // Step 2: Geological Resources
        let res = resourceLayers.get(descriptor.id);
        if (!res) {
          res = await generateResourceLayer(geo, resourceConfig);
          setWorldLayer(descriptor.id, "resource", res);
        }

        // Step 3: Biosphere
        setBioBusy(true);
        setBioProgress({ stage: 1, totalStages: 4, stageName: "Seeding Biosphere", percent: 35, featuresCount: 0, elapsedMs: 0 });
        let bio = bioLayers.get(descriptor.id);
        if (!bio) {
          bio = await generateBioLayer(geo, { richness: 1, wildShare: 1 }, setBioProgress);
          setWorldLayer(descriptor.id, "bio", bio);
        }
        setBioBusy(false);
        setBioProgress(null);

        // Step 4: Human Habitable Sites
        setHumanBusy(true);
        setHumanProgress({ stage: 1, totalStages: 4, stageName: "Surveying Habitable Zones", percent: 65, featuresCount: 0, elapsedMs: 0 });
        let human = humanLayers.get(descriptor.id);
        if (!human) {
          human = await generateHumanLayer(geo, bio, { density: 1, urbanisation: 0.5 }, setHumanProgress, res);
          setWorldLayer(descriptor.id, "human", human);
        }
        setHumanBusy(false);
        setHumanProgress(null);

        // Step 5: Population — reuse the existing model when one is already present
        setPopBusy(true);
        setPopProgress({ stage: 1, totalStages: 3, stageName: "Simulating Epoch & Demographics", percent: 80, featuresCount: 0, elapsedMs: 0 });
        let pop = popLayers.get(descriptor.id);
        if (!pop) {
          pop = await generatePopulationLayer(geo, bio, human, { era: "current", year: 2026, targetScale: 1 }, setPopProgress);
          setWorldLayer(descriptor.id, "population", pop);
        }
        setPopBusy(false);
        setPopProgress(null);

        // Step 6: Trade Routes & Roads (Layer 6)
        setRouteBusy(true);
        setRouteProgress({ stage: 1, totalStages: 5, stageName: "Pathfinding Highways & Trade Routes", percent: 85, featuresCount: 0, elapsedMs: 0 });
        let route = routeLayers.get(descriptor.id);
        if (!route) {
          route = await generateRouteLayer(geo, human.settlements, {
            density: 1,
            pavedHighwayShare: 0.45,
            coastalShipping: true,
          }, setRouteProgress, res);
          setWorldLayer(descriptor.id, "routes", route);
        }
        setRouteBusy(false);
        setRouteProgress(null);

        // Step 7: Cadastre (Layer 7) — streets, parcels, and village house roofs
        setCadastreBusy(true);
        let cadastreRes = cadastreLayers.get(descriptor.id);
        if (!cadastreRes) {
          cadastreRes = await generateCadastreLayer(geo, human.settlements, pop.model);
          setWorldLayer(descriptor.id, "cadastre", cadastreRes);
        }
        setCadastreBusy(false);
      } catch (err) {
        reportFailure("Full cascade generation failed", err);
      } finally {
        setRegionBusy(null);
        setRegionProgress(null);
        setBioBusy(false);
        setBioProgress(null);
        setHumanBusy(false);
        setHumanProgress(null);
        setPopBusy(false);
        setPopProgress(null);
        setRouteBusy(false);
        setRouteProgress(null);
        setCadastreBusy(false);
        finish();
      }
    },
    [beginJob, openRegionTab, regionDetail, resourceConfig, resourceLayers, bioLayers, humanLayers, popLayers, routeLayers, cadastreLayers, reportFailure, setWorldLayer]
  );

  // Grids are memoised per tab so switching tabs is instant and never rebuilds
  const macroGrid = useMemo(() => {
    if (!macro) return null;
    return SpatialGrid.forFeatures(macro.features, PLANET_BOUNDS);
  }, [macro]);
  const macroRawGrid = useMemo(() => {
    if (!macro?.rawFeatures) return null;
    return SpatialGrid.forFeatures(macro.rawFeatures, PLANET_BOUNDS);
  }, [macro]);

  const activeGrid = useMemo(() => {
    if (mode === "planet") return showRawMode && macroRawGrid ? macroRawGrid : macroGrid;
    if (!activeRegion) return null;
    const modeTag = showRawMode ? "raw" : "ft";
    const key = `${activeRegion.descriptor.id}:${activeRegion.generatedAt}:${modeTag}`;
    let g = regionGrids.current.get(key);
    if (!g) {
      const d = activeRegion.descriptor;
      const padX = (d.bbox.maxX - d.bbox.minX) * 0.08;
      const padY = (d.bbox.maxY - d.bbox.minY) * 0.08;
      const feats = showRawMode ? activeRegion.rawFeatures : activeRegion.features;
      g = SpatialGrid.forFeatures(feats, {
        minX: d.bbox.minX - padX,
        minY: d.bbox.minY - padY,
        maxX: d.bbox.maxX + padX,
        maxY: d.bbox.maxY + padY,
      });
      regionGrids.current.set(key, g);
    }
    return g;
  }, [mode, macroGrid, macroRawGrid, activeRegion, showRawMode]);

  const activeBounds: BBox = useMemo(() => {
    if (mode === "planet" || !activeRegion) return PLANET_BOUNDS;
    const d = activeRegion.descriptor;
    const padX = (d.bbox.maxX - d.bbox.minX) * 0.08;
    const padY = (d.bbox.maxY - d.bbox.minY) * 0.08;
    return {
      minX: d.bbox.minX - padX,
      minY: d.bbox.minY - padY,
      maxX: d.bbox.maxX + padX,
      maxY: d.bbox.maxY + padY,
    };
  }, [mode, activeRegion]);

  // Reset selection when the tab changes
  useEffect(() => {
    setSelected(null);
  }, [activeTabId]);

  // -------------------------------------------------------------------------
  const focusOn = useCallback((bbox: BBox, tabId = activeTabId) => {
    focusNonce.current += 1;
    setFocusTarget({ bbox, nonce: focusNonce.current, tabId });
  }, [activeTabId]);

  const locateRegion = useCallback(
    (r: RegionDescriptor) => {
      if (activeTabId !== "planet") setActiveTabId("planet");
      focusOn(r.bbox, "planet");
    },
    [activeTabId, focusOn]
  );

  const allLogs: ConflictRecord[] = useMemo(() => {
    const base = macro?.log ?? [];
    const regionLogs = [...regionDetail.values()].flatMap((r) => r.log);
    return [...base, ...regionLogs];
  }, [macro, regionDetail]);

  const layerCounts = useMemo(() => {
    const src =
      mode === "planet"
        ? macro?.features ?? []
        : showRawMode
        ? activeRegion?.rawFeatures ?? []
        : activeRegion?.features ?? [];
    const c: Partial<Record<keyof RenderLayers, number>> = {};
    let land = 0, seas = 0, relief = 0, peaks = 0, volc = 0, rivers = 0, lakes = 0, biomes = 0, tect = 0;
    for (const f of src) {
      switch (f.properties.featureType) {
        case "continent":
        case "island":
        case "coastline":
          land++;
          break;
        case "sea":
          seas++;
          break;
        case "trench":
        case "plate_boundary":
          tect++;
          break;
        case "mountain_range":
        case "plateau":
          relief++;
          break;
        case "mountain":
          peaks++;
          break;
        case "volcano":
          volc++;
          break;
        case "river":
          rivers++;
          break;
        case "lake":
          lakes++;
          break;
        case "ice_cap":
          break;
        default:
          biomes++;
      }
    }
    c.landmasses = land;
    c.seas = seas;
    c.tectonics = tect;
    c.relief = relief;
    c.peaks = peaks;
    c.volcanoes = volc;
    c.rivers = rivers;
    c.lakes = lakes;
    c.biomes = biomes;
    c.routes = activeRoute ? activeRoute.routes.length : 0;
    return c;
  }, [mode, macro, activeRegion, showRawMode, activeRoute]);

  const residentFeatures = useMemo(
    () => [...regionDetail.values()].reduce((s, r) => s + r.features.length, 0),
    [regionDetail]
  );

  const minimapFeatures = useMemo(() => {
    if (mode === "planet") return macro?.features.filter((f) => f.properties.featureType === "continent") ?? [];
    return activeRegion?.features.filter((f) => f.properties.featureType === "coastline") ?? [];
  }, [mode, macro, activeRegion]);

  const displayedLayers = useMemo<RenderLayers>(() => {
    if (geoVisible) return layers;
    return {
      ...layers,
      landmasses: false, seas: false, tectonics: false, relief: false,
      peaks: false, volcanoes: false, rivers: false, lakes: false,
      biomes: false, regionOverlay: false, compartments: false,
    };
  }, [geoVisible, layers]);

  const makeWorkspaceCheckpoint = useCallback(() => {
    if (generationGate.current.activeJob) throw new Error("Finish generation before saving a checkpoint");
    if (!macro) return null;
    return createCheckpoint({
      macro,
      regions: regionDetail,
      biosphere: bioLayers,
      humans: humanLayers,
      populations: popLayers,
      resources: resourceLayers,
      routes: routeLayers,
      cadastres: cadastreLayers,
      resourceConfig,
      view: {
        tabs,
        activeTabId,
        themeId,
        layers,
        visibility: {
          geo: geoVisible,
          bio: bioVisible,
          human: humanVisible,
          population: popVisible,
          resource: resourceVisible,
          routes: routeVisible,
          cadastre: cadastreVisible,
        },
        raw: { geography: showRawMode, biosphere: bioShowRaw, human: humanShowRaw },
      },
    });
  }, [macro, regionDetail, bioLayers, humanLayers, popLayers, resourceLayers, routeLayers, cadastreLayers, resourceConfig, tabs, activeTabId, themeId, layers, geoVisible, bioVisible, humanVisible, popVisible, resourceVisible, routeVisible, cadastreVisible, showRawMode, bioShowRaw, humanShowRaw]);

  const restoreWorkspaceCheckpoint = useCallback((checkpoint: WorkspaceCheckpoint) => {
    if (generationGate.current.activeJob) throw new Error("Cannot restore while generation is running");
    setMacro(checkpoint.macro);
    setPlanetConfig(checkpoint.macro.config);
    replaceWorld({
      geo: new Map(checkpoint.regions.map((r) => [r.descriptor.id, r])),
      bio: new Map(checkpoint.biosphere.map((b) => [b.regionId, b])),
      human: new Map(checkpoint.humans.map((h) => [h.regionId, h])),
      population: deserializePopulations(checkpoint.populations),
      resource: checkpoint.resources ? new Map(checkpoint.resources.map((r) => [r.regionId, r])) : undefined,
      routes: checkpoint.routes ? new Map(checkpoint.routes.map((r) => [r.regionId, r])) : undefined,
      cadastre: deserializeCadastres(checkpoint.cadastres),
    });
    if (checkpoint.resourceConfig) setResourceConfig(checkpoint.resourceConfig);
    setTabs(checkpoint.view.tabs);
    setActiveTabId(checkpoint.view.activeTabId);
    setThemeId(checkpoint.view.themeId);
    setLayers(checkpoint.view.layers);
    setGeoVisible(checkpoint.view.visibility.geo);
    setBioVisible(checkpoint.view.visibility.bio);
    setHumanVisible(checkpoint.view.visibility.human);
    if (checkpoint.view.visibility.population !== undefined) {
      setPopVisible(checkpoint.view.visibility.population);
    }
    if (checkpoint.view.visibility.resource !== undefined) setResourceVisible(checkpoint.view.visibility.resource);
    if (checkpoint.view.visibility.routes !== undefined) setRouteVisible(checkpoint.view.visibility.routes);
    if (checkpoint.view.visibility.cadastre !== undefined) setCadastreVisible(checkpoint.view.visibility.cadastre);
    setShowRawMode(checkpoint.view.raw.geography);
    setBioShowRaw(checkpoint.view.raw.biosphere);
    setHumanShowRaw(checkpoint.view.raw.human);
    setSelected(null);
    setFocusTarget(null);
    setPendingRegion(null);
    setShowSetup(false);
    setShowBioModal(false);
    setShowHumanModal(false);
    setShowPopModal(false);
    setWorkflowIssue(null);
  }, [replaceWorld]);

  const handleExport = () => {
    if (mode === "region" && activeRegion) {
      const rid = activeRegion.descriptor.id;
      downloadText(
        `region-${activeRegion.descriptor.name.replace(/\s+/g, "-").toLowerCase()}-world.geojson`,
        exportRegionWorldGeoJSON(activeRegion, {
          resource: resourceLayers.get(rid) ?? null,
          bio: bioLayers.get(rid) ?? null,
          human: humanLayers.get(rid) ?? null,
          population: popLayers.get(rid) ?? null,
          routes: routeLayers.get(rid) ?? null,
          cadastre: cadastreLayers.get(rid) ?? null,
        })
      );
    } else if (macro) {
      downloadText(`planet-${macro.config.seed}-macro.geojson`, exportMacroGeoJSON(macro));
    }
  };

  const randomPlanet = () => {
    if (generationGate.current.activeJob) return;
    if (
      regionDetail.size > 0 &&
      !window.confirm(
        `Generate a new random planet? This will replace the current planet and clear your ${regionDetail.size} generated region tab(s). (To regenerate only a single continent or island, use "Re-roll Region" instead.)`
      )
    ) {
      return;
    }
    const c = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 7; i++) s += c[Math.floor(Math.random() * c.length)];
    runMacro({ ...planetConfig, seed: s });
  };

  // -------------------------------------------------------------------------
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans text-zinc-100">
      {/* Header */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/90 px-3 backdrop-blur-md md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-teal-500 to-emerald-400 shadow-lg shadow-teal-500/20">
            <Globe2 className="h-5 w-5 text-slate-950" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold tracking-tight text-white sm:text-base">Terra Ex Nihilo</h1>
              <span className="hidden rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-teal-300 md:inline-block">
                Cascading Tiers
              </span>
              {macro && (
                <span className="hidden rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 lg:inline-block">
                  T1 {macro.stats.macroFeatures.toLocaleString()} · T2 {residentFeatures.toLocaleString()}
                </span>
              )}
            </div>
            <p className="hidden truncate text-[10px] text-zinc-400 sm:block">
              Macro planet stays light · continental detail generated on demand, block by block
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {mode === "region" && activeRegion ? (
            <>
              <button
                onClick={() => configureRegion(activeRegion.descriptor)}
                disabled={isBusy}
                title="Change seed, detail level, or sliders for this continent/island only"
                className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300 disabled:opacity-50"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Region Seed / Setup</span>
              </button>
              <button
                onClick={() => rerollRegion(activeRegion.descriptor)}
                disabled={isBusy}
                title="Regenerate ONLY this continent/island with a new random seed (planet & other tabs stay untouched)"
                className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden md:inline">Re-roll Region</span>
              </button>
              <button
                onClick={() => setShowSetup(true)}
                disabled={isBusy}
                title="Configure or generate a new Tier-1 planet"
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
              >
                <Globe2 className="h-3.5 w-3.5 text-teal-400" />
                <span className="hidden xl:inline">Planet Setup</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowSetup(true)}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-teal-400"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Planet</span>
              </button>
              <button
                onClick={randomPlanet}
                disabled={isBusy}
                title="Generate a new random Tier-1 planet"
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden md:inline">Random Planet</span>
              </button>
            </>
          )}
          <button
            onClick={() => setShowSizes(true)}
            title="Land-size compartments and their Tier-2 prerequisites"
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
          >
            <Ruler className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Size Classes</span>
          </button>
          <button
            onClick={() => setShowVerifier(true)}
            title="Finetune Stage & Geomorphic Verifier Report"
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Verifier</span>
          </button>
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <Activity className="h-3.5 w-3.5 text-teal-400" />
            <span className="hidden lg:inline">Log</span>
          </button>
          <button
            onClick={() => setShowArch(true)}
            className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-white/5 px-3 py-1.5 text-xs font-medium text-teal-300 transition hover:bg-white/10"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Architecture</span>
          </button>
          <button
            onClick={handleExport}
            title={mode === "region" ? "Export this region" : "Export planet macro"}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">GeoJSON</span>
          </button>
          <button
            onClick={() => setShowBackup(true)}
            title="Back up project source and the generated workspace"
            className="flex items-center gap-1.5 rounded-lg border border-teal-400/30 bg-teal-400/10 px-3 py-1.5 text-xs font-semibold text-teal-200 transition hover:bg-teal-400/20"
          >
            <Archive className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Backup</span>
          </button>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        busyTabId={regionBusy ? `region:${regionBusy}` : null}
      />

      {(workflowIssue || isBusy) && (
        <div role={workflowIssue ? "alert" : "status"} className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs ${workflowIssue ? "border-rose-400/20 bg-rose-950/30 text-rose-200" : "border-teal-400/20 bg-teal-950/30 text-teal-200"}`}>
          <div className="flex min-w-0 items-center gap-2">
            {workflowIssue ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
            <span className="break-words">
              {workflowIssue ? <><strong>{workflowIssue.title}.</strong> {workflowIssue.detail}</> : <>Running {activeJob}. Other generation jobs are locked until it finishes.</>}
            </span>
          </div>
          {workflowIssue && <button aria-label="Dismiss workflow message" onClick={() => setWorkflowIssue(null)} className="shrink-0 rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>}
        </div>
      )}

      {/* Workspace */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {activeGrid ? (
            <RecoveryBoundary label="Map view" resetKey={`${activeTabId}:${activeRegion?.generatedAt ?? macro?.config.seed}:${themeId}`}>
            <MapViewer
              key={activeTabId}
              grid={activeGrid}
              bounds={activeBounds}
              themeId={themeId}
              layers={displayedLayers}
              mode={mode}
              selected={geoVisible ? selected : null}
              onSelect={setSelected}
              focusTarget={focusTarget?.tabId === activeTabId ? focusTarget : null}
              regions={macro?.regions}
              detailedRegionIds={new Set(regionDetail.keys())}
              activeRegionId={activeTab.regionId ?? null}
              onOpenRegion={requestRegion}
              minimapFeatures={minimapFeatures}
              compartments={mode === "region" ? activeRegion?.compartments : undefined}
              resources={
                mode === "region" && activeResource
                  ? { items: activeResource.deposits, visible: resourceVisible }
                  : undefined
              }
              bio={
                mode === "region" && activeBio
                  ? { items: bioItems, visible: bioVisible }
                  : undefined
              }
              human={
                mode === "region" && activeHuman
                  ? { items: humanItems, visible: humanVisible }
                  : undefined
              }
              population={
                mode === "region" && activePop
                  ? { model: activePop.model, visible: popVisible, era: activePop.config.era }
                  : undefined
              }
              routes={
                mode === "region" && activeRoute
                  ? { items: routeItems, visible: routeVisible }
                  : undefined
              }
              region={activeRegion ?? undefined}
              cadastre={{ visible: cadastreVisible }}
              onRenderError={(error) => reportFailure("Map rendering failed", error)}
            />
            </RecoveryBoundary>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
              {macroBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Forming planet...</> : <>
                <span>No planet is available. The source backup is still accessible.</span>
                <button onClick={() => void runMacro(DEFAULT_PLANET)} disabled={isBusy} className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">Retry Planet Generation</button>
              </>}
            </div>
          )}

          {selected && (
            <Inspector feature={selected} onClose={() => setSelected(null)} onFocus={(f) => focusOn(f.bbox)} />
          )}

          {/* Planet shape ribbon */}
          {mode === "planet" && macro?.shape && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-white/15 bg-slate-950/85 px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-md">
                <span className="font-semibold text-white">Coastlines</span>
                <button
                  onClick={() => setShowRawMode((v) => !v)}
                  title="Compare raw generator blobs with the shape-finetuned continents"
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold transition ${
                    showRawMode
                      ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                      : "border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  }`}
                >
                  {showRawMode ? "RAW generator blobs" : "Shape-finetuned ✓"}
                </button>
                <span className="font-mono text-[10px] text-zinc-400">
                  {macro.shape.reshaped + macro.shape.softened} reshaped · {macro.shape.sutured} sutured ·{" "}
                  {macro.shape.accreted} accreted · ocean seam
                </span>
              </div>
            </div>
          )}

          {/* Region context ribbon */}
          {mode === "region" && activeRegion && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-white/15 bg-slate-950/85 px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-md">
                <button
                  onClick={() => setActiveTabId("planet")}
                  className="flex items-center gap-1 text-zinc-400 transition hover:text-teal-300"
                >
                  <ArrowLeft className="h-3 w-3" /> Planet
                </button>
                <span className="h-3 w-px bg-white/15" />
                <span className="font-semibold text-white">{activeRegion.descriptor.name}</span>
                <button
                  onClick={() => setShowSizes(true)}
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                  style={{
                    borderColor: `${SIZE_PROFILES[activeRegion.sizeClass].color}55`,
                    color: SIZE_PROFILES[activeRegion.sizeClass].color,
                    background: `${SIZE_PROFILES[activeRegion.sizeClass].color}1a`,
                  }}
                >
                  {SIZE_PROFILES[activeRegion.sizeClass].label}
                </button>
                <button
                  onClick={() => setLayers((p) => ({ ...p, compartments: !p.compartments }))}
                  title="Toggle processing-compartment overlay"
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                    layers.compartments
                      ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                      : "border-white/15 text-zinc-400 hover:text-white"
                  }`}
                >
                  {activeRegion.compartments.length} blocks
                </button>
                <span className="font-mono text-zinc-500">
                  {Math.abs(activeRegion.descriptor.lat).toFixed(1)}°
                  {activeRegion.descriptor.lat >= 0 ? "N" : "S"}
                </span>
                <span className="h-3 w-px bg-white/15" />
                <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                  Tier 2 · {(showRawMode ? activeRegion.rawFeatures.length : activeRegion.features.length).toLocaleString()} features
                </span>
                <button
                  onClick={() => setShowRawMode((v) => !v)}
                  title="Toggle between Finetuned (Realistic) and Raw (Pre-Finetune) features"
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold transition ${
                    showRawMode
                      ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                      : "border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  }`}
                >
                  {showRawMode
                    ? `RAW (${activeRegion.verificationBefore.totalViolations} conflicts)`
                    : `Finetuned ✓ (${activeRegion.verificationAfter.passedChecks}/${activeRegion.verificationAfter.totalChecks})`}
                </button>
                <span className="h-3 w-px bg-white/15" />
                <button
                  onClick={() => rerollRegion(activeRegion.descriptor)}
                  disabled={isBusy}
                  title={`Current region seed: ${activeRegion.seed}. Click to re-roll ONLY ${activeRegion.descriptor.name} with a new seed.`}
                  className="flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 transition hover:bg-amber-400/25 disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" /> Re-roll Seed
                </button>
                <button
                  onClick={() => runFullCascade(activeRegion.descriptor)}
                  disabled={isBusy}
                  title={`Run the automated pipeline from ${LAYER_BY_ID.geo.short} Geography through ${LAYER_BY_ID.cadastre.short} Cadastre for this region`}
                  className="flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-400/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 transition hover:bg-cyan-400/25 disabled:opacity-50"
                >
                  ⚡ Cascade All (L1→L7)
                </button>
                <button
                  onClick={() => configureRegion(activeRegion.descriptor)}
                  disabled={isBusy}
                  title="Edit custom seed or parameters for this region only"
                  className="rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                >
                  Seed: {activeRegion.seed.split("::").pop()}
                </button>
                <span className="h-3 w-px bg-white/15" />
                <button
                  onClick={() => setShowResourceModal(true)}
                  disabled={isBusy}
                  title="Geological & Mineral Resources — metals, stone, clay, salts, fuels, fantasy veins"
                  className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/25"
                >
                  ⛏️ {activeResource ? `${LAYER_BY_ID.resource.short} · ${activeResource.deposits.length} lodes` : `Resources (${LAYER_BY_ID.resource.short})`}
                </button>
                {activeResource && (
                  <button
                    onClick={() => setResourceVisible((v) => !v)}
                    title="Toggle the geological resource deposit overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      resourceVisible
                        ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                        : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {resourceVisible ? "on" : "off"}
                  </button>
                )}
                <button
                  onClick={() => setShowBioModal(true)}
                  disabled={isBusy}
                  title="Layer 3 — Flora & Fauna, built on top of this frozen geography"
                  className="flex items-center gap-1 rounded border border-lime-500/40 bg-lime-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-lime-300 transition hover:bg-lime-500/25"
                >
                  🌿 {activeBio ? `L3 · ${activeBio.populations.length} pops` : "Biosphere (L3)"}
                </button>
                {activeBio && (
                  <button
                    onClick={() => setBioVisible((v) => !v)}
                    title="Toggle the biosphere overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      bioVisible
                        ? "border-lime-400/50 bg-lime-400/20 text-lime-200"
                        : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {bioVisible ? "on" : "off"}
                  </button>
                )}
                {activeBio && bioShowRaw && (
                  <button
                    onClick={() => setBioShowRaw(false)}
                    title="Showing the raw creative scatter — click for the finetuned biosphere"
                    className="rounded border border-rose-500/40 bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300"
                  >
                    BIO RAW ({activeBio.verifyBefore.totalViolations}v)
                  </button>
                )}
                <button
                  onClick={() => setShowHumanModal(true)}
                  disabled={!activeBio || isBusy}
                  title={activeBio ? `${LAYER_BY_ID.human.label} (Layer ${LAYER_BY_ID.human.index}) — fed by this biosphere` : `Generate the Biosphere (${LAYER_BY_ID.bio.short}) first`}
                  className="flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-orange-300 transition hover:bg-orange-500/25 disabled:opacity-40"
                >
                  🏘️ {activeHuman ? `${LAYER_BY_ID.human.short} · ${activeHuman.settlements.length} zones` : `Habitable Zones (${LAYER_BY_ID.human.short})`}
                </button>
                <button
                  onClick={() => setShowPopModal(true)}
                  disabled={!activeHuman || isBusy}
                  title={activeHuman ? `Layer ${LAYER_BY_ID.population.index} — Population, generated per zone on all materials beneath` : `Generate Habitable Zones (${LAYER_BY_ID.human.short}) first`}
                  className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
                >
                  👥 {activePop ? `${LAYER_BY_ID.population.short} · ${activePop.report.finalOccupancy.toLocaleString()} ppl` : `Population (${LAYER_BY_ID.population.short})`}
                </button>
                {activePop && (
                  <button
                    onClick={() => setPopVisible((v) => !v)}
                    title="Toggle the population demographic overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      popVisible ? "border-sky-400/50 bg-sky-400/20 text-sky-200" : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {popVisible ? "on" : "off"}
                  </button>
                )}
                <button
                  onClick={() => setShowRouteModal(true)}
                  disabled={!activeHuman || isBusy}
                  title={activeHuman ? "Layer 6 — Trade Routes & Roads: connecting settlements, passes, and ports" : "Generate Habitable Zones (L4) first"}
                  className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-40"
                >
                  🛣️ {activeRoute ? `L6 · ${activeRoute.routes.length} routes` : "Roads (L6)"}
                </button>
                {activeRoute && (
                  <button
                    onClick={() => setRouteVisible((v) => !v)}
                    title="Toggle the trade route network overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      routeVisible ? "border-amber-400/50 bg-amber-400/20 text-amber-200" : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {routeVisible ? "on" : "off"}
                  </button>
                )}
                <button
                  onClick={() => setShowCadastreModal(true)}
                  disabled={!activeHuman || isBusy}
                  title={activeHuman ? "Layer 7 — Cadastre: streets, parcels, and village cottage roofs" : "Generate Habitable Zones (L4) first"}
                  className="flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-purple-300 transition hover:bg-purple-500/25 disabled:opacity-40"
                >
                  🏛️ {activeCadastre ? `L7 · ${activeCadastre.stats.totalBuildings.toLocaleString()} blds` : "Cadastre (L7)"}
                </button>
                {activeCadastre && (
                  <button
                    onClick={() => setCadastreVisible((v) => !v)}
                    title="Toggle the cadastral urbanism and roof overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      cadastreVisible ? "border-purple-400/50 bg-purple-400/20 text-purple-200" : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {cadastreVisible ? "on" : "off"}
                  </button>
                )}
                {activeHuman && (
                  <button
                    onClick={() => setHumanVisible((v) => !v)}
                    title="Toggle the settlement overlay"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      humanVisible ? "border-orange-400/50 bg-orange-400/20 text-orange-200" : "border-white/15 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {humanVisible ? "on" : "off"}
                  </button>
                )}
                {activeHuman && humanShowRaw && (
                  <button
                    onClick={() => setHumanShowRaw(false)}
                    title="Showing the raw founding — click for the finetuned settlements"
                    className="rounded border border-rose-500/40 bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300"
                  >
                    L3 RAW ({activeHuman.verifyBefore.totalViolations}v)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="z-20 flex w-[19rem] shrink-0 flex-col border-l border-white/10 bg-slate-950 lg:w-[22rem]">
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 bg-slate-900/60 p-2">
              {(
                [
                  ["regions", "Regions", Compass],
                  ["layers", "Layers", Layers],
                  ["stats", "Stats", BarChart3],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setSidebarTab(id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    sidebarTab === id
                      ? "border border-teal-500/30 bg-teal-500/20 text-teal-300"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              <RecoveryBoundary label="Workspace panel" resetKey={`${activeTabId}:${sidebarTab}:${activeRegion?.generatedAt ?? macro?.config.seed}`}>
              {sidebarTab === "regions" && macro && (
                <div className="flex h-full flex-col gap-2.5">
                  {mode === "region" && activeRegion ? (
                    <>
                      <div className="shrink-0 rounded-xl border border-amber-500/25 bg-amber-950/20 p-2.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-amber-300">Viewing {activeRegion.descriptor.name}</span>
                          <span className="font-mono text-[10px] text-zinc-400">seed: {activeRegion.seed}</span>
                        </div>
                        <p className="mt-0.5 text-zinc-400">
                          Regenerate this {activeRegion.descriptor.kind} alone without touching the planet:
                        </p>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            onClick={() => rerollRegion(activeRegion.descriptor)}
                            disabled={isBusy}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" /> Re-roll {activeRegion.descriptor.kind}
                          </button>
                          <button
                            onClick={() => configureRegion(activeRegion.descriptor)}
                            disabled={isBusy}
                            className="flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-white/15 disabled:opacity-50"
                          >
                            <Sliders className="h-3 w-3" /> Custom Seed
                          </button>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1">
                        <LandmarkList
                          features={activeRegion.features}
                          onSelect={(f) => {
                            setSelected(f);
                            focusOn(f.bbox);
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="h-full min-h-[24rem]">
                      <RegionBrowser
                        regions={macro.regions}
                        detail={regionDetail}
                        resources={resourceLayers}
                        bios={bioLayers}
                        humans={humanLayers}
                        pops={popLayers}
                        routes={routeLayers}
                        cadastres={cadastreLayers}
                        activeRegionId={activeTab.regionId ?? null}
                        onOpen={requestRegion}
                        onRerollRegion={rerollRegion}
                        onConfigureRegion={configureRegion}
                        onLocate={locateRegion}
                        onUnload={unloadRegion}
                        onLayer={openLayerFor}
                      />
                    </div>
                  )}
                </div>
              )}

              {sidebarTab === "layers" && (
                <LayersPanel
                  layers={layers}
                  onToggle={(k) => setLayers((p) => ({ ...p, [k]: !p[k] }))}
                  themeId={themeId}
                  onTheme={setThemeId}
                  counts={layerCounts}
                  mode={mode}
                  world={{
                    visible: { geo: geoVisible, resource: resourceVisible, bio: bioVisible, human: humanVisible, population: popVisible, routes: routeVisible, cadastre: cadastreVisible },
                    onToggle: (id) => {
                      if (id === "geo") setGeoVisible((v) => !v);
                      if (id === "resource") setResourceVisible((v) => !v);
                      if (id === "bio") setBioVisible((v) => !v);
                      if (id === "human") setHumanVisible((v) => !v);
                      if (id === "population") setPopVisible((v) => !v);
                      if (id === "routes") setRouteVisible((v) => !v);
                      if (id === "cadastre") setCadastreVisible((v) => !v);
                    },
                    active: mode === "region" ? { geo: activeRegion, resource: activeResource, bio: activeBio, human: activeHuman, population: activePop, routes: activeRoute, cadastre: activeCadastre } : null,
                    onGenerate: (id) => {
                      if (id === "resource") setShowResourceModal(true);
                      if (id === "bio") setShowBioModal(true);
                      if (id === "human") setShowHumanModal(true);
                      if (id === "population") setShowPopModal(true);
                      if (id === "routes") setShowRouteModal(true);
                      if (id === "cadastre") setShowCadastreModal(true);
                    },
                  }}
                />
              )}

              {sidebarTab === "stats" && macro && (
                <StatsPanel
                  macro={macro}
                  region={activeRegion}
                  detailCount={regionDetail.size}
                  residentFeatures={residentFeatures}
                  onOpenVerifier={() => setShowVerifier(true)}
                  regions={regionDetail}
                  resources={resourceLayers}
                  bios={bioLayers}
                  humans={humanLayers}
                  pops={popLayers}
                  routes={routeLayers}
                  cadastres={cadastreLayers}
                  activeResource={activeResource}
                  activeBio={activeBio}
                  activeHuman={activeHuman}
                  activePop={activePop}
                  activeRoute={activeRoute}
                  activeCadastre={activeCadastre}
                />
              )}
              </RecoveryBoundary>
            </div>
          </aside>
        )}
      </div>

      {/* Modals */}
      <PlanetSetupModal
        open={showSetup}
        onClose={() => setShowSetup(false)}
        onGenerate={requestPlanetGeneration}
        busy={isBusy}
        progress={macroProgress}
        current={planetConfig}
        loadedRegionCount={regionDetail.size}
      />
      <RegionGenerateModal
        open={!!pendingRegion}
        region={pendingRegion}
        initialConfig={pendingRegion ? regionDetail.get(pendingRegion.id)?.config ?? null : null}
        onClose={() => setPendingRegion(null)}
        onGenerate={runRegion}
        busy={isBusy}
        progress={regionProgress}
      />
      <LogModal open={showLog} onClose={() => setShowLog(false)} logs={allLogs} />
      <ArchitectureModal open={showArch} onClose={() => setShowArch(false)} />
      <SizeClassModal
        open={showSizes}
        onClose={() => setShowSizes(false)}
        macro={macro}
        detail={regionDetail}
        onOpenRegion={requestRegion}
      />
      <VerifierModal
        open={showVerifier}
        onClose={() => setShowVerifier(false)}
        macro={macro}
        regions={regionDetail}
        activeRegionId={activeTab.regionId ?? null}
        showRawMode={showRawMode}
        onToggleRawMode={setShowRawMode}
      />
      <ResourceModal
        key={`resource:${activeTab.regionId ?? "planet"}`}
        open={showResourceModal}
        onClose={() => setShowResourceModal(false)}
        region={activeRegion}
        existing={activeResource}
        onApplyConfig={runResource}
      />
      <BioModal
        key={`bio:${activeTab.regionId ?? "planet"}`}
        open={showBioModal}
        onClose={() => setShowBioModal(false)}
        region={activeRegion}
        existing={activeBio}
        busy={bioBusy || isBusy}
        progress={bioProgress}
        onGenerate={runBio}
        showRaw={bioShowRaw}
        onToggleRaw={setBioShowRaw}
      />
      <HumanModal
        key={`human:${activeTab.regionId ?? "planet"}`}
        open={showHumanModal}
        onClose={() => setShowHumanModal(false)}
        region={activeRegion}
        bio={activeBio}
        existing={activeHuman}
        busy={humanBusy || isBusy}
        progress={humanProgress}
        onGenerate={runHuman}
        showRaw={humanShowRaw}
        onToggleRaw={setHumanShowRaw}
      />
      <PopulationModal
        key={`pop:${activeTab.regionId ?? "planet"}`}
        open={showPopModal}
        onClose={() => setShowPopModal(false)}
        region={activeRegion}
        zones={activeHuman}
        existing={activePop}
        busy={popBusy || isBusy}
        progress={popProgress}
        onGenerate={runPop}
        onClear={clearPopulation}
      />
      <RouteModal
        key={`route:${activeTab.regionId ?? "planet"}`}
        open={showRouteModal}
        onClose={() => setShowRouteModal(false)}
        region={activeRegion}
        settlements={activeHuman ? activeHuman.settlements : []}
        resources={activeResource}
        existing={activeRoute}
        busy={routeBusy || isBusy}
        progress={routeProgress}
        onGenerate={runRoute}
      />
      <CadastreModal
        key={`cadastre:${activeTab.regionId ?? "planet"}`}
        open={showCadastreModal}
        onClose={() => setShowCadastreModal(false)}
        region={activeRegion}
        human={activeHuman}
        population={activePop}
        cadastreLayer={activeCadastre}
        onCadastreGenerated={(res) => {
          if (activeRegion) {
            setWorldLayer(activeRegion.descriptor.id, "cadastre", res);
          }
        }}
        onFocusSettlement={(s) => {
          setFocusTarget({
            bbox: {
              minX: s.point[0] - 0.05,
              minY: s.point[1] - 0.05,
              maxX: s.point[0] + 0.05,
              maxY: s.point[1] + 0.05,
            },
            nonce: ++focusNonce.current,
            tabId: activeTabId,
          });
        }}
      />
      <BackupModal
        open={showBackup}
        onClose={() => setShowBackup(false)}
        busy={isBusy}
        regionCount={regionDetail.size}
        makeCheckpoint={makeWorkspaceCheckpoint}
        onRestore={restoreWorkspaceCheckpoint}
      />
    </div>
  );
}
