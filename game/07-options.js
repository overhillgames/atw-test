// Line Tower Wars runtime, part 07 of 20: art/music option rendering, AI difficulty/strategy/stage getters, loadOptions/saveOptions.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function getArtPackOption(artPackId) {
  const normalizedArtPackId = normalizeArtPackId(artPackId);
  return ART_PACK_OPTIONS.find((option) => option.id === normalizedArtPackId) || ART_PACK_OPTIONS[0];
}

function getArtPackForPreview(option) {
  const sourceId = ART_PACKS[option.id] ? option.id : (option.previewSource || DEFAULT_OPTIONS.artPack);
  return ART_PACKS[sourceId] || ART_PACKS[DEFAULT_OPTIONS.artPack];
}

function getAttackerPreviewMarkup(pack, attackerId, alt) {
  const fallbackPack = ART_PACKS[DEFAULT_OPTIONS.artPack];
  const spriteCfg = pack.attackerSprites?.[attackerId] || fallbackPack.attackerSprites?.[attackerId];
  const iconPath = pack.attackerIcons?.[attackerId] || fallbackPack.attackerIcons?.[attackerId] || null;
  if (spriteCfg && !iconPath) {
    return `<span class="art-thumb-sprite" style="--sprite-url: url('${spriteCfg.path}'); --sprite-frames: ${spriteCfg.frames};" role="img" aria-label="${alt}"></span>`;
  }
  return `<img src="${iconPath}" alt="${alt}" />`;
}

function renderArtPackOptions() {
  if (!artPackGridEl) {
    return;
  }

  artPackGridEl.innerHTML = ART_PACK_OPTIONS.filter((option) => option.hidden !== true).map((option) => {
    const pack = getArtPackForPreview(option);
    const fallbackPack = ART_PACKS[DEFAULT_OPTIONS.artPack];
    const preview = option.preview;
    const previewPack = {
      ...pack,
      towers: getArtPackSideAssets(pack, "player", "towers"),
      attackerIcons: getArtPackSideAssets(pack, "player", "attackerIcons"),
      attackerSprites: getArtPackSideAssets(pack, "player", "attackerSprites")
    };
    const towerA = previewPack.towers?.[preview.towers[0]] || fallbackPack.towers[preview.towers[0]];
    const towerB = previewPack.towers?.[preview.towers[1]] || fallbackPack.towers[preview.towers[1]];
    const subText = option.unlocked ? (option.artist || "") : "In-App Purchase";
    const subLabel = subText ? `<span class="row-sub">${subText}</span>` : "";
    const iconLink = option.icon && option.instagram
      ? `<a class="artist-social-link" href="${option.instagram}" target="_blank" rel="noopener noreferrer" aria-label="${option.name} Instagram"><img src="${option.icon}" alt="" /></a>`
      : (option.icon ? `<img src="${option.icon}" alt="" />` : "");
    const thumbnailCells = option.unlocked
      ? `
          <span class="art-thumb-cell">${getAttackerPreviewMarkup(previewPack, preview.creeps[0], `${option.name} creep`)}</span>
          <span class="art-thumb-cell"><img src="${towerA}" alt="" /></span>
          <span class="art-thumb-cell"><img src="${towerB}" alt="" /></span>
          <span class="art-thumb-cell">${getAttackerPreviewMarkup(previewPack, preview.creeps[1], `${option.name} creep`)}</span>
        `
      : `
          <span class="art-thumb-cell locked-placeholder"></span>
          <span class="art-thumb-cell locked-placeholder"></span>
          <span class="art-thumb-cell locked-placeholder"></span>
          <span class="art-thumb-cell locked-placeholder"></span>
        `;
    return `
      <div class="art-pack-option${option.unlocked ? "" : " locked"}" role="radio" tabindex="${option.unlocked ? "0" : "-1"}" aria-checked="false" data-art-pack="${option.id}" ${option.unlocked ? "" : "aria-disabled=\"true\""} aria-label="${option.name}${option.unlocked ? "" : " locked"}">
        <span class="art-thumb-grid" aria-hidden="true">
          ${thumbnailCells}
        </span>
        <span class="row-text">
          <strong class="row-title">${option.name}</strong>
          ${subLabel}
        </span>
        ${iconLink}
      </div>
    `;
  }).join("");
}

