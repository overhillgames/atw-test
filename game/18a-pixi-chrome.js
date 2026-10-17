// Line Tower Wars runtime, part 18a: the battle chrome in the Jon grammar; filled by ltw-battle-2d-juice piece C.
// Classic script sharing the one global scope: load order is index.html's.
// The same ink-drawn tiles the menus use (tools/jon-theme-tiles.py), exported once at 2x so they are
// crisp under the renderer's resolution 2, drawn as nine-slices: the side panels, the wood dock, the
// card frames, the buttons. Nothing here reads or writes `state`.

// Pieces, fonts and colours come from the active battle theme pack (PACK_* in 01-defs.js, set by applyArtPack).
// The JON_* colour constants below are Jon Light's values, kept for 17/18 until they read the live pack colours.
const JON_INK = 0x141414;
const JON_PAPER = 0xf0e0c8;
const JON_PAPER_3 = 0xdcc9a8;
const JON_BLUE = 0x18a0e0;
const JON_MUTED_CSS = "#5a4a3a";
const JON_INK_CSS = "#141414";

// Live pack colours: "ink" -> 0x141414 for Pixi fills, packColourCss("ink") -> "#141414" for text.
function packColourNumber(key) {
  return parseInt(PACK_COLOURS[key].slice(1), 16);
}

function packColourCss(key) {
  return PACK_COLOURS[key];
}

// the family list for a pack font slot ("title" | "head" | "body")
function packFontFamily(slot) {
  return `"${PACK_FONTS[slot].family}", "Trebuchet MS", sans-serif`;
}

// The board-font rule, shared with tools/godot-layout/export.mjs (boardFontFile): the body slot when it has a font
// file, else the head slot. The HUD numbers and the dock card words use it, always at weight 400 (the bundled fonts
// have no bold file and Godot draws them regular), so the game shows the face the Godot board shows.
function packBoardFontSlot() {
  return PACK_FONTS.body && PACK_FONTS.body.file ? "body" : "head";
}

function packBoardFontFamily() {
  return packFontFamily(packBoardFontSlot());
}

// the timer column's bar: inside its own tile, below the Round tile and above the Time tile
// (the pack's layout section is PACK_LAYOUT, the bar's track rect is PACK_HUD.timerFill, the HUD midline is PACK_HUD.midY)
const JON_TIMER_STROKE = 1.5;
function jonLayout() {
  return PACK_LAYOUT;
}
function jonTimerRect() {
  return PACK_HUD.timerFill;
}
function jonDockRect() {
  return PACK_LAYOUT.dock || { x: 0, y: 587, width: 420, height: 173 };
}
// The pack's piece names; the five before the bar pieces are the ones the DOM (jon-battle.css) also draws.
const JON_CSS_TILES = ["panel", "card", "cardSelected", "buttonMain", "buttonSub"];
const JON_BAR_PIECES = ["barInk", "barMask", "barTile"];

// Old tile names still used by 17/18 until they switch to the piece names (a trailing "-2x" is ignored too).
const JON_PIECE_ALIASES = {
  "frame-panel": "panel", "frame-card": "card", "frame-card-selected": "cardSelected",
  "btn-blue": "buttonMain", "btn-paper": "buttonSub",
  "frame-wood-ink": "barInk", "frame-wood-mask": "barMask", "wood-tile": "barTile"
};

function jonPieceName(name) {
  const bare = name.replace(/-2x$/, "");
  return JON_PIECE_ALIASES[bare] || bare;
}

// The active pack's file for a piece, e.g. "assets/packs/jonCarlingLight/ui/panel.png".
function jonPiecePath(name) {
  const piece = PACK_UI_PIECES[jonPieceName(name)];
  if (!piece) throw new Error(`Battle theme piece missing from the pack: ${name}`);
  return `${PACK_UI_ROOT}/${piece.file}`;
}

const jonTextureStore = {};
const jonTexturePromises = new Map();

// Cached Promise<PIXI.Texture> for a pack piece, keyed by its full path so a pack switch loads the new
// files. The pieces are 2x PNGs loaded at resolution PACK_UI_SCALE, so they draw at their logical size.
// The loaded texture is also kept in jonTextureStore[path] for sync reads.
function loadJonTexture(name, resolution = PACK_UI_SCALE) {
  const path = jonPiecePath(name);
  const key = `${path}@${resolution}`;
  if (!jonTexturePromises.has(key)) {
    jonTexturePromises.set(key, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const texture = new PIXI.Texture({ source: new PIXI.ImageSource({ resource: img, resolution }) });
          jonTextureStore[path] = texture;
          resolve(texture);
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error(`Unable to load battle theme piece: ${path}`));
      img.src = path;
    }));
  }
  return jonTexturePromises.get(key);
}

