// Line Tower Wars runtime, part 11 of 20: tower slots, createCards, touch drag, placement, queueing, arena drop, HUD, shop UI, refreshAllUI.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function createTowerSlots() {
  enemySlotsEl.innerHTML = "";
  playerSlotsEl.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const enemySlot = document.createElement("div");
    enemySlot.className = "tower-slot enemy";
    enemySlot.dataset.slotIndex = String(i);
    enemySlot.style.left = `${slotPosAI[i].x * 100}%`;
    enemySlot.style.top = `${slotPosAI[i].y * 100}%`;
    enemySlot.style.zIndex = i < 2 ? "5" : "4";
    enemySlotsEl.appendChild(enemySlot);

    const playerSlot = document.createElement("div");
    playerSlot.className = "tower-slot player";
    playerSlot.dataset.slotIndex = String(i);
    playerSlot.style.left = `${slotPosPlayer[i].x * 100}%`;
    playerSlot.style.top = `${slotPosPlayer[i].y * 100}%`;
    playerSlot.style.zIndex = i < 2 ? "4" : "5";

    playerSlot.addEventListener("dragover", (event) => {
      if (!isPlayerInputAllowed()) {
        return;
      }
      event.preventDefault();
      playerSlot.classList.add("over");
    });

    playerSlot.addEventListener("dragleave", () => {
      playerSlot.classList.remove("over");
    });

    playerSlot.addEventListener("drop", (event) => {
      playerSlot.classList.remove("over");
      if (!isPlayerInputAllowed()) {
        return;
      }

      const payload = event.dataTransfer.getData("text/plain") || activeDragPayload;
      if (!payload.startsWith("tower:")) {
        return;
      }

      event.preventDefault();
      const towerId = payload.split(":")[1];
      placePlayerTower(i, towerId);
      clearSelectedTower();
    });

    playerSlot.addEventListener("click", () => {
      if (state.mode === "tug") { tugSlotTap(i); return; } // before the prep-phase and selected-tower guard, which tug never meets
      if (!isPlayerInputAllowed() || !selectedTowerId) {
        return;
      }
      placePlayerTower(i, selectedTowerId);
    });

    playerSlotsEl.appendChild(playerSlot);
  }
}

function createCards() {
  towerPanelEl.innerHTML = "";
  attackerPanelEl.innerHTML = "";

  for (const tower of towerDefs.slice().reverse()) {
    const card = document.createElement("div");
    card.className = "card tower";
    card.draggable = !prefersTouchInput;
    card.dataset.towerId = tower.id;
    card.dataset.cost = String(tower.cost);
    card.innerHTML = `
      <img class="tower-icon-card" src="${towerSpritePaths[tower.id]}" alt="${tower.name} tower" />
      <span class="tower-cost">${tower.cost}</span>
    `;
    if (!prefersTouchInput) {
      card.addEventListener("dragstart", (event) => {
        const payload = `tower:${tower.id}`;
        activeDragPayload = payload;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", payload);
      });
      card.addEventListener("dragend", () => {
        activeDragPayload = "";
      });
    }
    if (prefersTouchInput) {
      card.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || state.phase === "shop" || !isPlayerInputAllowed()) {
          return;
        }
        startTouchDrag(event, `tower:${tower.id}`, "tower");
      });
    }
    card.addEventListener("click", () => onTowerCardActivated(tower));
    towerPanelEl.appendChild(card);
  }

  for (const attacker of attackerDefs) {
    const card = document.createElement("div");
    card.className = "card attacker";
    card.draggable = !prefersTouchInput;
    card.dataset.attackerId = attacker.id;
    card.dataset.cost = String(attacker.cost);
    const spriteCfg = attackerSpriteConfig[attacker.id];
    const iconPath = attackerIconPaths[attacker.id];
    if (spriteCfg && !iconPath) {
      card.innerHTML = `
        <span class="attacker-icon-card attacker-sprite-preview" style="--sprite-url: url('${spriteCfg.path}'); --sprite-frames: ${spriteCfg.frames};" role="img" aria-label="${attacker.name}"></span>
        <span class="attacker-cost">${attacker.cost}</span>
      `;
    } else if (spriteCfg) {
      card.innerHTML = `
        <img class="attacker-icon-card" src="${iconPath || spriteCfg.path}" alt="${attacker.name}" />
        <span class="attacker-cost">${attacker.cost}</span>
      `;
    } else {
      card.innerHTML = `
        <div class="shape" style="background:${attacker.color}"></div>
        <span class="attacker-cost">${attacker.cost}</span>
      `;
    }
    if (!prefersTouchInput) {
      card.addEventListener("dragstart", (event) => {
        const payload = `attacker:${attacker.id}`;
        activeDragPayload = payload;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", payload);
      });
      card.addEventListener("dragend", () => {
        activeDragPayload = "";
      });
    }
    if (prefersTouchInput) {
      card.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || state.phase === "shop" || !isPlayerInputAllowed()) {
          return;
        }
        startTouchDrag(event, `attacker:${attacker.id}`, "attacker");
      });
    }
    card.addEventListener("click", () => onAttackerCardActivated(attacker));
    attackerPanelEl.appendChild(card);
  }
}

