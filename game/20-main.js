// Line Tower Wars runtime, part 20 of 20: returnToMenuFromMatch, submitReadyForBattle, togglePause, button/slider listeners, init sequence.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function returnToMenuFromMatch() {
  // leaving a live match is a quit (the menu has no Resume); the card asks first. Game over goes straight to the menu.
  if (state.hasActiveMatch && !state.gameOver) {
    openQuitConfirm();
    return;
  }
  setScreen("menu");
}

function openQuitConfirm() { quitOverlayEl?.classList.remove("hidden"); }
function closeQuitConfirm() { quitOverlayEl?.classList.add("hidden"); }
// the dock's one choice state (2026-10-16: the old Quick Match and the online sub-row are unplugged, tug is the match):
// Play Match swaps row 1 to Solo Match / Gauntlet (.choosing) and the 2 x 2 to one Back (jon-menu.css). Play Online has
// no sub-row: index.html's click map sends it straight to the online search (tugNetPlayOnline)
function openPlayChoice() { menuScreenEl.classList.add("choosing"); }
function closePlayChoice() { menuScreenEl.classList.remove("choosing"); }
// ends the match for good: online ends the session; solo drops the save. Then the menu.
function quitMatchNow() {
  closeQuitConfirm();
  if (multiplayerRole !== null) { window.Lobby && Lobby.endSession(); }
  clearSavedMatchState();
  if (state.mode === "tug") { tugOnQuit(); }
  state.hasActiveMatch = false;
  state.paused = false;
  updateStatus("Match quit.");
  setScreen("menu");
}

replayBtnEl.addEventListener("click", () => {
  returnToMenuFromMatch();
});

function submitReadyForBattle() {
  if (state.phase !== "prep" || state.gameOver || state.paused || state.battleSkipUsedThisRound) {
    return;
  }
  state.battleSkipUsedThisRound = true;
  state.phaseTimer = 0;
  refreshHUD();
  updateStatus(multiplayerRole !== null ? "Ready. Waiting for opponent..." : "Ready. Starting battle.");
  launchWave();
}

battleSkipBtnEl.addEventListener("click", submitReadyForBattle);
readyBtnEl?.addEventListener("click", submitReadyForBattle);

shopUpgradeBtnEl.addEventListener("click", () => {
  if (state.shopSelectionType === "tower") {
    upgradeSelectedTower();
  } else {
    upgradeSelectedAttacker();
  }
});

shopStartBtnEl.addEventListener("click", () => {
  if (state.phase !== "shop") {
    return;
  }
  if (multiplayerRole !== null && window.Lobby) {
    window.Lobby.onShopStart();
    return;
  }
  beginRoundBanner();
});

function togglePause() {
  if (state.gameOver || state.phase === "shop" || state.phase === "banner") {
    return;
  }
  state.paused = !state.paused;
  syncPauseButtons();
  syncMusicPlaybackForScreen();
  saveMatchStateNow();
  if (state.paused) {
    updateStatus("Paused.");
  } else {
    updateStatus(state.phase === "prep" ? "Prep resumed." : "Battle resumed.");
  }
}

pauseBtnEl.addEventListener("click", togglePause);
floatingPauseBtnEl?.addEventListener("click", togglePause);
pauseResumeBtnEl?.addEventListener("click", togglePause);
pauseMenuBtnEl?.addEventListener("click", returnToMenuFromMatch);
quitCancelBtnEl?.addEventListener("click", closeQuitConfirm);
quitConfirmBtnEl?.addEventListener("click", quitMatchNow);

// SFX hook (Baz, 2026-09-30): menu taps get a sound later. Call it here and in every menu/options button listener below; nothing wired yet.
openPlayBtnEl?.addEventListener("click", openPlayChoice);
menuBackBtnEl?.addEventListener("click", closePlayChoice);
// 2026-10-16: the old Quick Match button (#play-match-btn) is gone from the menu, so its listener went with it.
// Solo Match: tug vs the AI (game/tug/); index.html's click map must not list it
document.getElementById("tug-match-btn")?.addEventListener("click", () => {
  startNewMatch({ mode: "tug" });
});

openRecordsBtnEl.addEventListener("click", () => {
  setScreen("records");
});

openGauntletBtnEl.addEventListener("click", () => {
  setScreen("gauntlet");
});

gauntletBackBtnEl.addEventListener("click", () => {
  setScreen("menu");
});

gauntletStartBtnEl.addEventListener("click", () => {
  startGauntletChallenge();
});

openDifficultyOptionsBtnEl.addEventListener("click", () => {
  setScreen("difficultyOptions");
});

openMusicOptionsBtnEl.addEventListener("click", () => {
  setScreen("musicOptions");
});