function getJonTexture(name) {
  return jonTextureStore[jonPiecePath(name)] || PIXI.Texture.EMPTY;
}

// The pieces that jon-battle.css draws through border-image (Ready, Pause, the match-end card and
// buttons) load on first display; warming them here keeps a first match-end or first Ready from
// rendering frameless.
function warmJonCssTile(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = jonPiecePath(name);
  });
}

async function preloadJonChrome() {
  const pieces = PACK_CHROME_MODE === "nineSlice" ? [...JON_CSS_TILES, ...JON_BAR_PIECES] : JON_CSS_TILES;
  await Promise.all([
    ...pieces.map((piece) => loadJonTexture(piece)),
    ...JON_CSS_TILES.map(warmJonCssTile)
  ]);
}

// name is a pack piece ("panel"; the old "frame-panel" names still resolve). slice is in logical px and
// defaults to the piece's inset from the pack manifest.
function jonNineSlice(name, slice, width, height) {
  const inset = slice === undefined ? PACK_UI_PIECES[jonPieceName(name)].inset : slice;
  const node = new PIXI.NineSliceSprite({
    texture: getJonTexture(name),
    leftWidth: inset,
    topHeight: inset,
    rightWidth: inset,
    bottomHeight: inset
  });
  node.width = width;
  node.height = height;
  return node;
}

// The wood recipe from jon-chrome.css: one wood strip covers the bar, a mask clips it to the drawn
// outline, the ink-only nine-slice draws the line on top. This Pixi build alpha-masks only with a
// Sprite (a NineSliceSprite mask becomes a stencil rectangle), so the mask nine-slice is rendered once
// to a texture and applied as a Sprite.
function jonWoodBar(width, height) {
  const bar = new PIXI.Container();
  const wood = new PIXI.Sprite(getJonTexture("barTile"));
  const cover = Math.max(width / wood.texture.width, height / wood.texture.height);
  wood.scale.set(cover);
  wood.x = (width - wood.texture.width * cover) / 2;
  wood.y = (height - wood.texture.height * cover) / 2;
  const maskSource = jonNineSlice("barMask", undefined, width, height);
  const maskTexture = pixiState.app.renderer.generateTexture({ target: maskSource, resolution: 2 });
  maskSource.destroy();
  const mask = new PIXI.Sprite(maskTexture);
  wood.mask = mask;
  bar.addChild(wood, mask);
  bar.addChild(jonNineSlice("barInk", undefined, width, height));
  return bar;
}

// font: the pack's "title" (numbers, titles), "head" (labels, buttons) or "body" (bold sans body lines) face
function jonText(text, options = {}) {
  const { font = "head", size = 14, fill = packColourCss("ink"), ...rest } = options;
  return pixiText(text, {
    fontFamily: packFontFamily(font === "title" ? "title" : font === "body" ? "body" : "head"),
    fontSize: size,
    fontWeight: font === "body" ? "700" : "400",
    fill,
    ...rest
  });
}

// ---- Board text: the HUD numbers and the dock card words, drawn the way the Godot board (tools/godot-layout) draws
// its Labels, so what Baz styles there is what the game shows (proof: tools/godot-layout/text-match.mjs). A style spec
// is pack.json's hud.text.<key> / layout.cards.<kind>.role|cost: { size, color, outline: { width, color } }, size and
// outline width in game px, colours #rrggbb, outline width 0 = none.

// Godot paints an outline as a ring outline_size / 4 px wide outside the glyphs (its FreeType stroker radius), with the
// fill on top. A Pixi stroke is centred on the glyph edge and painted under the fill, so the same ring takes a stroke
// twice the ring: outline width x 0.5 (measured against Godot 4.7.2, outline widths 1 to 10 at 18 and 30 px).
const BOARD_STROKE_PER_OUTLINE = 0.5;