function startTouchDrag(event, payload, kind) {
  if (touchDragState || !isPlayerInputAllowed()) {
    return;
  }

  const sourceCard = event.currentTarget;
  const sourceRect = sourceCard.getBoundingClientRect();
  const ghostEl = sourceCard.cloneNode(true);
  ghostEl.style.position = "fixed";
  ghostEl.style.left = `${sourceRect.left}px`;
  ghostEl.style.top = `${sourceRect.top}px`;
  ghostEl.style.width = `${sourceRect.width}px`;
  ghostEl.style.height = `${sourceRect.height}px`;
  ghostEl.style.opacity = "0.8";
  ghostEl.style.pointerEvents = "none";
  ghostEl.style.zIndex = "9999";
  ghostEl.style.transform = "scale(0.96)";
  ghostEl.style.boxShadow = "0 10px 20px rgba(2, 6, 23, 0.4)";
  document.body.appendChild(ghostEl);

  touchDragState = {
    pointerId: event.pointerId,
    payload,
    kind,
    ghostEl
  };
  activeDragPayload = payload;

  updateTouchDragGhost(event.clientX, event.clientY);
  document.addEventListener("pointermove", onTouchDragMove, { passive: false });
  document.addEventListener("pointerup", onTouchDragEnd, { passive: false });
  document.addEventListener("pointercancel", onTouchDragCancel, { passive: false });
}

function updateTouchDragGhost(clientX, clientY) {
  if (!touchDragState?.ghostEl) {
    return;
  }
  const ghostRect = touchDragState.ghostEl.getBoundingClientRect();
  touchDragState.ghostEl.style.left = `${Math.round(clientX - ghostRect.width / 2)}px`;
  touchDragState.ghostEl.style.top = `${Math.round(clientY - ghostRect.height / 2)}px`;
}

function clearTouchDragHighlights() {
  playerSlotsEl.querySelectorAll(".tower-slot.over").forEach((slot) => slot.classList.remove("over"));
}

function onTouchDragMove(event) {
  if (!touchDragState || event.pointerId !== touchDragState.pointerId) {
    return;
  }
  event.preventDefault();
  updateTouchDragGhost(event.clientX, event.clientY);

  if (touchDragState.kind !== "tower") {
    return;
  }
  clearTouchDragHighlights();
  const slotEl = document.elementFromPoint(event.clientX, event.clientY)?.closest(".tower-slot.player");
  if (slotEl && isPlayerInputAllowed()) {
    slotEl.classList.add("over");
  }
}

function endTouchDragInternal(clientX, clientY, shouldApplyDrop) {
  if (!touchDragState) {
    return;
  }

  if (touchDragState.ghostEl?.parentNode) {
    touchDragState.ghostEl.parentNode.removeChild(touchDragState.ghostEl);
  }
  clearTouchDragHighlights();

  if (shouldApplyDrop && isPlayerInputAllowed()) {
    if (touchDragState.kind === "tower" && touchDragState.payload.startsWith("tower:")) {
      const slotEl = document.elementFromPoint(clientX, clientY)?.closest(".tower-slot.player");
      if (slotEl) {
        const slotIndex = Number(slotEl.dataset.slotIndex);
        const towerId = touchDragState.payload.split(":")[1];
        if (Number.isInteger(slotIndex)) {
          placePlayerTower(slotIndex, towerId);
        }
      }
    } else if (touchDragState.kind === "attacker" && touchDragState.payload.startsWith("attacker:")) {
      const dropInsideArena = !!document.elementFromPoint(clientX, clientY)?.closest("#arena-drop-zone");
      if (dropInsideArena) {
        const attackerId = touchDragState.payload.split(":")[1];
        queuePlayerAttacker(attackerId);
      }
    }
  }

  touchDragState = null;
  activeDragPayload = "";
  document.removeEventListener("pointermove", onTouchDragMove);
  document.removeEventListener("pointerup", onTouchDragEnd);
  document.removeEventListener("pointercancel", onTouchDragCancel);
}

