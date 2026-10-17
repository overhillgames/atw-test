// Line Tower Wars runtime, part 17 of 20: Pixi renderer sizing, scene build, HUD text, card detail panel.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function resizePixiRendererToLayout() {
  if (!pixiState.app?.renderer || !gameFrameLayout.visibleLogicalWidth || !gameFrameLayout.visibleLogicalHeight) {
    return;
  }
  const width = Math.max(1, Math.round(gameFrameLayout.visibleLogicalWidth));
  const height = Math.max(1, Math.round(gameFrameLayout.visibleLogicalHeight));
  if (pixiState.app.renderer.width !== width || pixiState.app.renderer.height !== height) {
    pixiState.app.renderer.resize(width, height);
  }
  positionPixiScene();
}

function positionPixiScene() {
  if (!pixiState.app) {
    return;
  }
  const safeX = gameFrameLayout.safeOffsetLogicalX || 0;
  const safeY = gameFrameLayout.safeOffsetLogicalY || 0;

  if (pixiState.artboard) {
    pixiState.artboard.x = safeX - SAFE_AREA_OFFSET_X;
    pixiState.artboard.y = safeY - SAFE_AREA_OFFSET_Y;
  }

  if (pixiState.highZLayer) {
    pixiState.highZLayer.x = safeX - SAFE_AREA_OFFSET_X;
    pixiState.highZLayer.y = safeY - SAFE_AREA_OFFSET_Y;
  }

  for (const layer of [pixiState.chromeLayer, pixiState.markerLayer,pixiState.battlefieldLayer, pixiState.unitLayer, pixiState.towerLayer, pixiState.fxLayer, pixiState.dockIconLayer, pixiState.textLayer]) {
    if (layer) {
      layer.x = safeX;
      layer.y = safeY;
    }
  }

  for (const mask of [pixiState.unitMask, pixiState.fxMask]) {
    if (mask) {
      mask
        .clear()
        .rect(
          safeX + BATTLEFIELD_BOUNDS.x,
          safeY + BATTLEFIELD_BOUNDS.y,
          BATTLEFIELD_BOUNDS.width,
          BATTLEFIELD_BOUNDS.height
        )
        .fill(0xffffff);
    }
  }

  if (pixiState.battlefieldMask) {
    pixiState.battlefieldMask
      .clear()
      .rect(
        safeX + BATTLEFIELD_BOUNDS.x,
        safeY + BATTLEFIELD_BOUNDS.y,
        BATTLEFIELD_BOUNDS.width,
        BATTLEFIELD_BOUNDS.height
      )
      .fill(0xffffff);
  }
}

function ensurePixiViewport() {
  if (pixiState.app || !window.PIXI) {
    return;
  }
  const host = document.getElementById("pixi-viewport");
  if (!host) {
    return;
  }

  const app = new PIXI.Application();
  pixiState.app = app;
  app.init({
    width: LOGICAL_CANVAS_WIDTH,
    height: LOGICAL_CANVAS_HEIGHT,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  }).then(async () => {
    host.innerHTML = "";
    host.appendChild(app.canvas);
    try {
      // Pixi text rasterises with whatever face is loaded at draw time, so the two fonts
      // declared in jon-chrome.css must be ready before the scene builds.
      try {
        const fontLoads = [...packFontPromises, document.fonts.load('20px "Caveat Brush"'), document.fonts.load('20px "Patrick Hand"')];
        for (const slot of ["title", "head", "body"]) {
          const family = PACK_FONTS && PACK_FONTS[slot] && PACK_FONTS[slot].family;
          // the body slot is a font file only on a pack that ships one (the board font then, packBoardFontFamily)
          if (family && (slot !== "body" || PACK_FONTS[slot].file)) {
            fontLoads.push(document.fonts.load(`20px "${family}"`));
          }
        }
        await Promise.allSettled(fontLoads);
      } catch {}
      await buildPixiScene();
      pixiState.ready = true;
      updatePixiCardStates(true);
      renderPixiCardDetailPanel();
      document.documentElement.classList.remove("pixi-failed");
    } catch (error) {
      console.error("Unable to build Pixi scene", error);
      document.documentElement.classList.add("pixi-failed");
    }
  }).catch((error) => {
    console.error("Unable to initialize Pixi viewport", error);
  });
}

