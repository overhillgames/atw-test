// Line Tower Wars runtime, part 01 of 20: tuning constants, towerDefs, id aliases, normalize helpers, TOWER_LEVEL_RULES.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

const PREP_SECONDS = 15;
const MAX_ROUNDS = 10;
const MANA_CAP = 99;
const AI_MANA_BONUS_PER_ROUND = 3;
const ROUND_BANNER_SECONDS = 0.25; // the Round card's fade-in; the card then stays through prep (18b juiceUpdateBanner)
const BATTLE_START_SECONDS = 0.85; // the Battle card's whole life (bounce, hold, rise) and how long the battle waits before creeps move and towers fire (16-effects updateGame, 18b juiceUpdateBanner)
const HUD_POP_SECONDS = 0.45; // a HUD number that changes (You, AI, Mana) snaps up and settles back over this long
const HUD_POP_SCALE = 0.35; // the snap's size above 1
const CARD_HOLD_MS = 400;
const CARD_HOVER_MS = 250; // a mouse must rest on a card this long before its detail opens (so a mouse parked on a card when the game screen appears doesn't open one)
const SHOP_UPGRADE_COST = 3;
const TOWER_UPGRADE_COST = 5;
const ATTACKER_UPGRADE_MULTIPLIER = 1.1;
const TOWER_UPGRADE_MULTIPLIER = 1.2;
const MAX_TOWER_UPGRADES = 2;
const SHOW_RANGE_ARCS = false;
const ATW_STORAGE_PREFIX = window.ATW_BUILD && typeof window.ATW_BUILD.storagePrefix === "string" ? window.ATW_BUILD.storagePrefix : ""; // published test builds save under their own names (same origin as Brian's preview); "" locally
const STATS_STORAGE_KEY = ATW_STORAGE_PREFIX + "bline-tower-wars-match-stats";
const MATCH_STATE_STORAGE_KEY = ATW_STORAGE_PREFIX + "line-tower-wars-active-match";
const OPTIONS_STORAGE_KEY = ATW_STORAGE_PREFIX + "bline-tower-wars-options";
const INTRO_ANIMATIC_MAX_SECONDS = 20;
const SKIP_INTRO_ANIMATIC = true; // dev: jump straight to the menu; set false for release
const INTRO_ANIMATIC_SEQUENCE = [
  "assets/intro/overhill-animatic-with-urs-audio.mp4",
  "assets/intro/carling-arts-zoom-logo.mp4"
];
const GAUNTLET_VICTORY_SFX_SRC = "assets/sfx/gauntlet-victory.wav";