// A board text in the board font at weight 400; place it with placeBoardText.
function boardText(text, spec = {}, fallbackSize = 16) {
  const size = Number.isFinite(spec.size) && spec.size > 0 ? spec.size : fallbackSize;
  const width = Number(spec.outline && spec.outline.width) || 0;
  const style = { fontFamily: packBoardFontFamily(), fontSize: size, fontWeight: "400", fill: spec.color || packColourCss("ink") };
  if (width > 0) {
    style.stroke = { color: spec.outline.color || packColourCss("ink"), width: width * BOARD_STROKE_PER_OUTLINE, join: "round" };
  }
  const node = pixiText(text, style);
  node.anchor.set(0, 0);
  return node;
}

// The Label boxes tools/godot-layout/export.mjs writes, in game px (keep the two in step). A HUD number's box is
// centred on its hud.anchors point and generous, so Godot never grows it around a large size.
function boardHudBox(anchor, size) {
  const width = Math.max(40, size * 4);
  const height = Math.max(24, size * 2);
  return { x: anchor.x - width / 2, y: anchor.y - height / 2, width, height };
}

// A card's role word: the box's bottom-left corner at (x, y). A card's cost: the box's bottom-right corner at (x, y).
function boardRoleBox(x, y, size) {
  return { x, y: y - size * 2, width: size * 6, height: size * 2 };
}

function boardCostBox(x, y, size) {
  return { x: x - size * 3, y: y - size * 2, width: size * 3, height: size * 2 };
}

// A face's ascent and descent per px of font size, from the browser's font metrics at 1000 px (canvas rounds them to
// whole px, so a large size keeps the ratio exact); cached once the face has loaded.
const boardFontRatios = new Map();
let boardMeasureContext = null;

function boardMeasure() {
  if (!boardMeasureContext) {
    boardMeasureContext = document.createElement("canvas").getContext("2d");
  }
  return boardMeasureContext;
}

function boardFontRatio(family) {
  const cached = boardFontRatios.get(family);
  if (cached) {
    return cached;
  }
  const context = boardMeasure();
  context.font = `normal 400 1000px ${family}`;
  const metrics = context.measureText("H");
  let ratio = { ascent: metrics.fontBoundingBoxAscent / 1000, descent: metrics.fontBoundingBoxDescent / 1000 };
  if (!Number.isFinite(ratio.ascent) || !Number.isFinite(ratio.descent)) {
    const font = PIXI.CanvasTextMetrics.measureFont(`normal 400 1000px ${family}`);
    ratio = { ascent: font.ascent / 1000, descent: font.descent / 1000 };
  }
  if (!document.fonts || document.fonts.check(`1000px ${family}`)) {
    boardFontRatios.set(family, ratio);
  }
  return ratio;
}

// Places a board text the way Godot 4 lays out a one-line Label in `box` (game px). The line box is the face's ascent
// + descent, each rounded up to whole Godot units; it sits at the box's top, centre or bottom, and the glyph run starts
// at the box's left edge, centre or right edge. `unit` is Godot units per game px: 1 for the HUD numbers, 2 for the
// labels under a ui2x node (the cards). Godot's whole-unit steps are kept: above 20 units the run is a whole number of
// units wide (no subpixel positioning), and the centre, bottom and right offsets are truncated to whole units.
// The node keeps its position (theme-check asserts the HUD numbers sit on their anchors): the placement is its pivot,
// recomputed whenever its text or font changes (onRender), and its texture lands on whole device pixels.
function placeBoardText(node, box, hAlign = "left", vAlign = "top", unit = 1) {
  node.anchor.set(0, 0);
  node.boardLayout = { box: { ...box }, hAlign, vAlign, unit, key: "" };
  layoutBoardText(node);
  node.onRender = () => layoutBoardText(node);
  return node;
}

