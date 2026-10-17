// Line Tower Wars runtime, part 08 of 20: Gauntlet progress, stage, map UI, advance, results.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function createDefaultGauntletProgress() {
  return {
    seasonId: GAUNTLET_SEASON_ID,
    unlockedStage: 0,
    completedWins: 0,
    currentMatches: 0,
    currentWins: 0
  };
}

function normalizeGauntletProgress(parsed) {
  if (parsed?.seasonId && parsed.seasonId !== GAUNTLET_SEASON_ID) {
    return createDefaultGauntletProgress();
  }
  const unlockedStage = clamp(Math.floor(Number(parsed?.unlockedStage) || 0), 0, GAUNTLET_STAGES.length - 1);
  const completedWins = clamp(
    Math.floor(Number(parsed?.completedWins ?? unlockedStage) || 0),
    0,
    GAUNTLET_STAGES.length
  );
  const currentMatches = Math.max(0, Math.floor(Number(parsed?.currentMatches) || 0));
  const currentWins = clamp(Math.floor(Number(parsed?.currentWins) || 0), 0, currentMatches);
  return {
    seasonId: GAUNTLET_SEASON_ID,
    unlockedStage,
    completedWins,
    currentMatches,
    currentWins
  };
}

function loadGauntletProgress() {
  try {
    const raw = localStorage.getItem(GAUNTLET_STORAGE_KEY);
    gauntletProgress = raw ? normalizeGauntletProgress(JSON.parse(raw)) : createDefaultGauntletProgress();
  } catch {
    gauntletProgress = createDefaultGauntletProgress();
  }
}

function saveGauntletProgress() {
  try {
    localStorage.setItem(GAUNTLET_STORAGE_KEY, JSON.stringify(gauntletProgress));
  } catch {
  }
}

function getGauntletStage(index = gauntletProgress.unlockedStage) {
  return GAUNTLET_STAGES[clamp(index, 0, GAUNTLET_STAGES.length - 1)];
}

function getGauntletStagePercent(stage) {
  return {
    x: stage.x / GAUNTLET_MAP_WIDTH * 100,
    y: stage.y / GAUNTLET_MAP_HEIGHT * 100
  };
}

// The map window fades its top and bottom 30 px into the panel's paper (jon-screens.css), so a marker
// counts as clear when it is fully in view and at least 36 px (the fade plus a margin) from both edges.
// The scroll may run this far past the map's own top and bottom (plain paper shows there), so the boss
// at the very top and the camp at the very bottom can still be clear of the fade.
const GAUNTLET_EDGE_CLEAR = 36;
const GAUNTLET_SCROLL_PAD = 64;
// y extents (map pixels) of the drawn landmarks, which tools/jon-gauntlet-map.py prints: keep the two in step
const GAUNTLET_LANDMARK_SPANS = [[104, 220], [319, 414], [383, 469], [574, 635], [597, 678], [776, 883], [906, 962], [936, 1029], [1159, 1249], [1205, 1281], [1395, 1492]];

function focusGauntletViewport(stageIndex = gauntletProgress.unlockedStage) {
  if (!gauntletMapTrackEl) {
    return;
  }
  const viewportEl = document.getElementById("gauntlet-map-viewport");
  if (!viewportEl) {
    return;
  }
  const stage = getGauntletStage(stageIndex);
  const viewportHeight = viewportEl.clientHeight;
  const trackRect = gauntletMapTrackEl.getBoundingClientRect();
  const trackHeight = trackRect.height;
  if (!viewportHeight || !trackHeight) {
    return;
  }
  const scale = trackHeight / GAUNTLET_MAP_HEIGHT;
  const stageY = stage.y * scale;
  const targetY = viewportHeight * 0.66;
  const minOffset = Math.min(0, viewportHeight - trackHeight) - GAUNTLET_SCROLL_PAD;
  const maxOffset = GAUNTLET_SCROLL_PAD;
  const wantedOffset = targetY - stageY;
  const baseOffset = clamp(wantedOffset, minOffset, maxOffset);
  // Marker radii match the CSS (9.5% / 12% of the track's width across, so 4.75% / 6% as a radius).
  const radiusOf = (item) => trackRect.width * (item.strategy === "boss" ? 0.06 : 0.0475);
  const isClear = (top, bottom) => top >= GAUNTLET_EDGE_CLEAR && bottom <= viewportHeight - GAUNTLET_EDGE_CLEAR;
  const isOut = (top, bottom) => bottom <= 0 || top >= viewportHeight;
  // Cost of an offset: each marker (or landmark) is free when fully out of view or clear; otherwise it is
  // cut by the edge (partly out of view) or sits in the fade zone (a lighter cost). Landmarks weigh little
  // beside markers, so they only break ties.
  const spanCost = (top, bottom, cutCost, fadeCost) => {
    if (isOut(top, bottom) || isClear(top, bottom)) {
      return 0;
    }
    return top < 0 || bottom > viewportHeight ? cutCost : fadeCost;
  };
  const costOf = (off) => {
    let total = 0;
    for (const item of GAUNTLET_STAGES) {
      const centerY = item.y * scale + off;
      total += spanCost(centerY - radiusOf(item), centerY + radiusOf(item), 4, 1);
    }
    for (const [top, bottom] of GAUNTLET_LANDMARK_SPANS) {
      total += spanCost(top * scale + off, bottom * scale + off, 0.1, 0.05);
    }
    return total;
  };
  const currentIsClear = (off) => isClear(stageY + off - radiusOf(stage), stageY + off + radiusOf(stage));
  // Search +-120 px around the centred offset: the lowest cost wins, ties go to the offset nearest the
  // centred target (the current stage as close to 66% down as the search allows). The current stage
  // must itself be clear when any offset in range makes it so. If a marker is still cut by an edge,
  // the search widens once to +-240 px.
  const search = (range, requireClear) => {
    let found = null;
    for (let d = -range; d <= range; d += 1) {
      const off = clamp(baseOffset + d, minOffset, maxOffset);
      if (requireClear && !currentIsClear(off)) {
        continue;
      }
      const cost = costOf(off);
      const distance = Math.abs(off - wantedOffset);
      if (!found || cost < found.cost - 1e-9 || (Math.abs(cost - found.cost) <= 1e-9 && distance < found.distance)) {
        found = { off, cost, distance };
      }
    }
    return found;
  };
  let best = null;
  for (const range of [120, 240]) {
    best = search(range, true) || search(range, false);
    if (best.cost < 4) {
      break;
    }
  }
  // the offset is where the track's top would sit in the window; the window scrolls instead, and the
  // track sits GAUNTLET_SCROLL_PAD below the scroll top, so scrollTop = pad - offset (0 at maxOffset,
  // scrollHeight - clientHeight at minOffset). Smooth: the glide the transform transition used to give
  viewportEl.scrollTo({ top: GAUNTLET_SCROLL_PAD - best.off, behavior: "smooth" });
}

