import type { GeneratedRegion, Pt } from "../types";
import type { SettlementTier } from "../human/human-types";
import type { BuildingFootprint, EstablishmentInfo } from "./cadastre-types";
import { makeRng } from "../rng";

// ---------------------------------------------------------------------------
// ESTABLISHMENT & SOCIO-ECONOMIC GENERATOR (S. John Ross / Eigengrau Paradigm)
//
// Synthesizes authentic medieval fantasy named establishments, proprietors,
// and trades contextualized by Layer 2 regional resources (metals, timber,
// fisheries, livestock, agriculture) and settlement tier.
// ---------------------------------------------------------------------------

const INN_ADJECTIVES = [
  "Silver", "Golden", "Red", "Black", "Prancing", "Drunken", "Rusty", "Sleeping",
  "Merry", "Blind", "Crowned", "Weeping", "Iron", "Dancing", "Copper", "Gilded",
  "Silent", "Roaring", "Green", "White", "Salty", "Shistling", "Hearth", "Moonlit"
];

const INN_NOUNS = [
  "Flagon", "Tankard", "Boar", "Stag", "Drake", "Griffin", "Hearth", "Anchor",
  "Maiden", "Crow", "Badger", "Lion", "Hound", "Goat", "Swan", "Knight",
  "Goblet", "Shield", "Barrel", "Barrow", "Kettle", "Whistle", "Lantern", "Compass"
];

const TEMPLE_DEITIES = [
  "the Dawnfather", "the Earthmother", "the Sunken Beacon", "St. Theresa",
  "the Silver Light", "the Iron Justiciar", "the Hearthkeeper", "the Stormlord",
  "the Weeping Virgin", "the Seven Heavens", "the Sacred Flame", "the Silent Guide"
];

const SMITH_PREFIXES = [
  "Stonehammer", "Ironclash", "Wyrmfire", "Blackanvil", "Ember", "Heavyiron",
  "Coldsteel", "Silverbrand", "Bronzebound", "Redflame", "Deepforge", "Grimhammer"
];

const MANOR_NAMES = [
  "Ravenscroft", "Highgate", "Greystone", "Alderman's", "Barrow Hall", "Ironwood",
  "Cresthaven", "Silverthorne", "Windmere", "Dunwall", "Oakenshield", "Valemont"
];

const FIRST_NAMES = [
  "Durgan", "Bron", "Elora", "Willem", "Bran", "Kaelen", "Morwen", "Alistair",
  "Giles", "Aldous", "Mina", "Rowan", "Theron", "Greta", "Corin", "Lucan",
  "Jocelyn", "Oswin", "Breg", "Kendra", "Torvald", "Hilda", "Percival", "Maeve"
];

const SURNAMES = [
  "Stone", "Ironbeard", "Vance", "Blackwood", "Miller", "Cooper", "Fletcher",
  "Tanner", "Thorne", "Rivers", "Oakhaven", "Hill", "Dale", "Frost",
  "Smith", "Barrow", "Marsh", "Crowe", "Sterling", "Hearth", "Winter", "Fox"
];

/** Scans local region features within radius to detect surrounding economic resources */
export function detectLocalEconomicResources(
  geo: GeneratedRegion,
  center: Pt,
  searchRadiusUnits = 0.08 // ~450m
): Set<string> {
  const resources = new Set<string>();

  for (const f of geo.features) {
    const fType = f.properties.featureType;
    const fName = (f.properties.name || "").toLowerCase();
    const fProps = f.properties as unknown as Record<string, unknown>;
    const fCat = String(fProps.resourceCategory || "").toLowerCase();

    // Check bbox proximity
    const b = f.bbox;
    const inRange =
      center[0] >= b.minX - searchRadiusUnits &&
      center[0] <= b.maxX + searchRadiusUnits &&
      center[1] >= b.minY - searchRadiusUnits &&
      center[1] <= b.maxY + searchRadiusUnits;

    if (!inRange) continue;

    if (fType === "river" || fType === "lake" || fType === "sea" || fName.includes("water") || fName.includes("fish")) {
      resources.add("fishery");
      resources.add("waterfront");
    }
    if (fType === "forest" || fName.includes("timber") || fName.includes("pine") || fName.includes("oak")) {
      resources.add("timber");
    }
    if (fCat === "metal" || fCat === "mineral" || fName.includes("iron") || fName.includes("copper") || fName.includes("mine") || fName.includes("quarry")) {
      resources.add("metals");
      resources.add("quarry");
    }
    if (fType === "grassland" || fType === "savanna" || fName.includes("plains") || fName.includes("pasture")) {
      resources.add("livestock");
      resources.add("agriculture");
    }
    if (fCat === "luxury" || fName.includes("gold") || fName.includes("silver") || fName.includes("gem")) {
      resources.add("luxury");
    }
  }

  return resources;
}

