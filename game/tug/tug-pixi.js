// Line Tower Wars runtime, tug mode: the Pixi reconciler for a tug match (plans .plans/ltw-tug-mode.md step 4,
// .plans/ltw-tug-ui-pass.md step 2, .plans/ltw-tug-dock-fixes.md step 2, .plans/ltw-tug-hud-pass.md step 2,
// .plans/ltw-tug-hud-2a.md steps 3 and 4). Classic script sharing the one global scope: index.html loads it after 19-draw.js
// and tug/rules.js, sim.js, bot.js, and before tug/tug-mode.js and 20-main.js.
//
// drawBoard (19-draw.js) hands a tug match to updatePixiTug() instead of the classic Pixi updaters. Each frame it reads
// tugState.snap (ProtoSim.snapshot, frame px, refreshed by tugUpdate in tug-mode.js) and reconciles its own display
// objects: mobs (18b's unit views, placed by attackerPosition's px / py branch), turrets on the pack's slot 0 and 1
// diamonds (18b's tower views, morphed onto the tower sprite of the dominant trait; a building turret fades in with a
// build bar at its foot, a destroyed one stays as its greyed, leaning sprite with a countdown and a timer bar while its
// slot is rubble), slot marks, gates (a thin accent ring on the player's gate while it is the selection), hp and XP
// bars, badges, the selection ring (tugState.selected: null = the gate, or { side: "player", slot }), shots, bursts,
// gold floaters, and the dock. The dock draws tugState.dock (the v4 model tug-mode.js rebuilds every frame; nothing
// here decides what is offered or lit) in one container on dockIconLayer, tug's own 2a "Low Dock" (TUG_PX_DOCK,
// 0,604 420x156; classic's chrome and dock cards are hidden by tug-mode.js): first the wood (jonWoodBar on a pack with
// the bar pieces, else a flat #5a3a1e rect with an ink stroke), then the title line (units mode: `title` centred;
// tower mode: `title` left, `titleRight` right), then in units mode two turret tabs (tabs[]: the turret's sprite, its
// name and line, a "! ready" pill; a tap calls tugTabTap(slot) when tappable) or in tower mode four 96x60 trait
// frames (frames[]: three traits and Heal, the card tile or cardSelected while lit, the word, a rank row of pips and
// "rank/cap" or Heal's sub, a hint while lit, muted while dim, and a white light sweeping each lit frame on the
// animation clock), then in both modes tug's own five mob cards (dock.mobs[]: a coin and the cost, red while poor;
// the attacker's sheet frame; the role word; a "×n" pill while some are queued; blocked fades the sprite and mutes the
// role; a tap calls tugQueueMob(id), and tugPxFlashMob(id), which tug-mode.js calls on a queued mob, flashes the card
// with classic's flashPixiCard timing). Every tile is the pack's card / cardSelected nine-slice, drawn on every pack.
// Then it calls tugUpdateHud() (tug-mode.js, which hides classic's rails and HUD numbers and publishes tugState.hud =
// { gold, time, goldPopT0 }) and draws that HUD in one container on textLayer, shown while tugState.hud exists: the
// clock chip top-left ("m:ss" on a card tile), the gold chip bottom-right (a coin and the number centred as a pair,
// the number popping on change, "gold" under it), and the queue column in the left strip, growing up from the
// player's gate under its "queue" caption: min(queue.max, 5) cells, dock.queue.list head first with the head at the
// bottom; every training mob (all of them while queue.parallel, else the head) on a cardSelected tile filling
// bottom-up as it trains, the other queued mobs on card tiles, the empty cells dashed.
// Then it calls tugUpdateCardStates() (tug-mode.js). tugPixiDestroy() (called by tugEndMatch and tugStartMatch)
// removes all of it.
//
// It never writes `state` or tugState; actions go through tug-mode.js (a tap on a frame calls tugFrameTap(i), which
// checks lit; a tap on a tab calls tugTabTap(slot); a tap on a mob card calls tugQueueMob(id); a turret shot calls
// tugOnShot). No hold, no hover, no detail panel on anything here. Animation runs on state.animationClock, so
// everything freezes with pause (the mob card flash runs on timeouts, as classic's card flash does).
// Its couplings to 18b's module state, all visual: juiceClock follows the animation clock and juiceTickEffects runs
// here (updatePixiUnits does not run in tug), so 18b's death and shot puffs time right; juiceShadowUnitLayer /
// juiceShadowTowerLayer point at this file's shadow containers only while a view is being created; every build and
// destroy calls juiceDestroyAll and clears juiceBook, so classic leftovers vanish here and a classic match afterwards
// rebuilds its own scene from scratch. One container per Pixi layer, created lazily and rebuilt whenever its layer no
// longer holds it (an Art-screen pack change rebuilds the scene).

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const TUG_PX_SLOTS = 2; // turret slots per side: the pack's slot 0 and 1 diamonds
const TUG_PX_SQUARE = 44; // fallback slot-mark square, frame px
const TUG_PX_BAR_W = 40;
const TUG_PX_BAR_H = 4;
const TUG_PX_BLINK_SECONDS = 0.3; // a ready turret's outline and "!" blink on this half-period
const TUG_PX_POP_SECONDS = 0.3; // morph pop, scale 1.2 -> 1
const TUG_PX_FIRE_RISE = 0.3; // a cooldown-fraction rise above this is a shot (a Rate pick moves it less)
const TUG_PX_GATE = { x: 150, width: 120, height: 14 };
const TUG_PX_GOLD_RISE = 22;
const TUG_PX_HIT_SECONDS = 0.6; // the sim keeps a hit this long (TUG_HIT_SECONDS)
const TUG_PX_GATE_RING = 4; // the gate's selection ring sits this far outside its bar
// The dock (.plans/ltw-tug-hud-2a.md "Geometry and look"), tug's own: classic's PACK_LAYOUT dock stays 587 x 173.
// tug-mode.js reads TUG_PX_DOCK.y (a press above it on the arena deselects).
const TUG_PX_DOCK = { x: 0, y: 604, width: 420, height: 156 };
const TUG_PX_WOOD_FALLBACK = 0x5a3a1e; // the dock on a painted-layers pack (no bar pieces): this fill, a 2 px ink stroke
const TUG_PX_WOOD_STROKE = 2;
// the title line's box: units mode centres `title` in it; tower mode puts `title` at its left and `titleRight` at its
// right, both on the box's middle (y 618)
const TUG_PX_TITLE = { x: 12, y: 607, width: 396, height: 22, size: 15 };
// units mode: two turret tabs (left xs, top y). A tab: the tower sprite (contain-fit in sprite.width x sprite.height,
// its left at tab left + sprite.dx, vertically centred; alpha buildingAlpha while building), the text column at
// tab left + textDx (textDxBare without a sprite): name centred on nameCy, line on lineCy, both left-anchored; the
// "! ready" pill (pill.height tall, pill.padX + pill.border either side of its word, its right edge pill.right in
// from the tab's, centred on pill.cy) drawn above the text
const TUG_PX_TAB = {
  xs: [6, 214], y: 630, width: 200, height: 60,
  sprite: { dx: 10, width: 34, height: 42 }, buildingAlpha: 0.5,
  textDx: 52, textDxBare: 10, nameCy: 651.5, nameSize: 16, lineCy: 668.5, lineSize: 14,
  pill: { text: "! ready", size: 14, height: 22, padX: 7, border: 2, radius: 11, right: 8, cy: 660 }
};
// tower mode: four frames (three traits + Heal), 96 x 60 centred on (xs[i], cy). Each line's centre is cy + its dy:
// lit = word, rank row, hint; unlit = word, rank row; a frame with the word only (Open) centres it. The rank row: cap
// pips (pipD across, pipPitch apart, ring pipRing), rowGap, then "rank/cap"; the whole row centred on the frame.
const TUG_PX_FRAME = {
  width: 96, height: 60, cy: 660, xs: [54, 158, 262, 366],
  litWordDy: -18, litRowDy: 1.5, hintDy: 19.5, wordDy: -9, rowDy: 10.5,
  wordSize: 17, rowSize: 14, hintSize: 14,
  pipD: 8, pipPitch: 11, pipRing: 1.5, rowGap: 5
};
// The light sweeping a lit frame: a band (bandFrac of the box's width, heightFrac of its height, leaning "/" by skew
// radians) inside the frame inset by `inset` (round mask, `radius`). Per frame i, p = mod(clock - stagger * i, period)
// / period; the band moves only while p < move (eased in-out), its left edge from the box left - startFrac * box width
// to travel band widths further right, and is hidden for the rest of the loop. The colour runs alpha 0 -> peak -> 0.
const TUG_PX_SHIMMER = {
  inset: 5, radius: 7, bandFrac: 0.38, heightFrac: 1.6, skew: -0.314,
  stagger: 0.18, period: 1.9, move: 0.55, startFrac: 0.55, travel: 4.2,
  rgb: "255, 252, 240", peak: 0.95, textureWidth: 128, textureHeight: 4
};
// the five mob cards under the tabs / frames: card i's top-left at (x0 + pitch * i, y), width x height. The cost: a
// coin (coinD across its outer edge, ring coinRing) centred on (left + coinDx, costCy), the number left-anchored at
// left + costDx on costCy. The sheet preview (frame 0) sprite x sprite centred on (cx, spriteCy). The role word
// centred, its bottom on roleBottom. The count pill ("×n"): pill.height tall, at least pill.minWidth wide, pill.padX +
// pill.border either side of its word, its top on pill.top, its right edge pill.dx past the card's (at most maxRight).
// blocked: the sprite at blockedAlpha and the role muted. The tap flash: a paper round rect inset flash.inset
// (radius flash.radius, alpha flash.alpha), flashPixiCard's timing.
const TUG_PX_MOB = {
  x0: 6, pitch: 83, y: 694, width: 76, height: 62,
  coinD: 10, coinRing: 1.5, coinDx: 12, costDx: 20, costCy: 702, costSize: 16,
  sprite: 36, spriteCy: 721, roleSize: 14, roleBottom: 752, blockedAlpha: 0.4,
  pill: { size: 15, height: 26, minWidth: 26, padX: 4, border: 2, radius: 13, top: 687, dx: 7, maxRight: 420 },
  flash: { inset: 3, radius: 8, alpha: 0.5, offMs: 85, againMs: 145, endMs: 230, againAlpha: 0.72 }
};
const TUG_PX_POOR = "#b02a40"; // a mob card's cost while gold is short
// the HUD on textLayer. The clock chip top-left: the card tile, "m:ss" centred on (cx, cy).
const TUG_PX_CLOCK = { x: 10, y: 10, width: 76, height: 44, cx: 48, cy: 32, size: 22 };
// The gold chip bottom-right: the card tile; a coin (coinD across, ring coinRing), gap, then the number, the pair
// centred as a group on cx at cy (the number pops about its own centre); the caption centred on (cx, captionCy).
const TUG_PX_GOLD = {
  x: 330, y: 538, width: 80, height: 58, cx: 370, cy: 559,
  coinD: 14, coinRing: 2, gap: 6, size: 26, captionCy: 580, captionSize: 14
};
// The queue column in the left strip, growing up from the player's gate: the caption centred on (captionCx,
// captionCy); min(queue.max, max) cells, cell k (0 = the head) with its top-left at (x, y0 - pitch * k), size x size.
// A training mob (every queued mob while queue.parallel, else the head): cardSelected, an accent fill (alpha, inset
// fillInset, radius fillRadius) rising bottom-up with its training fraction, the sprite inset headInset. Other queued
// mobs: card, the sprite inset inset. Empty cells: a dashed
// muted border (dashWidth, alpha dashAlpha, outer radius dashRadius; dash on / off along the straight edges).
const TUG_PX_QUEUE = {
  captionCx: 40, captionCy: 300, captionSize: 14,
  x: 14, y0: 536, pitch: 56, size: 52, max: 5,
  fillInset: 4, fillRadius: 5, alpha: 0.38, headInset: 6, inset: 7,
  dashWidth: 2, dashAlpha: 0.55, dashRadius: 9, dashOn: 6, dashOff: 4
};
const TUG_PX_RUBBLE_TINT = 0x8a8a8a;
const TUG_PX_RUBBLE_ALPHA = 0.6;
const TUG_PX_RUBBLE_LEAN = 0.18; // radians, about the foot; the player's lean right, the enemy's left
const TUG_PX_WOOD = 0x7a4e2a;
const TUG_PX_WOOD_LIGHT = 0xc8965c;
const TUG_PX_RUBBLE = 0x9a9a9a;
const TUG_PX_CHARGE_TINT = 0xff8a80;
const TUG_PX_SIDES = ["player", "ai"];

