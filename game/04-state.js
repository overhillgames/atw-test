// Line Tower Wars runtime, part 04 of 20: element lookups, canvas/ctx, state, gauntletProgress, pixiState, lane geometry, stats factories, persistentStats.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

const menuScreenEl = document.getElementById("menu-screen");
const gauntletScreenEl = document.getElementById("gauntlet-screen");
const difficultyOptionsScreenEl = document.getElementById("difficulty-options-screen");
const musicOptionsScreenEl = document.getElementById("music-options-screen");
const artOptionsScreenEl = document.getElementById("art-options-screen");
const recordsScreenEl = document.getElementById("records-screen");
const gameScreenEl = document.getElementById("game-screen");
const appShellEl = document.getElementById("app-shell");
const loadingAnimaticEl = document.getElementById("loading-animatic");
const loadingAnimaticVideoEl = document.getElementById("loading-animatic-video");
const loadingAnimaticSkipBtnEl = document.getElementById("loading-animatic-skip-btn");
const orientationNoticeEl = document.getElementById("orientation-notice");
const openPlayBtnEl = document.getElementById("open-play-btn");
const menuBackBtnEl = document.getElementById("menu-back-btn");
const openGauntletBtnEl = document.getElementById("open-gauntlet-btn");
const openDifficultyOptionsBtnEl = document.getElementById("open-difficulty-options-btn");
const openMusicOptionsBtnEl = document.getElementById("open-music-options-btn");
const openArtOptionsBtnEl = document.getElementById("open-art-options-btn");
const optionsBackBtnEls = document.querySelectorAll(".options-back-btn");
const difficultyListEl = document.getElementById("difficulty-list");
const difficultySummaryEl = document.getElementById("difficulty-summary");
const musicPackGridEl = document.getElementById("music-pack-grid");
const musicSummaryEl = document.getElementById("music-summary");
const musicVolumeSliderEl = document.getElementById("music-volume-slider");
const musicVolumeValueEl = document.getElementById("music-volume-value");
const sfxVolumeSliderEl = document.getElementById("sfx-volume-slider");
const sfxVolumeValueEl = document.getElementById("sfx-volume-value");
const artPackGridEl = document.getElementById("art-pack-grid");
const openRecordsBtnEl = document.getElementById("open-records-btn");
const recordsBackBtnEl = document.getElementById("records-back-btn");
const gauntletBackBtnEl = document.getElementById("gauntlet-back-btn");
const gauntletStartBtnEl = document.getElementById("gauntlet-start-btn");
const gauntletStageTitleEl = document.getElementById("gauntlet-stage-title");
const gauntletStageCopyEl = document.getElementById("gauntlet-stage-copy");
const gauntletStageListEl = document.getElementById("gauntlet-stage-list");
const gauntletMapTrackEl = document.getElementById("gauntlet-map-track");
const gauntletMarkerLayerEl = document.getElementById("gauntlet-marker-layer");
const gauntletOrbEl = document.getElementById("gauntlet-orb");
const menuMetaEl = document.getElementById("menu-meta");
const recordsUpdatedAtEl = document.getElementById("records-updated-at");
const recordsOverviewEl = document.getElementById("records-overview");
const recordsMilestonesEl = document.getElementById("records-milestones");
const recordsTopAttackersEl = document.getElementById("records-top-attackers");
const recordsTopTowersEl = document.getElementById("records-top-towers");
const playerScoreEl = document.getElementById("player-score");
const aiScoreEl = document.getElementById("ai-score");
const waveNumberEl = document.getElementById("wave-number");
const playerManaEl = document.getElementById("player-mana");
const shopManaValueEl = document.getElementById("shop-mana-value");
const phaseLabelEl = document.getElementById("phase-label");
const phaseTimerEl = document.getElementById("phase-timer");
const waveProgressFillEl = document.getElementById("wave-progress-fill");
const statusTextEl = document.getElementById("status-text");
const replayBtnEl = document.getElementById("replay-btn");
const pauseBtnEl = document.getElementById("pause-btn");
const floatingPauseBtnEl = document.getElementById("floating-pause-btn");
const readyBtnEl = document.getElementById("ready-btn");
const battleSkipBtnEl = document.getElementById("battle-skip-btn");
const shopOverlayEl = document.getElementById("shop-overlay");
const matchEndOverlayEl = document.getElementById("match-end-overlay");
const matchResultEyebrowEl = document.getElementById("match-result-eyebrow");
const matchResultTitleEl = document.getElementById("match-result-title");
const matchResultCopyEl = document.getElementById("match-result-copy");
const matchSummaryGridEl = document.getElementById("match-summary-grid");
const matchNextGoalEl = document.getElementById("match-next-goal");
const matchContinueBtnEl = document.getElementById("match-continue-btn");
const matchPlayAgainBtnEl = document.getElementById("match-play-again-btn");
const matchRecordsBtnEl = document.getElementById("match-records-btn");
const matchHomeBtnEl = document.getElementById("match-home-btn");
const pauseOverlayEl = document.getElementById("pause-overlay");
const pauseResumeBtnEl = document.getElementById("pause-resume-btn");
const pauseMenuBtnEl = document.getElementById("pause-menu-btn");
const quitOverlayEl = document.getElementById("quit-overlay");
const quitCancelBtnEl = document.getElementById("quit-cancel-btn");
const quitConfirmBtnEl = document.getElementById("quit-confirm-btn");
const shopTitleEl = document.getElementById("shop-title");
const shopUnitNameEl = document.getElementById("shop-unit-name");
const shopCurrentUnitEl = document.getElementById("shop-current-unit");
const shopNextUnitEl = document.getElementById("shop-next-unit");
const shopLevelCurrentEl = document.getElementById("shop-level-current");
const shopLevelNextEl = document.getElementById("shop-level-next");
const shopDescriptionEl = document.getElementById("shop-description");
const shopUpgradeBtnEl = document.getElementById("shop-upgrade-btn");
const shopStartBtnEl = document.getElementById("shop-start-btn");