/** Synthesizes a full socio-economic establishment directory for a settlement's buildings */
export function generateSettlementEstablishments(
  settlementId: string,
  settlementName: string,
  _tier: SettlementTier,
  buildings: BuildingFootprint[],
  geo: GeneratedRegion,
  center: Pt,
  seedString: string
): EstablishmentInfo[] {
  const rng = makeRng(`${seedString}::establishments::${settlementId}`);
  const resources = detectLocalEconomicResources(geo, center);
  const establishments: EstablishmentInfo[] = [];

  let estCounter = 0;

  for (const b of buildings) {
    let est: EstablishmentInfo | null = null;
    const estId = `est_${settlementId}_${++estCounter}`;
    const pFirst = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const pLast = SURNAMES[Math.floor(rng() * SURNAMES.length)];
    const propName = `${pFirst} ${pLast}`;

    switch (b.buildingType) {
      case "inn": {
        const adj = INN_ADJECTIVES[Math.floor(rng() * INN_ADJECTIVES.length)];
        const noun = resources.has("waterfront") && rng() > 0.4
          ? (rng() > 0.5 ? "Anchor" : "Maiden")
          : INN_NOUNS[Math.floor(rng() * INN_NOUNS.length)];
        est = {
          id: estId,
          name: `The ${adj} ${noun} Inn`,
          trade: "Coaching Inn & Hospitality",
          proprietor: `Innkeeper ${propName}`,
          socialClass: "artisan",
          specialty: "Rooms, warm spiced ale, and fresh roasted mutton",
          buildingId: b.id,
        };
        break;
      }
      case "tavern": {
        const adj = INN_ADJECTIVES[Math.floor(rng() * INN_ADJECTIVES.length)];
        const noun = INN_NOUNS[Math.floor(rng() * INN_NOUNS.length)];
        est = {
          id: estId,
          name: `The ${adj} ${noun} Tavern`,
          trade: "Public Tavern & Alehouse",
          proprietor: `Tavernkeeper ${propName}`,
          socialClass: "yeoman",
          specialty: "Cask cider, bar dice, and hearty stew",
          buildingId: b.id,
        };
        break;
      }
      case "temple":
      case "cathedral":
      case "chapel": {
        const deity = TEMPLE_DEITIES[Math.floor(rng() * TEMPLE_DEITIES.length)];
        const title = b.buildingType === "cathedral" ? "High Cathedral of" : b.buildingType === "chapel" ? "Chapel of" : "Sanctuary of";
        const clergyTitle = b.buildingType === "cathedral" ? "Archbishop" : b.buildingType === "temple" ? "High Priest" : "Brother";
        est = {
          id: estId,
          name: `${title} ${deity}`,
          trade: "Religious Ministry & Sanctuary",
          proprietor: `${clergyTitle} ${propName}`,
          socialClass: "clergy",
          specialty: "Daily prayers, holy communion, and consecrated burial rites",
          buildingId: b.id,
        };
        break;
      }
      case "blacksmith": {
        const prefix = SMITH_PREFIXES[Math.floor(rng() * SMITH_PREFIXES.length)];
        const smithTrade = resources.has("metals")
          ? (rng() > 0.4 ? "Armory & Weaponry" : "Master Bladesmith")
          : "Farrier & General Smithing";
        est = {
          id: estId,
          name: `${prefix} Forge`,
          trade: smithTrade,
          proprietor: `Master Smith ${propName}`,
          socialClass: "artisan",
          specialty: resources.has("metals") ? "Folded steel broadswords and plate harness" : "Iron plowshares, horseshoes, and hearth chains",
          buildingId: b.id,
        };
        break;
      }
      case "townhall": {
        est = {
          id: estId,
          name: `${settlementName} Civic Hall`,
          trade: "Town Council & Magisterium",
          proprietor: `High Alderman ${propName}`,
          socialClass: "patrician",
          specialty: "Municipal charters, market tax collection, and magistrate court",
          buildingId: b.id,
        };
        break;
      }
      case "keep": {
        est = {
          id: estId,
          name: `${settlementName} Citadel Keep`,
          trade: "Military Garrison & Castellan",
          proprietor: `Castellan ${propName}`,
          socialClass: "patrician",
          specialty: "Garrison watch, armory stockade, and regional defense command",
          buildingId: b.id,
        };
        break;
      }
      case "manor": {
        const mName = MANOR_NAMES[Math.floor(rng() * MANOR_NAMES.length)];
        est = {
          id: estId,
          name: `${mName} Manor`,
          trade: "Noble Gentry Estate",
          proprietor: `Lord ${propName}`,
          socialClass: "patrician",
          specialty: "Land leases, fine vintage cellars, and pedigree falcons",
          buildingId: b.id,
        };
        break;
      }
      case "watermill": {
        est = {
          id: estId,
          name: `${pLast}'s Millpond Watermill`,
          trade: "Grain Milling & Sifting",
          proprietor: `Miller ${propName}`,
          socialClass: "yeoman",
          specialty: "Stone-ground flour and grain storage",
          buildingId: b.id,
        };
        break;
      }
      case "windmill": {
        est = {
          id: estId,
          name: `Highknoll Windmill`,
          trade: "Wind-Powered Gristmill",
          proprietor: `Miller ${propName}`,
          socialClass: "yeoman",
          specialty: "Fine rye and barley meal",
          buildingId: b.id,
        };
        break;
      }
      case "storehouse": {
        let storeTrade = "General Warehousing";
        let storeName = `${pLast} Merchant Storehouse`;
        if (resources.has("fishery")) {
          storeTrade = "Salt Fish & Barrel Depot";
          storeName = "Wharfside Cold Storage";
        } else if (resources.has("timber")) {
          storeTrade = "Timber & Lumber Stacking";
          storeName = "Sawyer's Timber Yard";
        } else if (resources.has("agriculture")) {
          storeTrade = "Civic Granary & Harvest Reserve";
          storeName = "Common Granary";
        }
        est = {
          id: estId,
          name: storeName,
          trade: storeTrade,
          proprietor: `Storekeeper ${propName}`,
          socialClass: "artisan",
          specialty: "Caravan dry storage and trade transshipment",
          buildingId: b.id,
        };
        break;
      }
      default:
        break;
    }

    if (est) {
      b.establishment = est;
      establishments.push(est);
    }
  }

  return establishments;
}