// -------------------------------------------------------------------------------------------------
// Bookkeeping (never on state or tugState)
// -------------------------------------------------------------------------------------------------

// The dock's nine-slice wood bar, kept across matches (tugPxBuildWood); teardown only detaches it.
let tugPxWoodCache = null; // { key, bar }

const tugPx = {
  layers: null, // the containers, one per Pixi layer, with their groups
  mobs: new Map(), // "side:id" -> { like, view, lastHp, attacking, x, y }
  slots: new Map(), // "side:slot" -> { g, badge, bang, rubbleText, view, rubble, lastCooldown, fireT0, popT0 }
  gates: {}, // side -> { g, text, signature }
  shots: [], // sprite pool, one per snapshot projectile
  floaters: [], // text pool, one per gold hit
  dock: null, // { wood, title, titleRight, mode, tabsGroup, tabs, framesGroup, frames, mobsGroup, mobs } (tugPxBuildDock)
  shimmer: null, // the shimmer band's gradient texture (tugPxShimmerTexture), made per build, destroyed in teardown
  hud: null, // { root, time, gold, goldCoin, goldW, goldCaption, caption, cells: [...] } (tugPxBuildHud)
  markSignature: "",
  lastClock: null
};

// -------------------------------------------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------------------------------------------

function tugPxDestroyNode(node) {
  if (node && !node.destroyed) {
    node.destroy({ children: true });
  }
}

// A label in the pack's board font (packBoardFontFamily, 18a), centred on its position.
function tugPxText(text, size, fill, strokeColour, strokeWidth) {
  const style = { fontFamily: packBoardFontFamily(), fontSize: size, fontWeight: "400", fill };
  if (strokeWidth > 0) {
    style.stroke = { color: strokeColour, width: strokeWidth, join: "round" };
  }
  return pixiText(text, style);
}

function tugPxSetText(node, text) {
  if (node.text !== text) {
    node.text = text;
  }
}

function tugPxSlotCentre(side, slot) {
  const pos = (side === "player" ? towerPosPlayer : towerPosAI)[slot];
  return { x: pos.x * LOGICAL_CANVAS_WIDTH, y: pos.y * LOGICAL_CANVAS_HEIGHT };
}

function tugPxLevelScale(level) {
  return 1 + 0.025 * Math.min(Math.max(0, Number(level) || 0), 10);
}

// A thin bar: paper track, coloured fill from the left, ink outline.
function tugPxBar(g, x, y, frac, colour) {
  g.rect(x, y, TUG_PX_BAR_W, TUG_PX_BAR_H).fill({ color: packColourNumber("paper") });
  const w = TUG_PX_BAR_W * clamp(Number(frac) || 0, 0, 1);
  if (w > 0) {
    g.rect(x, y, w, TUG_PX_BAR_H).fill({ color: colour });
  }
  g.rect(x, y, TUG_PX_BAR_W, TUG_PX_BAR_H).stroke({ width: 1, color: packColourNumber("ink") });
}

// Seconds a slot stays rubble (match.tug.build.rubbleSeconds, tug/rules.js); 0 when off or missing.
function tugPxRubbleSeconds() {
  const tug = tugState && tugState.match ? tugState.match.tug : null;
  const v = tug && tug.build ? Number(tug.build.rubbleSeconds) : 0;
  return v > 0 ? v : 0;
}

