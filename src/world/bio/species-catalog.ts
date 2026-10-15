import type { SpeciesCategory, SpeciesDef } from "./bio-types";

// ---------------------------------------------------------------------------
// HUMAN-DEPENDENCY SPECIES CATALOG (imported & tweaked, not invented)
//
// Plant climate envelopes are imported from the FAO EcoCrop database
// (EcoCrop_DB.csv, mirrored at github.com/OpenCLIM/ecocrop — fields TMIN/TMAX,
// RMIN/RMAX, ALTMX), simplified from growing-season cardinal values to the
// annual-mean envelopes this planet's climate model exposes, and trimmed from
// 2,568 species to the set human settlement (Layer 4) actually depends on:
// every major edible crop group, livestock, draft/transport animals, game,
// fisheries, plus timber and forage. Animal ranges follow FAO/FAOSTAT
// husbandry and fisheries distribution data.
//
// Tweaks applied to the imported values:
//  • TMIN relaxed ~2°C where winter dormancy applies (annual-mean form)
//  • RMIN kept as the un-irrigated floor; `irrigable` marks crops the source
//    lists as commonly irrigated (desert agriculture near fresh water)
//  • ALTMX carried over only where it constrains placement on this planet
// ---------------------------------------------------------------------------

const S = (
  id: string,
  name: string,
  sci: string,
  glyph: string,
  kind: SpeciesDef["kind"],
  category: SpeciesDef["category"],
  roles: SpeciesDef["roles"],
  tMin: number,
  tMax: number,
  rMin: number,
  rMax: number,
  spreadKm: [number, number],
  extra: Partial<SpeciesDef> = {}
): SpeciesDef => ({
  id,
  name,
  sci,
  glyph,
  kind,
  category,
  roles,
  tMin,
  tMax,
  rMin,
  rMax,
  habitat: "land",
  spreadKm,
  ...extra,
});