// Multiplayer mode — set by lobby.js when a match is found, cleared on exit
let multiplayerRole          = null;   // null | "host" | "guest"
let multiplayerRoomId        = null;
let multiplayerOpponentName  = "Opponent";
let opponentAttackerUpgrades = {};     // loaded from Firebase before each battle
const BASE_TOWER_CONE_DEGREES = 130;
const LOGICAL_CANVAS_WIDTH = 420;
const LOGICAL_CANVAS_HEIGHT = 760;
let ARTBOARD_WIDTH = 630;
let ARTBOARD_HEIGHT = 860;
let SAFE_AREA_OFFSET_X = 105;
let SAFE_AREA_OFFSET_Y = 50;
const BATTLEFIELD_BOUNDS = { x: 10, y: 20, width: 400, height: 570 };
let PIXI_LAYER_ASSET_ROOT = "assets/battlefield-template-v3";
let PIXI_HIGH_Z_LAYER = null;
let PIXI_TIMER_FILL_LAYER = null;
// true: the template's 01 bleed layer is skipped (Brian's v3 and Jon's v4 fill it white) so the CSS paper
// behind the canvas shows beyond the board on tall phones; a pack whose 01 is painted art sets paperBleed: false.
let PIXI_PAPER_BLEED = true;
const DEFAULT_PIXI_TEMPLATE_LAYERS = [
  "01_bleed_area.png",
  "02_safe_area.png",
  "03_battlefield.png",
  "04_tower_dock.png",
  "05_creep_dock.png",
  "06_timer_round_panel.png",
  "07_timer_round_containers.png",
  "08_score_mana_panel.png",
  "09_score_mana_containers.png",
  "10_tower_card_frames.png",
  "12_creep_card_frames.png"
];
let PIXI_TEMPLATE_LAYERS = [...DEFAULT_PIXI_TEMPLATE_LAYERS];
let BATTLEFIELD_TOWER_MARKER_PATH = "assets/ui/markers/battlefield-tower-marker.png";
let BATTLEFIELD_TOWER_MARKER_SIZE = 48;
// Pack globals: the active battle theme's chrome, fonts, colours and HUD geometry. Initial values are Jon Light's;
// applyArtPack (02-art-packs.js) overwrites them from www/assets/packs/<id>/pack.json before any scene builds.
let PACK_CHROME_MODE = "nineSlice"; // "nineSlice" (code-drawn chrome from ui pieces) | "layers" (the template's own PNG layers)
let PACK_UI_ROOT = "assets/packs/jonCarlingLight/ui";
let PACK_UI_SCALE = 2;
let PACK_UI_PIECES = {
  panel: { file: "panel.png", inset: 28 },
  card: { file: "card.png", inset: 20 },
  cardSelected: { file: "card-selected.png", inset: 20 },
  buttonMain: { file: "button-main.png", inset: 20 },
  buttonSub: { file: "button-sub.png", inset: 20 },
  barInk: { file: "bar-ink.png", inset: 24 },
  barMask: { file: "bar-mask.png", inset: 24 },
  barTile: { file: "bar-tile.png" }
};
let PACK_FX_ROOT = "assets/packs/jonCarlingLight/fx";
let PACK_FONTS = {
  title: { family: "Caveat Brush", file: "assets/packs/jonCarlingLight/fonts/CaveatBrush-Regular.ttf" },
  head: { family: "Patrick Hand", file: "assets/packs/jonCarlingLight/fonts/PatrickHand-Regular.ttf" },
  body: { family: "Trebuchet MS", file: null }
};
// colours.locked is optional (not set here): the colour of a card cost the player cannot afford, falling back to "#9a9a9a".
let PACK_COLOURS = { ink: "#141414", paper: "#f0e0c8", paper3: "#dcc9a8", accent: "#18a0e0", muted: "#5a4a3a", gold: "#f0e080", red: "#d8405a" };
let PACK_HUD = {
  anchors: { round: { x: 32, y: 215 }, time: { x: 32, y: 384 }, ai: { x: 387, y: 215 }, mana: { x: 386, y: 300 }, you: { x: 387, y: 384 } },
  timerFill: { x: 22, y: 256, width: 21, height: 99 },
  ready: { x: 5, y: 427, width: 54, height: 37, art: "button" },
  pause: { x: 359, y: 427, width: 54, height: 37 },
  midY: 309,
  // Board text style: size and outline width in game px, colours #rrggbb. Outline width 0 means no outline.
  text: {
    round: { size: 16, color: "#141414", outline: { width: 0, color: "#141414" } },
    time: { size: 15, color: "#141414", outline: { width: 0, color: "#141414" } },
    ai: { size: 16, color: "#141414", outline: { width: 0, color: "#141414" } },
    mana: { size: 16, color: "#141414", outline: { width: 0, color: "#141414" } },
    you: { size: 16, color: "#141414", outline: { width: 0, color: "#141414" } },
    ready: { size: 15, color: "#141414", outline: { width: 0.5, color: "#141414" } },
    pause: { size: 15, color: "#141414", outline: { width: 0, color: "#141414" } }
  }
};
// The battle chrome's geometry in safe-frame px (420 x 760): HUD columns, stat tiles, timer tile, wood dock, the
// card-detail pop-up panel, the dock card centres and the card contents (picture, role word, cost per kind,
// offsets from the card centre). Initial values are Jon Light's; applyArtPack overwrites
// them from pack.json's "layout" ({} for a pack without one: the readers fall back to these same numbers).
let PACK_LAYOUT = {
  columns: [{ x: 4, y: 188, width: 60, height: 242 }, { x: 358, y: 188, width: 60, height: 242 }],
  statTiles: {
    round: { x: 10, y: 200, width: 44, height: 46 },
    time: { x: 10, y: 369, width: 44, height: 46 },
    ai: { x: 364, y: 200, width: 44, height: 46 },
    mana: { x: 364, y: 285, width: 44, height: 46 },
    you: { x: 364, y: 369, width: 44, height: 46 }
  },
  // The words under the HUD numbers: centre point in game px, editable on the Godot board.
  statLabels: {
    round: { x: 32, y: 235, size: 11, color: "#5a4a3a", outline: { width: 0, color: "#141414" } },
    time: { x: 32, y: 404, size: 11, color: "#5a4a3a", outline: { width: 0, color: "#141414" } },
    ai: { x: 386, y: 235, size: 11, color: "#5a4a3a", outline: { width: 0, color: "#141414" } },
    mana: { x: 386, y: 320, size: 11, color: "#5a4a3a", outline: { width: 0, color: "#141414" } },
    you: { x: 386, y: 404, size: 11, color: "#5a4a3a", outline: { width: 0, color: "#141414" } }
  },
  timerTile: { x: 10, y: 250, width: 44, height: 111 },
  dock: { x: 0, y: 587, width: 420, height: 173 },
  popup: { x: 66, width: 288, topY: 170, maxHeight: 260, padding: 20 },
  cardSlots: {
    towers: [{ x: 57, y: 641 }, { x: 133, y: 641 }, { x: 209, y: 641 }, { x: 285, y: 641 }, { x: 361, y: 641 }],
    creeps: [{ x: 57, y: 722 }, { x: 133, y: 722 }, { x: 209, y: 722 }, { x: 285, y: 722 }, { x: 361, y: 722 }]
  },
  cards: {
    towers: {
      icon: { x: 0, y: -10, width: 40, height: 48 },
      role: { x: -29, y: 33, size: 10, color: "#141414", outline: { width: 0, color: "#141414" } },
      cost: { x: 30, y: 34, size: 15, color: "#141414", outline: { width: 0, color: "#141414" } }
    },
    creeps: {
      icon: { x: 0, y: -10, width: 36, height: 36 },
      role: { x: -29, y: 26, size: 10, color: "#141414", outline: { width: 0, color: "#141414" } },
      cost: { x: 30, y: 27, size: 15, color: "#141414", outline: { width: 0, color: "#141414" } }
    }
  }
};
// Per-side tower render fields (id -> { anchor, offset, scale, shadow }), filled by applyArtPack beside towerSpritePathSets.
let towerRenderFieldSets = { player: {}, ai: {} };
let packFontPromises = []; // FontFace load promises; the scene build awaits them (17-pixi-scene.js)
const packFontsRegistered = new Set();
const TOWER_RENDER_BOX_WIDTH = 64;
const TOWER_RENDER_BOX_HEIGHT = 78;
const TOWER_SHADOW_LENGTH_RATIO = TOWER_RENDER_BOX_HEIGHT / TOWER_RENDER_BOX_WIDTH;
const OBJECT_SHADOWS = {
  color: "0, 0, 0",
  minAlpha: 0.24,
  maxAlpha: 0.34,
  minWidthScale: 0.98,
  maxWidthScale: 0.82,
  minHeightScale: 0.9,
  maxHeightScale: 3.15,
  creep: {
    widthRatio: 0.68,
    heightRatio: 0.2,
    yOffsetRatio: 0.34
  },
  tower: {
    widthRatio: 0.72,
    heightRatio: 0.18 * TOWER_SHADOW_LENGTH_RATIO,
    yOffsetRatio: 0.42,
    maxDepth: 0.81
  }
};
const DEFAULT_TOWER_CARD_CENTERS = [
  { x: 161, y: 691 },
  { x: 237, y: 691 },
  { x: 313, y: 691 },
  { x: 389, y: 691 },
  { x: 465, y: 691 }
];
const DEFAULT_CREEP_CARD_CENTERS = [
  { x: 161, y: 772 },
  { x: 237, y: 772 },
  { x: 313, y: 772 },
  { x: 389, y: 772 },
  { x: 465, y: 772 }
];
let TOWER_CARD_CENTERS = [...DEFAULT_TOWER_CARD_CENTERS];
let CREEP_CARD_CENTERS = [...DEFAULT_CREEP_CARD_CENTERS];
let TIMER_FILL_RECT = { x: 22, y: 238, width: 20, height: 122 };

