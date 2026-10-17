// Line Tower Wars runtime, part 18 of 20: drag ghost, pointer and hold handling, card activation, dock cards, timer fill, card/HUD updates.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function createPixiTowerDragGhost(tower) {
  const ghostEl = document.createElement("div");
  ghostEl.className = "pixi-drag-ghost";
  ghostEl.innerHTML = `<img src="${towerSpritePaths[tower.id]}" alt="" />`;
  ghostEl.style.position = "fixed";
  ghostEl.style.width = `${TOWER_RENDER_BOX_WIDTH}px`;
  ghostEl.style.height = `${TOWER_RENDER_BOX_HEIGHT}px`;
  ghostEl.style.opacity = "0.7";
  ghostEl.style.pointerEvents = "none";
  ghostEl.style.zIndex = "9999";
  ghostEl.style.transform = "translate(-50%, -50%)";
  const img = ghostEl.querySelector("img");
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  document.body.appendChild(ghostEl);
  return ghostEl;
}

function getPixiPointerClientPosition(event) {
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  const canvasRect = pixiState.app?.canvas?.getBoundingClientRect();
  if (!canvasRect || !event.global) {
    return { x: 0, y: 0 };
  }
  const scaleX = canvasRect.width / Math.max(1, pixiState.app.renderer.width);
  const scaleY = canvasRect.height / Math.max(1, pixiState.app.renderer.height);
  return {
    x: canvasRect.left + event.global.x * scaleX,
    y: canvasRect.top + event.global.y * scaleY
  };
}

function updatePixiTowerDragGhost(clientX, clientY) {
  if (!pixiTowerDragState?.ghostEl) {
    return;
  }
  pixiTowerDragState.ghostEl.style.left = `${clientX}px`;
  pixiTowerDragState.ghostEl.style.top = `${clientY}px`;
}

function startPixiTowerPointer(event, tower) {
  if (state.mode === "tug") return;
  if (!isPlayerInputAllowed()) {
    return;
  }
  if (state.playerMana < tower.cost) {
    updateStatus("Not enough mana for that tower.");
    triggerPlacementHaptic("error");
    return;
  }
  const client = getPixiPointerClientPosition(event);
  pixiTowerDragState = {
    pointerId: event.pointerId,
    tower,
    startX: client.x,
    startY: client.y,
    hasMoved: false,
    ghostEl: null
  };
  document.addEventListener("pointermove", onPixiTowerPointerMove, { passive: false });
  document.addEventListener("pointerup", onPixiTowerPointerEnd, { passive: false });
  document.addEventListener("pointercancel", onPixiTowerPointerCancel, { passive: false });
}

function onPixiTowerPointerMove(event) {
  if (!pixiTowerDragState || event.pointerId !== pixiTowerDragState.pointerId) {
    return;
  }
  if (pixiCardHoldSwallowTap) {
    return;
  }
  const dx = event.clientX - pixiTowerDragState.startX;
  const dy = event.clientY - pixiTowerDragState.startY;
  if (!pixiTowerDragState.hasMoved && Math.hypot(dx, dy) < 6) {
    return;
  }
  event.preventDefault();
  pixiTowerDragState.hasMoved = true;
  if (!pixiTowerDragState.ghostEl) {
    pixiTowerDragState.ghostEl = createPixiTowerDragGhost(pixiTowerDragState.tower);
    activeDragPayload = `tower:${pixiTowerDragState.tower.id}`;
  }
  updatePixiTowerDragGhost(event.clientX, event.clientY);
  clearTouchDragHighlights();
  const slotEl = document.elementFromPoint(event.clientX, event.clientY)?.closest(".tower-slot.player");
  if (slotEl && isPlayerInputAllowed()) {
    slotEl.classList.add("over");
  }
}