const enemySlotsEl = document.getElementById("enemy-slots");
const playerSlotsEl = document.getElementById("player-slots");
const towerPanelEl = document.getElementById("tower-panel");
const attackerPanelEl = document.getElementById("attacker-panel");
const arenaZoneEl = document.querySelector(".arena-zone");
const arenaDropZoneEl = document.getElementById("arena-drop-zone");
const topBarEl = document.querySelector(".top-bar");
const hudStripEl = document.querySelector(".hud-strip");
const bottomBarEl = document.querySelector(".bottom-bar");
const progressBtnEl = document.getElementById("progress-btn");
const homeBtnEl = document.getElementById("home-btn");

const canvas = document.getElementById("arena-canvas");
const ctx = canvas.getContext("2d");
const BATTLEFIELD_BOTTOM_TRIM_PX = 10;
const FIELD_SHIFT_Y = BATTLEFIELD_BOTTOM_TRIM_PX / LOGICAL_CANVAS_HEIGHT;
const prefersTouchInput = window.matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window);
const MIN_GAME_FRAME_SCALE = 0.5;
const MAX_PHONE_FRAME_SCALE = Number.POSITIVE_INFINITY;
const MAX_DESKTOP_PREVIEW_SCALE = 1;
const GAME_FRAME_ASPECT = LOGICAL_CANVAS_WIDTH / LOGICAL_CANVAS_HEIGHT;