export const SPECIES_CATALOG: SpeciesDef[] = [
  // ---- CEREALS & PSEUDOCEREALS (EcoCrop) ----------------------------------
  S("wheat", "Wheat", "Triticum aestivum", "🌾", "crop", "cereal", ["staple"], 3, 27, 300, 1600, [25, 90], { staple: true, elevMaxM: 3500, irrigable: true }),
  S("rice", "Rice", "Oryza sativa", "🌾", "crop", "cereal", ["staple"], 16, 36, 1000, 4000, [20, 80], { staple: true, irrigable: true, waterKm: 60, biomes: ["forest", "wetland", "savanna", "grassland"] }),
  S("maize", "Maize", "Zea mays", "🌽", "crop", "cereal", ["staple"], 10, 33, 400, 1800, [25, 90], { staple: true, elevMaxM: 3300, irrigable: true }),
  S("barley", "Barley", "Hordeum vulgare", "🌾", "crop", "cereal", ["staple"], 0, 27, 200, 1000, [20, 70], { staple: true, elevMaxM: 4500 }),
  S("sorghum", "Sorghum", "Sorghum bicolor", "🌾", "crop", "cereal", ["staple"], 14, 40, 300, 1000, [20, 70], { staple: true }),
  S("pearl-millet", "Pearl Millet", "Pennisetum glaucum", "🌾", "crop", "cereal", ["staple"], 16, 40, 200, 900, [15, 60], { staple: true }),
  S("oats", "Oats", "Avena sativa", "🌾", "crop", "cereal", ["staple", "forage"], 2, 26, 250, 1500, [15, 60], { staple: true }),
  S("rye", "Rye", "Secale cereale", "🌾", "crop", "cereal", ["staple"], -2, 25, 300, 900, [15, 60], { staple: true }),
  S("quinoa", "Quinoa", "Chenopodium quinoa", "🌾", "crop", "cereal", ["staple"], 0, 20, 250, 800, [10, 40], { staple: true, highland: true }),
  S("buckwheat", "Buckwheat", "Fagopyrum esculentum", "🌾", "crop", "cereal", ["staple"], 5, 25, 400, 1200, [10, 40], { staple: true }),

  // ---- ROOTS & TUBERS (EcoCrop) -------------------------------------------
  S("potato", "Potato", "Solanum tuberosum", "🥔", "crop", "root", ["staple", "vegetable"], 2, 25, 350, 1600, [20, 70], { staple: true, elevMaxM: 4300 }),
  S("sweet-potato", "Sweet Potato", "Ipomoea batatas", "🍠", "crop", "root", ["staple"], 16, 35, 600, 1700, [15, 60], { staple: true }),
  S("cassava", "Cassava", "Manihot esculenta", "🍠", "crop", "root", ["staple"], 18, 35, 500, 2800, [20, 70], { staple: true }),
  S("yam", "Yam", "Dioscorea spp.", "🍠", "crop", "root", ["staple"], 20, 35, 900, 3000, [12, 45], { staple: true }),
  S("taro", "Taro", "Colocasia esculenta", "🍠", "crop", "root", ["staple"], 18, 35, 1200, 4000, [8, 30], { staple: true, waterKm: 40, biomes: ["forest", "wetland", "savanna", "grassland"] }),

  // ---- LEGUMES / PULSES (EcoCrop) -----------------------------------------
  S("soybean", "Soybean", "Glycine max", "🫘", "crop", "legume", ["protein", "oil"], 12, 32, 450, 1500, [20, 70]),
  S("common-bean", "Common Bean", "Phaseolus vulgaris", "🫘", "crop", "legume", ["protein"], 12, 30, 400, 1600, [15, 60]),
  S("chickpea", "Chickpea", "Cicer arietinum", "🫘", "crop", "legume", ["protein"], 8, 30, 300, 1000, [12, 45], { irrigable: true }),
  S("lentil", "Lentil", "Lens culinaris", "🫘", "crop", "legume", ["protein"], 4, 28, 300, 900, [10, 40]),
  S("pea", "Field Pea", "Pisum sativum", "🫛", "crop", "legume", ["protein", "vegetable"], 2, 24, 350, 1100, [10, 40]),
  S("peanut", "Groundnut", "Arachis hypogaea", "🥜", "crop", "legume", ["protein", "oil"], 18, 35, 450, 1300, [12, 45]),
  S("cowpea", "Cowpea", "Vigna unguiculata", "🫘", "crop", "legume", ["protein"], 16, 37, 300, 1500, [12, 45]),

  // ---- VEGETABLES (EcoCrop; grouped) --------------------------------------
  S("tomato", "Tomato", "Solanum lycopersicum", "🍅", "crop", "vegetable", ["vegetable"], 12, 32, 400, 1400, [10, 35], { irrigable: true }),
  S("onion", "Onion & Garlic", "Allium cepa / sativum", "🧅", "crop", "vegetable", ["vegetable", "spice"], 4, 30, 300, 1600, [10, 35], { irrigable: true }),
  S("brassica", "Cabbage & Kale", "Brassica oleracea", "🥬", "crop", "vegetable", ["vegetable"], 2, 25, 400, 1600, [10, 35]),
  S("carrot", "Carrot", "Daucus carota", "🥕", "crop", "vegetable", ["vegetable"], 5, 26, 400, 1200, [8, 30]),
  S("squash", "Squash & Pumpkin", "Cucurbita spp.", "🎃", "crop", "vegetable", ["vegetable"], 13, 33, 450, 1400, [10, 35]),
  S("chili", "Chili & Pepper", "Capsicum spp.", "🌶️", "crop", "vegetable", ["vegetable", "spice"], 16, 32, 500, 1500, [8, 30]),
  S("eggplant", "Eggplant", "Solanum melongena", "🍆", "crop", "vegetable", ["vegetable"], 16, 33, 500, 1400, [8, 30]),
  S("cucumber", "Cucumber & Melon", "Cucumis spp.", "🥒", "crop", "vegetable", ["vegetable", "fruit"], 14, 32, 400, 1500, [8, 30], { irrigable: true }),
  S("leafy-greens", "Leafy Greens", "Lactuca / Spinacia", "🥬", "crop", "vegetable", ["vegetable"], 3, 24, 400, 1200, [8, 30]),

  // ---- FRUITS (EcoCrop) ----------------------------------------------------
  S("banana", "Banana & Plantain", "Musa spp.", "🍌", "crop", "fruit", ["fruit", "staple"], 18, 35, 1100, 4000, [12, 45], { staple: true }),
  S("apple", "Apple", "Malus domestica", "🍎", "crop", "fruit", ["fruit"], 2, 24, 500, 1300, [10, 40]),
  S("citrus", "Citrus", "Citrus spp.", "🍊", "crop", "fruit", ["fruit"], 13, 34, 600, 2000, [10, 40], { irrigable: true }),
  S("mango", "Mango", "Mangifera indica", "🥭", "crop", "fruit", ["fruit"], 19, 36, 600, 2600, [10, 40]),
  S("grape", "Grape", "Vitis vinifera", "🍇", "crop", "fruit", ["fruit", "beverage"], 10, 30, 350, 1200, [10, 40], { irrigable: true }),
  S("date-palm", "Date Palm", "Phoenix dactylifera", "🌴", "crop", "fruit", ["fruit", "staple"], 18, 42, 80, 500, [8, 30], { irrigable: true, waterKm: 30, biomes: ["desert", "savanna", "grassland"] }),
  S("coconut", "Coconut", "Cocos nucifera", "🥥", "crop", "fruit", ["fruit", "oil"], 21, 34, 1000, 4000, [10, 40], { elevMaxM: 900 }),
  S("papaya", "Papaya", "Carica papaya", "🥭", "crop", "fruit", ["fruit"], 19, 35, 1000, 2500, [8, 30]),
  S("pineapple", "Pineapple", "Ananas comosus", "🍍", "crop", "fruit", ["fruit"], 18, 32, 800, 2500, [8, 30]),
  S("olive", "Olive", "Olea europaea", "🫒", "crop", "fruit", ["oil", "fruit"], 10, 30, 300, 900, [10, 40]),
  S("stone-fruit", "Peach & Plum", "Prunus spp.", "🍑", "crop", "fruit", ["fruit"], 6, 28, 500, 1300, [8, 30]),
  S("fig", "Fig", "Ficus carica", "🫐", "crop", "fruit", ["fruit"], 10, 32, 300, 1000, [8, 30], { irrigable: true }),
  S("watermelon", "Watermelon", "Citrullus lanatus", "🍉", "crop", "fruit", ["fruit"], 16, 35, 400, 1200, [8, 30], { irrigable: true }),

  // ---- OIL / SUGAR / BEVERAGE / FIBER / SPICE / NUT (EcoCrop) --------------
  S("sunflower", "Sunflower", "Helianthus annuus", "🌻", "crop", "oil", ["oil"], 10, 30, 400, 1200, [12, 45]),
  S("rapeseed", "Rapeseed", "Brassica napus", "🌼", "crop", "oil", ["oil"], 3, 25, 400, 1000, [12, 45]),
  S("oil-palm", "Oil Palm", "Elaeis guineensis", "🌴", "crop", "oil", ["oil"], 21, 33, 1500, 4000, [12, 45]),
  S("sesame", "Sesame", "Sesamum indicum", "🌿", "crop", "oil", ["oil"], 18, 35, 300, 1100, [8, 30]),
  S("sugarcane", "Sugarcane", "Saccharum officinarum", "🎋", "crop", "sugar", ["sugar"], 18, 37, 1000, 3000, [12, 45], { irrigable: true }),
  S("sugar-beet", "Sugar Beet", "Beta vulgaris", "🫜", "crop", "sugar", ["sugar"], 4, 26, 450, 1100, [12, 45]),
  S("coffee", "Coffee", "Coffea arabica", "☕", "crop", "beverage", ["beverage"], 14, 28, 1100, 2400, [8, 30], { highland: true, elevMaxM: 2300 }),
  S("tea", "Tea", "Camellia sinensis", "🍵", "crop", "beverage", ["beverage"], 12, 30, 1100, 3000, [8, 30]),
  S("cacao", "Cacao", "Theobroma cacao", "🍫", "crop", "beverage", ["beverage"], 20, 33, 1400, 3500, [8, 30], { biomes: ["forest", "wetland"] }),
  S("cotton", "Cotton", "Gossypium hirsutum", "🧶", "crop", "fiber", ["fiber"], 16, 35, 450, 1500, [12, 45], { irrigable: true }),
  S("flax", "Flax", "Linum usitatissimum", "🧵", "crop", "fiber", ["fiber", "oil"], 4, 25, 400, 900, [10, 35]),
  S("hemp", "Hemp", "Cannabis sativa", "🧵", "crop", "fiber", ["fiber"], 7, 27, 500, 1200, [10, 35]),
  S("black-pepper", "Black Pepper", "Piper nigrum", "🫑", "crop", "spice", ["spice"], 20, 32, 1400, 3500, [5, 20], { biomes: ["forest", "wetland"] }),
  S("ginger", "Ginger & Turmeric", "Zingiber / Curcuma", "🫚", "crop", "spice", ["spice"], 18, 32, 1200, 3000, [5, 20]),
  S("almond", "Almond", "Prunus dulcis", "🌰", "crop", "nut", ["protein", "oil"], 8, 30, 300, 800, [8, 30], { irrigable: true }),
  S("walnut", "Walnut & Chestnut", "Juglans / Castanea", "🌰", "crop", "nut", ["protein"], 6, 26, 600, 1400, [8, 30]),
  S("cashew", "Cashew", "Anacardium occidentale", "🌰", "crop", "nut", ["protein"], 20, 35, 700, 2200, [8, 30]),

  // ---- LIVESTOCK (FAO/FAOSTAT husbandry ranges) ----------------------------
  S("cattle", "Cattle", "Bos taurus", "🐄", "livestock", "meat_dairy", ["meat", "dairy", "draft"], -4, 32, 250, 3000, [25, 90], { needsForage: true }),
  S("buffalo", "Water Buffalo", "Bubalus bubalis", "🐃", "livestock", "meat_dairy", ["meat", "dairy", "draft"], 12, 36, 700, 4000, [15, 60], { needsForage: true, waterKm: 45 }),
  S("sheep", "Sheep", "Ovis aries", "🐑", "livestock", "meat_dairy", ["meat", "wool", "dairy"], -8, 30, 150, 1600, [20, 75], { needsForage: true }),
  S("goat", "Goat", "Capra hircus", "🐐", "livestock", "meat_dairy", ["meat", "dairy"], -4, 36, 100, 1900, [18, 70], { needsForage: true }),
  S("pig", "Pig", "Sus domesticus", "🐖", "livestock", "meat_dairy", ["meat"], -2, 32, 350, 3200, [15, 55]),
  S("chicken", "Chicken", "Gallus domesticus", "🐓", "livestock", "poultry", ["meat", "protein"], 0, 35, 200, 3500, [12, 45]),
  S("duck", "Duck & Goose", "Anas / Anser", "🦆", "livestock", "poultry", ["meat", "protein"], 0, 32, 400, 3500, [10, 40], { waterKm: 35 }),
  S("horse", "Horse", "Equus caballus", "🐎", "livestock", "draft", ["draft", "transport"], -14, 30, 200, 1800, [18, 70], { needsForage: true }),
  S("donkey", "Donkey & Mule", "Equus asinus", "🫏", "livestock", "draft", ["draft", "transport"], 2, 36, 100, 1400, [14, 50]),
  S("camel", "Camel", "Camelus dromedarius", "🐪", "livestock", "camelid", ["transport", "dairy", "meat"], 8, 45, 0, 450, [18, 70], { biomes: ["desert", "savanna", "grassland"] }),
  S("llama", "Llama & Alpaca", "Lama glama / pacos", "🦙", "livestock", "camelid", ["wool", "transport", "meat"], -8, 20, 200, 1200, [12, 45], { highland: true }),
  S("yak", "Yak", "Bos grunniens", "🐂", "livestock", "camelid", ["dairy", "meat", "wool", "draft"], -20, 14, 200, 1300, [12, 45], { highland: true }),
  S("reindeer", "Reindeer", "Rangifer tarandus", "🦌", "livestock", "camelid", ["meat", "transport"], -24, 8, 150, 1200, [20, 75], { biomes: ["tundra", "forest", "glacier"] }),
  S("honey-bee", "Honey Bee", "Apis mellifera", "🐝", "livestock", "apiary", ["honey", "pollination"], 2, 36, 250, 3500, [10, 40], { biomes: ["forest", "grassland", "savanna", "wetland"] }),

  // ---- WILD FAUNA humans hunt/fish (FAO fisheries & game ranges) -----------
  S("deer", "Deer & Elk", "Cervidae", "🦌", "wild", "game", ["game", "meat"], -14, 28, 350, 2600, [20, 80], { biomes: ["forest", "grassland", "tundra", "wetland"] }),
  S("boar", "Wild Boar", "Sus scrofa", "🐗", "wild", "game", ["game", "meat"], -6, 32, 450, 3000, [15, 60], { biomes: ["forest", "wetland", "grassland"] }),
  S("hare", "Hare & Rabbit", "Leporidae", "🐇", "wild", "game", ["game", "meat"], -12, 34, 150, 2000, [12, 50]),
  S("waterfowl", "Wild Waterfowl", "Anatidae", "🦢", "wild", "game", ["game", "meat"], -10, 32, 300, 4000, [10, 40], { waterKm: 25 }),
  S("trout", "Trout & Whitefish", "Salmonidae", "🐟", "wild", "fish_fresh", ["fishery", "protein"], -8, 18, 0, 9999, [8, 30], { habitat: "freshwater" }),
  S("carp", "Carp & Catfish", "Cyprinidae / Siluridae", "🐟", "wild", "fish_fresh", ["fishery", "protein"], 6, 32, 0, 9999, [8, 30], { habitat: "freshwater" }),
  S("salmon", "Salmon Run", "Salmo / Oncorhynchus", "🐟", "wild", "fish_fresh", ["fishery", "protein"], -8, 14, 0, 9999, [10, 35], { habitat: "freshwater" }),
  S("cold-fishery", "Cod & Herring Banks", "Gadus / Clupea", "🐟", "wild", "fish_marine", ["fishery", "protein"], -6, 14, 0, 9999, [25, 90], { habitat: "marine" }),
  S("warm-fishery", "Reef & Tuna Fishery", "Thunnus / reef spp.", "🐠", "wild", "fish_marine", ["fishery", "protein"], 16, 31, 0, 9999, [25, 90], { habitat: "marine" }),
  S("shellfish", "Shellfish Beds", "Bivalvia / Crustacea", "🦪", "wild", "shellfish", ["fishery", "protein"], -4, 30, 0, 9999, [10, 40], { habitat: "coastal" }),

  // ---- SUPPORT FLORA for Layer 4 (EcoCrop forestry/forage entries) ---------
  S("pasture", "Pasture Grasses", "Poaceae (forage)", "🌱", "flora", "forage", ["forage"], -10, 36, 150, 2200, [30, 110], { biomes: ["grassland", "savanna", "tundra", "forest", "wetland"] }),
  S("softwood", "Softwood Timber", "Pinus / Picea / Abies", "🌲", "flora", "timber", ["timber"], -16, 22, 350, 2200, [30, 110], { biomes: ["forest", "tundra", "grassland"] }),
  S("hardwood", "Hardwood Timber", "Quercus / Fagus / Tectona", "🌳", "flora", "timber", ["timber"], 4, 32, 550, 3200, [30, 110], { biomes: ["forest", "savanna", "wetland"] }),
  S("bamboo", "Bamboo", "Bambusa vulgaris", "🎍", "flora", "timber", ["timber", "fiber"], 13, 32, 900, 4200, [12, 45], { biomes: ["forest", "wetland", "savanna"] }),
  S("reeds", "Reeds & Papyrus", "Phragmites / Cyperus", "🌾", "flora", "reed", ["fiber", "forage"], 2, 34, 0, 9999, [8, 30], { waterKm: 10 }),
];

