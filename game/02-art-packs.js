// Line Tower Wars runtime, part 02 of 20: ART_PACKS, asset tables, art-pack helpers (Brian's art-config file).
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

// Every pack lives in www/assets/packs/<id>/pack.json; tools/packs.mjs bundles them into 02a-pack-manifests.js
// (PACK_ORDER, PACK_MANIFESTS). The manifest's units.* keys sit at the top level of a pack (today's shape);
// motion: how a pack's creeps move when they have no run-cycle frames (the juice layer, 18b, draws it in code).
// "walk" = hops, one per few px of travel, with a landing squash; "float" = a slow bob and sway;
// "roll" = stays on the ground, tilts into its sway and bobs a pixel. A unit id missing there uses DEFAULT_UNIT_MOTION.
function buildArtPacksFromManifests(manifests) {
  const packs = {};
  for (const [id, manifest] of Object.entries(manifests)) {
    const units = manifest.units || {};
    const pack = {
      battlefield: units.battlefield,
      motion: units.motion,
      towers: units.towers,
      towerFireSheets: units.towerFireSheets,
      attackerIcons: units.attackerIcons,
      attackerSprites: units.attackerSprites
    };
    if (units.creepKillEffect) {
      pack.creepKillEffect = units.creepKillEffect;
    }
    if (units.sideAssets) {
      pack.sideAssets = units.sideAssets;
    }
    pack.pixiTemplate = { ...manifest.template, paperBleed: manifest.chrome?.paperBleed };
    pack.chrome = manifest.chrome;
    pack.hud = manifest.hud;
    pack.layout = manifest.layout;
    pack.ui = manifest.ui;
    pack.fonts = manifest.fonts;
    pack.colours = manifest.colours;
    pack.fx = manifest.fx;
    pack.placeholders = manifest.placeholders;
    pack.name = manifest.name;
    pack.picker = manifest.picker;
    packs[id] = pack;
  }
  return packs;
}
const ART_PACKS = buildArtPacksFromManifests(PACK_MANIFESTS);

function getOwnerVisualSide(owner) {
  return owner === "ai" ? "ai" : "player";
}

// A pack the player may pick: known to ART_PACKS and not hidden (pack.json picker.hidden; hidden packs stay loadable
// for the old match and the dev tools, but never show on the Art screen, in saved options or as an online opponent).
function isPickableArtPack(packId) {
  return typeof packId === "string" && !!ART_PACKS[packId] && ART_PACKS[packId].picker?.hidden !== true;
}

function getArtPackSideAssets(pack, side, key) {
  const fallbackPack = ART_PACKS[DEFAULT_OPTIONS.artPack] || {};
  return pack.sideAssets?.[side]?.[key] || pack[key] || fallbackPack[key] || {};
}

function applyPixiTemplate(template = {}) {
  ARTBOARD_WIDTH = template.artboardWidth || 630;
  ARTBOARD_HEIGHT = template.artboardHeight || 860;
  SAFE_AREA_OFFSET_X = template.safeOffsetX || 105;
  SAFE_AREA_OFFSET_Y = template.safeOffsetY || 50;
  PIXI_LAYER_ASSET_ROOT = template.assetRoot || "assets/battlefield-template-v3";
  PIXI_TEMPLATE_LAYERS = template.layers ? [...template.layers] : [...DEFAULT_PIXI_TEMPLATE_LAYERS];
  PIXI_PAPER_BLEED = template.paperBleed !== false;
  PIXI_HIGH_Z_LAYER = template.highZLayer || null;
  PIXI_TIMER_FILL_LAYER = template.timerFillLayer || null;
  BATTLEFIELD_TOWER_MARKER_PATH = template.markerPath || "assets/ui/markers/battlefield-tower-marker.png";
  BATTLEFIELD_TOWER_MARKER_SIZE = template.markerSize || 48;
  TOWER_CARD_CENTERS = template.towerCardCenters ? template.towerCardCenters.map((center) => ({ ...center })) : [...DEFAULT_TOWER_CARD_CENTERS];
  CREEP_CARD_CENTERS = template.creepCardCenters ? template.creepCardCenters.map((center) => ({ ...center })) : [...DEFAULT_CREEP_CARD_CENTERS];
  TIMER_FILL_RECT = template.timerFillRect ? { ...template.timerFillRect } : { x: 22, y: 238, width: 20, height: 122 };
}