function onTouchDragEnd(event) {
  if (!touchDragState || event.pointerId !== touchDragState.pointerId) {
    return;
  }
  event.preventDefault();
  endTouchDragInternal(event.clientX, event.clientY, true);
}

function onTouchDragCancel(event) {
  if (!touchDragState || event.pointerId !== touchDragState.pointerId) {
    return;
  }
  event.preventDefault();
  endTouchDragInternal(event.clientX, event.clientY, false);
}

function isPlayerInputAllowed() {
  return state.screen === "game" && !state.gameOver && state.phase === "prep";
}

function placePlayerTower(slotIndex, towerId) {
  const towerDef = towerDefs.find((item) => item.id === towerId);
  if (!towerDef) {
    triggerPlacementHaptic("error");
    return;
  }

  const existingTower = state.playerTowers[slotIndex];
  if (existingTower && existingTower.id === towerDef.id && existingTower.level >= getTowerMaxLevel(towerDef.id)) {
    updateStatus(`${towerDef.name} tower is already at max level in slot ${slotIndex + 1}.`);
    triggerPlacementHaptic("error");
    return;
  }

  if (state.playerMana < towerDef.cost) {
    updateStatus("Not enough mana for that tower.");
    triggerPlacementHaptic("error");
    return;
  }

  state.playerMana -= towerDef.cost;
  const canUpgradeExisting = !!existingTower
    && existingTower.id === towerDef.id
    && existingTower.level < getTowerMaxLevel(towerDef.id);

  if (canUpgradeExisting) {
    const nextLevel = existingTower.level + 1;
    state.playerTowers[slotIndex] = createTowerInstance(towerDef, "player", nextLevel);
    updateStatus(`Upgraded ${towerDef.name} tower to level ${nextLevel} in slot ${slotIndex + 1}.`);
  } else if (existingTower) {
    state.playerTowers[slotIndex] = createTowerInstance(towerDef, "player", 1);
    updateStatus(`Replaced ${existingTower.name} tower with ${towerDef.name} tower in slot ${slotIndex + 1}.`);
  } else {
    state.playerTowers[slotIndex] = createTowerInstance(towerDef, "player", 1);
    updateStatus(`Placed ${towerDef.name} tower in slot ${slotIndex + 1}.`);
  }
  state.matchStats.towersPlaced += 1;
  markMatchUsage("towers", towerId, "player");
  triggerPlacementHaptic("impact");
  clearSelectedTower();
  refreshAllUI();
}

function canPlaceSelectedTowerInSlot(slotIndex) {
  if (!selectedTowerId || !isPlayerInputAllowed()) {
    return false;
  }
  const towerDef = towerDefs.find((item) => item.id === selectedTowerId);
  if (!towerDef || state.playerMana < towerDef.cost) {
    return false;
  }
  const existingTower = state.playerTowers[slotIndex];
  return !existingTower
    || existingTower.id !== towerDef.id
    || existingTower.level < getTowerMaxLevel(towerDef.id);
}

function queuePlayerAttacker(attackerId) {
  const attacker = attackerDefs.find((item) => item.id === attackerId);
  if (!attacker) {
    triggerPlacementHaptic("error");
    return;
  }
  if (state.playerMana < attacker.cost) {
    updateStatus("Not enough mana for that attacker.");
    triggerPlacementHaptic("error");
    return;
  }

  state.playerMana -= attacker.cost;
  state.playerQueue.push(attacker.id);
  state.playerQueueCounts[attacker.id] = (state.playerQueueCounts[attacker.id] || 0) + 1;
  state.matchStats.attackersQueued += 1;
  markMatchUsage("attackers", attacker.id, "player");
  updateStatus(`${attacker.name} added to next wave queue.`);
  refreshAllUI();
}

