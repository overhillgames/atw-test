// Line Tower Wars runtime, part 18b: units, towers, effects, status cues, the round banner, the juice dispatcher.
// Classic script sharing the one global scope: load order is index.html's.
//
// The juice layer (ltw-battle-2d-juice, piece B). Every creep, tower, projectile, effect and the round banner is a
// persistent Pixi display object. Each frame updatePixiUnits() (called from drawBoard) reads `state`, works out what
// happened since the last frame (new projectiles, gone units, slot changes, timer onsets ...) and advances every
// animation from state.animationClock, so motion freezes with pause and fixed-step harness runs are deterministic.
// It never writes to `state`: all bookkeeping lives in the module-level Maps and objects below, and its own
// small PRNG (juiceRandom) keeps the visual randomness off the game's random stream.
//
// A jump of more than 0.25 s in the clock, a clock that went backwards (new match) or a rebuilt scene is a silent
// catch-up: every view is rebuilt at its rest pose, nothing is emitted, no tween or shake runs. That is what the
// --screenshots stills (drawBoard only at a few moments) must show.

// -------------------------------------------------------------------------------------------------
// Motion words (02-art-packs.js declares them per pack)
// -------------------------------------------------------------------------------------------------

const DEFAULT_UNIT_MOTION = { imp: "walk", runner: "walk", brute: "walk", wisp: "float", tank: "roll" };

function getUnitMotion(defId) {
  return activeArtPack?.motion?.[defId] || DEFAULT_UNIT_MOTION[defId] || "walk";
}

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

// the effect PNGs load from the active pack's fx folder (PACK_FX_ROOT); colours come from PACK_COLOURS
const JUICE_FX_NAMES = [
  "bullet-violet", "bullet-yellow", "bullet-red", "bullet-green", "bullet-blue", "bullet-tank",
  "spark", "puff", "dust", "shard", "bubble", "goal-flash",
  "shadow", "slow-ring", "star", "hp-bar"
];
// Multi-frame effect PNGs: frames in a row, each size x size logical px.
const JUICE_FX_SHEETS = { spark: 16, puff: 24, dust: 32, shard: 16 };
const JUICE_CATCHUP_SECONDS = 0.25;
const JUICE_HOP_PX = 10;
const JUICE_SHADOW_ALPHA = 0.2;
const JUICE_EVENT_LIMIT = 512;
const JUICE_POOL_LIMIT = 96;
const JUICE_Z_UNDER = 1;
const JUICE_Z_FX = 2;
const JUICE_Z_DYING = 3;
const JUICE_Z_KILL = 4;
const JUICE_Z_BANNER = 1000;

// -------------------------------------------------------------------------------------------------
// The dispatcher
// -------------------------------------------------------------------------------------------------

const atwJuice = {
  events: [],
  forceStatic: false,
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  },
  stats() {
    return { views: juiceUnitViews.size + juiceTowerViews.size, pooled: juicePool.length, texturesCreated: juiceTexturesCreated };
  }
};
window.atwJuice = atwJuice;

// The one sound hook: every juice event passes through here. Nothing is wired yet.
function onJuiceSound(type, data) {}

function emitJuice(type, data = {}) {
  atwJuice.events.push({ type, x: data.x, y: data.y, ...data });
  if (atwJuice.events.length > JUICE_EVENT_LIMIT) {
    atwJuice.events.splice(0, atwJuice.events.length - JUICE_EVENT_LIMIT);
  }
  onJuiceSound(type, data);
  runJuiceEffect(type, data);
}

// -------------------------------------------------------------------------------------------------
// Module bookkeeping (never on state, units, towers or projectiles)
// -------------------------------------------------------------------------------------------------

const juiceFx = {}; // name -> { tex, frames[] }
const juiceFxCache = new Map(); // full path -> Promise<{ tex, frames[] }>, so a pack switch loads the new folder
const juiceKillCache = new Map(); // path -> { frames[], cfg }
let juiceKill = null;
let juiceUnitSheets = { player: {}, ai: {} };
let juiceTowerSheets = { player: {}, ai: {} };
let juiceTexturesCreated = 0;

const juiceUnitViews = new Map(); // "owner:id" -> unit view
const juiceTowerViews = new Map(); // "owner:slot" -> tower view
const juiceProjViews = new Map(); // projectile id -> { sprite, ghosts[] }
const juiceBurstSprites = [];
const juiceEffects = [];
const juicePool = []; // free Sprites
let juiceBook = null; // the previous frame's snapshot
let juiceFrame = null; // this frame's { cur, prev, clock, dt }
let juiceBanner = null;
let juiceBattleT0 = null;
let juiceRoundOutT0 = null; // clock when prep ended: the Round card's fade-out start
const juiceShake = { t0: -10, amp: 0, angle: 0 };
let juiceClock = 0;
let juiceRngState = 0x2f6e2b1;

function juiceRandom() {
  juiceRngState = (juiceRngState + 0x6d2b79f5) | 0;
  let t = Math.imul(juiceRngState ^ (juiceRngState >>> 15), 1 | juiceRngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function juiceTexture(options) {
  juiceTexturesCreated += 1;
  return new PIXI.Texture(options);
}

// Full opacity until the last 15% of an effect's life (no grey see-through marks), then out.
function juiceFade(u) {
  return u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15;
}

// Effects end by shrinking: full size for the first 60% of their life, then down to nothing.
function juiceShrink(u) {
  return u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4);
}

// A wobbly ink ring of dashes of unequal length and gap that shrink and break as u goes 0 -> 1.
function juiceDrawRing(g, x, y, r, u, seed) {
  g.clear();
  const arcs = 9;
  let a0 = seed;
  for (let k = 0; k < arcs; k += 1) {
    const slot = (Math.PI * 2) / arcs;
    const len = slot * (0.35 + 0.5 * (0.5 + 0.5 * Math.sin(seed * 3.1 + k * 2.3))) * (1 - 0.7 * u);
    const start = a0 + slot * 0.1 * Math.sin(seed + k * 1.7);
    for (let i = 0; i <= 6; i += 1) {
      const a = start + (len * i) / 6;
      const rr = r + 1.1 * Math.sin(3 * a + seed) + 0.7 * Math.sin(7 * a + k) + 0.6 * Math.sin(13 * a + seed * 2);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) {
        g.moveTo(px, py);
      } else {
        g.lineTo(px, py);
      }
    }
    a0 += slot;
  }
  g.stroke({ width: 2.5, color: packColourNumber("ink"), alpha: juiceFade(u), cap: "round", join: "round" });
}

function juiceEaseOut(t) {
  const k = 1 - clamp(t, 0, 1);
  return 1 - k * k * k;
}

// 1 -> 0 with one overshoot below zero near the end.
function juiceElastic(u) {
  return (1 - u) * Math.cos(1.25 * Math.PI * u);
}

// -------------------------------------------------------------------------------------------------
// Preload: effect PNGs, the kill sheet, per-pack frame and tint textures
// -------------------------------------------------------------------------------------------------

function juiceLoadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Unable to load image asset: ${path}`));
    img.src = path;
  });
}

function juiceLoadFx() {
  const root = PACK_FX_ROOT;
  return Promise.all(JUICE_FX_NAMES.map(async (name) => {
    const path = `${root}/${name}.png`;
    if (!juiceFxCache.has(path)) {
      juiceFxCache.set(path, (async () => {
        const img = await juiceLoadImage(path);
        // A 2x PNG at resolution 2 draws at its logical size; frame rectangles are in logical px.
        const source = new PIXI.ImageSource({ resource: img, resolution: 2 });
        const tex = juiceTexture({ source });
        const frameSize = JUICE_FX_SHEETS[name];
        const frames = [];
        if (frameSize) {
          for (let i = 0; i < Math.floor(tex.width / frameSize); i += 1) {
            frames.push(juiceTexture({ source, frame: new PIXI.Rectangle(i * frameSize, 0, frameSize, frameSize) }));
          }
        } else {
          frames.push(tex);
        }
        return { tex, frames };
      })().catch((error) => {
        juiceFxCache.delete(path);
        throw error;
      }));
    }
    juiceFx[name] = await juiceFxCache.get(path);
  }));
}

async function juiceLoadKill() {
  juiceKill = null;
  const cfg = creepKillEffectConfig;
  if (!cfg || !cfg.path) {
    return;
  }
  if (!juiceKillCache.has(cfg.path)) {
    const img = await juiceLoadImage(cfg.path);
    const source = new PIXI.ImageSource({ resource: img });
    const count = Math.max(1, cfg.frames || 1);
    const frameWidth = cfg.frameWidth || Math.floor(img.naturalWidth / count);
    const frameHeight = cfg.frameHeight || img.naturalHeight;
    const frames = [];
    for (let i = 0; i < count; i += 1) {
      frames.push(juiceTexture({ source, frame: new PIXI.Rectangle(i * frameWidth, 0, frameWidth, frameHeight) }));
    }
    juiceKillCache.set(cfg.path, { frames, frameWidth, frameHeight });
  }
  juiceKill = { ...juiceKillCache.get(cfg.path), cfg };
}

// One frame of a unit sheet, drawn at render size (2x) with its light fill pixels flooded with one colour and
// its dark ink lines (luminance < 70) left as they are: the hit flash (white) and the poison tick (green).
// Made once per (sheet, frame) at preload.
function juiceTintedTexture(sheetTex, sx, sw, sh, rw, rh, rgb) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rw * 2));
  canvas.height = Math.max(1, Math.round(rh * 2));
  const c2d = canvas.getContext("2d", { willReadFrequently: true });
  c2d.imageSmoothingEnabled = true;
  c2d.imageSmoothingQuality = "high";
  c2d.drawImage(sheetTex.source.resource, sx, 0, sw, sh, 0, 0, canvas.width, canvas.height);
  const image = c2d.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) {
      continue;
    }
    if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] >= 70) {
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
    }
  }
  c2d.putImageData(image, 0, 0);
  return juiceTexture({ source: new PIXI.CanvasSource({ resource: canvas, resolution: 2 }) });
}

function juiceMakeUnitSheet(cfg, tex) {
  const fields = unitRenderFields(cfg);
  const rw = (cfg.renderWidth || 42) * fields.scale;
  const rh = (cfg.renderHeight || 42) * fields.scale;
  const frames = Math.max(1, cfg.frames || 1);
  const frameWidth = cfg.frameWidth || Math.floor(tex.width / frames);
  const frameHeight = cfg.frameHeight || tex.height;
  const frameTex = [];
  const white = [];
  const green = [];
  for (let i = 0; i < frames; i += 1) {
    frameTex.push(juiceTexture({ source: tex.source, frame: new PIXI.Rectangle(i * frameWidth, 0, frameWidth, frameHeight) }));
    white.push(juiceTintedTexture(tex, i * frameWidth, frameWidth, frameHeight, rw, rh, [255, 255, 255]));
    green.push(juiceTintedTexture(tex, i * frameWidth, frameWidth, frameHeight, rw, rh, [0x5c, 0xc0, 0x2c]));
  }
  return { rw, rh, frames, fps: cfg.fps || 6, frameTex, white, green, fields };
}

function juiceUnitSheet(side, defId) {
  if (!(defId in juiceUnitSheets[side])) {
    const cfg = attackerSpriteConfigSets[side]?.[defId] || attackerSpriteConfig?.[defId];
    const tex = pixiState.attackerTextureSets[side]?.[defId];
    juiceUnitSheets[side][defId] = cfg && tex ? juiceMakeUnitSheet(cfg, tex) : null;
  }
  return juiceUnitSheets[side][defId];
}

function juiceTowerFire(side, towerId) {
  if (!(towerId in juiceTowerSheets[side])) {
    const cfg = towerFireSheetConfigSets[side]?.[towerId];
    const tex = pixiState.towerFireTextureSets[side]?.[towerId];
    let entry = null;
    if (cfg && tex) {
      const count = Math.max(1, cfg.frames || 4);
      const frameWidth = cfg.frameWidth || Math.floor(tex.width / count);
      const frameHeight = cfg.frameHeight || tex.height;
      const frames = [];
      for (let i = 0; i < count; i += 1) {
        frames.push(juiceTexture({ source: tex.source, frame: new PIXI.Rectangle(i * frameWidth, 0, frameWidth, frameHeight) }));
      }
      entry = { frames };
    }
    juiceTowerSheets[side][towerId] = entry;
  }
  return juiceTowerSheets[side][towerId];
}

async function preloadPixiUnits() {
  await juiceLoadFx();
  await juiceLoadKill();
  juiceUnitSheets = { player: {}, ai: {} };
  juiceTowerSheets = { player: {}, ai: {} };
  juiceBook = null;
  // Build every sub-texture and tint now, so the first strip and the first battle second are deterministic.
  for (const side of ["player", "ai"]) {
    for (const defId of Object.keys(attackerSpriteConfigSets[side] || {})) {
      juiceUnitSheet(side, defId);
    }
    for (const towerId of Object.keys(towerFireSheetConfigSets[side] || {})) {
      juiceTowerFire(side, towerId);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Sprite pool and small display helpers
// -------------------------------------------------------------------------------------------------

function juiceAcquireSprite(texture, z = JUICE_Z_FX) {
  const sprite = juicePool.pop() || new PIXI.Sprite();
  sprite.texture = texture;
  sprite.anchor.set(0.5);
  sprite.scale.set(1);
  sprite.rotation = 0;
  sprite.alpha = 1;
  sprite.visible = true;
  sprite.zIndex = z;
  pixiState.fxLayer.addChild(sprite);
  return sprite;
}

function juiceReleaseSprite(sprite) {
  sprite.visible = false;
  if (sprite.parent) {
    sprite.parent.removeChild(sprite);
  }
  if (juicePool.length < JUICE_POOL_LIMIT) {
    juicePool.push(sprite);
  } else {
    sprite.destroy();
  }
}

// Sets a sprite's texture and scales it so the whole texture covers w x h logical px. The anchor is the
// bottom centre (feet) by default, or the top centre with a negative y scale for a vertical flip; anchor is the
// unit's render-field anchor (default x 0.5, y 1), mirrored in y when flipped.
function juiceFitSprite(sprite, texture, w, h, flipY, anchor = { x: 0.5, y: 1 }) {
  sprite.texture = texture;
  sprite.anchor.set(anchor.x, flipY ? 1 - anchor.y : anchor.y);
  const ow = texture.orig.width || texture.width || 1;
  const oh = texture.orig.height || texture.height || 1;
  sprite.scale.set(w / ow, (flipY ? -1 : 1) * (h / oh));
}

function juiceAddEffect(effect) {
  effect.t0 = juiceClock;
  juiceEffects.push(effect);
  return effect;
}

function juiceTickEffects(clock) {
  for (let i = juiceEffects.length - 1; i >= 0; i -= 1) {
    const effect = juiceEffects[i];
    const u = (clock - effect.t0) / effect.dur;
    if (u >= 1 || u < 0) {
      effect.done(effect);
      juiceEffects.splice(i, 1);
    } else {
      effect.update(effect, u);
    }
  }
}

// A sprite effect that plays the frames of an fx sheet over `dur` seconds.
function juiceFrameFx(name, x, y, dur, options = {}) {
  const fx = juiceFx[name];
  if (!fx) {
    return null;
  }
  const sprite = juiceAcquireSprite(fx.frames[0], options.z ?? JUICE_Z_FX);
  sprite.position.set(x, y);
  sprite.anchor.set(0.5, options.anchorY ?? 0.5);
  const base = options.scale ?? 1;
  sprite.scale.set(base * (options.flip ? -1 : 1), base);
  sprite.rotation = options.rotation ?? 0;
  return juiceAddEffect({
    dur,
    sprite,
    frames: fx.frames,
    base,
    flipSign: options.flip ? -1 : 1,
    fade: !!options.fade,
    update(e, u) {
      e.sprite.texture = e.frames[Math.min(e.frames.length - 1, Math.floor(u * e.frames.length))];
      if (e.fade) {
        // ends by shrinking away, fully opaque until the last 15%
        const k = juiceShrink(u);
        e.sprite.scale.set(e.base * e.flipSign * k, e.base * k);
        e.sprite.alpha = juiceFade(u);
      }
    },
    done(e) {
      juiceReleaseSprite(e.sprite);
    }
  });
}

function juiceStartShake(amp) {
  juiceShake.t0 = juiceClock;
  juiceShake.amp = amp;
  juiceShake.angle = juiceRandom() * Math.PI * 2;
}

function juiceApplyShake(clock, dt) {
  const stage = pixiState.app.stage;
  const t = clock - juiceShake.t0;
  if (state.paused || dt <= 0 || t < 0 || t >= 0.25) {
    stage.position.set(0, 0);
    return;
  }
  const mag = juiceShake.amp * (1 - t / 0.25) * Math.cos(t * Math.PI * 2 * 11);
  stage.position.set(Math.cos(juiceShake.angle) * mag, Math.sin(juiceShake.angle) * mag);
}

// -------------------------------------------------------------------------------------------------
// Shadows: soft contact shadows (shadow.png, a radial alpha falloff) at the foot line, all in one dedicated
// container per layer, drawn first, one low alpha each so overlaps stay light. No depth scaling.
// -------------------------------------------------------------------------------------------------

let juiceShadowUnitLayer = null;
let juiceShadowTowerLayer = null;

function juiceMakeShadow(layer, width) {
  const sprite = new PIXI.Sprite(juiceFx.shadow.tex);
  sprite.anchor.set(0.5);
  sprite.alpha = JUICE_SHADOW_ALPHA;
  sprite.scale.set(width / 64, (width * 0.28) / 24);
  layer.addChild(sprite);
  return sprite;
}

// -------------------------------------------------------------------------------------------------
// Unit views
// -------------------------------------------------------------------------------------------------

function juiceCreateUnitView(unit, clock) {
  const side = getOwnerVisualSide(unit.owner);
  const sheet = juiceUnitSheet(side, unit.defId);
  const rw = sheet ? sheet.rw : 42;
  const rh = sheet ? sheet.rh : 42;
  const fields = sheet ? sheet.fields : unitRenderFields(null);
  const container = new PIXI.Container();
  const shadow = juiceMakeShadow(juiceShadowUnitLayer, rw * 0.9 * fields.shadow.scale);
  const slowRing = new PIXI.Sprite(juiceFx["slow-ring"].tex);
  slowRing.anchor.set(0.5);
  // one ring, on the ground at the shadow (in the shadow layer, never in the body container), 1.2x the shadow
  slowRing.scale.set((rw * 0.9 * 1.2) / 64, (rw * 0.9 * 0.28 * 1.2) / 24);
  slowRing.visible = false;
  juiceShadowUnitLayer.addChild(slowRing);
  const bubble = new PIXI.Sprite(juiceFx.bubble.tex);
  bubble.anchor.set(0.5);
  bubble.position.set(0, -rh / 2);
  bubble.visible = false;
  const body = new PIXI.Container();
  body.position.set(fields.offset.x, fields.offset.y);
  const sprite = new PIXI.Sprite();
  const flash = new PIXI.Sprite();
  const flashGreen = new PIXI.Sprite();
  flash.visible = false;
  flashGreen.visible = false;
  let fallback = null;
  if (sheet) {
    body.addChild(sprite, flash, flashGreen);
  } else {
    // No sheet for this unit id in the pack: the old coloured dot.
    fallback = new PIXI.Graphics().circle(0, -8, 8).fill(unit.color || "#ffffff");
    body.addChild(fallback);
  }
  // HP bar: the hand-inked frame (hp-bar.png) with a red fill rect inside it (the fill is scaled, never redrawn).
  const hpBar = new PIXI.Container();
  hpBar.position.set(0, -rh - 6);
  hpBar.scale.set(0.6);
  const hpFrame = new PIXI.Sprite(juiceFx["hp-bar"].tex);
  hpFrame.anchor.set(0.5);
  const hpFill = new PIXI.Graphics().rect(0, 0, 43, 3.2).fill(packColourNumber("red"));
  hpFill.position.set(-21.5, -1.6);
  hpBar.addChild(hpFrame, hpFill);
  hpBar.visible = false;
  container.addChild(bubble, body, hpBar);
  pixiState.unitLayer.addChild(container);

  const view = {
    key: `${unit.owner}:${unit.id}`,
    unitId: unit.id,
    owner: unit.owner,
    defId: unit.defId,
    side,
    sheet,
    fields,
    rw,
    rh,
    motion: getUnitMotion(unit.defId),
    flip: unit.owner === "ai" && (unit.defId === "wisp" || unit.defId === "tank"),
    container,
    shadow,
    slowRing,
    bubble,
    body,
    sprite,
    flash,
    flashGreen,
    hpBar,
    hpFill,
    hpT0: null,
    frameIdx: -1,
    unitClock: clock,
    phase: 0,
    lx: null,
    ly: null,
    rollTilt: 0,
    slowDur: 1.2,
    hitT0: null,
    tickT0: null,
    recoilT0: null
  };
  return view;
}

function juiceDestroyView(view) {
  if (view.container.parent) {
    view.container.parent.removeChild(view.container);
  }
  view.container.destroy({ children: true });
  view.shadow.destroy();
  view.slowRing.destroy();
}

function juiceUpdateUnitView(view, unit, dt, clock) {
  const pos = attackerPosition(unit);
  const x = pos.x * LOGICAL_CANVAS_WIDTH;
  const y = pos.y * LOGICAL_CANVAS_HEIGHT;
  if (view.lx === null) {
    view.lx = x;
    view.ly = y;
  }
  const dx = x - view.lx;
  const dy = y - view.ly;
  const moved = Math.hypot(dx, dy);
  view.lx = x;
  view.ly = y;
  const ratio = unit.baseSpeed > 0 ? unit.speed / unit.baseSpeed : 1;
  view.unitClock += dt * ratio;
  view.phase += moved / JUICE_HOP_PX;
  const container = view.container;
  container.position.set(x, y + view.rh / 2);
  container.zIndex = container.y;

  // Frame: a sheet plays at the unit's own rate (it slows with the creep); a still is frame 0.
  const sheet = view.sheet;
  const animated = !!sheet && sheet.frames > 1 && !atwJuice.forceStatic;
  if (sheet) {
    const idx = animated ? Math.floor(view.unitClock * sheet.fps) % sheet.frames : 0;
    if (idx !== view.frameIdx) {
      view.frameIdx = idx;
      juiceFitSprite(view.sprite, sheet.frameTex[idx], view.rw, view.rh, view.flip, view.fields.anchor);
      juiceFitSprite(view.flash, sheet.white[idx], view.rw, view.rh, view.flip, view.fields.anchor);
      juiceFitSprite(view.flashGreen, sheet.green[idx], view.rw, view.rh, view.flip, view.fields.anchor);
    }
  }

  // Locomotion.
  let by = 0;
  let rot = 0;
  let sx = 1;
  let sy = 1;
  const lean = unit.owner === "ai" ? -1 : 1;
  if (view.motion === "roll") {
    if (dt > 0) {
      view.rollTilt = clamp((dx / dt) * 0.003, -0.06, 0.06);
    }
    rot = view.rollTilt;
    if (!animated && moved > 0) {
      by = -(0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * 6)); // a 1 px bob at 6 Hz
    }
  } else if (!animated) {
    if (view.motion === "float") {
      by = Math.sin(clock * 2.2 + unit.id) * 4;
      rot = Math.sin(clock * 1.7 + unit.id) * 0.06;
    } else {
      const p = view.phase;
      by = -Math.abs(Math.sin(p * Math.PI)) * 0.13 * view.rh;
      rot = Math.sin(p * Math.PI * 2) * 0.08 * lean;
      const f = p - Math.floor(p);
      if (p > 0) {
        if (f < 0.35) {
          const k = 1 - f / 0.35; // landing squash over the first 35% of each hop
          sx = 1 + 0.12 * k;
          sy = 1 - 0.12 * k;
        }
        const apex = Math.max(0, 1 - Math.abs(f - 0.5) / 0.15); // stretch at the top
        sx *= 1 - 0.05 * apex;
        sy *= 1 + 0.05 * apex;
      }
    }
  }

  // Hit squash (elastic, one overshoot), then the white copy fading out.
  let flashAlpha = 0;
  if (view.hitT0 !== null) {
    const u = (clock - view.hitT0) / 0.22;
    if (u >= 1 || u < 0) {
      view.hitT0 = null;
    } else {
      const f = juiceElastic(u);
      sx *= 1 + 0.25 * f;
      sy *= 1 - 0.2 * f;
      flashAlpha = 0.85 * Math.max(0, 1 - (clock - view.hitT0) / 0.12);
    }
  }
  if (view.recoilT0 !== null) {
    const u = (clock - view.recoilT0) / 0.15;
    if (u >= 1 || u < 0) {
      view.recoilT0 = null;
    } else {
      sy *= 0.9 + 0.1 * juiceEaseOut(u);
    }
  }
  view.body.position.y = view.fields.offset.y + by;
  view.body.rotation = rot;
  view.body.scale.set(sx, sy);
  if (sheet) {
    view.flash.visible = flashAlpha > 0;
    view.flash.alpha = flashAlpha;
  }

  // Poison: the bubble around the body, and the green copy that fades until the next tick.
  if (unit.poisonTimer > 0) {
    view.bubble.visible = true;
    view.bubble.rotation += 0.8 * dt;
    // The ring is 83.2 px of the 96 px sprite: it hugs one creep at 1.3x its render width. A poison tick
    // pulses it 10% over 150 ms.
    let pulse = 1 + 0.03 * Math.sin(clock * 5);
    if (view.tickT0 !== null && clock - view.tickT0 < 0.15 && clock >= view.tickT0) {
      pulse += 0.1 * Math.sin((Math.PI * (clock - view.tickT0)) / 0.15);
    }
    view.bubble.scale.set(((1.3 * view.rw) / 83.2) * pulse);
    view.bubble.alpha = 1;
  } else {
    view.bubble.visible = false;
  }
  let greenAlpha = 0;
  if (view.tickT0 !== null) {
    const age = clock - view.tickT0;
    if (age >= 0.9 || age < 0) {
      view.tickT0 = null;
    } else {
      greenAlpha = 0.8 * (1 - age / 0.9);
    }
  }
  if (sheet) {
    view.flashGreen.visible = greenAlpha > 0;
    view.flashGreen.alpha = greenAlpha;
  }

  // Shadow (on the ground: never follows the hop), and the slow ring around it.
  const shadowFields = view.fields.shadow;
  view.shadow.position.set(x + shadowFields.x, y + view.rh * 0.35 + shadowFields.y); // the foot line of the art (sheets keep padding under the feet)
  if (unit.slowTimer > 0) {
    view.slowRing.visible = true;
    view.slowRing.position.set(x + shadowFields.x, y + view.rh * 0.35 + shadowFields.y);
    view.slowRing.alpha = 0.55 + 0.45 * Math.abs(Math.sin(clock * Math.PI * 4)); // 0.55-1, never grey
  } else {
    view.slowRing.visible = false;
  }

  // HP bar: appears with the first damage, never hides again.
  if (unit.hp < unit.maxHp) {
    if (view.hpT0 === null) {
      view.hpT0 = clock;
    }
    view.hpBar.visible = true;
    view.hpBar.alpha = Math.min(1, Math.max(0, (clock - view.hpT0) / 0.2));
    view.hpFill.scale.x = clamp(unit.hp / unit.maxHp, 0, 1);
  }
}

// -------------------------------------------------------------------------------------------------
// Tower views
// -------------------------------------------------------------------------------------------------

const TOWER_FOOT_DROP = 8; // the foot sits on the diamond's lower half, not 39 px below its centre

function juiceTowerLevelScale(tower) {
  return Math.max(1, Number(tower.level) || 1) > 1 ? 1.16 : 1;
}

function juiceTowerBase(owner, slot, ls) {
  const pos = (owner === "player" ? towerPosPlayer : towerPosAI)[slot];
  const yOffset = owner === "player" ? -6 : 0;
  return {
    x: pos.x * LOGICAL_CANVAS_WIDTH,
    y: pos.y * LOGICAL_CANVAS_HEIGHT + yOffset,
    yNorm: (pos.y * LOGICAL_CANVAS_HEIGHT + yOffset) / LOGICAL_CANVAS_HEIGHT,
    baseY: pos.y * LOGICAL_CANVAS_HEIGHT + TOWER_FOOT_DROP * ls
  };
}

function juiceCreateTowerView(owner, slot, tower) {
  const side = getOwnerVisualSide(owner);
  const fields = towerRenderFieldSets[side]?.[tower.id] || unitRenderFields(null);
  const container = new PIXI.Container();
  const shadow = juiceMakeShadow(juiceShadowTowerLayer, TOWER_RENDER_BOX_WIDTH * 0.9 * fields.shadow.scale);
  const body = new PIXI.Container();
  const sprite = new PIXI.Sprite();
  body.addChild(sprite);
  container.addChild(body);
  pixiState.towerLayer.addChild(container);
  const view = {
    key: `${owner}:${slot}`,
    owner,
    slot,
    side,
    id: tower.id,
    fields,
    level: Math.max(1, Number(tower.level) || 1),
    container,
    shadow,
    body,
    sprite,
    curTex: null,
    placeT0: null,
    fireT0: null,
    lvlT0: null
  };
  juiceRefitTower(view);
  return view;
}

function juiceTowerStaticTexture(view) {
  const set = pixiState.towerTextureSets[view.side] || pixiState.towerTextures;
  return set[view.id] || null;
}

function juiceRefitTower(view) {
  const ls = view.level > 1 ? 1.16 : 1;
  const base = juiceTowerBase(view.owner, view.slot, ls);
  view.container.position.set(base.x, base.baseY);
  view.shadow.position.set(base.x + view.fields.shadow.x, base.baseY - 2 + view.fields.shadow.y);
  const sw = TOWER_RENDER_BOX_WIDTH * 0.9 * ls * view.fields.shadow.scale;
  view.shadow.scale.set(sw / 64, (sw * 0.28) / 24);
  view.body.position.set(view.fields.offset.x, view.fields.offset.y);
  view.ls = ls;
  view.curTex = null; // forces the sprite to refit
}

function juiceSetTowerTexture(view, texture) {
  if (!texture || view.curTex === texture) {
    return;
  }
  view.curTex = texture;
  const scale = view.fields.scale;
  juiceFitSprite(view.sprite, texture, TOWER_RENDER_BOX_WIDTH * view.ls * scale, TOWER_RENDER_BOX_HEIGHT * view.ls * scale, false, view.fields.anchor);
}

function juiceDestroyTower(view) {
  if (view.container.parent) {
    view.container.parent.removeChild(view.container);
  }
  view.container.destroy({ children: true });
  view.shadow.destroy();
}

// Per-frame tower look: the sheet frame while a fire animation is live, else the still; the pose tweens
// (drop and landing, fire anticipation and recoil, level-up pop) from the clock.
function updatePixiTowers() {
  if (!pixiState.ready || juiceTowerViews.size === 0) {
    return;
  }
  const clock = state.animationClock;
  for (const view of juiceTowerViews.values()) {
    let texture = juiceTowerStaticTexture(view);
    if (!atwJuice.forceStatic) {
      const anim = state.towerFireAnimations.find((a) => a.key === view.key);
      const fire = anim ? juiceTowerFire(view.side, view.id) : null;
      if (anim && fire) {
        const progress = clamp(1 - anim.life / anim.maxLife, 0, 0.999);
        texture = fire.frames[Math.min(fire.frames.length - 1, Math.floor(progress * fire.frames.length))];
      }
    }
    juiceSetTowerTexture(view, texture);

    let sx = 1;
    let sy = 1;
    let by = 0;
    if (view.placeT0 !== null) {
      const t = clock - view.placeT0;
      if (t < 0 || t >= 0.6) {
        view.placeT0 = null;
      } else if (t < 0.3) {
        by = -40 * (1 - juiceEaseOut(t / 0.3));
      } else {
        if (!view.dusted) {
          // the dust fires AT touchdown, not while the tower is in the air
          view.dusted = true;
          const base = juiceTowerBase(view.owner, view.slot, view.ls);
          juiceFrameFx("dust", base.x, base.baseY + 2, 0.4, { z: JUICE_Z_UNDER, fade: true, anchorY: 0.8, scale: 2 });
        }
        // squash (1.25, 0.75) held 0.08 s, then easing to (1, 1) over 0.22 s
        const g = t < 0.38 ? 1 : 1 - (t - 0.38) / 0.22;
        sx = 1 + 0.25 * g;
        sy = 1 - 0.25 * g;
      }
    }
    if (view.fireT0 !== null) {
      const u = clock - view.fireT0;
      if (u < 0 || u >= 0.24) {
        view.fireT0 = null;
      } else if (u < 0.06) {
        sy *= 1 - 0.07 * (u / 0.06);
      } else {
        const k = juiceEaseOut((u - 0.06) / 0.18);
        sy *= 1.06 - 0.06 * k;
        by -= 3 * (1 - k);
      }
    }
    if (view.lvlT0 !== null) {
      const u = clock - view.lvlT0;
      if (u < 0 || u >= 0.3) {
        view.lvlT0 = null;
      } else {
        const pop = 1 + 0.12 * Math.sin((Math.PI * u) / 0.3);
        sx *= pop;
        sy *= pop;
      }
    }
    view.body.position.y = view.fields.offset.y + by;
    view.body.scale.set(sx, sy);
  }
}

// updatePixiMarkers: unchanged (the pack's marker under every empty slot).
function updatePixiMarkers() {
  if (!pixiState.ready || !pixiState.markerLayer || !pixiState.markerTexture) {
    return;
  }
  const signature = JSON.stringify({
    player: state.playerTowers.map((tower) => (tower ? "1" : "0")),
    ai: state.aiTowers.map((tower) => (tower ? "1" : "0"))
  });
  if (signature === pixiState.lastMarkerSignature) {
    return;
  }
  pixiState.lastMarkerSignature = signature;
  pixiState.markerLayer.removeChildren();

  const drawMarker = (pos) => {
    addFittedSprite(
      pixiState.markerLayer,
      pixiState.markerTexture,
      pos.x * LOGICAL_CANVAS_WIDTH,
      pos.y * LOGICAL_CANVAS_HEIGHT,
      BATTLEFIELD_TOWER_MARKER_SIZE,
      BATTLEFIELD_TOWER_MARKER_SIZE
    );
  };

  for (let i = 0; i < 5; i += 1) {
    if (!state.aiTowers[i]) {
      drawMarker(towerPosAI[i]);
    }
    if (!state.playerTowers[i]) {
      drawMarker(towerPosPlayer[i]);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Projectiles and bursts
// -------------------------------------------------------------------------------------------------

function juiceBulletTexture(towerId) {
  return (juiceFx[`bullet-${towerId}`] || juiceFx["bullet-violet"]).tex;
}

function juiceSyncProjectiles() {
  const live = new Set();
  for (const p of state.projectiles) {
    live.add(p.id);
    let view = juiceProjViews.get(p.id);
    if (!view) {
      const texture = juiceBulletTexture(p.towerId);
      view = { sprite: juiceAcquireSprite(texture), ghosts: [], rot: p.owner === "player" ? -Math.PI / 2 : Math.PI / 2 };
      if (p.towerId === "violet" || p.towerId === "yellow" || p.towerId === "green") {
        for (const scale of [0.65, 0.4]) { // opaque, smaller copies down the trail
          const ghost = juiceAcquireSprite(texture, JUICE_Z_FX - 0.5);
          ghost.scale.set(scale);
          view.ghosts.push(ghost);
        }
      }
      juiceProjViews.set(p.id, view);
    }
    const trail = p.trail;
    const last = trail.length - 1;
    const here = trail[last] || { x: p.x, y: p.y };
    const before = trail[Math.max(0, last - 1)] || { x: p.prevX, y: p.prevY };
    const ddx = (here.x - before.x) * LOGICAL_CANVAS_WIDTH;
    const ddy = (here.y - before.y) * LOGICAL_CANVAS_HEIGHT;
    if (Math.abs(ddx) + Math.abs(ddy) > 1e-6) {
      view.rot = Math.atan2(ddy, ddx);
    }
    view.sprite.position.set(p.x * LOGICAL_CANVAS_WIDTH, p.y * LOGICAL_CANVAS_HEIGHT);
    view.sprite.rotation = view.rot;
    const back = [Math.max(0, last - 2), Math.max(0, last - 4)];
    view.ghosts.forEach((ghost, i) => {
      const t = trail[back[i]] || here;
      ghost.position.set(t.x * LOGICAL_CANVAS_WIDTH, t.y * LOGICAL_CANVAS_HEIGHT);
      ghost.rotation = view.rot;
    });
  }
  for (const [id, view] of juiceProjViews) {
    if (!live.has(id)) {
      juiceReleaseSprite(view.sprite);
      for (const ghost of view.ghosts) {
        juiceReleaseSprite(ghost);
      }
      juiceProjViews.delete(id);
    }
  }
}

function juiceSyncBursts() {
  const bursts = state.fireBursts;
  while (juiceBurstSprites.length < bursts.length) {
    const sprite = juiceAcquireSprite(juiceFx["bullet-red"].tex);
    sprite.scale.set(0.6);
    juiceBurstSprites.push(sprite);
  }
  while (juiceBurstSprites.length > bursts.length) {
    juiceReleaseSprite(juiceBurstSprites.pop());
  }
  for (let i = 0; i < bursts.length; i += 1) {
    const b = bursts[i];
    const sprite = juiceBurstSprites[i];
    sprite.position.set(b.x * LOGICAL_CANVAS_WIDTH, b.y * LOGICAL_CANVAS_HEIGHT);
    sprite.alpha = clamp(b.life / b.maxLife, 0, 1);
    sprite.rotation = Math.atan2(b.vy * LOGICAL_CANVAS_HEIGHT, b.vx * LOGICAL_CANVAS_WIDTH);
  }
}

// -------------------------------------------------------------------------------------------------
// The round banner (stateless: drawn from state / the clock each frame; it turns into the Battle N card)
// -------------------------------------------------------------------------------------------------

function juiceMakeCard(width, height, titleSize, subText) {
  const card = new PIXI.Container();
  card.zIndex = JUICE_Z_BANNER;
  card.visible = false;
  card.position.set(LOGICAL_CANVAS_WIDTH / 2, PACK_HUD.midY);
  const panel = jonNineSlice("panel", undefined, width, height);
  panel.position.set(-width / 2, -height / 2); // a NineSliceSprite has no anchor
  const title = jonText("", { font: "head", size: titleSize });
  title.anchor.set(0.5);
  title.position.set(0, subText ? -10 : 0);
  card.addChild(panel, title);
  let sub = null;
  if (subText) {
    sub = jonText(subText, { font: "head", size: 16, fill: packColourCss("muted") });
    sub.anchor.set(0.5);
    sub.position.set(0, 22); // under the title
    card.addChild(sub);
  }
  pixiState.fxLayer.addChild(card);
  return { card, title, sub };
}

function juiceEnsureBanner() {
  if (juiceBanner && juiceBanner.layer === pixiState.fxLayer) {
    return;
  }
  juiceBanner = {
    layer: pixiState.fxLayer,
    round: juiceMakeCard(200, 104, 32, "Prepare yourself")
  };
}

// One Round card. It fades in over the banner phase and stays through prep. When the battle starts (juiceBattleT0) the same
// card becomes "Battle N": a short bounce, a hold, then a fade upward until BATTLE_START_SECONDS (0.5 s at today's 0.85), when the creeps appear. Without a battle start (multiplayer waiting)
// it fades upward for 0.25 s from juiceRoundOutT0. Hidden while a card's detail panel is open (same spot).
function juiceUpdateBanner(clock) {
  const round = juiceBanner.round;
  let shown = false;
  let alpha = 1;
  let lift = 0;
  let scale = 1;
  if (state.screen === "game" && !state.gameOver) {
    if (state.phase === "banner" || state.phase === "prep") {
      shown = true;
      juiceBattleT0 = null;
      round.sub.visible = true;
      round.title.position.y = -10;
      if (round.title.text !== state.roundBannerText) {
        round.title.text = state.roundBannerText;
      }
      if (state.phase === "banner") {
        juiceRoundOutT0 = null;
        // An old save can carry a banner timer above ROUND_BANNER_SECONDS: never negative time.
        const elapsed = Math.max(0, ROUND_BANNER_SECONDS - state.roundBannerTimer);
        alpha = clamp(elapsed / 0.25, 0, 1);
        lift = -60 * (1 - juiceEaseOut(elapsed / 0.25));
      }
    } else if (juiceBattleT0 !== null) {
      const t = clock - juiceBattleT0;
      if (t < 0 || t >= BATTLE_START_SECONDS) {
        juiceBattleT0 = null;
      } else {
        shown = true;
        const text = `Battle ${state.waveNumber}`;
        if (round.title.text !== text) {
          round.title.text = text;
        }
        round.sub.visible = false;
        round.title.position.y = 0;
        if (t < 0.2) {
          scale = 1 + 0.12 * Math.sin(Math.PI * (t / 0.2));
        } else if (t >= 0.35) {
          const p = (t - 0.35) / (BATTLE_START_SECONDS - 0.35);
          alpha = 1 - p;
          lift = -40 * juiceEaseOut(p);
        }
      }
    } else if (juiceRoundOutT0 !== null) {
      const t = clock - juiceRoundOutT0;
      if (t >= 0 && t < 0.25) {
        shown = true;
        alpha = 1 - t / 0.25;
        lift = -30 * (t / 0.25);
      }
    }
  }
  if (shown) {
    round.card.alpha = alpha;
    round.card.scale.set(scale);
    round.card.position.y = PACK_HUD.midY + lift;
  }
  round.card.visible = shown && alpha > 0 && !state.cardDetailId;
}

// -------------------------------------------------------------------------------------------------
// Effects for the events
// -------------------------------------------------------------------------------------------------

function juiceUnitCentre(key) {
  const c = juiceFrame && (juiceFrame.cur.units.get(key) || juiceFrame.prev.units.get(key));
  return c || null;
}

function runJuiceEffect(type, data) {
  if (!pixiState.ready || !pixiState.fxLayer || !juiceFx.puff) {
    return;
  }
  const clock = juiceClock;
  if (type === "battle-start") {
    juiceBattleT0 = clock;
    juiceRoundOutT0 = null; // the merged Round card takes over: no separate fade-out
  } else if (type === "place") {
    const view = juiceTowerViews.get(data.key);
    if (view) {
      view.placeT0 = clock;
      view.dusted = false;
    }
  } else if (type === "level-up") {
    const view = juiceTowerViews.get(data.key);
    if (view) {
      view.lvlT0 = clock;
      const base = juiceTowerBase(view.owner, view.slot, view.ls);
      juiceFrameFx("dust", base.x - 18, base.baseY + 2, 0.4, { z: JUICE_Z_UNDER, fade: true, anchorY: 0.8, scale: 1.1, flip: true });
      juiceFrameFx("dust", base.x + 18, base.baseY + 2, 0.4, { z: JUICE_Z_UNDER, fade: true, anchorY: 0.8, scale: 1.1 });
      // Its own mark: an ink star pops above the tower (0.4 -> 1.2 -> 1) and fades out.
      const star = juiceAcquireSprite(juiceFx.star.tex, JUICE_Z_KILL);
      const sx = base.x;
      const sy = base.baseY - TOWER_RENDER_BOX_HEIGHT * view.ls - 6;
      star.position.set(sx, sy);
      star.scale.set(0.4);
      juiceAddEffect({
        dur: 0.5,
        sprite: star,
        sx,
        sy,
        update(e, u) {
          e.sprite.scale.set(u < 0.3 ? 0.4 + 0.8 * (u / 0.3) : 1.2 - 0.2 * ((u - 0.3) / 0.7));
          e.sprite.position.set(e.sx, e.sy - 8 * u);
          e.sprite.alpha = juiceFade(u);
        },
        done(e) {
          juiceReleaseSprite(e.sprite);
        }
      });
    }
    juiceStartShake(3);
  } else if (type.startsWith("fire-")) {
    const view = juiceTowerViews.get(data.key);
    if (view) {
      view.fireT0 = clock;
      const base = juiceTowerBase(view.owner, view.slot, view.ls);
      let ux = 0;
      let uy = view.owner === "player" ? -1 : 1;
      const target = data.targetKey ? juiceUnitCentre(data.targetKey) : null;
      if (target) {
        const len = Math.hypot(target.x - base.x, target.y - base.y) || 1;
        ux = (target.x - base.x) / len;
        uy = (target.y - base.y) / len;
      }
      // The puff sits at the tower's edge toward the first target, turned along the shot.
      juiceFrameFx("puff", base.x + ux * 26, base.y - 8 + uy * 26, 0.2, { z: JUICE_Z_FX, fade: true, rotation: Math.atan2(uy, ux) });
    }
  } else if (type === "tank-shot") {
    const view = data.unitKey ? juiceUnitViews.get(data.unitKey) : null;
    if (view) {
      view.recoilT0 = clock;
    }
    let tx = 0;
    let ty = data.owner === "player" ? -1 : 1;
    const aim = data.targetKey ? juiceUnitCentre(data.targetKey) : null;
    if (aim) {
      const len = Math.hypot(aim.x - data.x, aim.y - data.y) || 1;
      tx = (aim.x - data.x) / len;
      ty = (aim.y - data.y) / len;
    }
    juiceFrameFx("puff", data.x + tx * 18, data.y - 8 + ty * 18, 0.25, { scale: 1.1, fade: true, rotation: Math.atan2(ty, tx) });
  } else if (type === "hit") {
    juiceFrameFx("spark", data.x, data.y, 0.18, { scale: 1.4 });
    const view = data.targetKey ? juiceUnitViews.get(data.targetKey) : null;
    if (view) {
      view.hitT0 = clock;
    }
  } else if (type === "splash") {
    const ring = new PIXI.Graphics();
    ring.zIndex = JUICE_Z_FX;
    pixiState.fxLayer.addChild(ring);
    juiceAddEffect({
      dur: 0.3,
      ring,
      seed: juiceRandom() * 6,
      x: data.x,
      y: data.y,
      update(e, u) {
        juiceDrawRing(e.ring, e.x, e.y, 10 + 32 * juiceEaseOut(u), u, e.seed);
      },
      done(e) {
        e.ring.destroy();
      }
    });
    const turn = juiceRandom() * Math.PI;
    for (let i = 0; i < 6; i += 1) {
      const a = turn + (Math.PI * 2 * i) / 6;
      juiceFrameFx("spark", data.x + Math.cos(a) * 18, data.y + Math.sin(a) * 18, 0.18, { rotation: a });
    }
  } else if (type === "leap") {
    const g = new PIXI.Graphics();
    g.zIndex = JUICE_Z_FX;
    pixiState.fxLayer.addChild(g);
    juiceAddEffect({
      dur: Math.max(0.05, data.life || 0.12),
      g,
      sparked: false,
      fromX: data.fromX,
      fromY: data.fromY,
      toX: data.x,
      toY: data.y,
      update(e, u) {
        // the polyline grows from the source toward the target (the tip advances linearly); the midpoint
        // jitter is recomputed every frame from the clock
        const jitter = Math.sin(juiceClock * 80 + e.fromX * 0.04) * 4;
        const mx = (e.fromX + e.toX) / 2 + jitter;
        const my = (e.fromY + e.toY) / 2 - jitter;
        const l1 = Math.hypot(mx - e.fromX, my - e.fromY);
        const l2 = Math.hypot(e.toX - mx, e.toY - my);
        let reach = Math.min(1, u / 0.8) * (l1 + l2);
        const pts = [[e.fromX, e.fromY]];
        if (reach <= l1) {
          const f = l1 > 0 ? reach / l1 : 1;
          pts.push([e.fromX + (mx - e.fromX) * f, e.fromY + (my - e.fromY) * f]);
        } else {
          reach -= l1;
          const f = l2 > 0 ? reach / l2 : 1;
          pts.push([mx, my], [mx + (e.toX - mx) * f, my + (e.toY - my) * f]);
        }
        const alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
        e.g.clear();
        for (const [width, color] of [[5, packColourNumber("ink")], [3, packColourNumber("gold")]]) {
          e.g.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < pts.length; k += 1) {
            e.g.lineTo(pts[k][0], pts[k][1]);
          }
          e.g.stroke({ width, color, alpha, cap: "round", join: "round" });
        }
        if (u >= 0.8 && !e.sparked) {
          e.sparked = true;
          juiceFrameFx("spark", e.toX, e.toY, 0.18, { fade: true });
        }
      },
      done(e) {
        e.g.destroy();
      }
    });
  } else if (type === "poison-tick") {
    const view = data.unitKey ? juiceUnitViews.get(data.unitKey) : null;
    if (view) {
      view.tickT0 = clock; // the green fill flash and the bubble's 10% pulse run from the clock
    }
  } else if (type === "death") {
    juiceDeathEffect(data);
  } else if (type === "score") {
    const flash = juiceAcquireSprite(juiceFx["goal-flash"].tex, JUICE_Z_FX);
    flash.position.set(data.x, data.y);
    juiceAddEffect({
      dur: 0.35,
      sprite: flash,
      update(e, u) {
        e.sprite.scale.set((0.6 + 0.8 * Math.min(1, u / 0.6)) * juiceShrink(u));
        e.sprite.alpha = juiceFade(u);
      },
      done(e) {
        juiceReleaseSprite(e.sprite);
      }
    });
    juiceStartShake(4);
  }
}

function juiceDeathEffect(data) {
  const view = data.unitKey ? juiceUnitViews.get(data.unitKey) : null;
  juiceUnitViews.delete(data.unitKey);
  juiceFrameFx("puff", data.x, data.y + 8, 0.25, { z: JUICE_Z_UNDER, scale: 1.8, fade: true });
  // An inked star burst behind the death (the kill sheet's white poof has no outline of its own).
  const burst = juiceAcquireSprite(juiceFx.star.tex, JUICE_Z_UNDER + 0.5);
  burst.position.set(data.x, data.y);
  juiceAddEffect({
    dur: 0.3,
    sprite: burst,
    update(e, u) {
      e.sprite.scale.set((1 + 1.6 * juiceEaseOut(u)) * juiceShrink(u));
      e.sprite.rotation = 0.6 * u;
      e.sprite.alpha = juiceFade(u);
    },
    done(e) {
      juiceReleaseSprite(e.sprite);
    }
  });
  if (juiceKill) {
    const cfg = juiceKill.cfg;
    const sprite = juiceAcquireSprite(juiceKill.frames[0], JUICE_Z_KILL);
    sprite.position.set(data.x, data.y);
    sprite.scale.set((cfg.renderWidth || juiceKill.frameWidth) / juiceKill.frameWidth, (cfg.renderHeight || juiceKill.frameHeight) / juiceKill.frameHeight);
    juiceAddEffect({
      dur: (cfg.frames || 1) / Math.max(1, cfg.fps || 12),
      sprite,
      frames: juiceKill.frames,
      update(e, u) {
        e.sprite.texture = e.frames[Math.min(e.frames.length - 1, Math.floor(u * e.frames.length))];
      },
      done(e) {
        juiceReleaseSprite(e.sprite);
      }
    });
    if (view) {
      juiceDestroyView(view);
    }
    return;
  }
  // No kill sheet: the body squashes flat while paper shards fly out.
  if (view) {
    view.hpBar.visible = false;
    view.bubble.visible = false;
    view.slowRing.visible = false;
    view.container.zIndex = JUICE_Z_DYING;
    pixiState.fxLayer.addChild(view.container);
    juiceAddEffect({
      dur: 0.12,
      view,
      update(e, u) {
        e.view.body.scale.set(1 + 0.35 * u, Math.max(0.02, 1 - u));
        e.view.body.rotation = 0;
      },
      done(e) {
        juiceDestroyView(e.view);
      }
    });
  }
  const shards = juiceFx.shard.frames;
  for (let i = 0; i < 6; i += 1) {
    const a = juiceRandom() * Math.PI * 2;
    const dist = 30 + juiceRandom() * 20;
    const sprite = juiceAcquireSprite(shards[i % shards.length], JUICE_Z_FX);
    sprite.position.set(data.x, data.y);
    sprite.scale.set(1.3);
    const spin = (juiceRandom() - 0.5) * 8;
    juiceAddEffect({
      dur: 0.5,
      sprite,
      x: data.x,
      y: data.y,
      a,
      dist,
      spin,
      update(e, u) {
        const k = juiceEaseOut(u);
        e.sprite.position.set(e.x + Math.cos(e.a) * e.dist * k, e.y + Math.sin(e.a) * e.dist * k);
        e.sprite.rotation = e.spin * u;
        e.sprite.alpha = juiceFade(u);
      },
      done(e) {
        juiceReleaseSprite(e.sprite);
      }
    });
  }
}

// -------------------------------------------------------------------------------------------------
// Snapshots, catch-up and the per-frame reconcile
// -------------------------------------------------------------------------------------------------

function juiceSnapshot(clock) {
  const units = new Map();
  const laneHidden = state.phase === "battle" && state.battleStartTimer > 0; // the lane is empty until the Battle card is gone
  for (const owner of laneHidden ? [] : ["player", "ai"]) {
    const list = owner === "player" ? state.attackersPlayer : state.attackersAI;
    for (const unit of list) {
      const pos = attackerPosition(unit);
      units.set(`${owner}:${unit.id}`, {
        unit,
        owner,
        id: unit.id,
        defId: unit.defId,
        nx: pos.x,
        ny: pos.y,
        x: pos.x * LOGICAL_CANVAS_WIDTH,
        y: pos.y * LOGICAL_CANVAS_HEIGHT,
        hp: unit.hp,
        progress: unit.progress,
        slow: unit.slowTimer,
        poison: unit.poisonTimer,
        ticks: unit.poisonTicksRemaining || 0
      });
    }
  }
  const proj = new Map();
  for (const p of state.projectiles) {
    proj.set(p.id, { x: p.x, y: p.y, speed: p.speed, towerId: p.towerId, owner: p.owner, targetKey: `${p.targetOwner}:${p.targetId}` });
  }
  return {
    clock,
    layer: pixiState.unitLayer,
    phase: state.phase,
    playerScore: state.playerScore,
    aiScore: state.aiScore,
    units,
    proj,
    bursts: new Set(state.fireBursts.map((b) => b.groupId)),
    leaps: new Set(state.yellowLeaps)
  };
}

function juiceDestroyAll() {
  for (const effect of juiceEffects) {
    effect.done(effect);
  }
  juiceEffects.length = 0;
  for (const view of juiceUnitViews.values()) {
    juiceDestroyView(view);
  }
  juiceUnitViews.clear();
  for (const view of juiceTowerViews.values()) {
    juiceDestroyTower(view);
  }
  juiceTowerViews.clear();
  for (const view of juiceProjViews.values()) {
    juiceReleaseSprite(view.sprite);
    for (const ghost of view.ghosts) {
      juiceReleaseSprite(ghost);
    }
  }
  juiceProjViews.clear();
  while (juiceBurstSprites.length) {
    juiceReleaseSprite(juiceBurstSprites.pop());
  }
  while (juicePool.length) {
    juicePool.pop().destroy();
  }
  if (juiceBanner) {
    juiceBanner.round.card.destroy({ children: true });
    juiceBanner = null;
  }
  if (juiceShadowUnitLayer) {
    juiceShadowUnitLayer.destroy({ children: true });
    juiceShadowUnitLayer = null;
  }
  if (juiceShadowTowerLayer) {
    juiceShadowTowerLayer.destroy({ children: true });
    juiceShadowTowerLayer = null;
  }
  juiceBattleT0 = null;
  juiceRoundOutT0 = null;
  juiceShake.t0 = -10;
}

// Silent catch-up: every view rebuilt at its rest pose, nothing emitted.
function juiceRebuild(clock) {
  juiceDestroyAll();
  juiceClock = clock;
  pixiState.unitLayer.sortableChildren = true;
  pixiState.fxLayer.sortableChildren = true;
  pixiState.app.stage.position.set(0, 0);
  juiceEnsureBanner();
  juiceShadowUnitLayer = new PIXI.Container();
  juiceShadowUnitLayer.zIndex = -1; // under every creep (unitLayer sorts by y)
  pixiState.unitLayer.addChild(juiceShadowUnitLayer);
  juiceShadowTowerLayer = new PIXI.Container();
  pixiState.towerLayer.addChildAt(juiceShadowTowerLayer, 0);
  for (const owner of ["player", "ai"]) {
    const towers = owner === "player" ? state.playerTowers : state.aiTowers;
    for (let slot = 0; slot < towers.length; slot += 1) {
      if (towers[slot]) {
        juiceTowerViews.set(`${owner}:${slot}`, juiceCreateTowerView(owner, slot, towers[slot]));
      }
    }
    const units = owner === "player" ? state.attackersPlayer : state.attackersAI;
    for (const unit of units) {
      const view = juiceCreateUnitView(unit, clock);
      view.hpT0 = clock - 1;
      view.slowDur = Math.max(unit.slowTimer, 0.01);
      juiceUnitViews.set(view.key, view);
      juiceUpdateUnitView(view, unit, 0, clock);
    }
  }
  juiceSyncProjectiles();
  juiceSyncBursts();
  juiceUpdateBanner(clock);
  updatePixiTowers();
  // The legacy canvas texture is no longer redrawn: upload its (cleared) canvas once, so nothing stale shows.
  updatePixiDynamicTexture();
  juiceBook = juiceSnapshot(clock);
  juiceFrame = null;
}

function juiceFindSlot(owner, nx, ny) {
  const positions = owner === "player" ? towerPosPlayer : towerPosAI;
  for (let i = 0; i < positions.length; i += 1) {
    if (Math.hypot(positions[i].x - nx, positions[i].y - ny) <= 0.01) {
      return i;
    }
  }
  return -1;
}

function juiceReconcileTowers() {
  for (const owner of ["player", "ai"]) {
    const towers = owner === "player" ? state.playerTowers : state.aiTowers;
    for (let slot = 0; slot < towers.length; slot += 1) {
      const key = `${owner}:${slot}`;
      const tower = towers[slot];
      const existing = juiceTowerViews.get(key);
      if (!tower) {
        if (existing) {
          juiceDestroyTower(existing);
          juiceTowerViews.delete(key);
        }
        continue;
      }
      const level = Math.max(1, Number(tower.level) || 1);
      if (!existing || existing.id !== tower.id) {
        if (existing) {
          juiceDestroyTower(existing);
        }
        const view = juiceCreateTowerView(owner, slot, tower);
        juiceTowerViews.set(key, view);
        const base = juiceTowerBase(owner, slot, view.ls);
        emitJuice("place", { owner, towerId: tower.id, slot, key, level, x: base.x, y: base.y });
      } else if (level !== existing.level) {
        const rose = level > existing.level;
        existing.level = level;
        juiceRefitTower(existing);
        if (rose) {
          const base = juiceTowerBase(owner, slot, existing.ls);
          emitJuice("level-up", { owner, towerId: tower.id, slot, key, level, x: base.x, y: base.y });
        }
      }
    }
  }
}

function updatePixiUnits() {
  if (!pixiState.ready || !pixiState.app || !pixiState.unitLayer || !pixiState.fxLayer || !juiceFx.bubble) {
    return;
  }
  const stage = pixiState.app.stage;
  if (pixiState.unitLayer.parent !== stage || pixiState.fxLayer.parent !== stage) {
    return; // the scene is being rebuilt
  }
  const clock = state.animationClock;
  const prev = juiceBook;
  if (!prev || prev.layer !== pixiState.unitLayer || clock < prev.clock || clock - prev.clock > JUICE_CATCHUP_SECONDS) {
    juiceRebuild(clock);
    return;
  }
  const dt = clock - prev.clock;
  juiceClock = clock;
  const cur = juiceSnapshot(clock);
  juiceFrame = { cur, prev, clock, dt };
  const hitKeys = new Set();

  // Phase changes.
  if (cur.phase !== prev.phase) {
    if (prev.phase === "prep" && cur.phase !== "banner") {
      juiceRoundOutT0 = clock; // battle, or multiplayer's waiting: the Round card fades out
    }
    if (cur.phase === "battle") {
      emitJuice("battle-start", { x: LOGICAL_CANVAS_WIDTH / 2, y: PACK_HUD.midY });
    } else if (cur.phase === "banner") {
      emitJuice("banner", { x: LOGICAL_CANVAS_WIDTH / 2, y: PACK_HUD.midY, text: state.roundBannerText });
    }
  }

  // Views for units that appeared (spawned at launch).
  for (const [key, c] of cur.units) {
    if (!juiceUnitViews.has(key)) {
      const view = juiceCreateUnitView(c.unit, clock);
      juiceUnitViews.set(key, view);
    }
  }

  // Slots: place and level-up.
  juiceReconcileTowers();

  // New projectiles: fire-<tower>, tank-shot, multi.
  const firedBySlot = new Map();
  for (const p of state.projectiles) {
    if (prev.proj.has(p.id)) {
      continue;
    }
    const origin = p.trail[0] || { x: p.x, y: p.y };
    const targetKey = `${p.targetOwner}:${p.targetId}`;
    if (p.towerId === "tank") {
      let best = null;
      let bestDist = Infinity;
      for (const [key, c] of cur.units) {
        if (c.owner !== p.owner || c.defId !== "tank") {
          continue;
        }
        const d = Math.hypot(c.nx - origin.x, c.ny - origin.y);
        if (d < bestDist) {
          bestDist = d;
          best = key;
        }
      }
      emitJuice("tank-shot", {
        owner: p.owner,
        towerId: "tank",
        unitKey: bestDist <= 0.02 ? best : null,
        targetKey,
        x: origin.x * LOGICAL_CANVAS_WIDTH,
        y: origin.y * LOGICAL_CANVAS_HEIGHT
      });
      continue;
    }
    const slot = juiceFindSlot(p.owner, origin.x, origin.y);
    const view = slot >= 0 ? juiceTowerViews.get(`${p.owner}:${slot}`) : null;
    const base = slot >= 0 ? juiceTowerBase(p.owner, slot, view ? view.ls : 1) : { x: origin.x * LOGICAL_CANVAS_WIDTH, y: origin.y * LOGICAL_CANVAS_HEIGHT };
    emitJuice(`fire-${p.towerId}`, {
      owner: p.owner,
      towerId: p.towerId,
      slot,
      key: slot >= 0 ? `${p.owner}:${slot}` : null,
      targetKey,
      x: base.x,
      y: base.y
    });
    if (slot >= 0) {
      const slotKey = `${p.owner}:${slot}`;
      firedBySlot.set(slotKey, (firedBySlot.get(slotKey) || 0) + 1);
    }
  }
  for (const [slotKey, count] of firedBySlot) {
    if (count >= 2) {
      const [owner, slotText] = slotKey.split(":");
      const base = juiceTowerBase(owner, Number(slotText), 1);
      emitJuice("multi", { owner, towerId: "blue", slot: Number(slotText), key: slotKey, count, x: base.x, y: base.y });
    }
  }

  // Gone projectiles: a hit when the last recorded distance to the target was within reach.
  for (const [id, p] of prev.proj) {
    if (cur.proj.has(id)) {
      continue;
    }
    const target = prev.units.get(p.targetKey);
    if (!target) {
      continue;
    }
    const dist = Math.hypot(target.nx - p.x, target.ny - p.y);
    if (dist <= 0.012 + p.speed * dt) {
      hitKeys.add(p.targetKey);
      emitJuice("hit", {
        owner: p.owner,
        towerId: p.towerId,
        targetKey: p.targetKey,
        x: p.x * LOGICAL_CANVAS_WIDTH,
        y: p.y * LOGICAL_CANVAS_HEIGHT
      });
    }
  }

  // New burst groups (red splash) and new yellow leaps.
  const seenGroups = new Set();
  for (const b of state.fireBursts) {
    if (prev.bursts.has(b.groupId) || seenGroups.has(b.groupId)) {
      continue;
    }
    seenGroups.add(b.groupId);
    emitJuice("splash", { owner: b.sourceOwner, towerId: "red", x: b.x * LOGICAL_CANVAS_WIDTH, y: b.y * LOGICAL_CANVAS_HEIGHT });
  }
  for (const leap of state.yellowLeaps) {
    if (!prev.leaps.has(leap)) {
      emitJuice("leap", {
        owner: null,
        towerId: "yellow",
        life: leap.maxLife,
        fromX: leap.fromX * LOGICAL_CANVAS_WIDTH,
        fromY: leap.fromY * LOGICAL_CANVAS_HEIGHT,
        x: leap.toX * LOGICAL_CANVAS_WIDTH,
        y: leap.toY * LOGICAL_CANVAS_HEIGHT
      });
    }
  }

  // Status onsets and ticks, and damage that no hit explains (poison, shrapnel).
  for (const [key, c] of cur.units) {
    const p = prev.units.get(key);
    if (!p) {
      continue;
    }
    const view = juiceUnitViews.get(key);
    const at = { owner: c.owner, defId: c.defId, unitKey: key, x: c.x, y: c.y };
    if (c.slow > 0 && p.slow <= 0) {
      if (view) {
        view.slowDur = c.slow;
      }
      emitJuice("slow", { ...at, towerId: "yellow" });
    } else if (c.slow > p.slow && view) {
      view.slowDur = c.slow;
    }
    if (c.poison > 0 && p.poison <= 0) {
      emitJuice("poison", { ...at, towerId: "green" });
    }
    if (c.ticks < p.ticks) {
      emitJuice("poison-tick", { ...at, towerId: "green" });
    }
    if (c.hp < p.hp && !hitKeys.has(key)) {
      emitJuice("damage", at);
    }
  }

  // Gone units: the ones that scored (by the score delta, highest progress first) and the ones that died.
  for (const owner of ["player", "ai"]) {
    const gone = [];
    for (const [key, p] of prev.units) {
      if (p.owner === owner && !cur.units.has(key)) {
        gone.push({ key, p });
      }
    }
    if (gone.length === 0) {
      continue;
    }
    const delta = owner === "player" ? cur.playerScore - prev.playerScore : cur.aiScore - prev.aiScore;
    gone.sort((a, b) => b.p.progress - a.p.progress);
    gone.forEach(({ key, p }, i) => {
      const data = { owner, defId: p.defId, unitKey: key, x: p.x, y: p.y };
      if (i < delta) {
        const view = juiceUnitViews.get(key);
        if (view) {
          juiceUnitViews.delete(key);
          juiceDestroyView(view);
        }
        emitJuice("score", { ...data, y: laneEnds[owner].y * LOGICAL_CANVAS_HEIGHT });
      } else {
        emitJuice("death", data);
      }
    });
  }

  // Advance every view and effect from the clock.
  for (const [key, c] of cur.units) {
    const view = juiceUnitViews.get(key);
    if (view) {
      juiceUpdateUnitView(view, c.unit, dt, clock);
    }
  }
  juiceSyncProjectiles();
  juiceSyncBursts();
  juiceTickEffects(clock);
  updatePixiTowers();
  juiceUpdateBanner(clock);
  juiceApplyShake(clock, dt);

  juiceBook = cur;
  juiceFrame = null;
}