// The frame the Godot board draws for a Ready / Pause NinePatchRect of width x height game px whose patch margins are
// all inset (tools/godot-layout/export.mjs: inset x ui.scale texels). Godot grows a NinePatchRect to its minimum size,
// its patch margins summed, right and down from the same top-left, so per axis the drawn size is max(size, 2 x inset)
// and every edge is the full inset. The game copies the frame Godot draws (applyPackDom -> jon-battle.css
// border-image-*): edge = the inset, outset = how far the drawn frame reaches past the button's right / bottom, all in
// game px; the button's box, hit area and caption keep the unclamped rect. Keep it in step with its twin,
// godotNinePatchFrame in tools/godot-layout/text-match.mjs.
function godotNinePatchFrame(inset, width, height) {
  return {
    edge: inset,
    outset: { t: 0, r: Math.max(0, 2 * inset - width), b: Math.max(0, 2 * inset - height), l: 0 }
  };
}

// CSS variables, chrome-mode classes and font registration for the active pack (the DOM half of applyArtPack).
function applyPackDom(pack) {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  const root = document.documentElement;
  const style = root.style;
  // Absolute URLs: Chrome resolves a url() inside a custom property against the stylesheet that reads it
  // (theme/jon-battle.css), so a relative "assets/..." would become "theme/assets/..." and 404.
  const absolute = (file) => new URL(file, document.baseURI).href;
  const pieceUrl = (name) => `url("${absolute(`${pack.ui.root}/${pack.ui.pieces[name].file}`)}")`;
  const family = (name) => `"${pack.fonts[name].family}", "Trebuchet MS", sans-serif`;
  const set = (name, value) => style.setProperty(name, String(value));
  set("--pack-panel", pieceUrl("panel"));
  set("--pack-card", pieceUrl("card"));
  set("--pack-card-selected", pieceUrl("cardSelected"));
  set("--pack-btn-main", pieceUrl("buttonMain"));
  set("--pack-btn-sub", pieceUrl("buttonSub"));
  set("--pack-ui-scale", pack.ui.scale || 2);
  set("--pack-inset-panel", pack.ui.pieces.panel.inset);
  set("--pack-inset-card", pack.ui.pieces.card.inset);
  set("--pack-inset-btn", pack.ui.pieces.buttonMain.inset);
  set("--pack-font-title", family("title"));
  set("--pack-font-head", family("head"));
  set("--pack-font-body", family("body"));
  for (const key of ["ink", "paper", "paper3", "accent", "muted", "gold", "red"]) {
    set(`--pack-${key}`, pack.colours[key]);
  }
  const ready = pack.hud.ready;
  const pause = pack.hud.pause;
  set("--pack-ready-x", ready.x);
  set("--pack-ready-y", ready.y);
  set("--pack-ready-w", ready.width);
  set("--pack-ready-h", ready.height);
  set("--pack-pause-x", pause.x);
  set("--pack-pause-y", pause.y);
  set("--pack-pause-w", pause.width);
  set("--pack-pause-h", pause.height);
  // the Ready / Pause captions' text style, pack.json hud.text.ready|pause (size and outline width in game px;
  // jon-battle.css turns the width into its stroke). Fallbacks: today's 15, the pack ink, Ready's 0.5 outline.
  for (const [key, outlineWidth] of [["ready", 0.5], ["pause", 0]]) {
    const text = pack.hud.text?.[key] || {};
    set(`--pack-${key}-font-size`, Number.isFinite(text.size) ? text.size : 15);
    set(`--pack-${key}-color`, text.color || pack.colours.ink);
    set(`--pack-${key}-outline-w`, Number.isFinite(text.outline?.width) ? text.outline.width : outlineWidth);
    set(`--pack-${key}-outline-color`, text.outline?.color || pack.colours.ink);
  }
  // the Ready / Pause frames as the Godot board draws them (godotNinePatchFrame): edge and outset in game px, the slice
  // in texels of the pack tile (inset x ui.scale); jon-battle.css turns them into the buttons' border-image-*
  for (const [key, piece] of [["ready", "buttonMain"], ["pause", "buttonSub"]]) {
    const rect = pack.hud[key];
    const inset = pack.ui.pieces[piece].inset || 0;
    const frame = godotNinePatchFrame(inset, rect.width, rect.height);
    set(`--pack-${key}-edge`, frame.edge);
    set(`--pack-${key}-slice`, inset * (pack.ui.scale || 2));
    set(`--pack-${key}-outset-r`, frame.outset.r);
    set(`--pack-${key}-outset-b`, frame.outset.b);
  }
  set("--pack-mid-y", pack.hud.midY);
  root.classList.toggle("pack-chrome-layers", pack.chrome.mode === "layers");
  root.classList.toggle("pack-chrome-nineslice", pack.chrome.mode === "nineSlice");
  root.classList.toggle("pack-ready-layer", ready.art === "layer");
  if (typeof FontFace !== "undefined" && document.fonts) {
    // body too when the pack ships its file: it is then the board font (packBoardFontFamily, 18a)
    for (const name of ["title", "head", "body"]) {
      const { family: fontFamily, file } = pack.fonts[name];
      if (!file) {
        continue;
      }
      const key = `${fontFamily}|${file}`;
      if (packFontsRegistered.has(key)) {
        continue;
      }
      const face = new FontFace(fontFamily, `url("${absolute(file)}")`);
      document.fonts.add(face);
      packFontPromises.push(face.load().catch(() => null));
      packFontsRegistered.add(key);
    }
  }
}