function setupArenaDrop() {
  arenaDropZoneEl.addEventListener("dragover", (event) => {
    if (!isPlayerInputAllowed()) {
      return;
    }
    event.preventDefault();
  });

  arenaDropZoneEl.addEventListener("drop", (event) => {
    if (!isPlayerInputAllowed()) {
      return;
    }
    const payload = event.dataTransfer.getData("text/plain") || activeDragPayload;
    if (!payload.startsWith("attacker:")) {
      return;
    }
    event.preventDefault();
    const attackerId = payload.split(":")[1];
    queuePlayerAttacker(attackerId);
  });
}

function clearSelectedTower() {
  selectedTowerId = null;
}

function refreshCardStates() {
  const towerCards = towerPanelEl.querySelectorAll(".card.tower");
  const attackerCards = attackerPanelEl.querySelectorAll(".card.attacker");

  towerCards.forEach((card) => {
    const cost = Number(card.dataset.cost);
    const towerId = card.dataset.towerId;
    const upgraded = (state.playerTowerUpgrades[towerId] || 0) > 0;
    const inShop = state.phase === "shop";
    card.classList.toggle("disabled", !inShop && (!isPlayerInputAllowed() || state.playerMana < cost));
    card.classList.toggle("selected", inShop
      ? state.shopSelectionType === "tower" && state.shopSelectionId === towerId
      : selectedTowerId === towerId);
    card.classList.toggle("shop-mode", inShop);
    card.classList.toggle("upgraded", upgraded);
  });

  attackerCards.forEach((card) => {
    const cost = Number(card.dataset.cost);
    const attackerId = card.dataset.attackerId;
    const queued = state.playerQueueCounts[attackerId] || 0;
    const upgraded = (state.playerAttackerUpgrades[attackerId] || 0) > 0;
    const inShop = state.phase === "shop";
    card.classList.toggle("disabled", !inShop && (!isPlayerInputAllowed() || state.playerMana < cost));
    card.classList.toggle("queued", !inShop && queued > 0);
    card.classList.toggle("selected", inShop && state.shopSelectionId === attackerId);
    card.classList.toggle("shop-mode", inShop);
    card.classList.toggle("upgraded", upgraded);
    card.dataset.queued = queued > 0 ? `x${queued}` : "";
  });
  updatePixiCardStates();
}

function refreshTowerSlots() {
  const enemySlots = enemySlotsEl.querySelectorAll(".tower-slot");
  const playerSlots = playerSlotsEl.querySelectorAll(".tower-slot");

  const towerMarkup = (tower, owner = "player") => {
    if (!tower) {
      return "";
    }
    const safeLevel = Math.max(1, Number(tower.level) || 1);
    const side = getOwnerVisualSide(owner);
    const towerPath = towerSpritePathSets[side]?.[tower.id] || towerSpritePaths[tower.id];
    return `<div class="slot-tower">
      <img class="tower-icon-slot level-${safeLevel}" src="${towerPath}" alt="${tower.name} tower" />
    </div>`;
  };

  for (let i = 0; i < 5; i += 1) {
    const playerSlot = playerSlots[i];
    const playerTower = state.playerTowers[i];
    playerSlot.innerHTML = playerTower ? towerMarkup(playerTower, "player") : `<span>${i + 1}</span>`;
    playerSlot.classList.toggle("filled", !!playerTower);
    playerSlot.classList.toggle("placement-target", canPlaceSelectedTowerInSlot(i));

    const enemySlot = enemySlots[i];
    const aiTower = state.aiTowers[i];
    enemySlot.innerHTML = aiTower ? towerMarkup(aiTower, "ai") : "";
    enemySlot.classList.toggle("filled", !!aiTower);
  }
}