function pixiText(text, style = {}) {
  const node = new PIXI.Text({
    text,
    style: {
      fontFamily: '"Patrick Hand", "Trebuchet MS", sans-serif',
      fontSize: 14,
      fontWeight: "400",
      fill: "#141414",
      align: "center",
      ...style
    }
  });
  node.anchor.set(0.5);
  return node;
}

function loadImageTexture(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        resolve(PIXI.Texture.from(img));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error(`Unable to load image asset: ${path}`));
    img.src = path;
  });
}

async function buildPixiScene() {
  const { app } = pixiState;
  if (!app) {
    return;
  }

  app.stage.removeChildren();
  // Two chrome modes (PACK_CHROME_MODE). nineSlice: only the bleed, safe-area and battlefield layers (01-03) are
  // drawn; the pack's docks, panels and card frames (04-17) are replaced by the game's own chrome (18a).
  // layers: the pack's painted layers are the chrome, so every layer is drawn except the template-only ones
  // (00_, 11_, 13_, 14_, 15_), which are skipped (the card/timer/HUD pieces are Pixi objects). In both modes the
  // timer fill is a Graphics bar (buildPixiHudText), never a loaded layer.
  // Brian's v3 and Jon's v4 fill the 01 bleed layer white, which would hide the CSS paper behind the canvas on
  // tall phones; those templates skip it (PIXI_PAPER_BLEED). Unfuneral's 01 is painted art and stays.
  const layersMode = PACK_CHROME_MODE === "layers";
  const templateLayerFilter = layersMode
    ? (filename) => !/^(00|11|13|14|15)_/.test(filename) && !(PIXI_PAPER_BLEED && /^01_/.test(filename))
    : (filename) => (PIXI_PAPER_BLEED ? /^0[23]_/ : /^0[123]_/).test(filename);
  const templateLayerNames = PIXI_TEMPLATE_LAYERS.filter(templateLayerFilter);
  const templateTextures = await Promise.all(
    templateLayerNames.map((filename) => loadImageTexture(`${PIXI_LAYER_ASSET_ROOT}/${filename}`))
  );
  const highZTexture = PIXI_HIGH_Z_LAYER ? await loadImageTexture(`${PIXI_LAYER_ASSET_ROOT}/${PIXI_HIGH_Z_LAYER}`) : null;
  const markerTexture = await loadImageTexture(BATTLEFIELD_TOWER_MARKER_PATH);
  const towerTextureSets = { player: {}, ai: {} };
  for (const side of ["player", "ai"]) {
    for (const [towerId, path] of Object.entries(towerSpritePathSets[side] || {})) {
      towerTextureSets[side][towerId] = await loadImageTexture(path);
    }
  }
  const towerFireTextureSets = { player: {}, ai: {} };
  for (const side of ["player", "ai"]) {
    for (const [towerId, cfg] of Object.entries(towerFireSheetConfigSets[side] || {})) {
      towerFireTextureSets[side][towerId] = await loadImageTexture(cfg.path);
    }
  }
  const attackerTextureSets = { player: {}, ai: {} };
  for (const side of ["player", "ai"]) {
    for (const [attackerId, cfg] of Object.entries(attackerSpriteConfigSets[side] || {})) {
      attackerTextureSets[side][attackerId] = cfg ? await loadImageTexture(cfg.path) : null;
    }
  }
  pixiState.towerTextureSets = towerTextureSets;
  pixiState.towerTextures = towerTextureSets.player;
  pixiState.towerFireTextureSets = towerFireTextureSets;
  pixiState.towerFireTextures = towerFireTextureSets.player;
  pixiState.attackerTextureSets = attackerTextureSets;
  pixiState.attackerTextures = attackerTextureSets.player;

  await preloadJonChrome();
  await preloadPixiUnits();

  const artboard = new PIXI.Container();
  pixiState.artboard = artboard;
  app.stage.addChild(artboard);

  for (const [templateIndex, texture] of templateTextures.entries()) {
    const sprite = new PIXI.Sprite(texture);
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = ARTBOARD_WIDTH;
    sprite.height = ARTBOARD_HEIGHT;
    sprite.label = templateLayerNames[templateIndex];
    artboard.addChild(sprite);
  }

  // layers mode keeps an empty container here so the stage indices do not shift
  app.stage.addChild(PACK_CHROME_MODE === "nineSlice" ? buildJonChrome() : new PIXI.Container());

  const markerLayer = new PIXI.Container();
  pixiState.markerLayer = markerLayer;
  pixiState.markerTexture = markerTexture;
  pixiState.lastMarkerSignature = "";
  app.stage.addChild(markerLayer);

  const battlefieldLayer = new PIXI.Container();
  const battlefieldMask = new PIXI.Graphics();
  battlefieldLayer.mask = battlefieldMask;
  pixiState.battlefieldLayer = battlefieldLayer;
  pixiState.battlefieldMask = battlefieldMask;
  app.stage.addChild(battlefieldLayer);
  app.stage.addChild(battlefieldMask);

  pixiState.legacyTexture = PIXI.Texture.from(canvas);
  pixiState.legacySprite = new PIXI.Sprite(pixiState.legacyTexture);
  pixiState.legacySprite.x = 0;
  pixiState.legacySprite.y = 0;
  pixiState.legacySprite.width = LOGICAL_CANVAS_WIDTH;
  pixiState.legacySprite.height = LOGICAL_CANVAS_HEIGHT;
  battlefieldLayer.addChild(pixiState.legacySprite);

  // unitLayer (creeps) sits under the towers, fxLayer (projectiles, effects, banner) above them;
  // both are masked to the battlefield like battlefieldLayer. Filled by 18b.
  pixiState.unitLayer = new PIXI.Container();
  pixiState.unitMask = new PIXI.Graphics();
  pixiState.unitLayer.mask = pixiState.unitMask;
  app.stage.addChild(pixiState.unitLayer, pixiState.unitMask);

  pixiState.towerLayer = new PIXI.Container();
  app.stage.addChild(pixiState.towerLayer);

  pixiState.fxLayer = new PIXI.Container();
  pixiState.fxMask = new PIXI.Graphics();
  pixiState.fxLayer.mask = pixiState.fxMask;
  app.stage.addChild(pixiState.fxLayer, pixiState.fxMask);

  pixiState.highZLayer = new PIXI.Container();
  app.stage.addChild(pixiState.highZLayer);
  if (highZTexture) {
    const highZSprite = new PIXI.Sprite(highZTexture);
    highZSprite.x = 0;
    highZSprite.y = 0;
    highZSprite.width = ARTBOARD_WIDTH;
    highZSprite.height = ARTBOARD_HEIGHT;
    pixiState.highZLayer.addChild(highZSprite);
  }

  pixiState.dockIconLayer = new PIXI.Container();
  app.stage.addChild(pixiState.dockIconLayer);

  pixiState.textLayer = new PIXI.Container();
  app.stage.addChild(pixiState.textLayer);

  buildPixiDockCards();
  buildPixiHudText();
  buildPixiCardDetailPanel();
  resizePixiRendererToLayout();
}