// Per-unit render fields (all optional in pack.json): anchor { x: 0.5, y: 1 }, offset { x: 0, y: 0 }, scale 1,
// shadow { scale: 1, x: 0, y: 0 }. A creep entry is its sprite config object; a tower entry is a path string
// (today) or an object { path, anchor, offset, scale, shadow }. Defaults reproduce the unmodified rendering.
function unitRenderFields(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  return {
    anchor: { x: c.anchor?.x ?? 0.5, y: c.anchor?.y ?? 1 },
    offset: { x: c.offset?.x ?? 0, y: c.offset?.y ?? 0 },
    scale: c.scale ?? 1,
    shadow: { scale: c.shadow?.scale ?? 1, x: c.shadow?.x ?? 0, y: c.shadow?.y ?? 0 }
  };
}

function unitPath(cfg) {
  return cfg && typeof cfg === "object" ? cfg.path : cfg;
}

function applyArtPack(artPackId, rerender = false) {
  const normalizedArtPackId = normalizeArtPackId(artPackId);
  const nextPack = ART_PACKS[normalizedArtPackId] || ART_PACKS[DEFAULT_OPTIONS.artPack];
  activeArtPackId = ART_PACKS[normalizedArtPackId] ? normalizedArtPackId : DEFAULT_OPTIONS.artPack;
  activeArtPack = nextPack;
  applyPixiTemplate(activeArtPack.pixiTemplate);
  TIMER_FILL_RECT = { ...activeArtPack.hud.timerFill };
  PACK_CHROME_MODE = activeArtPack.chrome.mode;
  PACK_UI_ROOT = activeArtPack.ui.root;
  PACK_UI_SCALE = activeArtPack.ui.scale || 2;
  PACK_UI_PIECES = activeArtPack.ui.pieces;
  PACK_FX_ROOT = activeArtPack.fx.root;
  PACK_FONTS = activeArtPack.fonts;
  PACK_COLOURS = activeArtPack.colours;
  PACK_HUD = activeArtPack.hud;
  PACK_LAYOUT = activeArtPack.layout || {};
  applyPackDom(activeArtPack);
  // The ai side's towers, creeps and motion: an online opponent's own pick (its player side), else the active pack's ai
  // side. Everything else (chrome, UI, fonts, colours, fx, battlefield, kill effect) stays the active pack's.
  const aiPack = opponentArtPackId && isPickableArtPack(opponentArtPackId) ? ART_PACKS[opponentArtPackId] : null;
  const aiSideAssets = (key) => aiPack ? getArtPackSideAssets(aiPack, "player", key) : getArtPackSideAssets(activeArtPack, "ai", key);
  const towerEntrySets = {
    player: getArtPackSideAssets(activeArtPack, "player", "towers"),
    ai: aiSideAssets("towers")
  };
  towerSpritePathSets = { player: {}, ai: {} };
  towerRenderFieldSets = { player: {}, ai: {} };
  for (const side of ["player", "ai"]) {
    for (const [towerId, entry] of Object.entries(towerEntrySets[side])) {
      towerSpritePathSets[side][towerId] = unitPath(entry);
      towerRenderFieldSets[side][towerId] = unitRenderFields(entry);
    }
  }
  towerSpritePaths = towerSpritePathSets.player;
  towerFireSheetConfigSets = {
    player: getArtPackSideAssets(activeArtPack, "player", "towerFireSheets"),
    ai: aiSideAssets("towerFireSheets")
  };
  towerFireSheetConfig = towerFireSheetConfigSets.player;
  attackerIconPathSets = {
    player: getArtPackSideAssets(activeArtPack, "player", "attackerIcons"),
    ai: aiSideAssets("attackerIcons")
  };
  attackerIconPaths = attackerIconPathSets.player;
  attackerSpriteConfigSets = {
    player: getArtPackSideAssets(activeArtPack, "player", "attackerSprites"),
    ai: aiSideAssets("attackerSprites")
  };
  attackerSpriteConfig = attackerSpriteConfigSets.player;
  unitMotionSets = { player: activeArtPack.motion || {}, ai: (aiPack || activeArtPack).motion || {} };
  creepKillEffectConfig = activeArtPack.creepKillEffect || null;
  attackerSprites = {};
  attackerSpriteSets = { player: {}, ai: {} };
  for (const side of ["player", "ai"]) {
    for (const [attackerId, cfg] of Object.entries(attackerSpriteConfigSets[side] || {})) {
      if (!cfg) {
        continue;
      }
      const img = new Image();
      img.src = cfg.path;
      attackerSpriteSets[side][attackerId] = img;
    }
  }
  attackerSprites = attackerSpriteSets.player;
  creepKillEffectSprite = null;
  if (creepKillEffectConfig?.path) {
    creepKillEffectSprite = new Image();
    creepKillEffectSprite.src = creepKillEffectConfig.path;
  }
  battlefieldBackgroundImage.src = activeArtPack.battlefield || "";
  document.documentElement.dataset.artPack = activeArtPackId;

  if (rerender) {
    createCards();
    if (pixiState.ready) {
      buildPixiScene();
      pixiState.lastTowerSignature = "";
      pixiState.lastCardSignature = "";
      pixiState.lastHudSignature = "";
    }
    refreshAllUI();
  }
}

// Declares whose pack the ai side wears: an online opponent's pick, or null for the active pack's own ai side.
// startNewMatch calls it at every match start (options.net.opponentPack, else null) and tugNetGo (tug-net.js) calls it
// at the start of its "Starting…" beat so the pictures load early. Rebuilds (applyArtPack(…, true)) only on a change.
function setOpponentArtPack(packId) {
  const next = isPickableArtPack(packId) ? packId : null;
  if (next === opponentArtPackId) {
    return false;
  }
  opponentArtPackId = next;
  applyArtPack(activeArtPackId, true);
  return true;
}