const state = {
  screen: "menu",
  mode: "classic", // "classic" | "tug" (game/tug/, plan .plans/ltw-tug-mode.md); resetMatch sets it back to classic
  waveNumber: 1,
  completedRounds: 0,
  phase: "banner",
  phaseTimer: PREP_SECONDS,
  playerMana: 9,
  aiMana: 9,
  playerScore: 0,
  aiScore: 0,
  gameOver: false,
  paused: false,
  winnerText: "",
  playerTowers: [null, null, null, null, null],
  aiTowers: [null, null, null, null, null],
  playerQueue: [],
  aiQueue: [],
  playerQueueCounts: {},
  attackersPlayer: [],
  attackersAI: [],
  projectiles: [],
  fireBursts: [],
  yellowLeaps: [],
  towerFlashes: [],
  towerFireAnimations: [],
  deathParticles: [],
  deathEffects: [],
  nextUnitId: 1,
  nextProjectileId: 1,
  nextFireBurstId: 1,
  aiDraftDone: false,
  animationClock: 0,
  roundBannerTimer: ROUND_BANNER_SECONDS,
  battleStartTimer: 0, // counts down from BATTLE_START_SECONDS at battle launch; creeps and towers wait while it runs
  roundBannerText: "Round 1",
  battleSkipUsedThisRound: false,
  shopSelectionType: "attacker",
  shopSelectionId: attackerDefs[0].id,
  matchWinner: "",
  hasActiveMatch: false,
  matchSummary: null,
  matchStats: null,
  playerTowerUpgrades: Object.fromEntries(towerDefs.map((tower) => [tower.id, 0])),
  playerAttackerUpgrades: Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, 0])),
  matchUsage: {
    player: {
      towers: Object.fromEntries(towerDefs.map((tower) => [tower.id, false])),
      attackers: Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, false]))
    },
    ai: {
      towers: Object.fromEntries(towerDefs.map((tower) => [tower.id, false])),
      attackers: Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, false]))
    }
  },
  soundCooldowns: {
    violet: 0,
    yellow: 0,
    red: 0,
    green: 0,
    blue: 0
  },
  roundManaBonusPending: {
    player: 0,
    ai: 0
  },
  gauntletRun: null,
  aiDifficultyOverride: "",
  aiStrategyOverride: "",
  cardDetailId: null
};

let gauntletProgress = {
  seasonId: GAUNTLET_SEASON_ID,
  unlockedStage: 0,
  completedWins: 0,
  currentMatches: 0,
  currentWins: 0
};
let gauntletTravelFromStage = null;
let gauntletSelectedStage = null; // Gauntlet map: the stage the orb sits on and Engage launches; null = the frontier (unlockedStage)
let pendingGauntletReturn = null;
let activeDragPayload = "";
let selectedTowerId = null;
let touchDragState = null;
let audioCtx = null;
let audioUnlocked = false;
let sfxMasterGain = null;
let musicAudioEl = null;
let gauntletVictoryAudioEl = null;
let activeMusicPackId = DEFAULT_OPTIONS.musicPack;
let activeMusicTrackIndex = 0;
let musicFadeTimer = null;
let lastAppHiddenAt = null;
let wasPausedBeforeBackground = false;
let laneBackgroundCanvas = null;
let loadingAnimaticDismissed = false;
let loadingAnimaticTimer = null;
let loadingAnimaticIndex = 0;
let loadingAnimaticMutedFallback = false;
const pixiState = {
  app: null,
  ready: false,
  artboard: null,
  battlefieldLayer: null,
  battlefieldMask: null,
  highZLayer: null,
  markerLayer: null,
  markerTexture: null,
  uiLayer: null,
  unitLayer: null,
  unitMask: null,
  towerLayer: null,
  fxLayer: null,
  fxMask: null,
  dockIconLayer: null,
  textLayer: null,
  timerFill: null,
  timerFillSprite: null,
  timerMask: null,
  legacyTexture: null,
  legacySprite: null,
  towerTextures: {},
  towerTextureSets: { player: {}, ai: {} },
  towerFireTextures: {},
  towerFireTextureSets: { player: {}, ai: {} },
  attackerTextures: {},
  attackerTextureSets: { player: {}, ai: {} },
  towerSprites: new Map(),
  cardSprites: [],
  cardText: [],
  cardEntries: [],
  hudText: {},
  cardDetailPanel: null,
  cardDetailBackground: null,
  cardDetailTextNodes: [],
  lastTowerSignature: "",
  lastMarkerSignature: "",
  lastCardSignature: "",
  lastHudSignature: ""
};
let pixiTowerDragState = null;
let suppressNextPixiTowerTap = false;
let pixiCardHoldTimer = null;
let pixiCardHoldPointerId = null;
let pixiCardHoldStart = null;
let pixiCardHoldFired = false;
let pixiCardHoldSwallowTap = false;
window.atwPixiState = pixiState;