function buildPixiHudText() {
  pixiState.textLayer.removeChildren();
  pixiState.timerFillSprite = null;
  // the fill sits one stroke width inside the pack's timer rect (the track is drawn by 18a in nineSlice mode,
  // by the painted layers in layers mode)
  const timerRect = PACK_HUD.timerFill;
  pixiState.timerFill = new PIXI.Graphics()
    .roundRect(
      timerRect.x + JON_TIMER_STROKE,
      timerRect.y + JON_TIMER_STROKE,
      timerRect.width - JON_TIMER_STROKE * 2,
      timerRect.height - JON_TIMER_STROKE * 2,
      3
    )
    .fill(packColourNumber("accent"));
  // outside prep the track is filled solid with the inset tan instead of standing empty
  pixiState.timerIdleFill = new PIXI.Graphics()
    .roundRect(
      timerRect.x + JON_TIMER_STROKE,
      timerRect.y + JON_TIMER_STROKE,
      timerRect.width - JON_TIMER_STROKE * 2,
      timerRect.height - JON_TIMER_STROKE * 2,
      3
    )
    .fill(packColourNumber("paper3"));
  pixiState.timerIdleFill.visible = false;
  pixiState.textLayer.addChild(pixiState.timerIdleFill);
  pixiState.timerMask = new PIXI.Graphics();
  pixiState.timerFill.mask = pixiState.timerMask;
  pixiState.textLayer.addChild(pixiState.timerFill);
  pixiState.textLayer.addChild(pixiState.timerMask);

  // The five numbers in the board font, sized, coloured and outlined by pack.json hud.text.<key> (fallback: today's 16,
  // 15 for the timer, pack ink, no outline), each centred both ways in its Godot box around its hud.anchors point. The
  // node's position is that point (theme-check asserts it); placeBoardText expresses Godot's placement as the pivot.
  const anchors = PACK_HUD.anchors;
  const hudNumber = (key, text, fallbackSize) => {
    const node = boardText(text, (PACK_HUD.text && PACK_HUD.text[key]) || {}, fallbackSize);
    node.position.set(anchors[key].x, anchors[key].y);
    return placeBoardText(node, boardHudBox(anchors[key], node.style.fontSize), "center", "center", 1);
  };
  pixiState.hudText = {
    round: hudNumber("round", "1", 16),
    timer: hudNumber("time", "15.0", 15),
    aiScore: hudNumber("ai", "0", 16),
    mana: hudNumber("mana", "9", 16),
    playerScore: hudNumber("you", "0", 16)
  };
  pixiState.hudPop = {}; // per-key { value, t0 } for the pop (18-pixi-cards.js updatePixiHudText)

  for (const node of Object.values(pixiState.hudText)) {
    pixiState.textLayer.addChild(node);
  }
}

