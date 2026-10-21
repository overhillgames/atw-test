// Line Tower Wars runtime, part 03 of 20: attackerDefs, UNIT_CARD_COPY, DEFAULT_OPTIONS, GAUNTLET_STAGES, difficulty/strategy settings.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

const attackerDefs = [
  { id: "imp", name: "Imp", cost: 2, hp: 18, speed: 0.09, color: "#1f2937" },
  { id: "runner", name: "Runner", cost: 3, hp: 16.2, speed: 0.126, color: "#d97706" },
  { id: "brute", name: "Brute", cost: 4, hp: 39.6, speed: 0.0825, color: "#15803d" },
  { id: "wisp", name: "Wisp", cost: 5, hp: 30.8, speed: 0.132, color: "#8b5cf6" },
  { id: "tank", name: "Tank", cost: 6, hp: 57.2, speed: 0.0682, color: "#0f766e" }
];
const UNIT_CARD_COPY = {
  violet: { role: "WIDE", line: "Cheapest tower, with the widest firing arc", effect: "" },
  yellow: { role: "SLOW", line: "Slows attackers and arcs to a second one", effect: "Slows its target by 30% for 1.2 s. Arcs to a nearby attacker for half damage and half the slow." },
  red: { role: "SPLASH", line: "Shrapnel flies out and hits other attackers", effect: "Each hit bursts into shrapnel; each piece deals a third of the hit." },
  green: { role: "POISON", line: "Longest range; poison keeps hurting for 3 s", effect: "Poison adds 60% more damage over 3 s. It doesn't stack." },
  blue: { role: "MULTI", line: "Shoots two attackers at once, three at level 2", effect: "" },
  imp: { role: "SWARM", line: "Cheapest attacker, sturdy for its price", effect: "" },
  runner: { role: "FAST", line: "Fast but fragile", effect: "" },
  brute: { role: "TOUGH", line: "Slow, but the most health for its cost", effect: "" },
  wisp: { role: "ELITE", line: "As fast as a Runner, with nearly twice the health", effect: "" },
  tank: { role: "HEAVY", line: "Slowest and toughest; shoots enemy attackers", effect: "Shoots the nearest enemy attacker: 1 damage every 1.1 s at short range." }
};
const DEFAULT_OPTIONS = {
  difficulty: "red", // 2026-10-21: the tug ladder's Normal.
  artPack: "jonCarlingLight",
  musicPack: "christopherJosephUehlein",
  musicVolume: 40,
  sfxVolume: 85
};
const GAUNTLET_STORAGE_KEY = ATW_STORAGE_PREFIX + "lineTowerWarsGauntlet";
// A new id resets everyone's Gauntlet progress once (2026-10-21: the old progress was earned on the old match).
const GAUNTLET_SEASON_ID = "gauntlet-2026-10-tug";
const GAUNTLET_MAP_WIDTH = 630;
const GAUNTLET_MAP_HEIGHT = 1520;
// Tug plays each stage at its skill (bot.plays.skill); strategy is the classic AI's.
const GAUNTLET_STAGES = [
  { id: "marker-01", difficulty: "purple", strategy: "rush", skill: 0.20, x: 311.5, y: 1415.5 },
  { id: "marker-02", difficulty: "purple", strategy: "fortress", skill: 0.26, x: 455.5, y: 1319.5 },
  { id: "marker-03", difficulty: "yellow", strategy: "counter", skill: 0.34, x: 215.5, y: 1271.5 },
  { id: "marker-04", difficulty: "yellow", strategy: "rush", skill: 0.40, x: 167.5, y: 1175.5 },
  { id: "marker-05", difficulty: "yellow", strategy: "fortress", skill: 0.46, x: 311.5, y: 1127.5 },
  { id: "marker-06", difficulty: "red", strategy: "counter", skill: 0.54, x: 455.5, y: 1031.5 },
  { id: "marker-07", difficulty: "red", strategy: "rush", skill: 0.60, x: 359.5, y: 983.5 },
  { id: "marker-08", difficulty: "red", strategy: "fortress", skill: 0.66, x: 263.5, y: 887.5 },
  { id: "marker-09", difficulty: "green", strategy: "counter", skill: 0.72, x: 167.5, y: 791.5 },
  { id: "marker-10", difficulty: "green", strategy: "rush", skill: 0.76, x: 359.5, y: 695.5 },
  { id: "marker-11", difficulty: "green", strategy: "fortress", skill: 0.80, x: 455.5, y: 551.5 },
  { id: "marker-12", difficulty: "green", strategy: "counter", skill: 0.84, x: 407.5, y: 455.5 },
  { id: "marker-13", difficulty: "blue", strategy: "rush", skill: 0.88, x: 215.5, y: 407.5 },
  { id: "marker-14", difficulty: "blue", strategy: "fortress", skill: 0.92, x: 311.5, y: 311.5 },
  { id: "marker-15", difficulty: "blue", strategy: "counter", skill: 0.96, x: 311.5, y: 215.5 },
  { id: "marker-16", difficulty: "blue", strategy: "boss", skill: 1.00, x: 311.5, y: 71.5 }
];
const ART_PACK_OPTIONS = [
  // The unlocked rows come from the pack manifests (www/assets/packs/<id>/pack.json: name + picker).
  ...PACK_ORDER.map((id) => ({ id, name: PACK_MANIFESTS[id].name, unlocked: true, ...PACK_MANIFESTS[id].picker })),
  { id: "artist4", name: "Artist Slot 4", unlocked: false, preview: { creeps: ["brute", "wisp"], towers: ["violet", "yellow"] } },
  { id: "artist5", name: "Artist Slot 5", unlocked: false, preview: { creeps: ["runner", "tank"], towers: ["green", "blue"] } },
  { id: "artist6", name: "Artist Slot 6", unlocked: false, preview: { creeps: ["imp", "wisp"], towers: ["red", "green"] } },
  { id: "artist7", name: "Artist Slot 7", unlocked: false, preview: { creeps: ["brute", "tank"], towers: ["yellow", "blue"] } },
  { id: "artist8", name: "Artist Slot 8", unlocked: false, preview: { creeps: ["runner", "brute"], towers: ["violet", "red"] } }
];
const MUSIC_PACK_OPTIONS = [
  {
    id: "christopherJosephUehlein",
    name: "Christopher Joseph Uehlein",
    unlocked: true,
    icon: "assets/music/composers/christopher-joseph-uehlein-spaceman.png",
    featureImage: "assets/music/composers/christopher-joseph-uehlein-spaceman.png",
    link: "https://overhill.games",
    tracks: [
      { title: "ATW Track 01 Original", src: "assets/music/christopher-joseph-uehlein-track-1.m4a" },
      { title: "ATW Track 02 Military Snare", src: "assets/music/christopher-joseph-uehlein-track-2.m4a" }
    ]
  },
  {
    id: "martinBiesecke",
    name: "Martin Biesecke",
    unlocked: true,
    icon: "assets/music/composers/martin-biesecke.png",
    featureImage: "assets/music/composers/martin-biesecke-mayybie-logo.png",
    link: "https://linktr.ee/maaybie",
    tracks: [
      { title: "Calm Stamets Point Theme", src: "assets/music/martin-biesecke-track-1.m4a" },
      { title: "Singularity Theme", src: "assets/music/martin-biesecke-track-2.m4a" },
      { title: "Martin Robot Combo", src: "assets/music/martin-biesecke-track-3.m4a" }
    ]
  },
  {
    id: "appalachianDeathTrap",
    name: "Appalachian Death Trap",
    unlocked: true,
    icon: "assets/music/composers/appalachian-death-trap-link.png",
    featureImage: "assets/music/composers/appalachian-death-trap-logo.jpg",
    link: "https://linktr.ee/adeathtrap",
    tracks: [
      { title: "Oxford Cloth Pyscho", src: "assets/music/appalachian-death-trap-track-1.m4a" },
      { title: "Into the Wilderness", src: "assets/music/appalachian-death-trap-track-2.m4a" },
      { title: "Stars", src: "assets/music/appalachian-death-trap-track-3.m4a" },
      { title: "Faces be Damed", src: "assets/music/appalachian-death-trap-track-4.m4a" }
    ]
  },
  { id: "composer4", name: "Music Slot 4", unlocked: false, trackCount: 0 },
  { id: "composer5", name: "Music Slot 5", unlocked: false, trackCount: 0 },
  { id: "composer6", name: "Music Slot 6", unlocked: false, trackCount: 0 },
  { id: "composer7", name: "Music Slot 7", unlocked: false, trackCount: 0 },
  { id: "composer8", name: "Music Slot 8", unlocked: false, trackCount: 0 }
];
const AI_DIFFICULTY_SETTINGS = {
  purple: {
    label: "Purple",
    // tugSkill is the only field tug reads (bot.plays.skill, 0..1); the rest of each entry is the classic AI's.
    tugSkill: 0.3,
    level: "Easy",
    summary: "Forgiving AI. It over-saves, sends slower waves, and gives up the strongest tower priorities.",
    manaBonusPerRound: 0,
    defenseRatioScale: 0.72,
    reserveScale: 1.55,
    postReserveScale: 1.45,
    maxPlacements: 1,
    minAttackBudgetScale: 0.55,
    towerWeights: { violet: 0.5, yellow: -1.1, red: -0.2, green: -0.8, blue: -1.2 },
    attackerPatterns: [["tank"], ["wisp", "tank"], ["brute", "tank"]],
    fallbackOrder: ["tank", "wisp", "brute", "runner", "imp"],
    randomTowerNoise: 0.9,
    considerTowerUpgrades: false,
    adaptation: 0.1,
    burstPressure: 0.35,
    defaultStrategy: "rush"
  },
  yellow: {
    label: "Yellow",
    tugSkill: 0.45,
    level: "Medium",
    summary: "Balanced AI. It considers every tower and creep, including tower upgrades.",
    manaBonusPerRound: 0,
    defenseRatioScale: 0.95,
    reserveScale: 1.05,
    postReserveScale: 1,
    maxPlacements: 2,
    minAttackBudgetScale: 0.9,
    towerWeights: { violet: 0.15, yellow: 0.2, red: 0, green: 0.15, blue: 0.1 },
    attackerPatterns: [["runner", "runner", "imp", "runner", "imp"], ["imp", "runner", "brute", "wisp", "runner"], ["brute", "wisp", "tank", "imp"]],
    fallbackOrder: ["runner", "imp", "brute", "wisp", "tank"],
    randomTowerNoise: 0.22,
    considerTowerUpgrades: true,
    adaptation: 0.45,
    burstPressure: 0.65,
    defaultStrategy: "counter"
  },
  red: {
    label: "Red",
    tugSkill: 0.6,
    level: "Hard",
    summary: "Aggressive AI. It leans on rush and imp pressure, with green support from the simulation's upper middle.",
    manaBonusPerRound: 3,
    defenseRatioScale: 0.88,
    reserveScale: 0.92,
    postReserveScale: 0.76,
    maxPlacements: 2,
    minAttackBudgetScale: 1.1,
    towerWeights: { violet: 0.45, yellow: 0.3, red: 0.2, green: 0.65, blue: 0.35 },
    attackerPatterns: [["runner", "imp", "runner", "imp", "runner"], ["imp", "imp", "runner", "brute", "imp"], ["brute", "imp", "wisp", "runner"]],
    fallbackOrder: ["imp", "runner", "brute", "wisp", "tank"],
    randomTowerNoise: 0.12,
    considerTowerUpgrades: true,
    adaptation: 0.75,
    burstPressure: 0.95,
    defaultStrategy: "rush"
  },
  green: {
    label: "Green",
    tugSkill: 0.8,
    level: "Very Hard",
    summary: "Sharp AI. It combines the strongest tower samples with steady rush pressure.",
    manaBonusPerRound: 4,
    defenseRatioScale: 1,
    reserveScale: 0.78,
    postReserveScale: 0.58,
    maxPlacements: 2,
    minAttackBudgetScale: 1.25,
    towerWeights: { violet: 0.9, yellow: 0.65, red: 0.15, green: 0.55, blue: 0.95 },
    attackerPatterns: [["runner", "imp", "runner", "imp", "runner", "imp"], ["imp", "runner", "brute", "imp", "runner"], ["brute", "wisp", "imp", "runner"]],
    fallbackOrder: ["runner", "imp", "brute", "wisp", "tank"],
    randomTowerNoise: 0.06,
    considerTowerUpgrades: true,
    adaptation: 1.05,
    burstPressure: 1.2,
    defaultStrategy: "counter"
  },
  blue: {
    label: "Blue",
    tugSkill: 0.9,
    level: "Ludicrous",
    summary: "No mercy. It borrows from the top simulated tower-heavy strategies and rush pressure.",
    manaBonusPerRound: 5,
    defenseRatioScale: 1.08,
    reserveScale: 0.62,
    postReserveScale: 0.38,
    maxPlacements: 3,
    minAttackBudgetScale: 1.45,
    towerWeights: { violet: 1, yellow: 1.25, red: 0.25, green: 0.65, blue: 1 },
    attackerPatterns: [["runner", "imp", "runner", "imp", "runner", "imp", "runner"], ["imp", "runner", "imp", "brute", "runner", "imp"], ["brute", "wisp", "imp", "runner", "tank"]],
    fallbackOrder: ["runner", "imp", "brute", "wisp", "tank"],
    randomTowerNoise: 0.02,
    considerTowerUpgrades: true,
    adaptation: 1.35,
    burstPressure: 1.55,
    defaultStrategy: "counter"
  }
};
const AI_STRATEGY_SETTINGS = {
  rush: {
    label: "Rush",
    reserveScale: 0.72,
    defenseBudgetScale: 0.75,
    attackBudgetScale: 1.35,
    fallbackBias: { runner: 1.35, imp: 1.28, wisp: 1.08, brute: 0.92, tank: 0.72 },
    towerBias: { violet: 0.55, yellow: 0.2, red: 0.05, green: 0.35, blue: 0.05 },
    upgradeBias: 0.2,
    counterScale: 0.8,
    burstInterval: 3,
    forceAttackWhenBehind: 1.35
  },
  fortress: {
    label: "Fortress",
    reserveScale: 1.1,
    defenseBudgetScale: 1.45,
    attackBudgetScale: 0.85,
    fallbackBias: { runner: 0.82, imp: 0.9, brute: 1.12, wisp: 1.02, tank: 1.28 },
    towerBias: { violet: -0.1, yellow: 0.45, red: 0.25, green: 0.45, blue: 0.65 },
    upgradeBias: 0.85,
    counterScale: 1,
    burstInterval: 4,
    forceAttackWhenBehind: 1.05
  },
  counter: {
    label: "Counter",
    reserveScale: 0.9,
    defenseBudgetScale: 1.05,
    attackBudgetScale: 1.12,
    fallbackBias: { runner: 1.05, imp: 1.08, brute: 1, wisp: 1.05, tank: 1 },
    towerBias: { violet: 0.15, yellow: 0.35, red: 0.25, green: 0.25, blue: 0.35 },
    upgradeBias: 0.6,
    counterScale: 1.45,
    burstInterval: 3,
    forceAttackWhenBehind: 1.2
  },
  boss: {
    label: "Boss",
    reserveScale: 0.55,
    defenseBudgetScale: 1.25,
    attackBudgetScale: 1.65,
    fallbackBias: { runner: 1.25, imp: 1.25, brute: 1.08, wisp: 1.12, tank: 1.08 },
    towerBias: { violet: 0.45, yellow: 0.85, red: 0.35, green: 0.75, blue: 0.9 },
    upgradeBias: 1,
    counterScale: 1.7,
    burstInterval: 2,
    forceAttackWhenBehind: 1.55
  }
};
const AI_GAUNTLET_STAGE_SETTINGS = [
  { towerPlan: [{ round: 1, towers: 1 }, { round: 4, towers: 2 }, { round: 7, towers: 3 }], towerBias: { violet: 0.8, yellow: 0.2 }, attackerBias: { runner: 0.35, imp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 6, towers: 3 }], towerBias: { yellow: 0.6, violet: 0.25 }, attackerBias: { brute: 0.35, imp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 8, towers: 4 }], towerBias: { red: 0.55, violet: 0.25 }, attackerBias: { runner: 0.45, wisp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 8, towers: 4 }], towerBias: { yellow: 0.55, blue: 0.2 }, attackerBias: { imp: 0.45, runner: 0.3 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 7, towers: 4 }], towerBias: { green: 0.55, red: 0.25 }, attackerBias: { brute: 0.45, wisp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 7, towers: 4 }], towerBias: { red: 0.6, yellow: 0.25 }, attackerBias: { runner: 0.4, imp: 0.35 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }], towerBias: { violet: 0.55, yellow: 0.45, red: 0.2 }, attackerBias: { runner: 0.65, imp: 0.45 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }], towerBias: { green: 0.65, blue: 0.4, yellow: 0.25 }, attackerBias: { brute: 0.55, wisp: 0.35, imp: 0.2 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }, { round: 9, towers: 5 }], towerBias: { yellow: 0.65, blue: 0.55, red: 0.25 }, attackerBias: { wisp: 0.55, runner: 0.4, imp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }, { round: 9, towers: 5 }], towerBias: { violet: 0.55, red: 0.45, yellow: 0.35 }, attackerBias: { runner: 0.7, imp: 0.5 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }, { round: 8, towers: 5 }], towerBias: { blue: 0.75, green: 0.45, yellow: 0.35 }, attackerBias: { brute: 0.55, tank: 0.35, wisp: 0.3 } },
  { towerPlan: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }, { round: 8, towers: 5 }], towerBias: { yellow: 0.65, blue: 0.5, green: 0.35 }, attackerBias: { wisp: 0.55, imp: 0.45, runner: 0.35 } },
  { towerPlan: [{ round: 1, towers: 2 }, { round: 3, towers: 3 }, { round: 5, towers: 4 }, { round: 7, towers: 5 }], towerBias: { violet: 0.65, yellow: 0.55, blue: 0.35 }, attackerBias: { runner: 0.75, imp: 0.6, wisp: 0.25 } },
  { towerPlan: [{ round: 1, towers: 2 }, { round: 3, towers: 3 }, { round: 5, towers: 4 }, { round: 7, towers: 5 }], towerBias: { green: 0.75, blue: 0.65, red: 0.35 }, attackerBias: { brute: 0.65, wisp: 0.45, tank: 0.35 } },
  { towerPlan: [{ round: 1, towers: 2 }, { round: 3, towers: 3 }, { round: 5, towers: 4 }, { round: 7, towers: 5 }], towerBias: { yellow: 0.75, blue: 0.65, red: 0.4 }, attackerBias: { wisp: 0.65, runner: 0.55, imp: 0.45 } },
  { towerPlan: [{ round: 1, towers: 2 }, { round: 2, towers: 3 }, { round: 4, towers: 4 }, { round: 6, towers: 5 }], towerBias: { blue: 0.8, yellow: 0.65, green: 0.55, red: 0.35 }, attackerBias: { runner: 0.65, imp: 0.6, wisp: 0.5, brute: 0.45 } }
];
let gameOptions = { ...DEFAULT_OPTIONS };
let activeArtPackId = DEFAULT_OPTIONS.artPack;
let activeArtPack = ART_PACKS[activeArtPackId] || ART_PACKS[DEFAULT_OPTIONS.artPack];
let towerSpritePaths = activeArtPack.towers;
let towerSpritePathSets = { player: activeArtPack.towers, ai: activeArtPack.towers };
let towerFireSheetConfig = activeArtPack.towerFireSheets || {};
let towerFireSheetConfigSets = { player: activeArtPack.towerFireSheets || {}, ai: activeArtPack.towerFireSheets || {} };
let attackerIconPaths = activeArtPack.attackerIcons;
let attackerIconPathSets = { player: activeArtPack.attackerIcons, ai: activeArtPack.attackerIcons };
let attackerSpriteConfig = activeArtPack.attackerSprites;
let attackerSpriteConfigSets = { player: activeArtPack.attackerSprites, ai: activeArtPack.attackerSprites };
let attackerSprites = {};
let attackerSpriteSets = { player: {}, ai: {} };
let opponentArtPackId = null; // online: the opponent's pick, drawn on the ai side (setOpponentArtPack); null = the active pack's own ai side
let unitMotionSets = { player: {}, ai: {} }; // each side's motion words (applyArtPack), read by getUnitMotion
let creepKillEffectConfig = activeArtPack.creepKillEffect || null;
let creepKillEffectSprite = null;
const battlefieldBackgroundImage = new Image();
document.documentElement.dataset.artPack = activeArtPackId;
applyArtPack(activeArtPackId);