function layoutBoardText(node) {
  const layout = node.boardLayout;
  if (!layout) {
    return;
  }
  const style = node.style;
  const stroke = style.stroke && typeof style.stroke === "object" ? Number(style.stroke.width) || 0 : 0;
  const resolution = node.resolution || pixiState.app?.renderer?.resolution || 1;
  const key = [node.text, style.fontFamily, style.fontSize, stroke, resolution, node.x, node.y].join("|");
  if (key === layout.key) {
    return;
  }
  layout.key = key;
  const { box, hAlign, vAlign, unit } = layout;
  const size = style.fontSize * unit; // the Label's font_size in Godot units
  const ratio = boardFontRatio(style.fontFamily);
  const ascent = Math.ceil(size * ratio.ascent - 1e-6);
  const lineHeight = ascent + Math.ceil(size * ratio.descent - 1e-6);
  const context = boardMeasure();
  context.font = `normal 400 ${size}px ${style.fontFamily}`;
  const advance = context.measureText(node.text).width;
  const run = size > 20 ? Math.round(advance) : advance;
  const width = box.width * unit;
  const height = box.height * unit;
  const ox = hAlign === "center" ? Math.trunc(Math.trunc(width - run) / 2) : hAlign === "right" ? Math.trunc(width - run) : 0;
  const oy = vAlign === "center" ? Math.trunc((height - lineHeight) / 2) : vAlign === "bottom" ? Math.trunc(height - lineHeight) : 0;
  const onPixel = (v) => Math.round(v * resolution) / resolution;
  const penX = onPixel(box.x + ox / unit);
  const baseline = onPixel(box.y + (oy + ascent) / unit);
  // Pixi draws the run at (stroke / 2 + padding, stroke / 2 + padding + its measured ascent) inside the text texture,
  // whose top-left sits at -padding; this padding puts that baseline on a whole device pixel
  const half = stroke / 2;
  const pixiAscent = PIXI.CanvasTextMetrics.measureText(node.text || " ", style).fontProperties.ascent;
  const padding = (Math.ceil((half + pixiAscent) * resolution) + 1) / resolution - half - pixiAscent;
  if (Math.abs((style.padding || 0) - padding) > 1e-6) {
    style.padding = padding;
  }
  node.pivot.set(node.x + half - penX, node.y + half + pixiAscent - baseline);
}

// A nine-slice piece ("panel" or "card") at a position, in logical safe px.
function jonPieceAt(name, x, y, width, height) {
  const node = jonNineSlice(name, undefined, width, height);
  node.position.set(x, y);
  return node;
}

// The two HUD columns, the timer bar's tile and the wood dock, in logical safe px (420 x 760); nineSlice mode only.
// Each column is the pack's panel piece holding stacked stat tiles (the pack's card piece); the numbers are
// the HUD texts (buildPixiHudText) at the pack's anchors.
// Built after the artboard and below markerLayer; positioned with the other safe-frame layers.
function buildJonChrome() {
  const layer = new PIXI.Container();
  pixiState.chromeLayer = layer;
  pixiState.statLabels = {};
  if (PACK_CHROME_MODE === "layers") return layer;

  const layout = jonLayout();
  for (const c of layout.columns) {
    layer.addChild(jonPieceAt("panel", c.x, c.y, c.width, c.height));
  }

  // a stat tile (pack layout rect, 44 x 46 today) whose value sits at the HUD anchor (Brian's anchor); the word's centre,
  // size, colour and outline come from pack.json layout.statLabels.<key>, drawn the Godot board's way (a pack without the
  // section gets today's placement: tile centre, 20 below the anchor, 11 px muted)
  const stat = (caption, key) => {
    const r = layout.statTiles[key];
    layer.addChild(jonPieceAt("card", r.x, r.y, r.width, r.height));
    const spec = (layout.statLabels && layout.statLabels[key])
      || { x: r.x + r.width / 2, y: PACK_HUD.anchors[key].y + 20, size: 11, color: packColourCss("muted") };
    const node = boardText(caption, spec, 11);
    node.position.set(spec.x, spec.y);
    placeBoardText(node, boardHudBox(spec, node.style.fontSize), "center", "center", 1);
    layer.addChild(node);
    pixiState.statLabels[key] = node;
  };
  stat("Round", "round");
  stat("Time", "time");
  stat("AI", "ai");
  stat("Mana", "mana");
  stat("You", "you");

  // the timer bar's own tile, between Round and Time, with its track inside
  const tt = layout.timerTile;
  layer.addChild(jonPieceAt("card", tt.x, tt.y, tt.width, tt.height));
  const timerRect = jonTimerRect();
  const track = new PIXI.Graphics()
    .roundRect(timerRect.x, timerRect.y, timerRect.width, timerRect.height, 5)
    .fill(packColourNumber("paper"))
    .stroke({ color: packColourNumber("ink"), width: JON_TIMER_STROKE });
  layer.addChild(track);

  const dockRect = jonDockRect();
  const dock = jonWoodBar(dockRect.width, dockRect.height);
  dock.position.set(dockRect.x, dockRect.y);
  layer.addChild(dock);
  return layer;
}