function finishPixiTowerPointer(clientX, clientY, shouldApplyDrop) {
  if (!pixiTowerDragState) {
    return;
  }
  const dragState = pixiTowerDragState;
  if (dragState.ghostEl?.parentNode) {
    dragState.ghostEl.parentNode.removeChild(dragState.ghostEl);
  }
  clearTouchDragHighlights();
  if (dragState.hasMoved) {
    suppressNextPixiTowerTap = true;
    window.setTimeout(() => {
      suppressNextPixiTowerTap = false;
    }, 0);
  }
  if (shouldApplyDrop && dragState.hasMoved && isPlayerInputAllowed()) {
    const slotEl = document.elementFromPoint(clientX, clientY)?.closest(".tower-slot.player");
    if (slotEl) {
      const slotIndex = Number(slotEl.dataset.slotIndex);
      if (Number.isInteger(slotIndex)) {
        placePlayerTower(slotIndex, dragState.tower.id);
      }
    }
  }
  pixiTowerDragState = null;
  activeDragPayload = "";
  document.removeEventListener("pointermove", onPixiTowerPointerMove);
  document.removeEventListener("pointerup", onPixiTowerPointerEnd);
  document.removeEventListener("pointercancel", onPixiTowerPointerCancel);
}

function onPixiTowerPointerEnd(event) {
  if (!pixiTowerDragState || event.pointerId !== pixiTowerDragState.pointerId) {
    return;
  }
  finishPixiTowerPointer(event.clientX, event.clientY, true);
}

function onPixiTowerPointerCancel(event) {
  if (!pixiTowerDragState || event.pointerId !== pixiTowerDragState.pointerId) {
    return;
  }
  finishPixiTowerPointer(event.clientX, event.clientY, false);
}

let pixiCardHoverTimer = null;

function clearPixiCardHoverTimer() {
  if (pixiCardHoverTimer) {
    window.clearTimeout(pixiCardHoverTimer);
    pixiCardHoverTimer = null;
  }
}

// A mouse must rest on a card CARD_HOVER_MS before its detail opens; leaving cancels or closes it.
function attachPixiCardHover(hitArea, id) {
  hitArea.on("pointerover", (event) => {
    if (event.pointerType === "mouse") {
      clearPixiCardHoverTimer();
      pixiCardHoverTimer = window.setTimeout(() => {
        pixiCardHoverTimer = null;
        openPixiCardDetail(id);
      }, CARD_HOVER_MS);
    }
  });
  hitArea.on("pointerout", (event) => {
    if (event.pointerType === "mouse") {
      clearPixiCardHoverTimer();
      closePixiCardDetail(id);
    }
  });
}

function clearPixiCardHoldTimer() {
  if (pixiCardHoldTimer) {
    window.clearTimeout(pixiCardHoldTimer);
    pixiCardHoldTimer = null;
  }
}

function startPixiCardHold(event, id) {
  // Every card's pointerdown routes through here first (towers call this
  // before startPixiTowerPointer; attackers call only this), for both mouse
  // and touch. Only touch starts the hold timer below.
  if (event.pointerType === "mouse") {
    return;
  }
  clearPixiCardHoldTimer();
  document.removeEventListener("pointermove", onPixiCardHoldPointerMove);
  pixiCardHoldPointerId = event.pointerId;
  pixiCardHoldStart = getPixiPointerClientPosition(event);
  pixiCardHoldFired = false;
  pixiCardHoldTimer = window.setTimeout(() => {
    pixiCardHoldTimer = null;
    pixiCardHoldFired = true;
    openPixiCardDetail(id);
    pixiCardHoldSwallowTap = true;
  }, CARD_HOLD_MS);
  document.addEventListener("pointermove", onPixiCardHoldPointerMove, { passive: false });
}

function onPixiCardHoldPointerMove(event) {
  if (pixiCardHoldFired || event.pointerId !== pixiCardHoldPointerId || !pixiCardHoldStart) {
    return;
  }
  const dx = event.clientX - pixiCardHoldStart.x;
  const dy = event.clientY - pixiCardHoldStart.y;
  if (Math.hypot(dx, dy) > 6) {
    clearPixiCardHoldTimer();
    document.removeEventListener("pointermove", onPixiCardHoldPointerMove);
    pixiCardHoldPointerId = null;
    pixiCardHoldStart = null;
  }
}

function endPixiCardHold(event, id) {
  if (event.pointerId !== pixiCardHoldPointerId) {
    return;
  }
  clearPixiCardHoldTimer();
  document.removeEventListener("pointermove", onPixiCardHoldPointerMove);
  pixiCardHoldPointerId = null;
  pixiCardHoldStart = null;
  pixiCardHoldFired = false;
  closePixiCardDetail(id);
  window.setTimeout(() => {
    pixiCardHoldSwallowTap = false;
  }, 0);
}

