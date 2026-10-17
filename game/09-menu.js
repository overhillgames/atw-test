// Line Tower Wars runtime, part 09 of 20: setDifficulty/ArtPack/MusicPack/volumes, refresh*UI, setScreen, loading animatic.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function setDifficulty(difficulty) {
  if (!AI_DIFFICULTY_SETTINGS[difficulty]) {
    return;
  }
  gameOptions.difficulty = difficulty;
  saveOptions();
  refreshOptionsUI();
}

function setArtPack(artPackId) {
  const normalizedArtPackId = normalizeArtPackId(artPackId);
  const option = getArtPackOption(normalizedArtPackId);
  if (!option.unlocked || !ART_PACKS[normalizedArtPackId]) {
    return;
  }
  gameOptions.artPack = normalizedArtPackId;
  applyArtPack(normalizedArtPackId, true);
  saveOptions();
  refreshArtOptionsUI();
}

function setMusicPack(musicPackId) {
  const option = getMusicPackOption(musicPackId);
  if (!option.unlocked) {
    return;
  }
  gameOptions.musicPack = option.id;
  activeMusicPackId = option.id;
  activeMusicTrackIndex = 0;
  if (musicAudioEl) {
    musicAudioEl.pause();
    musicAudioEl.removeAttribute("src");
    musicAudioEl.load();
  }
  saveOptions();
  refreshMusicOptionsUI();
  syncMusicPlaybackForScreen();
}

function setMusicVolume(volume) {
  gameOptions.musicVolume = clamp(Number(volume), 0, 100);
  updateMusicVolume();
  saveOptions();
  refreshMusicOptionsUI();
}

function setSfxVolume(volume) {
  gameOptions.sfxVolume = clamp(Number(volume), 0, 100);
  updateSfxVolume();
  if (gauntletVictoryAudioEl) {
    gauntletVictoryAudioEl.volume = getVolumeScale(gameOptions.sfxVolume);
  }
  saveOptions();
  refreshMusicOptionsUI();
}

function refreshOptionsUI() {
  const settings = getAIDifficultySettings();
  if (difficultySummaryEl) {
    const bonus = settings.manaBonusPerRound;
    const bonusSentence = bonus > 0 ? ` The AI gets ${bonus} extra mana every round.` : " The AI gets the same mana as you.";
    difficultySummaryEl.textContent = `${settings.summary}${bonusSentence}`;
  }
  renderArtPackOptions();
  renderMusicPackOptions();
  if (!difficultyListEl) {
    return;
  }
  for (const option of difficultyListEl.querySelectorAll(".difficulty-option")) {
    const selected = option.dataset.difficulty === gameOptions.difficulty;
    option.setAttribute("aria-checked", selected ? "true" : "false");
    const bonusEl = option.querySelector(".difficulty-bonus");
    if (bonusEl) {
      const optionBonus = AI_DIFFICULTY_SETTINGS[option.dataset.difficulty].manaBonusPerRound;
      bonusEl.textContent = optionBonus > 0 ? `+${optionBonus} mana a round` : "Even mana";
    }
  }
  refreshMusicOptionsUI();
  refreshArtOptionsUI();
}

function refreshMenuUI() {
  const profile = getProfileStats();
  menuMetaEl.textContent = profile.matchesPlayed > 0
    ? `${profile.matchesPlayed} matches played · ${profile.wins} wins · Best streak ${profile.bestWinStreak}`
    : "No records yet. Your first match will begin a fresh commander profile.";
}

function refreshRecordsUI() {
  const profile = getProfileStats();
  recordsUpdatedAtEl.textContent = formatUpdatedAt(persistentStats.updatedAt);
  renderStatCards(recordsOverviewEl, [
    { label: "Matches played", value: profile.matchesPlayed },
    { label: "Wins", value: profile.wins },
    { label: "Best win streak", value: profile.bestWinStreak },
    { label: "Win rate", value: `${getWinRate(profile)}%` }
  ]);

  recordsMilestonesEl.innerHTML = getMilestones(profile).map((item) => {
    // bar width: value / target as a whole percent, 0-100; a zero target reads as 0 %
    const percent = item.target > 0 ? clamp(Math.round((item.value / item.target) * 100), 0, 100) : 0;
    return `
    <div class="milestone-row${item.done ? " done" : ""}">
      <span class="milestone-head"><span class="row-title">${item.label}</span><span class="row-sub">${item.progress}</span></span>
      <span class="milestone-bar"><span style="width: ${percent}%"></span></span>
    </div>
  `;
  }).join("");

  renderRankingRows(recordsTopAttackersEl, getTopEntries(persistentStats.unitScores.player, attackerDefs, 3), "Top attackers are waiting");
  renderRankingRows(recordsTopTowersEl, getTopEntries(persistentStats.towerKills.player, towerDefs, 3), "Top towers are waiting");
}

function refreshMetaUI() {
  refreshMenuUI();
  refreshGauntletUI();
  refreshOptionsUI();
  refreshRecordsUI();
}