function syncPauseButtons() {
  const label = state.paused ? "Resume" : "Pause";
  pauseBtnEl.textContent = label;
  if (floatingPauseBtnEl) {
    floatingPauseBtnEl.textContent = label;
    floatingPauseBtnEl.hidden = state.screen !== "game" || state.gameOver || multiplayerRole !== null || state.paused;
  }
  // solo pause panel: Resume / Menu; hidden online and at match end
  const panel = state.paused && state.screen === "game" && !state.gameOver && multiplayerRole === null;
  pauseOverlayEl?.classList.toggle("hidden", !panel);
  // the quit card closes when the screen changes or the match ends; it stays while a live match (solo or online, paused or not) shows it
  if (state.screen !== "game" || state.gameOver) quitOverlayEl?.classList.add("hidden");
}

function refreshHUD() {
  playerScoreEl.textContent = String(state.playerScore);
  aiScoreEl.textContent = String(state.aiScore);
  waveNumberEl.textContent = String(state.waveNumber);
  playerManaEl.textContent = String(state.playerMana);
  if (shopManaValueEl) shopManaValueEl.textContent = String(state.playerMana);
  if (state.phase === "prep") {
    phaseLabelEl.textContent = "Prep";
  } else if (state.phase === "battle") {
    phaseLabelEl.textContent = "Battle";
  } else if (state.phase === "shop") {
    phaseLabelEl.textContent = "Shop";
  } else if (state.phase === "waiting") {
    phaseLabelEl.textContent = "Wait";
  } else {
    phaseLabelEl.textContent = "Round";
  }
  phaseLabelEl.classList.toggle("prep", state.phase === "prep");
  phaseLabelEl.classList.toggle("battle", state.phase === "battle");
  phaseTimerEl.textContent = state.phase === "prep" ? state.phaseTimer.toFixed(1) : "--";

  if (state.phase === "prep") {
    const ratio = clamp(state.phaseTimer / PREP_SECONDS, 0, 1);
    waveProgressFillEl.style.transform = `scaleY(${ratio})`;
  } else {
    waveProgressFillEl.style.transform = "scaleY(1)";
  }

  const canSkipToBattle = !state.gameOver && !state.paused && state.phase === "prep" && !state.battleSkipUsedThisRound;
  battleSkipBtnEl.disabled = !canSkipToBattle;
  battleSkipBtnEl.hidden = state.screen !== "game" || !canSkipToBattle;
  if (readyBtnEl) {
    readyBtnEl.disabled = !canSkipToBattle;
    readyBtnEl.hidden = state.screen !== "game" || !canSkipToBattle;
    readyBtnEl.textContent = multiplayerRole !== null && state.battleSkipUsedThisRound ? "Waiting" : "Ready";
  }
  // Pause is disabled in multiplayer — both players cannot pause a live match
  pauseBtnEl.hidden = multiplayerRole !== null;
  syncPauseButtons();
}

function refreshShopUI() {
  // Between-round upgrade flow is disabled for faster-paced matches.
  shopOverlayEl.classList.add("hidden");
}

function refreshMatchEndOverlay() {
  const showOverlay = state.gameOver;
  matchEndOverlayEl.classList.toggle("hidden", !showOverlay);
  if (!showOverlay) {
    return;
  }
  const summary = state.matchSummary || {
    title: "Match Complete",
    copy: state.winnerText,
    stats: [],
    nextGoal: getNextGoalText(getProfileStats())
  };
  const isGauntletResult = Boolean(pendingGauntletReturn);
  matchResultTitleEl.textContent = summary.title;
  matchResultCopyEl.textContent = summary.copy;
  matchResultEyebrowEl?.classList.toggle("hidden", isGauntletResult);
  matchResultCopyEl.classList.toggle("hidden", isGauntletResult);
  matchSummaryGridEl.innerHTML = summary.stats.map((item) => `
    <div class="match-stat">
      <strong>${item.value}</strong>
      <span>${item.label}</span>
    </div>
  `).join("");
  matchNextGoalEl.textContent = summary.nextGoal;
  const awaitingGauntletContinue = isGauntletResult;
  matchContinueBtnEl?.classList.toggle("hidden", !awaitingGauntletContinue);
  matchPlayAgainBtnEl?.classList.toggle("hidden", awaitingGauntletContinue);
  matchHomeBtnEl?.classList.toggle("hidden", awaitingGauntletContinue);
}

function refreshAllUI() {
  refreshHUD();
  refreshTowerSlots();
  refreshCardStates();
  refreshShopUI();
  refreshMatchEndOverlay();
  refreshMetaUI();
}