// The card-detail panel's rect: PACK_LAYOUT.popup { x, width, topY, maxHeight, padding }.
function packPopupRect() {
  return PACK_LAYOUT.popup || { x: 66, width: 288, topY: 170, maxHeight: 260, padding: 20 };
}

function buildPixiCardDetailPanel() {
  const panel = new PIXI.Container();
  panel.eventMode = "none";
  panel.visible = false;
  const popup = packPopupRect();
  const background = jonNineSlice("panel", undefined, popup.width, 120);
  background.position.set(popup.x, popup.topY);
  panel.addChild(background);
  pixiState.cardDetailPanel = panel;
  pixiState.cardDetailBackground = background;
  pixiState.cardDetailTextNodes = [];
  pixiState.textLayer.addChild(panel);
  renderPixiCardDetailPanel();
}

function formatCardStatNumber(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return String(rounded);
}

function buildCardDetailLines(id) {
  if (state.mode === "tug") return tugCardDetailLines(id);
  const copy = UNIT_CARD_COPY[id];
  if (!copy) {
    return null;
  }
  const towerDef = getTowerDef(id);
  const attackerDef = towerDef ? null : getAttackerDef(id);
  const def = towerDef || attackerDef;
  if (!def) {
    return null;
  }
  const lines = [
    { text: `${def.name} · ${copy.role}`, fontSize: 20, title: true },
    { text: `${formatCardStatNumber(def.cost)} mana`, fontSize: 12, muted: true },
    { text: copy.line, fontSize: 12 }
  ];
  if (towerDef) {
    lines.push({ text: `Damage ${formatCardStatNumber(towerDef.damage)} · 1 shot every ${formatCardStatNumber(towerDef.fireRate)} s`, fontSize: 12, muted: true });
    lines.push({ text: `Range ${Math.round(towerDef.range * 100)} · Targets ${towerDef.maxTargets || 1}`, fontSize: 12, muted: true });
  } else {
    lines.push({ text: `Health ${formatCardStatNumber(attackerDef.hp)} · Crosses in ${(1 / attackerDef.speed).toFixed(1)} s`, fontSize: 12, muted: true });
  }
  if (copy.effect) {
    lines.push({ text: copy.effect, fontSize: 12, muted: true });
  }
  return lines;
}