function refreshGauntletUI() {
  if (!gauntletScreenEl) {
    return;
  }
  const stageIndex = clamp(gauntletProgress.unlockedStage, 0, GAUNTLET_STAGES.length - 1);
  const stage = getGauntletStage(stageIndex);
  const stagePercent = getGauntletStagePercent(stage);
  if (gauntletOrbEl) {
    const fromStage = gauntletTravelFromStage !== null ? getGauntletStage(gauntletTravelFromStage) : null;
    const fromPercent = fromStage ? getGauntletStagePercent(fromStage) : null;
    gauntletOrbEl.style.left = `${(fromPercent || stagePercent).x}%`;
    gauntletOrbEl.style.top = `${(fromPercent || stagePercent).y}%`;
    if (fromPercent) {
      requestAnimationFrame(() => {
        gauntletOrbEl.style.left = `${stagePercent.x}%`;
        gauntletOrbEl.style.top = `${stagePercent.y}%`;
        gauntletTravelFromStage = null;
      });
    }
  }
  if (gauntletMarkerLayerEl) {
    gauntletMarkerLayerEl.innerHTML = GAUNTLET_STAGES.map((item, index) => {
      const stateName = index < stageIndex ? "complete" : index === stageIndex ? "current" : "pending";
      const percent = getGauntletStagePercent(item);
      const boss = item.strategy === "boss" ? " boss" : "";
      return `
        <div class="gauntlet-marker ${stateName} difficulty-${item.difficulty}${boss}" style="left: ${percent.x}%; top: ${percent.y}%;" aria-label="Stage ${index + 1}: ${item.strategy}"><span class="gauntlet-marker-num">${index + 1}</span></div>
      `;
    }).join("");
  }
  if (gauntletStartBtnEl) {
    gauntletStartBtnEl.textContent = `Engage \u00b7 Stage ${stageIndex + 1}`;
  }
  requestAnimationFrame(() => focusGauntletViewport(stageIndex));
}

function advanceGauntletAfterVictory(stageIndex) {
  if (!Number.isFinite(stageIndex)) {
    return false;
  }
  gauntletProgress.completedWins = clamp(
    Math.max(Number(gauntletProgress.completedWins) || 0, stageIndex + 1),
    0,
    GAUNTLET_STAGES.length
  );
  const nextStageIndex = clamp(stageIndex + 1, 0, GAUNTLET_STAGES.length - 1);
  if (nextStageIndex <= gauntletProgress.unlockedStage) {
    saveGauntletProgress();
    return false;
  }
  gauntletTravelFromStage = stageIndex;
  gauntletProgress.unlockedStage = nextStageIndex;
  saveGauntletProgress();
  return true;
}

function recordCurrentGauntletResult(won) {
  gauntletProgress.currentMatches = Math.max(0, Math.floor(Number(gauntletProgress.currentMatches) || 0)) + 1;
  gauntletProgress.currentWins = clamp(
    Math.floor(Number(gauntletProgress.currentWins) || 0) + (won ? 1 : 0),
    0,
    gauntletProgress.currentMatches
  );
  saveGauntletProgress();
}

function getCurrentGauntletWinRate() {
  const matches = Math.max(0, Math.floor(Number(gauntletProgress.currentMatches) || 0));
  if (matches <= 0) {
    return 0;
  }
  const wins = clamp(Math.floor(Number(gauntletProgress.currentWins) || 0), 0, matches);
  return Math.round((wins / matches) * 100);
}