export const SPECIES_BY_ID: Map<string, SpeciesDef> = new Map(SPECIES_CATALOG.map((s) => [s.id, s]));

export const CATEGORY_COLORS: Record<SpeciesCategory, string> = {
  cereal: "#eab308",
  root: "#d97706",
  legume: "#84cc16",
  vegetable: "#22c55e",
  fruit: "#f97316",
  oil: "#facc15",
  sugar: "#f472b6",
  beverage: "#a16207",
  fiber: "#e2e8f0",
  spice: "#ef4444",
  nut: "#92652a",
  meat_dairy: "#f87171",
  poultry: "#fb923c",
  draft: "#a78bfa",
  camelid: "#c084fc",
  apiary: "#fbbf24",
  game: "#34d399",
  fish_fresh: "#38bdf8",
  fish_marine: "#0ea5e9",
  shellfish: "#2dd4bf",
  timber: "#166534",
  forage: "#a3e635",
  reed: "#5eead4",
};

export const KIND_LABELS: Record<SpeciesDef["kind"], string> = {
  crop: "Crop",
  livestock: "Livestock",
  wild: "Wild Fauna",
  flora: "Support Flora",
};

/** Roles the finetune guarantees per region (when climate allows at all). */
export const REQUIRED_ROLES: { role: string; label: string }[] = [
  { role: "staple", label: "Staple carbohydrate" },
  { role: "protein", label: "Protein source" },
  { role: "vegetable", label: "Vegetables" },
  { role: "fruit", label: "Fruit" },
  { role: "timber", label: "Timber" },
  { role: "forage", label: "Forage / pasture" },
  { role: "fiber", label: "Fiber" },
];