function refreshArtOptionsUI() {
  if (!artPackGridEl) {
    return;
  }
  for (const option of artPackGridEl.querySelectorAll(".art-pack-option")) {
    const selected = option.dataset.artPack === gameOptions.artPack;
    option.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function getMusicPackOption(musicPackId) {
  return MUSIC_PACK_OPTIONS.find((option) => option.id === musicPackId) || MUSIC_PACK_OPTIONS[0];
}

function renderMusicPackOptions() {
  if (!musicPackGridEl) {
    return;
  }

  musicPackGridEl.innerHTML = MUSIC_PACK_OPTIONS.map((option) => {
    const trackCount = option.tracks?.length || option.trackCount || 0;
    const trackLabel = trackCount > 0
      ? `${trackCount} track${trackCount === 1 ? "" : "s"}`
      : "Awaiting tracks";
    const icon = option.icon
      ? `<img class="music-pack-icon" src="${option.icon}" alt="" />`
      : `<span class="music-slot-icon" aria-hidden="true"></span>`;
    const iconMarkup = option.icon && option.link
      ? `<a class="music-composer-link" href="${option.link}" target="_blank" rel="noopener noreferrer" aria-label="${option.name} link">${icon}</a>`
      : icon;
    const subText = option.unlocked ? trackLabel : "In-App Purchase";
    const optionClass = `music-pack-option${option.unlocked ? "" : " locked"}`;
    return `
      <div class="${optionClass}" role="radio" tabindex="${option.unlocked ? "0" : "-1"}" aria-checked="false" data-music-pack="${option.id}" ${option.unlocked ? "" : "aria-disabled=\"true\""} aria-label="${option.name}${option.unlocked ? "" : " locked"}">
        ${iconMarkup}
        <span class="row-text">
          <strong class="row-title">${option.name}</strong>
          <span class="row-sub">${subText}</span>
        </span>
      </div>
    `;
  }).join("");
}

function refreshMusicOptionsUI() {
  if (musicVolumeSliderEl) {
    musicVolumeSliderEl.value = String(gameOptions.musicVolume);
    musicVolumeSliderEl.style.setProperty("--fill", `${gameOptions.musicVolume}%`);
  }
  if (musicVolumeValueEl) {
    musicVolumeValueEl.value = `${gameOptions.musicVolume}%`;
    musicVolumeValueEl.textContent = `${gameOptions.musicVolume}%`;
  }
  if (sfxVolumeSliderEl) {
    sfxVolumeSliderEl.value = String(gameOptions.sfxVolume);
    sfxVolumeSliderEl.style.setProperty("--fill", `${gameOptions.sfxVolume}%`);
  }
  if (sfxVolumeValueEl) {
    sfxVolumeValueEl.value = `${gameOptions.sfxVolume}%`;
    sfxVolumeValueEl.textContent = `${gameOptions.sfxVolume}%`;
  }
  if (!musicPackGridEl) {
    return;
  }
  for (const option of musicPackGridEl.querySelectorAll(".music-pack-option")) {
    const selected = option.dataset.musicPack === gameOptions.musicPack;
    option.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function getAIDifficultySettings() {
  const difficultyId = state.aiDifficultyOverride || gameOptions.difficulty;
  return AI_DIFFICULTY_SETTINGS[difficultyId] || AI_DIFFICULTY_SETTINGS[DEFAULT_OPTIONS.difficulty];
}

function getAIStrategySettings() {
  const difficulty = getAIDifficultySettings();
  const strategyId = state.aiStrategyOverride || difficulty.defaultStrategy || "counter";
  return AI_STRATEGY_SETTINGS[strategyId] || AI_STRATEGY_SETTINGS.counter;
}

function getAIGauntletStageSettings() {
  if (!state.gauntletRun) {
    return null;
  }
  const stageIndex = clamp(Math.floor(state.gauntletRun.stageIndex), 0, GAUNTLET_STAGES.length - 1);
  return AI_GAUNTLET_STAGE_SETTINGS[stageIndex] || null;
}

function getAIManaBonusPerRound() {
  const configuredBonus = getAIDifficultySettings().manaBonusPerRound;
  return Number.isFinite(configuredBonus) ? configuredBonus : AI_MANA_BONUS_PER_ROUND;
}

function loadOptions() {
  try {
    const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!raw) {
      gameOptions = { ...DEFAULT_OPTIONS };
      applyArtPack(gameOptions.artPack);
      return;
    }
    const parsed = JSON.parse(raw);
    gameOptions = {
      ...DEFAULT_OPTIONS,
      ...parsed
    };
    gameOptions.artPack = normalizeArtPackId(gameOptions.artPack);
    if (!AI_DIFFICULTY_SETTINGS[gameOptions.difficulty]) {
      gameOptions.difficulty = DEFAULT_OPTIONS.difficulty;
    }
    if (!isPickableArtPack(gameOptions.artPack)) {
      gameOptions.artPack = DEFAULT_OPTIONS.artPack;
    }
    if (gameOptions.musicPack === "composer1") {
      gameOptions.musicPack = DEFAULT_OPTIONS.musicPack;
    } else if (gameOptions.musicPack === "composer2") {
      gameOptions.musicPack = "martinBiesecke";
    }
    if (!MUSIC_PACK_OPTIONS.some((option) => option.id === gameOptions.musicPack)) {
      gameOptions.musicPack = DEFAULT_OPTIONS.musicPack;
    }
    gameOptions.musicVolume = clamp(Number(gameOptions.musicVolume), 0, 100);
    gameOptions.sfxVolume = clamp(Number(gameOptions.sfxVolume), 0, 100);
    delete gameOptions.view3d;
  } catch {
    gameOptions = { ...DEFAULT_OPTIONS };
  }
  applyArtPack(gameOptions.artPack);
}

function saveOptions() {
  try {
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(gameOptions));
  } catch {
  }
}