const towerDefs = [
  { id: "violet", name: "Violet", cost: 3, damage: 2, range: 0.416, fireRate: 0.935, color: "#7c3aed", coneDegrees: 220, maxTargets: 1 },
  { id: "yellow", name: "Yellow", cost: 5, damage: 2, range: 0.520, fireRate: 0.95, color: "#eab308", coneDegrees: BASE_TOWER_CONE_DEGREES * 1.1, maxTargets: 1 },
  { id: "red", name: "Red", cost: 7, damage: 3.45, range: 0.434, fireRate: 1.05, color: "#dc2626", coneDegrees: BASE_TOWER_CONE_DEGREES, maxTargets: 1 },
  { id: "green", name: "Green", cost: 9, damage: 4, range: 0.635, fireRate: 1.15, color: "#22c55e", coneDegrees: BASE_TOWER_CONE_DEGREES * 0.9, maxTargets: 1 },
  { id: "blue", name: "Blue", cost: 11, damage: 4, range: 0.492, fireRate: 1.375, color: "#2563eb", coneDegrees: 200, maxTargets: 2 }
];
const LEGACY_TOWER_ID_ALIASES = {
  orange: "blue"
};
const LEGACY_ART_PACK_ID_ALIASES = {
  jonCarlingFantasy: "jonCarlingLight"
};