const laneStarts = {
  player: { x: 0.5, y: 560 / LOGICAL_CANVAS_HEIGHT },
  ai: { x: 0.5, y: 40 / LOGICAL_CANVAS_HEIGHT }
};

const laneEnds = {
  player: { x: 0.5, y: 80 / LOGICAL_CANVAS_HEIGHT },
  ai: { x: 0.5, y: 520 / LOGICAL_CANVAS_HEIGHT }
};

const towerPosPlayer = [
  { x: 147 / LOGICAL_CANVAS_WIDTH, y: 479 / LOGICAL_CANVAS_HEIGHT },
  { x: 273 / LOGICAL_CANVAS_WIDTH, y: 479 / LOGICAL_CANVAS_HEIGHT },
  { x: 95 / LOGICAL_CANVAS_WIDTH, y: 539 / LOGICAL_CANVAS_HEIGHT },
  { x: 210 / LOGICAL_CANVAS_WIDTH, y: 539 / LOGICAL_CANVAS_HEIGHT },
  { x: 324 / LOGICAL_CANVAS_WIDTH, y: 539 / LOGICAL_CANVAS_HEIGHT }
];

const towerPosAI = [
  { x: 147 / LOGICAL_CANVAS_WIDTH, y: 130 / LOGICAL_CANVAS_HEIGHT },
  { x: 273 / LOGICAL_CANVAS_WIDTH, y: 130 / LOGICAL_CANVAS_HEIGHT },
  { x: 95 / LOGICAL_CANVAS_WIDTH, y: 70 / LOGICAL_CANVAS_HEIGHT },
  { x: 210 / LOGICAL_CANVAS_WIDTH, y: 70 / LOGICAL_CANVAS_HEIGHT },
  { x: 324 / LOGICAL_CANVAS_WIDTH, y: 70 / LOGICAL_CANVAS_HEIGHT }
];

const slotPosPlayer = towerPosPlayer;
const slotPosAI = towerPosAI;

function createCountMap(defs) {
  return Object.fromEntries(defs.map((def) => [def.id, 0]));
}

function createEmptyProfileStats() {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    currentWinStreak: 0,
    bestWinStreak: 0
  };
}

function createEmptyMatchStats() {
  return {
    towersPlaced: 0,
    attackersQueued: 0,
    upgradesBought: 0
  };
}

function createEmptyPersistentStats() {
  return {
    updatedAt: null,
    profile: createEmptyProfileStats(),
    unitScores: {
      total: createCountMap(attackerDefs),
      player: createCountMap(attackerDefs),
      ai: createCountMap(attackerDefs)
    },
    towerKills: {
      total: createCountMap(towerDefs),
      player: createCountMap(towerDefs),
      ai: createCountMap(towerDefs)
    },
    matchUsage: {
      attackers: {
        used: createCountMap(attackerDefs),
        winningTeamUsed: createCountMap(attackerDefs)
      },
      towers: {
        used: createCountMap(towerDefs),
        winningTeamUsed: createCountMap(towerDefs)
      }
    }
  };
}

let persistentStats = createEmptyPersistentStats();
let statsSaveTimeout = null;
let gameFrameLayout = {
  viewportWidth: LOGICAL_CANVAS_WIDTH,
  viewportHeight: LOGICAL_CANVAS_HEIGHT,
  frameWidth: LOGICAL_CANVAS_WIDTH,
  frameHeight: LOGICAL_CANVAS_HEIGHT,
  safeFrameWidth: LOGICAL_CANVAS_WIDTH,
  safeFrameHeight: LOGICAL_CANVAS_HEIGHT,
  safeFrameX: 0,
  safeFrameY: 0,
  visibleLogicalWidth: LOGICAL_CANVAS_WIDTH,
  visibleLogicalHeight: LOGICAL_CANVAS_HEIGHT,
  safeOffsetLogicalX: 0,
  safeOffsetLogicalY: 0,
  scale: 1,
  reservedHeight: 0,
  desktopPreview: false
};