function onTowerCardActivated(tower) {
  if (state.mode === "tug") return;
  if (pixiCardHoldSwallowTap) {
    pixiCardHoldSwallowTap = false;
    return;
  }
  if (suppressNextPixiTowerTap) {
    suppressNextPixiTowerTap = false;
    return;
  }
  if (state.phase === "shop") {
    state.shopSelectionType = "tower";
    state.shopSelectionId = tower.id;
    refreshAllUI();
    return;
  }
  if (!isPlayerInputAllowed()) {
    return;
  }
  if (state.playerMana < tower.cost) {
    updateStatus("Not enough mana for that tower.");
    triggerPlacementHaptic("error");
    return;
  }
  selectedTowerId = selectedTowerId === tower.id ? null : tower.id;
  refreshCardStates();
  updateStatus(selectedTowerId
    ? `Selected ${tower.name}. Tap a slot to place, upgrade, or replace.`
    : "Tower selection cleared.");
}

function onAttackerCardActivated(attacker) {
  if (pixiCardHoldSwallowTap) {
    pixiCardHoldSwallowTap = false;
    return;
  }
  if (state.mode === "tug") { tugQueueMob(attacker.id); return; } // after the hold check: a hold that opened the detail does not queue
  if (state.phase === "shop") {
    state.shopSelectionType = "attacker";
    state.shopSelectionId = attacker.id;
    refreshAllUI();
    return;
  }
  if (!isPlayerInputAllowed()) {
    return;
  }
  if (state.playerMana < attacker.cost) {
    updateStatus("Not enough mana for that attacker.");
    triggerPlacementHaptic("error");
    return;
  }
  flashPixiCard("attacker", attacker.id);
  queuePlayerAttacker(attacker.id);
}