function renderPixiCardDetailPanel() {
  if (!pixiState.ready || !pixiState.cardDetailPanel) {
    return;
  }
  const panel = pixiState.cardDetailPanel;
  const id = state.cardDetailId;
  for (const node of pixiState.cardDetailTextNodes) {
    panel.removeChild(node);
    node.destroy();
  }
  pixiState.cardDetailTextNodes = [];
  const lines = id ? buildCardDetailLines(id) : null;
  if (!lines) {
    panel.visible = false;
    return;
  }
  const popup = packPopupRect();
  const innerWidth = popup.width - popup.padding * 2;
  const lineGap = 4;
  let cursorY = popup.topY + popup.padding;
  for (const line of lines) {
    const textNode = jonText(line.text, {
      font: line.title ? "head" : "body",
      size: line.fontSize,
      fill: line.muted ? "#5a4a3a" : "#141414",
      align: "left",
      wordWrap: true,
      wordWrapWidth: innerWidth
    });
    textNode.anchor.set(0, 0);
    textNode.position.set(popup.x + popup.padding, cursorY);
    panel.addChild(textNode);
    pixiState.cardDetailTextNodes.push(textNode);
    cursorY += textNode.height + lineGap;
  }
  const contentBottom = cursorY - lineGap + popup.padding;
  // centre on the HUD midline (PACK_HUD.midY)
  const h = Math.min(Math.max(60, contentBottom - popup.topY), popup.maxHeight);
  const top = Math.round(PACK_HUD.midY - h / 2);
  const dy = top - popup.topY;
  for (const node of pixiState.cardDetailTextNodes) {
    node.y += dy;
  }
  pixiState.cardDetailBackground.y = top;
  pixiState.cardDetailBackground.height = h;
  panel.visible = true;
}

function openPixiCardDetail(id) {
  state.cardDetailId = id;
  renderPixiCardDetailPanel();
}

function closePixiCardDetail(id) {
  if (state.cardDetailId !== id) {
    return;
  }
  state.cardDetailId = null;
  renderPixiCardDetailPanel();
}

function addFittedSprite(parent, texture, x, y, maxWidth, maxHeight, options = {}) {
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  sprite.width = maxWidth;
  sprite.height = maxHeight;
  if (options.flipY) {
    sprite.scale.y *= -1;
  }
  parent.addChild(sprite);
  return sprite;
}

function addFittedSheetFrame(parent, texture, x, y, maxWidth, maxHeight, frameIndex, frameCount) {
  const frame = new PIXI.Container();
  frame.x = x;
  frame.y = y;
  const sprite = new PIXI.Sprite(texture);
  sprite.x = -maxWidth / 2 - frameIndex * maxWidth;
  sprite.y = -maxHeight / 2;
  sprite.width = maxWidth * frameCount;
  sprite.height = maxHeight;
  const mask = new PIXI.Graphics()
    .rect(-maxWidth / 2, -maxHeight / 2, maxWidth, maxHeight)
    .fill(0xffffff);
  frame.addChild(sprite);
  frame.addChild(mask);
  sprite.mask = mask;
  parent.addChild(frame);
  return frame;
}

function addSheetPreview(parent, attackerId, cfg, x, y, width, height) {
  const frame = new PIXI.Container();
  frame.x = x - width / 2;
  frame.y = y - height / 2;
  const mask = new PIXI.Graphics().rect(frame.x, frame.y, width, height).fill(0xffffff);
  const sprite = new PIXI.Sprite(pixiState.attackerTextures[attackerId] || PIXI.Texture.EMPTY);
  sprite.x = frame.x;
  sprite.y = frame.y;
  sprite.height = height;
  sprite.width = width * (cfg.frames || 4);
  parent.addChild(sprite);
  parent.addChild(mask);
  sprite.mask = mask;
  return sprite;
}

function addPixiCardHitArea(parent, x, y, width, height, onTap, onPointerDown = null) {
  const hitArea = new PIXI.Graphics()
    .rect(x - width / 2, y - height / 2, width, height)
    .fill({ color: 0xffffff, alpha: 0.001 });
  hitArea.eventMode = "static";
  hitArea.cursor = "pointer";
  hitArea.on("pointertap", onTap);
  if (onPointerDown) {
    hitArea.on("pointerdown", onPointerDown);
  }
  parent.addChild(hitArea);
  return hitArea;
}