function setScreen(screen) {
  const previousScreen = state.screen;
  state.screen = screen;
  if (previousScreen === "game" && screen !== "game") {
    state.cardDetailId = null;
    renderPixiCardDetailPanel();
  }
  menuScreenEl.classList.toggle("hidden", screen !== "menu");
  menuScreenEl.classList.remove("choosing", "choosing-online"); // the menu always opens on Play Match / Play Online, never mid-choice
  gauntletScreenEl.classList.toggle("hidden", screen !== "gauntlet");
  difficultyOptionsScreenEl.classList.toggle("hidden", screen !== "difficultyOptions");
  musicOptionsScreenEl.classList.toggle("hidden", screen !== "musicOptions");
  artOptionsScreenEl.classList.toggle("hidden", screen !== "artOptions");
  recordsScreenEl.classList.toggle("hidden", screen !== "records");
  gameScreenEl.classList.toggle("hidden", screen !== "game");
  refreshMenuUI();
  refreshOptionsUI();
  refreshRecordsUI();
  updateOrientationNotice();
  requestAnimationFrame(resizeBattlefieldFrame);
  if (screen === "gauntlet") {
    requestAnimationFrame(() => focusGauntletViewport());
  }
  if (screen !== "game") {
    requestAnimationFrame(() => {
      appShellEl.scrollTop = 0;
    });
  }
  syncMusicPlaybackForScreen();
}

function dismissLoadingAnimatic() {
  if (loadingAnimaticDismissed) {
    return;
  }
  loadingAnimaticDismissed = true;
  if (loadingAnimaticTimer) {
    window.clearTimeout(loadingAnimaticTimer);
    loadingAnimaticTimer = null;
  }
  if (loadingAnimaticVideoEl) {
    loadingAnimaticVideoEl.pause();
    loadingAnimaticVideoEl.removeAttribute("src");
    loadingAnimaticVideoEl.load();
  }
  loadingAnimaticEl?.classList.add("dismissed");
  window.setTimeout(() => {
    loadingAnimaticEl?.classList.add("hidden");
  }, 260);
}

function setLoadingAnimaticSource(index) {
  if (!loadingAnimaticVideoEl || !INTRO_ANIMATIC_SEQUENCE[index]) {
    return false;
  }
  loadingAnimaticVideoEl.classList.remove("fading-out");
  loadingAnimaticVideoEl.src = INTRO_ANIMATIC_SEQUENCE[index];
  loadingAnimaticVideoEl.load();
  return true;
}

function syncLoadingAnimaticAspect() {
  if (!loadingAnimaticEl || !loadingAnimaticVideoEl) {
    return;
  }
  const { videoWidth, videoHeight } = loadingAnimaticVideoEl;
  if (!videoWidth || !videoHeight) {
    return;
  }
  loadingAnimaticEl.style.setProperty("--loading-video-aspect", String(videoWidth / videoHeight));
}

function updateLoadingAnimaticFade() {
  if (!loadingAnimaticVideoEl || loadingAnimaticDismissed) {
    return;
  }
  const isFinalAnimatic = loadingAnimaticIndex === INTRO_ANIMATIC_SEQUENCE.length - 1;
  const { currentTime, duration } = loadingAnimaticVideoEl;
  if (isFinalAnimatic && Number.isFinite(duration) && duration - currentTime <= 1.1) {
    loadingAnimaticVideoEl.classList.add("fading-out");
  }
}

function advanceLoadingAnimatic() {
  if (loadingAnimaticDismissed) {
    return;
  }
  loadingAnimaticIndex += 1;
  if (loadingAnimaticIndex >= INTRO_ANIMATIC_SEQUENCE.length || !setLoadingAnimaticSource(loadingAnimaticIndex)) {
    dismissLoadingAnimatic();
    return;
  }
  window.setTimeout(tryPlayLoadingAnimaticWithSound, 0);
}

function tryPlayLoadingAnimaticWithSound() {
  if (loadingAnimaticDismissed || !loadingAnimaticVideoEl) {
    return;
  }
  loadingAnimaticVideoEl.muted = loadingAnimaticMutedFallback;
  loadingAnimaticVideoEl.volume = getVolumeScale(gameOptions.sfxVolume);
  const playPromise = loadingAnimaticVideoEl.play();
  if (!playPromise || typeof playPromise.catch !== "function") {
    return;
  }
  playPromise.catch(() => {
    if (loadingAnimaticDismissed || !loadingAnimaticVideoEl) {
      return;
    }
    loadingAnimaticVideoEl.muted = true;
    loadingAnimaticMutedFallback = true;
    loadingAnimaticVideoEl.play().catch(() => {
      window.setTimeout(advanceLoadingAnimatic, 800);
    });
  });
}

function initLoadingAnimatic() {
  if (!loadingAnimaticEl || !loadingAnimaticVideoEl) {
    return;
  }
  if (SKIP_INTRO_ANIMATIC) {
    dismissLoadingAnimatic();
    return;
  }
  if (!setLoadingAnimaticSource(loadingAnimaticIndex)) {
    dismissLoadingAnimatic();
    return;
  }
  loadingAnimaticVideoEl.volume = getVolumeScale(gameOptions.sfxVolume);
  loadingAnimaticVideoEl.addEventListener("loadedmetadata", syncLoadingAnimaticAspect);
  loadingAnimaticVideoEl.addEventListener("timeupdate", updateLoadingAnimaticFade);
  loadingAnimaticVideoEl.addEventListener("ended", advanceLoadingAnimatic);
  loadingAnimaticVideoEl.addEventListener("error", () => {
    window.setTimeout(advanceLoadingAnimatic, 800);
  });
  loadingAnimaticSkipBtnEl?.addEventListener("click", () => {
    unlockAudioFromGesture();
    dismissLoadingAnimatic();
  });
  loadingAnimaticTimer = window.setTimeout(dismissLoadingAnimatic, INTRO_ANIMATIC_MAX_SECONDS * 1000);
  window.setTimeout(tryPlayLoadingAnimaticWithSound, 0);
}