// card labels are mixed case in the sans ("Multi", not "MULTI"): one voice per tile
function formatPixiCardRole(role) {
  const text = String(role || "");
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// A dock card's centre in safe-frame px. nineSlice packs carry it in pack.json layout.cardSlots (towers in
// drawn order: slot 0 is the last tower def); layers packs use the template's artboard centres minus the safe offsets.
function pixiCardSlot(kind, index) {
  const slot = PACK_CHROME_MODE === "nineSlice" ? PACK_LAYOUT.cardSlots?.[kind]?.[index] : null;
  if (slot) {
    return { x: slot.x, y: slot.y };
  }
  const center = (kind === "towers" ? TOWER_CARD_CENTERS : CREEP_CARD_CENTERS)[index];
  return { x: center.x - SAFE_AREA_OFFSET_X, y: center.y - SAFE_AREA_OFFSET_Y };
}

// Where a dock card's picture, role word and cost sit, relative to the card centre; pack.json layout.cards, one per
// kind (the Godot board edits it). icon x/y is the picture's centre, width/height its drawn box; role x/y is the
// word's bottom-left corner, cost x/y the number's bottom-right corner; size is the font size, color the text colour
// and outline { width, color } its outline (width in game px, 0 = none). Per-field fallback to the numbers every pack
// used before layout.cards existed (colour: the pack ink, no outline).
function pixiCardInner(kind) {
  const set = PACK_LAYOUT.cards?.[kind];
  const tower = kind === "towers";
  const pick = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const colour = (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : packColourCss("ink"));
  const outline = (value) => ({ width: pick(value?.width, 0), color: colour(value?.color) });
  const icon = set?.icon;
  const role = set?.role;
  const cost = set?.cost;
  return {
    icon: {
      x: pick(icon?.x, 0),
      y: pick(icon?.y, -10),
      width: pick(icon?.width, tower ? 40 : 36),
      height: pick(icon?.height, tower ? 48 : 36)
    },
    role: { x: pick(role?.x, -29), y: pick(role?.y, tower ? 33 : 26), size: pick(role?.size, 10), color: colour(role?.color), outline: outline(role?.outline) },
    cost: { x: pick(cost?.x, 30), y: pick(cost?.y, tower ? 34 : 27), size: pick(cost?.size, 15), color: colour(cost?.color), outline: outline(cost?.outline) }
  };
}

// A card's cost number and role word in the board font, placed as the Godot board's card labels (2 units per game px,
// under its ui2x node): the cost's box bottom-right and the role's box bottom-left at their layout.cards corners.
function pixiCardWords(inner, cx, cy, cost, role) {
  const costText = boardText(String(cost), inner.cost, 15);
  costText.position.set(cx + inner.cost.x, cy + inner.cost.y);
  placeBoardText(costText, boardCostBox(costText.x, costText.y, costText.style.fontSize), "right", "bottom", 2);
  const roleText = boardText(formatPixiCardRole(role), inner.role, 10);
  roleText.position.set(cx + inner.role.x, cy + inner.role.y);
  placeBoardText(roleText, boardRoleBox(roleText.x, roleText.y, roleText.style.fontSize), "left", "bottom", 2);
  return { costText, roleText, costColour: inner.cost.color };
}

function buildPixiDockCards() {
  clearPixiCardHoverTimer();
  pixiState.dockIconLayer.removeChildren();
  pixiState.cardSprites = [];
  pixiState.cardText = [];
  pixiState.cardEntries = [];

  const towerInner = pixiCardInner("towers");
  const towerOrder = towerDefs.slice().reverse();
  towerOrder.forEach((tower, index) => {
    const { x: cx, y: cy } = pixiCardSlot("towers", index);
    const frame = createPixiCardFrame(cx, cy, 74, 78);
    if (frame) {
      pixiState.dockIconLayer.addChild(frame);
    }
    const sprite = addFittedSprite(pixiState.dockIconLayer, pixiState.towerTextures[tower.id], cx + towerInner.icon.x, cy + towerInner.icon.y, towerInner.icon.width, towerInner.icon.height);
    pixiState.cardSprites.push(sprite);
    const { costText, roleText, costColour } = pixiCardWords(towerInner, cx, cy, tower.cost, UNIT_CARD_COPY[tower.id]?.role);
    pixiState.dockIconLayer.addChild(costText);
    pixiState.cardText.push(costText);
    pixiState.dockIconLayer.addChild(roleText);
    const flash = createPixiCardFlash(cx, cy, 74, 78);
    pixiState.dockIconLayer.addChild(flash);
    const hitArea = addPixiCardHitArea(pixiState.dockIconLayer, cx, cy, 74, 78, () => {
      onTowerCardActivated(tower);
    }, (event) => {
      startPixiCardHold(event, tower.id);
      startPixiTowerPointer(event, tower);
    });
    hitArea.on("pointerup", (event) => endPixiCardHold(event, tower.id));
    hitArea.on("pointerupoutside", (event) => endPixiCardHold(event, tower.id));
    hitArea.on("pointercancel", (event) => endPixiCardHold(event, tower.id));
    attachPixiCardHover(hitArea, tower.id);
    pixiState.cardEntries.push({ type: "tower", id: tower.id, manaCost: tower.cost, frame, sprite, costText, costColour, flash, roleText, hitArea });
  });

  const creepInner = pixiCardInner("creeps");
  attackerDefs.forEach((attacker, index) => {
    const { x: cx, y: cy } = pixiCardSlot("creeps", index);
    const frame = createPixiCardFrame(cx, cy, 74, 64);
    if (frame) {
      pixiState.dockIconLayer.addChild(frame);
    }
    const cfg = attackerSpriteConfig[attacker.id];
    let sprite = null;
    if (cfg) {
      sprite = addSheetPreview(pixiState.dockIconLayer, attacker.id, cfg, cx + creepInner.icon.x, cy + creepInner.icon.y, creepInner.icon.width, creepInner.icon.height);
    }
    const { costText, roleText, costColour } = pixiCardWords(creepInner, cx, cy, attacker.cost, UNIT_CARD_COPY[attacker.id]?.role);
    pixiState.dockIconLayer.addChild(costText);
    pixiState.cardText.push(costText);
    pixiState.dockIconLayer.addChild(roleText);
    const flash = createPixiCardFlash(cx, cy, 74, 64);
    pixiState.dockIconLayer.addChild(flash);
    const queueText = jonText("", { font: "title", size: 20, fill: "#18a0e0", stroke: { color: "#141414", width: 2 } });
    queueText.anchor.set(1, 0);
    queueText.position.set(cx + 33, cy - 30);
    queueText.visible = false;
    pixiState.dockIconLayer.addChild(queueText);
    const hitArea = addPixiCardHitArea(pixiState.dockIconLayer, cx, cy, 74, 64, () => {
      onAttackerCardActivated(attacker);
    }, (event) => {
      startPixiCardHold(event, attacker.id);
    });
    hitArea.on("pointerup", (event) => endPixiCardHold(event, attacker.id));
    hitArea.on("pointerupoutside", (event) => endPixiCardHold(event, attacker.id));
    hitArea.on("pointercancel", (event) => endPixiCardHold(event, attacker.id));
    attachPixiCardHover(hitArea, attacker.id);
    pixiState.cardEntries.push({ type: "attacker", id: attacker.id, manaCost: attacker.cost, frame, sprite, costText, costColour, flash, queueText, roleText, hitArea });
  });
  updatePixiCardStates(true);
}

// The card's drawn frame (manifest "card" piece); the selected state swaps its texture to the "cardSelected"
// tile (updatePixiCardStates), so the frame is owned by the card entry. In layers mode the pack's painted
// layers carry the card frames, so there is no frame sprite (null).
function createPixiCardFrame(x, y, width, height) {
  if (PACK_CHROME_MODE !== "nineSlice") {
    return null;
  }
  const frame = jonNineSlice("card", undefined, width, height);
  frame.position.set(x - width / 2, y - height / 2);
  frame.eventMode = "none";
  return frame;
}

function createPixiCardFlash(x, y, width, height) {
  const flash = new PIXI.Graphics()
    .roundRect(x - width / 2 + 3, y - height / 2 + 3, width - 6, height - 6, 8)
    .fill({ color: packColourNumber("paper"), alpha: 0.5 });
  flash.eventMode = "none";
  flash.visible = false;
  return flash;
}

function flashPixiCard(type, id) {
  const entry = pixiState.cardEntries.find((item) => item.type === type && item.id === id);
  if (!entry?.flash) {
    return;
  }
  if (entry.flashTimeouts) {
    for (const timeoutId of entry.flashTimeouts) {
      window.clearTimeout(timeoutId);
    }
  }
  entry.flash.visible = true;
  entry.flash.alpha = 1;
  entry.flashTimeouts = [
    window.setTimeout(() => {
      entry.flash.visible = false;
    }, 85),
    window.setTimeout(() => {
      entry.flash.visible = true;
      entry.flash.alpha = 0.72;
    }, 145),
    window.setTimeout(() => {
      entry.flash.visible = false;
      entry.flash.alpha = 1;
      entry.flashTimeouts = null;
    }, 230)
  ];
}

function updatePixiTimerFill() {
  if (!pixiState.ready || !pixiState.timerFill || !pixiState.timerMask) {
    return;
  }
  const ratio = state.phase === "prep" ? clamp(state.phaseTimer / PREP_SECONDS, 0, 1) : 0;
  // the fill lives inside the pack's timer rect (PACK_HUD.timerFill, one stroke width in); the mask reveals it from the bottom
  const timerRect = PACK_HUD.timerFill;
  const innerX = timerRect.x + JON_TIMER_STROKE;
  const innerY = timerRect.y + JON_TIMER_STROKE;
  const innerWidth = timerRect.width - JON_TIMER_STROKE * 2;
  const innerHeight = timerRect.height - JON_TIMER_STROKE * 2;
  const visibleHeight = innerHeight * ratio;
  const visibleY = innerY + innerHeight - visibleHeight;
  pixiState.timerFill.visible = ratio > 0;
  if (pixiState.timerIdleFill) {
    pixiState.timerIdleFill.visible = state.phase !== "prep";
  }
  pixiState.timerMask
    .clear()
    .rect(innerX, visibleY, innerWidth, visibleHeight)
    .fill(0xffffff);
}

function updatePixiCardStates(force = false) {
  if (!pixiState.ready || !pixiState.cardEntries.length) {
    return;
  }
  const signature = [
    state.phase,
    state.playerMana,
    selectedTowerId || "",
    state.shopSelectionType || "",
    state.shopSelectionId || "",
    JSON.stringify(state.playerQueueCounts || {}),
    isPlayerInputAllowed() ? "input" : "locked"
  ].join("|");
  if (!force && signature === pixiState.lastCardSignature) {
    return;
  }
  pixiState.lastCardSignature = signature;

  for (const entry of pixiState.cardEntries) {
    const inShop = state.phase === "shop";
    const affordable = inShop || (isPlayerInputAllowed() && state.playerMana >= entry.manaCost);
    // can't afford: only the cost number's fill turns grey (pack colours.locked, else #9a9a9a) and its outline stays;
    // the frame, the picture (no tint) and the role word keep their look (Baz, 2026-10-04, option A)
    if (entry.costText) {
      const fill = affordable ? entry.costColour : PACK_COLOURS.locked || "#9a9a9a";
      if (entry.costText.style.fill !== fill) {
        entry.costText.style.fill = fill;
      }
    }
    if (entry.frame) {
      const selected = entry.type === "tower"
        ? (inShop
          ? state.shopSelectionType === "tower" && state.shopSelectionId === entry.id
          : selectedTowerId === entry.id)
        : inShop && state.shopSelectionType === "attacker" && state.shopSelectionId === entry.id;
      entry.frame.texture = getJonTexture(selected ? "cardSelected" : "card");
    }
    if (entry.queueText) {
      const queued = state.playerQueueCounts[entry.id] || 0;
      entry.queueText.text = queued > 0 ? `x${queued}` : "";
      entry.queueText.visible = !inShop && queued > 0;
    }
  }
}

// Penner's easeOutElastic: 0 -> 1 with an overshoot that rings down
function hudEaseOutElastic(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
}

const HUD_POP_KEYS = [["mana", "playerMana"], ["playerScore", "playerScore"], ["aiScore", "aiScore"]];

function updatePixiHudText() {
  if (!pixiState.ready) {
    return;
  }
  const signature = [
    state.waveNumber,
    state.phase,
    state.phaseTimer.toFixed(1),
    state.playerMana,
    state.playerScore,
    state.aiScore
  ].join("|");
  if (signature !== pixiState.lastHudSignature) {
    pixiState.lastHudSignature = signature;
    pixiState.hudText.round.text = String(state.waveNumber);
    pixiState.hudText.timer.text = phaseTimerEl.textContent || state.phaseTimer.toFixed(1);
    pixiState.hudText.aiScore.text = String(state.aiScore);
    pixiState.hudText.mana.text = String(state.playerMana);
    pixiState.hudText.playerScore.text = String(state.playerScore);
    // a changed You / AI / Mana value starts the elastic pop on that number; the first half second of a match
    // (the reset to the starting values; animationClock restarts at 0 in resetMatch) is exempt
    for (const [key, stateKey] of HUD_POP_KEYS) {
      const value = state[stateKey];
      const pop = pixiState.hudPop[key] || (pixiState.hudPop[key] = { value, t0: null });
      if (pop.value !== value) {
        pop.value = value;
        pop.t0 = state.screen === "game" && state.animationClock > 0.5 ? state.animationClock : null;
      }
    }
  }
  // every frame: the pop is a scale about the node's pivot, which placeBoardText put at the number's centre.
  // Visual only; nothing here writes state (seeded hashes unaffected)
  for (const [key] of HUD_POP_KEYS) {
    const pop = pixiState.hudPop[key];
    const node = pixiState.hudText[key];
    if (!pop || !node) continue;
    let s = 1;
    if (pop.t0 !== null) {
      const p = (state.animationClock - pop.t0) / HUD_POP_SECONDS;
      if (p < 0 || p >= 1) pop.t0 = null;
      else s = 1 + HUD_POP_SCALE * (1 - hudEaseOutElastic(p));
    }
    if (node.scale.x !== s) node.scale.set(s);
  }
}

function updatePixiDynamicTexture() {
  if (!pixiState.ready || !pixiState.legacyTexture) {
    return;
  }
  pixiState.legacyTexture.source.update();
}