openArtOptionsBtnEl.addEventListener("click", () => {
  setScreen("artOptions");
});

for (const optionsBackBtnEl of optionsBackBtnEls) {
  optionsBackBtnEl.addEventListener("click", () => {
    setScreen("menu");
  });
}

musicVolumeSliderEl.addEventListener("input", (event) => {
  setMusicVolume(event.target.value);
});

sfxVolumeSliderEl.addEventListener("input", (event) => {
  setSfxVolume(event.target.value);
});

difficultyListEl.addEventListener("click", (event) => {
  const option = event.target.closest(".difficulty-option");
  if (!option) {
    return;
  }
  setDifficulty(option.dataset.difficulty);
});

musicPackGridEl.addEventListener("click", (event) => {
  if (event.target.closest(".music-composer-link")) {
    return;
  }
  const option = event.target.closest(".music-pack-option");
  if (!option) {
    return;
  }
  setMusicPack(option.dataset.musicPack);
});

musicPackGridEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const option = event.target.closest(".music-pack-option");
  if (!option) {
    return;
  }
  event.preventDefault();
  setMusicPack(option.dataset.musicPack);
});

artPackGridEl.addEventListener("click", (event) => {
  if (event.target.closest(".artist-social-link")) {
    return;
  }
  const option = event.target.closest(".art-pack-option");
  if (!option) {
    return;
  }
  setArtPack(option.dataset.artPack);
});

artPackGridEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const option = event.target.closest(".art-pack-option");
  if (!option) {
    return;
  }
  event.preventDefault();
  setArtPack(option.dataset.artPack);
});

recordsBackBtnEl.addEventListener("click", () => {
  setScreen("menu");
});

progressBtnEl?.addEventListener("click", () => {
  if (state.hasActiveMatch && !state.gameOver) {
    openQuitConfirm();
    return;
  }
  setScreen("records");
});

homeBtnEl?.addEventListener("click", () => {
  returnToMenuFromMatch();
});

matchPlayAgainBtnEl.addEventListener("click", () => {
  startNewMatch();
});

matchContinueBtnEl?.addEventListener("click", () => {
  continueFromMatchResults();
});

matchEndOverlayEl?.addEventListener("click", () => {
  if (!pendingGauntletReturn) {
    return;
  }
  continueFromMatchResults();
});

matchRecordsBtnEl?.addEventListener("click", () => {
  setScreen("records");
});

matchHomeBtnEl.addEventListener("click", () => {
  returnToMenuFromMatch();
});

window.addEventListener("resize", updateViewportHeight);
window.addEventListener("orientationchange", () => {
  updateViewportHeight();
  lockLandscapeOrientation();
});
if (window.visualViewport?.addEventListener) {
  window.visualViewport.addEventListener("resize", updateViewportHeight);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    lastAppHiddenAt = performance.now();
    wasPausedBeforeBackground = state.paused;
    if (state.hasActiveMatch && !state.gameOver) {
      state.paused = true;
      saveMatchStateNow();
      queueStatsSave();
    }
    pauseMusicForMenu();
    return;
  }

  updateViewportHeight();
  lockLandscapeOrientation();
  previousTime = performance.now();
  if (state.hasActiveMatch && !state.gameOver) {
    state.paused = wasPausedBeforeBackground;
    saveMatchStateNow();
  }
  resumeAudioAfterBackground();
});
document.addEventListener("touchmove", preventBrowserGestures, { passive: false });
document.addEventListener("contextmenu", preventBrowserGestures);
document.addEventListener("pointerdown", unlockAudioFromGesture, { passive: true });

createTowerSlots();
setupArenaDrop();
updateViewportHeight();
loadOptions();
initLoadingAnimatic();
loadGauntletProgress();
createCards();
loadPersistentStats();
resetMatch();
// 2026-10-16: the old match is unplugged (tug is the match and is never saved), so any saved match is dropped and the
// game opens on the menu. restoreSavedMatchState() stays defined (06-stats.js) for the later delete job; nothing calls it.
clearSavedMatchState();
const restoredMatch = false;
state.hasActiveMatch = restoredMatch;
state.paused = restoredMatch;
setScreen(restoredMatch ? "game" : "menu");
// published test builds only: build-info.js carries a title-screen label (locally there is none and the tag stays hidden)
const buildTagEl = document.getElementById("build-tag");
if (buildTagEl && window.ATW_BUILD && typeof window.ATW_BUILD.label === "string" && window.ATW_BUILD.label) {
  buildTagEl.textContent = window.ATW_BUILD.label;
  buildTagEl.hidden = false;
}
lockLandscapeOrientation();
registerNativeAppLifecycle();
resizeBattlefieldFrame();
refreshAllUI();
ensurePixiViewport();
requestAnimationFrame(gameLoop);