function normalizeTowerId(towerId) {
  return LEGACY_TOWER_ID_ALIASES[towerId] || towerId;
}

function normalizeArtPackId(artPackId) {
  return LEGACY_ART_PACK_ID_ALIASES[artPackId] || artPackId;
}

function readNumberWithLegacyId(source, id) {
  if (!source || typeof source !== "object") {
    return 0;
  }
  const direct = source[id];
  if (Number.isFinite(direct)) {
    return direct;
  }
  for (const [legacyId, currentId] of Object.entries(LEGACY_TOWER_ID_ALIASES)) {
    if (currentId === id && Number.isFinite(source[legacyId])) {
      return source[legacyId];
    }
  }
  return 0;
}

function readBooleanWithLegacyId(source, id) {
  if (!source || typeof source !== "object") {
    return false;
  }
  if (typeof source[id] === "boolean") {
    return source[id];
  }
  for (const [legacyId, currentId] of Object.entries(LEGACY_TOWER_ID_ALIASES)) {
    if (currentId === id && typeof source[legacyId] === "boolean") {
      return source[legacyId];
    }
  }
  return false;
}

function normalizeTowerInstance(tower) {
  if (!tower || typeof tower !== "object") {
    return tower;
  }
  const normalizedId = normalizeTowerId(tower.id);
  if (normalizedId === tower.id) {
    return tower;
  }
  const def = towerDefs.find((item) => item.id === normalizedId);
  return {
    ...tower,
    id: normalizedId,
    name: def?.name || tower.name,
    color: def?.color || tower.color
  };
}
const TOWER_LEVEL_RULES = {
  violet: {
    maxLevel: 2,
    damagePerLevel: 1,
    rangePerLevel: 1.2,
    fireRatePerLevel: 1.5,
    iconScalePerLevel: 1.2
  },
  yellow: {
    maxLevel: 2,
    damagePerLevel: 1,
    rangePerLevel: 1,
    fireRatePerLevel: 1.25,
    iconScalePerLevel: 1.2,
    slowDurationPerLevel: 1.5
  },
  red: {
    maxLevel: 2,
    damagePerLevel: 1.5,
    rangePerLevel: 1.1,
    fireRatePerLevel: 1,
    iconScalePerLevel: 1.2,
    shrapnelDamagePerLevel: 1.5
  },
  green: {
    maxLevel: 2,
    damagePerLevel: 1.5,
    rangePerLevel: 1.1,
    fireRatePerLevel: 1.2,
    iconScalePerLevel: 1.2,
    poisonDotPerLevel: 1.5
  },
  blue: {
    maxLevel: 2,
    damagePerLevel: 1.2,
    rangePerLevel: 1.1,
    fireRatePerLevel: 1,
    iconScalePerLevel: 1.2,
    maxTargetsByLevel: {
      2: 3
    }
  }
};