// The fallback slot mark when the pack has no marker texture: a dashed ink square.
function tugPxDashedSquare(g, cx, cy, size) {
  const h = size / 2;
  const corners = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  for (let k = 0; k < 4; k += 1) {
    const [ax, ay] = corners[k];
    const [bx, by] = corners[(k + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    for (let s = 0; s < len; s += 10) {
      const e = Math.min(len, s + 6);
      g.moveTo(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len).lineTo(ax + ((bx - ax) * e) / len, ay + ((by - ay) * e) / len);
    }
  }
  g.stroke({ width: 2, color: packColourNumber("ink"), alpha: 0.6 });
}

// -------------------------------------------------------------------------------------------------
// Scene: build, teardown, rebuild check
// -------------------------------------------------------------------------------------------------

function tugPxLayersOnStage() {
  const stage = pixiState.app && pixiState.app.stage;
  if (!stage) {
    return false;
  }
  return [pixiState.markerLayer, pixiState.unitLayer, pixiState.towerLayer, pixiState.fxLayer, pixiState.dockIconLayer, pixiState.textLayer]
    .every((layer) => layer && layer.parent === stage);
}

function tugPxIntact() {
  const L = tugPx.layers;
  return !!L
    && L.marks.parent === pixiState.markerLayer
    && L.units.parent === pixiState.unitLayer
    && L.towers.parent === pixiState.towerLayer
    && L.fx.parent === pixiState.fxLayer
    && L.dock.parent === pixiState.dockIconLayer
    && L.hud.parent === pixiState.textLayer;
}

// Views first, then 18b's effects in flight (their done() destroys the dying views' shadows, which sit in this file's
// shadow container), then the containers.
function tugPxTeardown() {
  for (const mob of tugPx.mobs.values()) {
    if (!mob.view.container.destroyed) {
      juiceDestroyView(mob.view);
    }
  }
  tugPx.mobs.clear();
  for (const rec of tugPx.slots.values()) {
    if (rec.view && !rec.view.container.destroyed) {
      juiceDestroyTower(rec.view);
    }
  }
  tugPx.slots.clear();
  if (pixiState.ready) {
    juiceDestroyAll();
  }
  juiceBook = null; // the next classic updatePixiUnits rebuilds its scene from state
  pixiState.lastMarkerSignature = ""; // the next classic updatePixiMarkers redraws its markers
  if (tugPxWoodCache && tugPxWoodCache.bar && !tugPxWoodCache.bar.destroyed) {
    tugPxWoodCache.bar.removeFromParent(); // the cached wood bar survives the layers' destroy; a non-cached bar dies with them
  }
  if (tugPx.dock) {
    for (const card of tugPx.dock.mobs) {
      tugPxClearFlash(card); // no pending flash step may touch a destroyed node
    }
  }
  if (tugPx.layers) {
    for (const node of Object.values(tugPx.layers)) {
      tugPxDestroyNode(node);
    }
  }
  if (tugPx.shimmer && !tugPx.shimmer.destroyed) {
    tugPx.shimmer.destroy(true);
  }
  tugPx.shimmer = null;
  tugPx.layers = null;
  tugPx.gates = {};
  tugPx.shots = [];
  tugPx.floaters = [];
  tugPx.dock = null;
  tugPx.hud = null;
  tugPx.markSignature = "";
  tugPx.lastClock = null;
}

function tugPxBuild() {
  tugPxTeardown();
  pixiState.app.stage.position.set(0, 0); // no classic shake left over
  pixiState.unitLayer.sortableChildren = true;
  pixiState.fxLayer.sortableChildren = true;
  // the classic markers (all five slots per side) go; tug marks slots 0 and 1 only
  for (const child of pixiState.markerLayer.removeChildren()) {
    child.destroy();
  }

  const L = {};
  L.marks = new PIXI.Container();
  L.markGroup = new PIXI.Container();
  L.gateGroup = new PIXI.Container();
  L.marks.addChild(L.markGroup, L.gateGroup);
  pixiState.markerLayer.addChild(L.marks);

  L.units = new PIXI.Container();
  L.units.sortableChildren = true; // unit views sort by y (juiceUpdateUnitView sets zIndex)
  L.unitShadows = new PIXI.Container();
  L.unitShadows.zIndex = -1;
  L.units.addChild(L.unitShadows);
  pixiState.unitLayer.addChild(L.units);

  L.towers = new PIXI.Container();
  L.towerShadows = new PIXI.Container();
  L.towerBodies = new PIXI.Container();
  L.towerOverlay = new PIXI.Container();
  L.towers.addChild(L.towerShadows, L.towerBodies, L.towerOverlay);
  pixiState.towerLayer.addChild(L.towers);

  L.fx = new PIXI.Container();
  L.fx.zIndex = JUICE_Z_KILL + 1; // the floaters read over 18b's puffs
  L.shotGroup = new PIXI.Container();
  L.bursts = new PIXI.Graphics();
  L.floaterGroup = new PIXI.Container();
  L.fx.addChild(L.shotGroup, L.bursts, L.floaterGroup);
  pixiState.fxLayer.addChild(L.fx);

  L.dock = new PIXI.Container(); // added after the pack's dock cards (hidden by tug-mode.js), so it draws on top
  pixiState.dockIconLayer.addChild(L.dock);

  L.hud = tugPxNoEvents(new PIXI.Container()); // added last on textLayer, so it draws above everything
  pixiState.textLayer.addChild(L.hud);
  tugPx.layers = L;

  const ink = packColourCss("ink");
  const paper = packColourCss("paper");
  for (const side of TUG_PX_SIDES) {
    for (let slot = 0; slot < TUG_PX_SLOTS; slot += 1) {
      const g = new PIXI.Graphics();
      const badge = tugPxText("", 9, ink, paper, 2);
      const bang = tugPxText("!", 16, packColourCss("gold"), ink, 3);
      bang.anchor.set(0.5, 1);
      const rubbleText = tugPxText("", 15, ink, paper, 3);
      badge.visible = false;
      bang.visible = false;
      rubbleText.visible = false;
      L.towerOverlay.addChild(g, badge, bang, rubbleText);
      tugPx.slots.set(`${side}:${slot}`, { g, badge, bang, rubbleText, view: null, rubble: false, lastCooldown: null, fireT0: null, popT0: null });
    }
  }
  tugPxBuildDock(L.dock);
  tugPxBuildHud(L.hud);
}

// -------------------------------------------------------------------------------------------------
// Slot marks and gates (markerLayer)
// -------------------------------------------------------------------------------------------------

function tugPxSlotEmpty(S, slot) {
  const tower = S.towers ? S.towers[slot] : null;
  if (tower) {
    return false;
  }
  return S.slotStates ? S.slotStates[slot] === "empty" : true;
}

// The pack's marker under each empty slot 0 and 1 (updatePixiMarkers' drawing, through addFittedSprite).
function tugPxSyncMarks(snap) {
  const signature = TUG_PX_SIDES.map((side) => {
    let bits = "";
    for (let slot = 0; slot < TUG_PX_SLOTS; slot += 1) {
      bits += tugPxSlotEmpty(snap[side], slot) ? "1" : "0";
    }
    return bits;
  }).join("|");
  if (signature === tugPx.markSignature) {
    return;
  }
  tugPx.markSignature = signature;
  const group = tugPx.layers.markGroup;
  for (const child of group.removeChildren()) {
    child.destroy();
  }
  let dashed = null;
  for (const side of TUG_PX_SIDES) {
    for (let slot = 0; slot < TUG_PX_SLOTS; slot += 1) {
      if (!tugPxSlotEmpty(snap[side], slot)) {
        continue;
      }
      const c = tugPxSlotCentre(side, slot);
      if (pixiState.markerTexture) {
        addFittedSprite(group, pixiState.markerTexture, c.x, c.y, BATTLEFIELD_TOWER_MARKER_SIZE, BATTLEFIELD_TOWER_MARKER_SIZE);
      } else {
        if (!dashed) {
          dashed = new PIXI.Graphics();
          group.addChild(dashed);
        }
        tugPxDashedSquare(dashed, c.x, c.y, TUG_PX_SQUARE);
      }
    }
  }
}

// A wood bar across the lane at the gate's y: ink outline, the hp fraction lighter from the left, the hp centred. The
// player's gate carries a thin accent ring while it is the selection (tugState.selected === null: units mode).
function tugPxSyncGates(snap) {
  const gateSelected = tugState.selected === null;
  for (const side of TUG_PX_SIDES) {
    const G = snap[side].gate;
    if (!G) {
      continue;
    }
    let rec = tugPx.gates[side];
    if (!rec) {
      rec = { g: new PIXI.Graphics(), text: tugPxText("", 11, packColourCss("ink"), packColourCss("paper"), 3), signature: "" };
      tugPx.layers.gateGroup.addChild(rec.g, rec.text);
      tugPx.gates[side] = rec;
    }
    const hp = Math.max(0, Math.round(G.hp));
    const ring = side === "player" && gateSelected;
    const signature = `${G.hp}|${G.maxHp}|${G.y}|${ring ? 1 : 0}`;
    if (signature === rec.signature) {
      continue;
    }
    rec.signature = signature;
    const { x, width, height } = TUG_PX_GATE;
    const y0 = G.y - height / 2;
    const frac = G.maxHp > 0 ? clamp(G.hp / G.maxHp, 0, 1) : 0;
    rec.g.clear();
    rec.g.rect(x, y0, width, height).fill({ color: TUG_PX_WOOD });
    if (frac > 0) {
      rec.g.rect(x, y0, width * frac, height).fill({ color: TUG_PX_WOOD_LIGHT });
    }
    rec.g.rect(x, y0, width, height).stroke({ width: 2, color: packColourNumber("ink") });
    if (ring) {
      const r = TUG_PX_GATE_RING;
      rec.g.roundRect(x - r, y0 - r, width + 2 * r, height + 2 * r, r).stroke({ width: 2, color: packColourNumber("accent") });
    }
    tugPxSetText(rec.text, String(hp));
    rec.text.position.set(x + width / 2, G.y);
  }
}

// -------------------------------------------------------------------------------------------------
// Mobs (unitLayer): 18b's unit views
// -------------------------------------------------------------------------------------------------

function tugPxCreateMobView(like, clock) {
  const saved = juiceShadowUnitLayer;
  juiceShadowUnitLayer = tugPx.layers.unitShadows; // juiceCreateUnitView puts the shadow and slow ring there
  try {
    const view = juiceCreateUnitView(like, clock);
    tugPx.layers.units.addChild(view.container);
    return view;
  } finally {
    juiceShadowUnitLayer = saved;
  }
}

// 18b's death (puff, star burst, kill sheet or squash and shards) at the mob's last position. juiceDeathEffect finds
// the view in juiceUnitViews, takes it out and destroys it (at once, or after its squash).
function tugPxMobDeath(key, mob) {
  const unitKey = `tug:${key}`;
  juiceUnitViews.set(unitKey, mob.view);
  emitJuice("death", { owner: mob.like.owner, defId: mob.like.defId, unitKey, x: mob.x, y: mob.y });
  if (juiceUnitViews.get(unitKey) === mob.view) {
    juiceUnitViews.delete(unitKey); // the effect did not run (fx not loaded): destroy it here
    juiceDestroyView(mob.view);
  }
}

function tugPxSyncMobs(snap, dt, clock) {
  const seen = new Set();
  for (const side of TUG_PX_SIDES) {
    for (const u of snap[side].units || []) {
      const key = `${side}:${u.id}`;
      seen.add(key);
      let mob = tugPx.mobs.get(key);
      if (!mob) {
        // the fields juiceCreateUnitView / juiceUpdateUnitView read; px / py take attackerPosition's tug branch
        const like = {
          id: u.id,
          owner: side,
          defId: u.defId,
          color: u.color,
          hp: u.hp,
          maxHp: u.maxHp,
          speed: 1,
          baseSpeed: 1,
          slowTimer: 0,
          poisonTimer: 0,
          px: u.x,
          py: u.y,
          fanSeed: 0
        };
        mob = { like, view: tugPxCreateMobView(like, clock), lastHp: u.hp, attacking: !!u.attacking, x: u.x, y: u.y };
        tugPx.mobs.set(key, mob);
      }
      const { like, view } = mob;
      like.hp = u.hp;
      like.maxHp = u.maxHp;
      like.px = u.x;
      like.py = u.y;
      like.slowTimer = u.slowed ? 1 : 0; // the slow ring on the shadow
      if (u.hp < mob.lastHp) {
        view.hitT0 = clock; // 18b's hit squash and white flash, as on a classic hit
      }
      if (u.attacking && !mob.attacking) {
        view.recoilT0 = clock; // 18b's recoil squash on each blow it lands
      }
      mob.lastHp = u.hp;
      mob.attacking = !!u.attacking;
      mob.x = u.x;
      mob.y = u.y;
      juiceUpdateUnitView(view, like, dt, clock);
      const tint = u.charging ? TUG_PX_CHARGE_TINT : 0xffffff;
      if (view.sprite.tint !== tint) {
        view.sprite.tint = tint;
      }
    }
  }
  for (const [key, mob] of tugPx.mobs) {
    if (!seen.has(key)) {
      tugPx.mobs.delete(key);
      tugPxMobDeath(key, mob);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Turrets (towerLayer): 18b's tower views, construction, rubble, bars, badges, blink, selection
// -------------------------------------------------------------------------------------------------

// A tower view standing on the slot's diamond exactly as a classic tower (juiceCreateTowerView -> juiceTowerBase);
// tower.id is the colour of the dominant trait, level 1 so 18b's own level step stays off (tug scales it here).
function tugPxCreateTowerView(side, slot, colourId) {
  const saved = juiceShadowTowerLayer;
  juiceShadowTowerLayer = tugPx.layers.towerShadows;
  try {
    const view = juiceCreateTowerView(side, slot, { id: colourId, level: 1 });
    tugPx.layers.towerBodies.addChild(view.container);
    return view;
  } finally {
    juiceShadowTowerLayer = saved;
  }
}

// 18b's shot puff at the turret's edge toward the nearest enemy mob (straight down the lane when there is none).
function tugPxShotPuff(snap, side, slot) {
  const base = juiceTowerBase(side, slot, 1);
  let ux = 0;
  let uy = side === "player" ? -1 : 1;
  let best = Infinity;
  for (const u of snap[side === "player" ? "ai" : "player"].units || []) {
    const d = Math.hypot(u.x - base.x, u.y - base.y);
    if (d < best && d > 0) {
      best = d;
      ux = (u.x - base.x) / d;
      uy = (u.y - base.y) / d;
    }
  }
  juiceFrameFx("puff", base.x + ux * 26, base.y - 8 + uy * 26, 0.2, { z: JUICE_Z_FX, fade: true, rotation: Math.atan2(uy, ux) });
}

// The sprite's frame (the fire sheet while a shot plays, else the still) and pose: updatePixiTowers' fire
// anticipation and recoil on the body, the level growth and the morph pop on the container (it sits at the foot).
function tugPxPoseTurret(rec, t, clock) {
  const view = rec.view;
  let texture = juiceTowerStaticTexture(view);
  let sy = 1;
  let by = 0;
  if (rec.fireT0 !== null) {
    const age = clock - rec.fireT0;
    const cfg = towerFireSheetConfigSets[view.side] && towerFireSheetConfigSets[view.side][view.id];
    const dur = (cfg && cfg.duration) || 0.24;
    if (age < 0 || age >= Math.max(dur, 0.24)) {
      rec.fireT0 = null;
    } else {
      const fire = atwJuice.forceStatic ? null : juiceTowerFire(view.side, view.id);
      if (fire && age < dur) {
        texture = fire.frames[Math.min(fire.frames.length - 1, Math.floor((age / dur) * fire.frames.length))];
      }
      if (age < 0.06) {
        sy *= 1 - 0.07 * (age / 0.06);
      } else if (age < 0.24) {
        const k = juiceEaseOut((age - 0.06) / 0.18);
        sy *= 1.06 - 0.06 * k;
        by -= 3 * (1 - k);
      }
    }
  }
  juiceSetTowerTexture(view, texture);
  view.body.position.y = view.fields.offset.y + by;
  view.body.scale.set(1, sy);
  let pop = 1;
  if (rec.popT0 !== null) {
    const u = (clock - rec.popT0) / TUG_PX_POP_SECONDS;
    if (u < 0 || u >= 1) {
      rec.popT0 = null;
    } else {
      pop = 1 + 0.2 * (1 - juiceEaseOut(u));
    }
  }
  const ls = tugPxLevelScale(t.level);
  view.container.scale.set(ls * pop);
  // under construction the real sprite fades in with its progress (0.25 -> 0.9), then stands at full alpha
  view.container.alpha = t.building ? 0.25 + 0.65 * clamp(Number(t.building.progress) || 0, 0, 1) : 1;
  return ls;
}

// A rubble slot keeps its fallen turret's sprite (or, after a scene rebuild, a violet one): its still frame, greyed,
// faded and leaning about its foot. Applied every frame (cheap; juiceSetTowerTexture skips an unchanged texture).
function tugPxPoseRubble(view, side) {
  juiceSetTowerTexture(view, juiceTowerStaticTexture(view));
  view.body.position.y = view.fields.offset.y;
  view.body.scale.set(1, 1);
  if (view.sprite.tint !== TUG_PX_RUBBLE_TINT) {
    view.sprite.tint = TUG_PX_RUBBLE_TINT;
  }
  view.container.alpha = TUG_PX_RUBBLE_ALPHA;
  view.container.rotation = side === "player" ? TUG_PX_RUBBLE_LEAN : -TUG_PX_RUBBLE_LEAN;
}

// The rubble countdown: the whole seconds left on the slot, and a timer bar at the foot emptying over rubbleSeconds.
function tugPxDrawRubble(rec, c, footY, seconds) {
  const left = Math.max(0, Number(seconds) || 0);
  const total = tugPxRubbleSeconds();
  tugPxBar(rec.g, c.x - TUG_PX_BAR_W / 2, footY + 3, total > 0 ? left / total : 0, TUG_PX_RUBBLE);
  tugPxSetText(rec.rubbleText, String(Math.ceil(left - 1e-9)));
  rec.rubbleText.position.set(c.x, c.y);
  rec.rubbleText.visible = true;
}

function tugPxSyncTurrets(snap, clock) {
  const gold = packColourNumber("gold");
  const accent = packColourNumber("accent");
  const blinkOn = Math.floor(clock / TUG_PX_BLINK_SECONDS) % 2 === 0;
  const sel = tugState.selected || null; // null = the gate; else { side, slot }
  for (const side of TUG_PX_SIDES) {
    const S = snap[side];
    for (let slot = 0; slot < TUG_PX_SLOTS; slot += 1) {
      const rec = tugPx.slots.get(`${side}:${slot}`);
      const t = (S.towers && S.towers[slot]) || null;
      const c = tugPxSlotCentre(side, slot);
      const g = rec.g;
      g.clear();
      rec.badge.visible = false;
      rec.bang.visible = false;
      rec.rubbleText.visible = false;
      const footY = juiceTowerBase(side, slot, 1).baseY;
      const barX = c.x - TUG_PX_BAR_W / 2;
      const hpY = footY + 3;

      if (!t) {
        rec.lastCooldown = null;
        rec.fireT0 = null;
        rec.popT0 = null;
        if (!(S.slotStates && S.slotStates[slot] === "rubble")) {
          // empty (or removed, which leaves no rubble): the view goes
          if (rec.view) {
            juiceDestroyTower(rec.view);
            rec.view = null;
          }
          rec.rubble = false;
          continue;
        }
        if (!rec.view) {
          rec.view = tugPxCreateTowerView(side, slot, "violet");
        }
        rec.rubble = true;
        tugPxPoseRubble(rec.view, side);
        tugPxDrawRubble(rec, c, footY, S.rubble ? S.rubble[slot] : 0);
        continue;
      }

      // A turret on a slot that still shows rubble: the greyed view goes first, so the new one stands upright, untinted.
      if (rec.rubble) {
        if (rec.view) {
          juiceDestroyTower(rec.view);
          rec.view = null;
        }
        rec.rubble = false;
      }

      // Morph: the dominant trait's colour changed -> the matching tower sprite, with a pop.
      const colourId = tugState.colourFor(t.dominant);
      if (rec.view && rec.view.id !== colourId) {
        juiceDestroyTower(rec.view);
        rec.view = null;
        rec.popT0 = clock;
      }
      if (!rec.view) {
        rec.view = tugPxCreateTowerView(side, slot, colourId);
      }
      const view = rec.view;
      const building = t.building || null;

      // Shot: the sim restarts the cooldown at its rate on a shot, so its fraction jumps up.
      if (!building && rec.lastCooldown !== null && t.cooldown > rec.lastCooldown + TUG_PX_FIRE_RISE) {
        rec.fireT0 = clock;
        tugPxShotPuff(snap, side, slot);
        tugOnShot(side, colourId);
      }
      rec.lastCooldown = t.cooldown;

      const ls = tugPxPoseTurret(rec, t, clock);
      const selected = !!sel && sel.side === side && sel.slot === slot;
      const topY = footY + (view.fields.offset.y - TOWER_RENDER_BOX_HEIGHT * view.fields.scale) * ls;
      const boxW = 54 * ls;
      const boxX = c.x - boxW / 2;
      const boxTop = topY + 4;
      const boxH = footY + 1 - boxTop;

      if (building) {
        // the sprite fades in (tugPxPoseTurret); an accent build bar at its foot; the selection ring as on a finished one
        tugPxBar(g, barX, hpY, building.progress, accent);
        if (selected) {
          g.roundRect(boxX, boxTop, boxW, boxH, 6).stroke({ width: 3, color: 0xffffff });
        }
        continue;
      }

      // A finished turret: hp and XP bars under the foot, the ready blink, the selection, the badges.
      const xpY = hpY + TUG_PX_BAR_H + 2;
      tugPxBar(g, barX, hpY, t.maxHp > 0 ? t.hp / t.maxHp : 0, packColourNumber("red"));
      tugPxBar(g, barX, xpY, t.xpFrac, gold);
      if (selected) {
        g.roundRect(boxX, boxTop, boxW, boxH, 6).stroke({ width: 3, color: 0xffffff });
      }
      const label = Array.isArray(t.badges) ? t.badges.join(" ") : "";
      if (label) {
        tugPxSetText(rec.badge, label);
        rec.badge.position.set(c.x, side === "player" ? topY - 9 : xpY + TUG_PX_BAR_H + 7);
        rec.badge.visible = true;
      }
      if (t.ready && blinkOn) {
        g.roundRect(boxX - 3, boxTop - 3, boxW + 6, boxH + 6, 8).stroke({ width: 3, color: gold });
        rec.bang.position.set(c.x, side === "player" && label ? topY - 15 : topY - 2);
        rec.bang.visible = true;
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Shots, bursts, gold floaters (fxLayer)
// -------------------------------------------------------------------------------------------------

// A turret shot's colour: the snapshot projectile carries its shooter's tint when it fired (t.color, one per
// dominant), so the owner's turret with that tint names the colour; if none is left (it morphed or fell), the owner's
// turret nearest the shot. The gate gun shoots violet.
function tugPxShotColour(snap, p) {
  if (p.towerId !== "turret") {
    return "violet";
  }
  const towers = (snap[p.owner] && snap[p.owner].towers) || [];
  for (const t of towers) {
    if (t && t.color === p.color) {
      return tugState.colourFor(t.dominant);
    }
  }
  let best = null;
  let bestDist = Infinity;
  for (const t of towers) {
    if (!t) {
      continue;
    }
    const d = Math.hypot(t.x - p.prevX, t.y - p.prevY);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best ? tugState.colourFor(best.dominant) : "violet";
}

// The projectiles have no ids: a pool of sprites, one per projectile each frame, turned along prev -> current.
function tugPxSyncShots(snap) {
  const list = snap.projectiles || [];
  const group = tugPx.layers.shotGroup;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    let sprite = tugPx.shots[i];
    if (!sprite) {
      sprite = new PIXI.Sprite();
      sprite.anchor.set(0.5);
      group.addChild(sprite);
      tugPx.shots.push(sprite);
    }
    const texture = juiceBulletTexture(tugPxShotColour(snap, p));
    if (sprite.texture !== texture) {
      sprite.texture = texture;
    }
    sprite.visible = true;
    sprite.position.set(p.x, p.y);
    const dx = p.x - p.prevX;
    const dy = p.y - p.prevY;
    sprite.rotation = Math.abs(dx) + Math.abs(dy) > 1e-6 ? Math.atan2(dy, dx) : (p.owner === "player" ? -Math.PI / 2 : Math.PI / 2);
  }
  for (let i = list.length; i < tugPx.shots.length; i += 1) {
    tugPx.shots[i].visible = false;
  }
}

// A splash burst: a red ring expanding as its life runs 1 -> 0, larger at the splash centre.
function tugPxSyncBursts(snap) {
  const g = tugPx.layers.bursts;
  g.clear();
  const red = packColourNumber("red");
  for (const b of snap.bursts || []) {
    const life = clamp(Number(b.life) || 0, 0, 1);
    const grow = 1 - life;
    const r = b.center ? 10 + 22 * grow : 5 + 10 * grow;
    g.circle(b.x, b.y, r).stroke({ width: b.center ? 3 : 2, color: red, alpha: Math.max(0.15, life) });
  }
}

// "+N" where a mob the player killed died, rising 22 px over the hit's 0.6 s. The snapshot copies match.hits every
// frame, so a hit is followed by its own age, not by object identity.
function tugPxSyncFloaters(snap) {
  const hits = (snap.hits || []).filter((h) => h.kind === "gold" && h.side === "player" && h.amount > 0);
  for (let i = 0; i < hits.length; i += 1) {
    const h = hits[i];
    let node = tugPx.floaters[i];
    if (!node) {
      node = tugPxText("", 13, packColourCss("gold"), packColourCss("ink"), 3);
      tugPx.layers.floaterGroup.addChild(node);
      tugPx.floaters.push(node);
    }
    const shown = Number.isInteger(h.amount) ? h.amount : +h.amount.toFixed(1);
    tugPxSetText(node, `+${shown}`);
    const u = clamp((Number(h.age) || 0) / TUG_PX_HIT_SECONDS, 0, 1);
    node.position.set(h.x, h.y - TUG_PX_GOLD_RISE * u);
    node.alpha = juiceFade(u);
    node.visible = true;
  }
  for (let i = hits.length; i < tugPx.floaters.length; i += 1) {
    tugPx.floaters[i].visible = false;
  }
}

// -------------------------------------------------------------------------------------------------
// The dock (dockIconLayer): the wood, the title line, the turret tabs, the trait frames and the mob cards
// -------------------------------------------------------------------------------------------------

function tugPxNoEvents(node) {
  node.eventMode = "none";
  return node;
}

function tugPxStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

function tugPxInt(v) {
  return Math.floor(Number(v) || 0);
}

// A non-negative remainder (the shimmer's loop runs on a clock that can sit below a frame's stagger).
function tugPxMod(a, m) {
  return ((a % m) + m) % m;
}

// A pack piece's nine-slice ("card" | "cardSelected", at the pack's inset), its top-left at (x, y). jonNineSlice is
// called directly: classic's card-frame helper returns null in layers mode, and tug draws its own tiles on every pack.
function tugPxTile(piece, x, y, width, height) {
  const tile = tugPxNoEvents(jonNineSlice(piece, undefined, width, height));
  tile.position.set(x, y);
  return tile;
}

// A tile shown as another piece: that piece's texture and inset (the size stays).
function tugPxSetTilePiece(tile, piece) {
  const spec = PACK_UI_PIECES[jonPieceName(piece)];
  tile.texture = getJonTexture(piece);
  if (spec && Number.isFinite(spec.inset)) {
    tile.leftWidth = spec.inset;
    tile.topHeight = spec.inset;
    tile.rightWidth = spec.inset;
    tile.bottomHeight = spec.inset;
  }
}

// A sprite fitted inside width x height keeping its aspect (CSS "contain"), centred on (x, y).
function tugPxContainSprite(parent, texture, x, y, width, height) {
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  const tw = texture.width > 0 ? texture.width : width;
  const th = texture.height > 0 ? texture.height : height;
  sprite.scale.set(Math.min(width / tw, height / th));
  parent.addChild(sprite);
  return sprite;
}

// The wood under the whole dock (the plan's Decision 3): jonWoodBar on a nine-slice pack that has the three bar pieces,
// else (a painted-layers pack) a flat wood rect with an ink stroke inside its edge. Returns the node. The nine-slice
// bar is cached in tugPxWoodCache (keyed by the pack) and survives teardown; its generated mask texture is never
// destroyed (Pixi's pooled alpha-mask effect keeps the last sprite mask's texture, so destroying it breaks the next
// wood dock drawn anywhere). A bar built before its art loaded is not cached, and dies with the layers.
function tugPxBuildWood() {
  const R = TUG_PX_DOCK;
  const pieces = PACK_UI_PIECES || {};
  if (PACK_CHROME_MODE === "nineSlice" && pieces.barTile && pieces.barMask && pieces.barInk) {
    const key = [PACK_UI_ROOT, pieces.barTile.file, pieces.barMask.file, pieces.barInk.file].join("|");
    if (tugPxWoodCache && tugPxWoodCache.key === key && tugPxWoodCache.bar && !tugPxWoodCache.bar.destroyed) {
      return tugPxWoodCache.bar;
    }
    if (tugPxWoodCache && tugPxWoodCache.bar && !tugPxWoodCache.bar.destroyed) {
      tugPxWoodCache.bar.destroy({ children: true }); // never its textures: a few MB lost per art-pack change is fine
    }
    tugPxWoodCache = null;
    const bar = tugPxNoEvents(jonWoodBar(R.width, R.height));
    bar.position.set(R.x, R.y);
    const loaded = ["barTile", "barMask", "barInk"].every((name) => getJonTexture(name) !== PIXI.Texture.EMPTY);
    if (loaded) {
      tugPxWoodCache = { key, bar };
    }
    return bar;
  }
  const s = TUG_PX_WOOD_STROKE;
  const g = tugPxNoEvents(new PIXI.Graphics());
  g.rect(R.x, R.y, R.width, R.height).fill({ color: TUG_PX_WOOD_FALLBACK });
  g.rect(R.x + s / 2, R.y + s / 2, R.width - s, R.height - s).stroke({ width: s, color: packColourNumber("ink") });
  return g;
}

// The shimmer band's texture: a horizontal gradient, the light colour at alpha 0 -> peak (middle) -> 0, drawn once on
// a canvas per build (tugPx.shimmer; tugPxTeardown destroys it).
function tugPxShimmerTexture() {
  const S = TUG_PX_SHIMMER;
  const canvas = document.createElement("canvas");
  canvas.width = S.textureWidth;
  canvas.height = S.textureHeight;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, S.textureWidth, 0);
  grad.addColorStop(0, `rgba(${S.rgb}, 0)`);
  grad.addColorStop(0.5, `rgba(${S.rgb}, ${S.peak})`);
  grad.addColorStop(1, `rgba(${S.rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S.textureWidth, S.textureHeight);
  return new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: canvas }) });
}

// The dock, back to front in tug's dock container: the wood, the title line (two head texts in paper: `title`, centred
// in units mode or left-anchored in tower mode, and `titleRight`, right-anchored), the tabs group (units mode), the
// frames group (tower mode), then the mob cards' group (both modes).
function tugPxBuildDock(layer) {
  const D = {
    wood: null, title: null, titleRight: null, mode: null,
    tabsGroup: null, tabs: [], framesGroup: null, frames: [], mobsGroup: null, mobs: []
  };
  const wood = tugPxBuildWood();
  D.wood = wood;
  layer.addChild(D.wood);

  const T = TUG_PX_TITLE;
  const paper = packColourCss("paper");
  D.title = tugPxNoEvents(jonText("", { font: "head", size: T.size, fill: paper }));
  D.titleRight = tugPxNoEvents(jonText("", { font: "head", size: T.size, fill: paper }));
  D.titleRight.anchor.set(1, 0.5);
  D.titleRight.position.set(T.x + T.width, T.y + T.height / 2);
  layer.addChild(D.title, D.titleRight);
  tugPxPlaceTitle(D, "units");

  D.tabsGroup = new PIXI.Container();
  D.tabsGroup.visible = false;
  TUG_PX_TAB.xs.forEach((x, i) => {
    D.tabs.push(tugPxBuildTab(D.tabsGroup, x, i));
  });
  layer.addChild(D.tabsGroup);

  if (!tugPx.shimmer) {
    tugPx.shimmer = tugPxShimmerTexture();
  }
  D.framesGroup = new PIXI.Container();
  D.framesGroup.visible = false;
  TUG_PX_FRAME.xs.forEach((cx, i) => {
    D.frames.push(tugPxBuildFrame(D.framesGroup, cx, i));
  });
  layer.addChild(D.framesGroup);

  D.mobsGroup = new PIXI.Container();
  attackerDefs.forEach((def, i) => {
    D.mobs.push(tugPxBuildMob(D.mobsGroup, def.id, i));
  });
  layer.addChild(D.mobsGroup);
  tugPx.dock = D;
}

// The title for a dock mode: centred on its box in units mode (and with no dock), left-anchored at the box's left edge
// in tower mode. Moves only when the mode changes.
function tugPxPlaceTitle(D, mode) {
  if (mode === D.mode) {
    return;
  }
  D.mode = mode;
  const T = TUG_PX_TITLE;
  const cy = T.y + T.height / 2;
  if (mode === "tower") {
    D.title.anchor.set(0, 0.5);
    D.title.position.set(T.x, cy);
  } else {
    D.title.anchor.set(0.5, 0.5);
    D.title.position.set(T.x + T.width / 2, cy);
  }
}

// A turret tab: the card tile, a holder for the tower sprite (re-created when the colour changes), the name and line,
// the "! ready" pill above them, and a tap-only hit area calling tugTabTap with the tab's slot (active only while the
// tab shows and is tappable).
function tugPxBuildTab(group, x, i) {
  const B = TUG_PX_TAB;
  const P = B.pill;
  const ink = packColourCss("ink");
  const box = new PIXI.Container();
  box.visible = false;
  const tile = tugPxTile("card", x, B.y, B.width, B.height);
  const spriteBox = tugPxNoEvents(new PIXI.Container());
  const name = tugPxNoEvents(jonText("", { font: "head", size: B.nameSize, fill: ink }));
  name.anchor.set(0, 0.5);
  const line = tugPxNoEvents(jonText("", { font: "head", size: B.lineSize, fill: packColourCss("muted") }));
  line.anchor.set(0, 0.5);
  const pill = tugPxNoEvents(new PIXI.Container());
  const pillG = tugPxNoEvents(new PIXI.Graphics());
  const pillText = tugPxNoEvents(jonText(P.text, { font: "head", size: P.size, fill: ink }));
  pill.addChild(pillG, pillText);
  pill.visible = false;
  box.addChild(tile, spriteBox, name, line, pill);
  const rec = {
    box, tile, spriteBox, sprite: null, colourId: null, name, line, pill, pillG, pillText, pillKey: "",
    hit: null, x, index: i, slot: i, on: null, active: null, textX: null, muted: null
  };
  rec.hit = addPixiCardHitArea(box, x + B.width / 2, B.y + B.height / 2, B.width, B.height, () => {
    tugTabTap(rec.slot);
  });
  rec.hit.eventMode = "none";
  group.addChild(box);
  return rec;
}

// The "! ready" pill: accent fill, ink border inside its edge, its word centred; its right edge pill.right in from the
// tab's. Redrawn only when the word's measured width changes.
function tugPxDrawPill(rec) {
  const B = TUG_PX_TAB;
  const P = B.pill;
  const w = rec.pillText.width + 2 * (P.padX + P.border);
  const key = String(w);
  if (key === rec.pillKey) {
    return;
  }
  rec.pillKey = key;
  const x = rec.x + B.width - P.right - w;
  const y = P.cy - P.height / 2;
  const half = P.border / 2;
  rec.pillG.clear();
  rec.pillG
    .roundRect(x + half, y + half, w - P.border, P.height - P.border, P.radius - half)
    .fill({ color: packColourNumber("accent") })
    .stroke({ width: P.border, color: packColourNumber("ink") });
  rec.pillText.position.set(x + w / 2, P.cy);
}

// One tab from its model (null: hidden, not tappable). A built or building tab shows its turret's sprite (faded while
// building); empty and rubble show none and mute the name too.
function tugPxSyncTab(rec, t) {
  const B = TUG_PX_TAB;
  const on = !!t;
  if (on !== rec.on) {
    rec.on = on;
    rec.box.visible = on;
  }
  const active = on && t.tappable === true;
  if (active !== rec.active) {
    rec.active = active;
    rec.hit.eventMode = active ? "static" : "none";
  }
  if (!on) {
    return;
  }
  rec.slot = Number.isInteger(t.slot) ? t.slot : rec.index;

  const withTurret = t.state === "built" || t.state === "building";
  const colourId = withTurret && t.colourId ? String(t.colourId) : null;
  if (colourId !== rec.colourId) {
    rec.colourId = colourId;
    for (const child of rec.spriteBox.removeChildren()) {
      child.destroy(); // the texture stays (pixiState.towerTextures owns it)
    }
    rec.sprite = null;
    const texture = colourId && pixiState.towerTextures ? pixiState.towerTextures[colourId] : null;
    if (texture) {
      const S = B.sprite;
      rec.sprite = tugPxNoEvents(tugPxContainSprite(rec.spriteBox, texture, rec.x + S.dx + S.width / 2, B.y + B.height / 2, S.width, S.height));
    }
  }
  if (rec.sprite) {
    const alpha = t.state === "building" ? B.buildingAlpha : 1;
    if (rec.sprite.alpha !== alpha) {
      rec.sprite.alpha = alpha;
    }
  }

  tugPxSetText(rec.name, tugPxStr(t.name));
  tugPxSetText(rec.line, tugPxStr(t.line));
  const textX = rec.x + (rec.sprite ? B.textDx : B.textDxBare);
  if (textX !== rec.textX) {
    rec.textX = textX;
    rec.name.position.set(textX, B.nameCy);
    rec.line.position.set(textX, B.lineCy);
  }
  const muted = t.state === "empty" || t.state === "rubble";
  if (muted !== rec.muted) {
    rec.muted = muted;
    rec.name.style.fill = packColourCss(muted ? "muted" : "ink");
  }

  const ready = t.ready === true;
  if (rec.pill.visible !== ready) {
    rec.pill.visible = ready;
  }
  if (ready) {
    tugPxDrawPill(rec);
  }
}

// A trait frame: the card tile (cardSelected while lit), the shimmer band under its round mask (inset from the
// frame), the word, one Graphics of rank pips, the row text ("rank/cap", or Heal's sub), the hint, and a tap-only hit
// area (tugFrameTap checks lit).
function tugPxBuildFrame(group, cx, i) {
  const F = TUG_PX_FRAME;
  const S = TUG_PX_SHIMMER;
  const cy = F.cy;
  const ink = packColourCss("ink");
  const box = new PIXI.Container();
  box.visible = false;
  const tile = tugPxTile("card", cx - F.width / 2, cy - F.height / 2, F.width, F.height);

  const bw = F.width - 2 * S.inset;
  const bh = F.height - 2 * S.inset;
  const bandMask = tugPxNoEvents(new PIXI.Graphics());
  bandMask.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, S.radius).fill({ color: 0xffffff });
  const band = tugPxNoEvents(new PIXI.Sprite(tugPx.shimmer));
  band.anchor.set(0.5);
  band.scale.set((S.bandFrac * bw) / tugPx.shimmer.width, (S.heightFrac * bh) / tugPx.shimmer.height);
  // Pixi maps x' = x + sin(skew.x) * y, y down: a negative skew moves the band's top edge right, so it leans "/"
  band.skew.x = S.skew;
  band.position.set(cx, cy);
  band.mask = bandMask;
  band.visible = false;

  const word = tugPxNoEvents(jonText("", { font: "head", size: F.wordSize, fill: ink }));
  const pips = tugPxNoEvents(new PIXI.Graphics());
  const row = tugPxNoEvents(jonText("", { font: "head", size: F.rowSize, fill: packColourCss("muted") }));
  row.visible = false;
  const hint = tugPxNoEvents(jonText("", { font: "head", size: F.hintSize, fill: ink }));
  hint.position.set(cx, cy + F.hintDy);
  hint.visible = false;
  box.addChild(tile, band, bandMask, word, pips, row, hint);
  const hit = addPixiCardHitArea(box, cx, cy, F.width, F.height, () => {
    tugFrameTap(i);
  });
  hit.eventMode = "none";
  group.addChild(box);
  return { box, tile, band, bandMask, word, pips, row, hint, hit, cx, index: i, on: null, lit: null, dim: null, layoutKey: "", rowKey: "" };
}

// A frame's rank row, on cy + (lit ? litRowDy : rowDy). A trait: cap pips (earned ink; the next one accent while lit;
// the rest unfilled; rings ink, muted while dim), rowGap, then "rank/cap" (muted), the whole row centred on the frame
// (the text's measured width included). Heal: its sub (muted) centred. Open: nothing. Redrawn only when its key
// (kind, rank, cap, lit, dim, text, text width) changes.
function tugPxSyncRow(fr, f, lit, dim) {
  const F = TUG_PX_FRAME;
  const kind = f.kind;
  let text = "";
  if (kind === "trait") {
    text = `${tugPxInt(f.rank)}/${tugPxInt(f.cap)}`;
  } else if (kind === "heal") {
    text = tugPxStr(f.sub);
  }
  tugPxSetText(fr.row, text);
  const shown = text !== "";
  if (fr.row.visible !== shown) {
    fr.row.visible = shown;
  }
  const textW = shown ? fr.row.width : 0;
  const key = `${kind}|${f.rank}|${f.cap}|${lit ? 1 : 0}|${dim ? 1 : 0}|${text}|${textW}`;
  if (key === fr.rowKey) {
    return;
  }
  fr.rowKey = key;
  const g = fr.pips;
  g.clear();
  const y = F.cy + (lit ? F.litRowDy : F.rowDy);
  if (kind !== "trait") {
    fr.row.anchor.set(0.5, 0.5);
    fr.row.position.set(fr.cx, y);
    return;
  }
  const cap = Math.max(0, tugPxInt(f.cap));
  const rank = Math.max(0, tugPxInt(f.rank));
  const pipsW = cap > 0 ? (cap - 1) * F.pipPitch + F.pipD : 0;
  const gap = cap > 0 ? F.rowGap : 0;
  const x0 = fr.cx - (pipsW + gap + textW) / 2;
  const ink = packColourNumber("ink");
  const accent = packColourNumber("accent");
  const ring = packColourNumber(dim ? "muted" : "ink");
  const r = (F.pipD - F.pipRing) / 2; // the ring's centre line, so the pip measures pipD across its outer edge
  for (let i = 0; i < cap; i += 1) {
    g.circle(x0 + F.pipD / 2 + i * F.pipPitch, y, r);
    if (i < rank) {
      g.fill({ color: ink });
    } else if (lit && i === rank) {
      g.fill({ color: accent });
    }
    g.stroke({ width: F.pipRing, color: ring });
  }
  fr.row.anchor.set(0, 0.5);
  fr.row.position.set(x0 + pipsW + gap, y);
}

// The light sweeping a lit frame (TUG_PX_SHIMMER), on the animation clock so it freezes with pause. Hidden while the
// frame is not lit and for the resting part of each loop.
function tugPxSyncShimmer(fr, lit, clock) {
  const S = TUG_PX_SHIMMER;
  const F = TUG_PX_FRAME;
  let x = null;
  if (lit) {
    const p = tugPxMod((Number.isFinite(clock) ? clock : 0) - S.stagger * fr.index, S.period) / S.period;
    if (p < S.move) {
      const v = p / S.move;
      const u = v * v * (3 - 2 * v); // ease in-out (smoothstep, close to cubic-bezier(0.42, 0, 0.58, 1))
      const boxW = F.width - 2 * S.inset;
      const bandW = S.bandFrac * boxW;
      const left = fr.cx - boxW / 2 - S.startFrac * boxW + u * S.travel * bandW;
      x = left + bandW / 2; // the band's anchor is its centre
    }
  }
  const shown = x !== null;
  if (fr.band.visible !== shown) {
    fr.band.visible = shown;
  }
  if (shown && fr.band.x !== x) {
    fr.band.x = x;
  }
}

// One frame from its model (null: hidden, not tappable). Tile piece only when lit changes, word colour only when dim
// changes, line positions only when lit / the row's presence change, text only when it changed. No alpha anywhere.
function tugPxSyncFrame(fr, f, clock) {
  const F = TUG_PX_FRAME;
  const on = !!f;
  if (on !== fr.on) {
    fr.on = on;
    fr.box.visible = on;
    fr.hit.eventMode = on ? "static" : "none";
  }
  if (!on) {
    return;
  }
  const lit = !!f.lit;
  if (lit !== fr.lit) {
    fr.lit = lit;
    tugPxSetTilePiece(fr.tile, lit ? "cardSelected" : "card");
    fr.hit.cursor = lit ? "pointer" : "default";
  }
  const dim = !!f.dim;
  if (dim !== fr.dim) {
    fr.dim = dim;
    fr.word.style.fill = packColourCss(dim ? "muted" : "ink");
  }
  tugPxSetText(fr.word, tugPxStr(f.name));
  const hasRow = f.kind === "trait" || f.kind === "heal";
  const layoutKey = `${lit ? 1 : 0}|${hasRow ? 1 : 0}`;
  if (layoutKey !== fr.layoutKey) {
    fr.layoutKey = layoutKey;
    const wordDy = !hasRow ? 0 : lit ? F.litWordDy : F.wordDy; // the word alone (Open) sits on the frame's middle
    fr.word.position.set(fr.cx, F.cy + wordDy);
  }
  const hint = lit ? tugPxStr(f.hint) : "";
  tugPxSetText(fr.hint, hint);
  if (fr.hint.visible !== (hint !== "")) {
    fr.hint.visible = hint !== "";
  }
  tugPxSyncRow(fr, f, lit, dim);
  tugPxSyncShimmer(fr, lit, clock);
}

// Draws tugState.dock, model v4 (missing: an empty, centred title, no tabs, no frames). Units mode: the centred title
// and the two tabs; tower mode: `title` left, `titleRight` right, and the four frames. The wood always shows.
function tugPxSyncDock(dock, clock) {
  const D = tugPx.dock;
  if (!D) {
    return;
  }
  const mode = dock && dock.mode === "tower" ? "tower" : "units";
  tugPxPlaceTitle(D, mode);
  tugPxSetText(D.title, dock ? tugPxStr(dock.title) : "");
  tugPxSetText(D.titleRight, dock && mode === "tower" ? tugPxStr(dock.titleRight) : "");

  const showTabs = !!dock && mode === "units" && Array.isArray(dock.tabs);
  if (D.tabsGroup.visible !== showTabs) {
    D.tabsGroup.visible = showTabs;
  }
  D.tabs.forEach((rec, i) => {
    tugPxSyncTab(rec, showTabs ? dock.tabs[i] || null : null);
  });

  const showFrames = !!dock && mode === "tower" && Array.isArray(dock.frames);
  if (D.framesGroup.visible !== showFrames) {
    D.framesGroup.visible = showFrames;
  }
  D.frames.forEach((fr, i) => {
    tugPxSyncFrame(fr, showFrames ? dock.frames[i] || null : null, clock);
  });

  const mobs = dock && Array.isArray(dock.mobs) ? dock.mobs : null;
  D.mobs.forEach((card, i) => {
    let m = mobs ? mobs[i] || null : null; // the model is in attackerDefs order; look it up by id if not
    if (mobs && (!m || m.id !== card.id)) {
      m = mobs.find((item) => item && item.id === card.id) || null;
    }
    tugPxSyncMob(card, m, !!dock);
  });
}

// -------------------------------------------------------------------------------------------------
// The mob cards (in the dock's mobsGroup) and their tap flash
// -------------------------------------------------------------------------------------------------

// A coin: gold fill and an ink ring, d across its outer edge, centred on (x, y).
function tugPxCoin(g, x, y, d, ring) {
  g.circle(x, y, (d - ring) / 2)
    .fill({ color: packColourNumber("gold") })
    .stroke({ width: ring, color: packColourNumber("ink") });
  return g;
}

// A mob card, built once per attackerDefs entry: the card tile, the attacker sheet's frame 0, the cost coin and
// number, the role word, the tap flash, the count pill (drawn over the card's top-right corner), and a tap-only hit
// area calling tugQueueMob (no hold, no hover; "none" while there is no dock model).
function tugPxBuildMob(group, id, i) {
  const M = TUG_PX_MOB;
  const P = M.pill;
  const ink = packColourCss("ink");
  const left = M.x0 + M.pitch * i;
  const cx = left + M.width / 2;
  const cy = M.y + M.height / 2;
  const box = new PIXI.Container();
  const tile = tugPxTile("card", left, M.y, M.width, M.height);
  box.addChild(tile);
  const cfg = (attackerSpriteConfig && attackerSpriteConfig[id]) || {};
  const sprite = tugPxNoEvents(addSheetPreview(box, id, cfg, cx, M.spriteCy, M.sprite, M.sprite));
  if (sprite.mask) {
    tugPxNoEvents(sprite.mask);
  }
  const coin = tugPxNoEvents(tugPxCoin(new PIXI.Graphics(), left + M.coinDx, M.costCy, M.coinD, M.coinRing));
  const cost = tugPxNoEvents(jonText("", { font: "head", size: M.costSize, fill: ink }));
  cost.anchor.set(0, 0.5);
  cost.position.set(left + M.costDx, M.costCy);
  const role = tugPxNoEvents(jonText("", { font: "head", size: M.roleSize, fill: ink }));
  role.anchor.set(0.5, 1);
  role.position.set(cx, M.roleBottom);
  const F = M.flash;
  const flash = tugPxNoEvents(new PIXI.Graphics());
  flash.roundRect(left + F.inset, M.y + F.inset, M.width - 2 * F.inset, M.height - 2 * F.inset, F.radius)
    .fill({ color: packColourNumber("paper"), alpha: F.alpha });
  flash.visible = false;
  const pill = tugPxNoEvents(new PIXI.Container());
  const pillG = tugPxNoEvents(new PIXI.Graphics());
  const pillText = tugPxNoEvents(jonText("", { font: "head", size: P.size, fill: ink }));
  pillText.position.set(0, P.top + P.height / 2);
  pill.addChild(pillG, pillText);
  pill.visible = false;
  box.addChild(coin, cost, role, flash, pill);
  const rec = {
    id, box, tile, sprite, coin, cost, role, flash, pill, pillG, pillText, pillKey: "", hit: null, left,
    poor: null, blocked: null, count: null, active: null, flashTimeouts: null
  };
  rec.hit = addPixiCardHitArea(box, cx, cy, M.width, M.height, () => {
    tugQueueMob(rec.id);
  });
  rec.hit.eventMode = "none";
  rec.active = false;
  group.addChild(box);
  return rec;
}

// The count pill: accent fill, ink border inside its edge, "×n" centred; at least minWidth wide, its right edge dx past
// the card's (clamped to maxRight). Redrawn only when the word's measured width changes.
function tugPxDrawMobPill(card) {
  const M = TUG_PX_MOB;
  const P = M.pill;
  const w = Math.max(P.minWidth, card.pillText.width + 2 * (P.padX + P.border));
  const key = String(w);
  if (key === card.pillKey) {
    return;
  }
  card.pillKey = key;
  const right = Math.min(P.maxRight, card.left + M.width + P.dx);
  const x = right - w;
  const half = P.border / 2;
  card.pillG.clear();
  card.pillG
    .roundRect(x + half, P.top + half, w - P.border, P.height - P.border, P.radius - half)
    .fill({ color: packColourNumber("accent") })
    .stroke({ width: P.border, color: packColourNumber("ink") });
  card.pillText.position.set(x + w / 2, P.top + P.height / 2);
}

// One mob card from its model (null: the card keeps its last look). Writes only on change: the cost text, its colour
// (poor), the sprite alpha and the role colour (blocked), the pill. The hit area is live only while there is a dock.
function tugPxSyncMob(card, m, hasDock) {
  const active = hasDock;
  if (active !== card.active) {
    card.active = active;
    card.hit.eventMode = active ? "static" : "none";
  }
  if (!m) {
    return;
  }
  tugPxSetText(card.cost, tugPxStr(m.cost));
  tugPxSetText(card.role, tugPxStr(m.role));
  const poor = !!m.poor;
  if (poor !== card.poor) {
    card.poor = poor;
    card.cost.style.fill = poor ? TUG_PX_POOR : packColourCss("ink");
  }
  const blocked = !!m.blocked;
  if (blocked !== card.blocked) {
    card.blocked = blocked;
    card.sprite.alpha = blocked ? TUG_PX_MOB.blockedAlpha : 1;
    card.role.style.fill = packColourCss(blocked ? "muted" : "ink");
  }
  const count = Math.max(0, tugPxInt(m.count));
  if (count !== card.count) {
    card.count = count;
    card.pill.visible = count > 0;
    if (count > 0) {
      tugPxSetText(card.pillText, `×${count}`);
    }
  }
  if (count > 0) {
    tugPxDrawMobPill(card);
  }
}

function tugPxClearFlash(card) {
  if (card && card.flashTimeouts) {
    for (const timeoutId of card.flashTimeouts) {
      window.clearTimeout(timeoutId);
    }
    card.flashTimeouts = null;
  }
}

// The mob card's tap flash (tugQueueMob calls it): flashPixiCard's on 85 ms / off / on at 0.72 from 145 ms / off at
// 230 ms. A repeat flash restarts it; teardown clears the pending steps; a destroyed node is never touched.
function tugPxFlashMob(id) {
  const D = tugPx.dock;
  const card = D ? D.mobs.find((item) => item.id === id) : null;
  if (!card || !card.flash || card.flash.destroyed) {
    return;
  }
  const F = TUG_PX_MOB.flash;
  const flash = card.flash;
  tugPxClearFlash(card);
  const step = (visible, alpha) => {
    if (!flash.destroyed) {
      flash.visible = visible;
      flash.alpha = alpha;
    }
  };
  step(true, 1);
  card.flashTimeouts = [
    window.setTimeout(() => step(false, 1), F.offMs),
    window.setTimeout(() => step(true, F.againAlpha), F.againMs),
    window.setTimeout(() => {
      step(false, 1);
      card.flashTimeouts = null;
    }, F.endMs)
  ];
}

// -------------------------------------------------------------------------------------------------
// The HUD (textLayer): the clock chip, the gold chip, the queue column
// -------------------------------------------------------------------------------------------------

// The empty queue cell's border: a dashed round rect (the stroke's outer edge on the cell's), dashes along the four
// straight edges, solid corner arcs. Drawn once per cell.
function tugPxDashedCell(g, x, y) {
  const Q = TUG_PX_QUEUE;
  const half = Q.dashWidth / 2;
  const x0 = x + half;
  const y0 = y + half;
  const s = Q.size - Q.dashWidth; // the stroke's centre line
  const r = Q.dashRadius - half;
  const run = s - 2 * r;
  const lead = (run - Math.floor((run + Q.dashOff) / (Q.dashOn + Q.dashOff)) * (Q.dashOn + Q.dashOff) + Q.dashOff) / 2;
  // the four edges, each from (ax, ay) along (dx, dy), between the corner arcs
  const edges = [
    [x0 + r, y0, 1, 0], [x0 + s, y0 + r, 0, 1], [x0 + s - r, y0 + s, -1, 0], [x0, y0 + s - r, 0, -1]
  ];
  for (const [ax, ay, dx, dy] of edges) {
    for (let t = Math.max(0, lead); t < run; t += Q.dashOn + Q.dashOff) {
      const e = Math.min(run, t + Q.dashOn);
      g.moveTo(ax + dx * t, ay + dy * t).lineTo(ax + dx * e, ay + dy * e);
    }
  }
  // the corner arcs: top-left, top-right, bottom-right, bottom-left
  const corners = [
    [x0 + r, y0 + r, Math.PI], [x0 + s - r, y0 + r, -Math.PI / 2], [x0 + s - r, y0 + s - r, 0], [x0 + r, y0 + s - r, Math.PI / 2]
  ];
  for (const [cx, cy, a] of corners) {
    g.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)).arc(cx, cy, r, a, a + Math.PI / 2);
  }
  g.stroke({ width: Q.dashWidth, color: packColourNumber("muted"), alpha: Q.dashAlpha });
  return g;
}

// The HUD, in one root shown while tugState.hud exists: the clock chip (card tile, "m:ss"), the gold chip (card tile,
// coin, number, "gold"), the "queue" caption, then min(queue.max, 5) cells growing up from the gate (cell 0, the head,
// at the bottom). A cell: its tile (card, or cardSelected while it holds a training mob; hidden while empty), the
// training fill, a holder for the mob's sheet preview (addSheetPreview puts the sprite and its mask in the holder; both
// go when the defId or the training flag changes), and the dashed border shown while empty.
function tugPxBuildHud(layer) {
  const ink = packColourCss("ink");
  const muted = packColourCss("muted");
  const H = { root: null, time: null, gold: null, goldCoin: null, goldW: null, goldCaption: null, caption: null, cells: [] };
  H.root = tugPxNoEvents(new PIXI.Container());
  H.root.visible = false;

  const C = TUG_PX_CLOCK;
  H.time = tugPxNoEvents(jonText("", { font: "head", size: C.size, fill: ink }));
  H.time.position.set(C.cx, C.cy);
  H.root.addChild(tugPxTile("card", C.x, C.y, C.width, C.height), H.time);

  const G = TUG_PX_GOLD;
  H.goldCoin = tugPxNoEvents(tugPxCoin(new PIXI.Graphics(), 0, 0, G.coinD, G.coinRing));
  H.goldCoin.position.set(G.cx, G.cy);
  H.gold = tugPxNoEvents(jonText("", { font: "head", size: G.size, fill: ink }));
  H.gold.position.set(G.cx, G.cy);
  H.goldCaption = tugPxNoEvents(jonText("gold", { font: "head", size: G.captionSize, fill: muted }));
  H.goldCaption.position.set(G.cx, G.captionCy);
  H.root.addChild(tugPxTile("card", G.x, G.y, G.width, G.height), H.goldCoin, H.gold, H.goldCaption);

  const Q = TUG_PX_QUEUE;
  H.caption = tugPxNoEvents(jonText("queue", { font: "head", size: Q.captionSize, fill: muted }));
  H.caption.position.set(Q.captionCx, Q.captionCy);
  H.root.addChild(H.caption);
  const tug = tugState && tugState.match ? tugState.match.tug : null;
  const maxRaw = tug && tug.queue ? Math.floor(Number(tug.queue.max)) : NaN;
  const max = Math.min(maxRaw > 0 ? maxRaw : Q.max, Q.max);
  for (let k = 0; k < max; k += 1) {
    const x = Q.x;
    const y = Q.y0 - Q.pitch * k;
    const box = tugPxNoEvents(new PIXI.Container());
    const tile = tugPxTile("card", x, y, Q.size, Q.size);
    tile.visible = false;
    const fill = tugPxNoEvents(new PIXI.Graphics());
    const spriteBox = tugPxNoEvents(new PIXI.Container());
    const dashed = tugPxNoEvents(tugPxDashedCell(new PIXI.Graphics(), x, y));
    box.addChild(tile, fill, spriteBox, dashed);
    H.root.addChild(box);
    H.cells.push({ box, tile, fill, spriteBox, dashed, sprite: null, x, y, defId: null, head: false, key: "" });
  }
  layer.addChild(H.root);
  tugPx.hud = H;
}

// One queue cell from its list item (null: empty). Re-synced only when its key (defId, training, frac) changes; the
// tile's piece swaps only when training changes; the sprite is re-made when the defId or training changes (a training
// mob's is inset headInset, the others' inset). `training` is true for the mob the sim is training: every queued mob
// while queue.parallel, else the head only. (The cell's `head` field and local hold that flag.)
function tugPxSyncCell(cell, item, training) {
  const Q = TUG_PX_QUEUE;
  const defId = item ? String(item.defId) : null;
  const head = !!item && training;
  const frac = head ? clamp(Number(item.frac) || 0, 0, 1) : 0;
  const key = defId === null ? "empty" : `${defId}|${head ? 1 : 0}|${frac}`;
  if (key === cell.key) {
    return;
  }
  cell.key = key;
  const filled = defId !== null;
  if (cell.tile.visible !== filled) {
    cell.tile.visible = filled;
  }
  if (cell.dashed.visible !== !filled) {
    cell.dashed.visible = !filled;
  }
  if (head !== cell.head) {
    tugPxSetTilePiece(cell.tile, head ? "cardSelected" : "card");
  }
  if (defId !== cell.defId || head !== cell.head) {
    for (const child of cell.spriteBox.removeChildren()) {
      child.destroy(); // the old sprite and its mask; the texture stays (pixiState.attackerTextures owns it)
    }
    cell.sprite = null;
    if (filled) {
      const inset = head ? Q.headInset : Q.inset;
      const size = Q.size - 2 * inset;
      const cfg = (attackerSpriteConfig && attackerSpriteConfig[defId]) || {};
      cell.sprite = tugPxNoEvents(addSheetPreview(cell.spriteBox, defId, cfg, cell.x + Q.size / 2, cell.y + Q.size / 2, size, size));
      if (cell.sprite.mask) {
        tugPxNoEvents(cell.sprite.mask);
      }
    }
  }
  cell.defId = defId;
  cell.head = head;
  cell.fill.clear();
  if (frac <= 0) {
    return;
  }
  const w = Q.size - 2 * Q.fillInset;
  const h = w * frac; // (size - 2 * fillInset) * frac: the cell is square
  const r = Math.min(Q.fillRadius, w / 2, h / 2);
  cell.fill
    .roundRect(cell.x + Q.fillInset, cell.y + Q.size - Q.fillInset - h, w, h, r)
    .fill({ color: packColourNumber("accent"), alpha: Q.alpha });
}

// Draws tugState.hud (null: the whole HUD hidden). Text only when it changed; the gold number pops on goldPopT0 the
// way classic's HUD numbers do (tug-mode.js sets and clears goldPopT0; nothing here writes it), and the coin + number
// pair re-centres on the chip when the number's width changes. Then the cells from tugState.dock.queue.list (head
// first; missing: all empty); a cell is styled as training when its item says so (item.training; cell 0 only if the
// item has no such flag).
function tugPxSyncHud(hud) {
  const H = tugPx.hud;
  if (!H) {
    return;
  }
  const show = !!hud;
  if (H.root.visible !== show) {
    H.root.visible = show;
  }
  if (!hud) {
    return;
  }
  tugPxSetText(H.time, hud.time !== undefined && hud.time !== null ? String(hud.time) : "");
  tugPxSetText(H.gold, hud.gold !== undefined && hud.gold !== null ? String(hud.gold) : "");
  let s = 1;
  const t0 = hud.goldPopT0;
  if (t0 !== null && t0 !== undefined && Number.isFinite(Number(t0))) {
    const p = (state.animationClock - Number(t0)) / HUD_POP_SECONDS;
    if (p >= 0 && p < 1) {
      s = 1 + HUD_POP_SCALE * (1 - hudEaseOutElastic(p));
    }
  }
  if (H.gold.scale.x !== s) {
    H.gold.scale.set(s);
  }
  // the pair (coin, gap, number) centred on the chip, from the number's unscaled width (the pop leaves it in place)
  const G = TUG_PX_GOLD;
  const goldW = s > 0 ? Math.abs(H.gold.width / s) : 0;
  if (goldW !== H.goldW) {
    H.goldW = goldW;
    const left = G.cx - (G.coinD + G.gap + goldW) / 2;
    H.goldCoin.position.set(left + G.coinD / 2, G.cy);
    H.gold.position.set(left + G.coinD + G.gap + goldW / 2, G.cy);
  }

  const dock = tugState.dock;
  const list = dock && dock.queue && Array.isArray(dock.queue.list) ? dock.queue.list : [];
  H.cells.forEach((cell, k) => {
    const item = list[k] || null;
    const on = !!item && item.defId !== undefined && item.defId !== null;
    tugPxSyncCell(cell, on ? item : null, on && (item.training === undefined ? k === 0 : item.training === true));
  });
}

// -------------------------------------------------------------------------------------------------
// Per frame, and the teardown tug-mode.js calls
// -------------------------------------------------------------------------------------------------

function updatePixiTug() {
  if (!tugState || !tugState.snap || !pixiState.ready) {
    return;
  }
  if (!pixiState.app || !juiceFx.bubble || !juiceFx.shadow) {
    return;
  }
  if (!tugPxLayersOnStage()) {
    return; // the scene is being rebuilt (a pack change): wait for the new layers
  }
  if (!tugPxIntact()) {
    tugPxBuild();
  }
  const snap = tugState.snap;
  const clock = state.animationClock;
  let dt = tugPx.lastClock === null ? 0 : clock - tugPx.lastClock;
  if (dt < 0 || dt > JUICE_CATCHUP_SECONDS) {
    dt = 0;
  }
  tugPx.lastClock = clock;
  juiceClock = clock; // 18b's effects start at juiceClock

  tugPxSyncMarks(snap);
  tugPxSyncGates(snap);
  tugPxSyncMobs(snap, dt, clock);
  tugPxSyncTurrets(snap, clock);
  tugPxSyncShots(snap);
  tugPxSyncBursts(snap);
  tugPxSyncFloaters(snap);
  tugPxSyncDock(tugState.dock || null, clock);
  juiceTickEffects(clock);

  tugUpdateHud();
  tugPxSyncHud(tugState.hud || null);
  tugUpdateCardStates();
}

function tugPixiDestroy() {
  tugPxTeardown();
}
