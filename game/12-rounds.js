// Line Tower Wars runtime, part 12 of 20: native lifecycle, updateStatus, makeAttacker, launchWave, beginPrepPhase, round banner, openRoundShop, finishMatch.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function registerNativeAppLifecycle() {
  const appPlugin = getCapacitorPlugin("App");
  if (!appPlugin?.addListener) {
    return;
  }

  appPlugin.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) {
      wasPausedBeforeBackground = state.paused;
      if (state.hasActiveMatch && !state.gameOver) {
        state.paused = true;
        saveMatchStateNow();
        queueStatsSave();
      }
      pauseMusicForMenu();
      return;
    }

    previousTime = performance.now();
    if (state.hasActiveMatch && !state.gameOver) {
      state.paused = wasPausedBeforeBackground;
    }
    updateViewportHeight();
    resizeBattlefieldFrame();
    lockLandscapeOrientation();
    resumeAudioAfterBackground();
    refreshAllUI();
  });
}

function updateStatus(text) {
  statusTextEl.textContent = text;
}

function makeAttacker(owner, attackerId, sequenceOffset, fanSeedOverride) {
  const def = getAttackerDef(attackerId);
  const id = state.nextUnitId;
  state.nextUnitId += 1;
  // In multiplayer, opponent units use precomputed fanSeeds for determinism
  const fanSeed = (fanSeedOverride !== undefined) ? fanSeedOverride : (Math.random() * 2 - 1);
  const upgradeMultiplier = owner === "player"
    ? Math.pow(ATTACKER_UPGRADE_MULTIPLIER, state.playerAttackerUpgrades[attackerId] || 0)
    : Math.pow(ATTACKER_UPGRADE_MULTIPLIER, opponentAttackerUpgrades[attackerId] || 0);

  return {
    id,
    owner,
    defId: def.id,
    hp: def.hp * upgradeMultiplier,
    maxHp: def.hp * upgradeMultiplier,
    baseSpeed: def.speed * upgradeMultiplier,
    speed: def.speed * upgradeMultiplier,
    color: def.color,
    progress: -sequenceOffset,
    fanSeed,
    slowTimer: 0,
    poisonTimer: 0,
    poisonTicksRemaining: 0,
    poisonTickInterval: 1,
    poisonTickTimer: 0,
    poisonBaseDamage: 0,
    poisonSourceOwner: null,
    shootCooldown: 0,
    isDefeated: false
  };
}

function buildSpawnOffsets(queue) {
  const offsets = [];
  let cumulative = 0;
  for (let i = 0; i < queue.length; i += 1) {
    offsets.push(cumulative);
    const baseGap = 0.035;
    const leadGapBonus = queue[i] === "tank" ? 0.11 : 0;
    cumulative += baseGap + leadGapBonus;
  }
  return offsets;
}

function launchWave() {
  // In multiplayer: hand off to lobby.js to sync with opponent first
  if (multiplayerRole !== null && window.Lobby) {
    window.Lobby.submitPrepPhaseData();
    return;
  }
  finalizeAIMovesBeforeBattle();
  _doLaunchWave();
}

// Internal battle launch — called directly in singleplayer, or by lobby.js
// after both players have submitted their prep data.
function _doLaunchWave() {
  state.phase = "battle";
  state.battleStartTimer = BATTLE_START_SECONDS; // the lane stays empty and quiet until the Battle card is gone
  state.aiDraftDone = false;
  clearSelectedTower();

  const aiFanSeeds = state._aiFanSeeds || [];
  const playerOffsets = buildSpawnOffsets(state.playerQueue);
  const aiOffsets = buildSpawnOffsets(state.aiQueue);
  state.attackersPlayer = state.playerQueue.map((attackerId, idx) => makeAttacker("player", attackerId, playerOffsets[idx]));
  state.attackersAI     = state.aiQueue.map((attackerId, idx)    => makeAttacker("ai", attackerId, aiOffsets[idx], aiFanSeeds[idx]));
  state._aiFanSeeds = [];

  state.projectiles = [];
  state.fireBursts = [];
  state.towerFlashes = [];
  state.towerFireAnimations = [];
  state.deathParticles = [];
  state.deathEffects = [];

  state.playerQueue = [];
  state.aiQueue = [];
  state.playerQueueCounts = {};

  updateStatus("Wave launched. Towers firing.");
  refreshAllUI();
}

function beginPrepPhase() {
  clearTowerFireAnimations();
  state.phase = "prep";
  state.phaseTimer = PREP_SECONDS;
  state.aiDraftDone = false;
  clearSelectedTower();

  if (multiplayerRole !== null) {
    // Opponent IS the AI — suppress local AI draft; aiDraftDone stays false
    // until set true below so updateGame() doesn't try to run prepareAIMoves()
    state.aiDraftDone = true;
  } else {
    prepareAIMoves();
  }
  refreshAllUI();
  updateStatus(`Round ${state.waveNumber} prep. Queue attackers and place towers.`);
}

function beginRoundBanner() {
  clearTowerFireAnimations();
  state.phase = "banner";
  state.roundBannerTimer = ROUND_BANNER_SECONDS;
  state.roundBannerText = `Round ${state.waveNumber}`;
  state.battleSkipUsedThisRound = false;
  clearSelectedTower();
  refreshAllUI();
  updateStatus(`${state.roundBannerText} is about to begin.`);
}

function openRoundShop() {
  const gain = 9 + state.waveNumber;
  state.playerMana = clamp(state.playerMana + gain, 0, MANA_CAP);
  state.aiMana = clamp(state.aiMana + gain + getAIManaBonusPerRound(), 0, MANA_CAP);
  state.roundManaBonusPending.player = 0;
  state.roundManaBonusPending.ai = 0;
  state.waveNumber += 1;
  beginRoundBanner();
  updateStatus(`Round ${state.waveNumber} begins soon.`);
}

function buildMatchSummary() {
  const margin = state.playerScore - state.aiScore;
  const profile = getProfileStats();
  const opponentLabel = multiplayerRole !== null ? multiplayerOpponentName : "AI";
  let title = "Battle Report";
  let copy = `Final score ${state.playerScore} to ${state.aiScore}.`;

  if (state.matchWinner === "player") {
    title = "Victory";
    copy = margin > 1
      ? `You secured the lane ${state.playerScore} to ${state.aiScore} and closed the match with room to spare.`
      : `You edged out ${opponentLabel} ${state.playerScore} to ${state.aiScore} in a tight final round.`;
  } else if (state.matchWinner === "ai") {
    title = "Defeat";
    copy = `${opponentLabel} held the lane ${state.aiScore} to ${state.playerScore}. Review your records, then adjust your next build.`;
  } else {
    title = "Draw";
    copy = `Both commanders finished level at ${state.playerScore}. A sharper lane plan can swing the rematch.`;
  }

  return {
    title,
    copy,
    stats: [
      { label: "Scoreline", value: `${state.playerScore}-${state.aiScore}` },
      { label: "Towers Placed", value: state.matchStats.towersPlaced },
      { label: "Attackers Queued", value: state.matchStats.attackersQueued },
      { label: "Career Matches", value: profile.matchesPlayed }
    ],
    nextGoal: getNextGoalText(profile)
  };
}

function finishMatch() {
  clearTowerFireAnimations();
  fadeOutMatchMusic(true);
  state.phase = "gameover";
  state.gameOver = true;
  if (state.playerScore === state.aiScore) {
    state.matchWinner = "draw";
    state.winnerText = "Draw match.";
  } else if (state.playerScore > state.aiScore) {
    state.matchWinner = "player";
    state.winnerText = "Player wins the match.";
  } else {
    state.matchWinner = "ai";
    state.winnerText = "AI wins the match.";
  }

  const profile = getProfileStats();
  profile.matchesPlayed += 1;
  if (state.matchWinner === "player") {
    profile.wins += 1;
    profile.currentWinStreak += 1;
    profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.currentWinStreak);
  } else if (state.matchWinner === "ai") {
    profile.losses += 1;
    profile.currentWinStreak = 0;
  } else {
    profile.draws += 1;
    profile.currentWinStreak = 0;
  }

  commitMatchUsageStats();
  queueStatsSave();
  state.hasActiveMatch = false;
  const gauntletRun = state.gauntletRun;
  const isGauntletMatch = Boolean(gauntletRun);
  const isGauntletVictory = Boolean(gauntletRun && state.matchWinner === "player");
  // only the frontier stage feeds "Current Gauntlet Win %"; a replay of a cleared stage is practice
  if (isGauntletMatch && gauntletRun.stageIndex === gauntletProgress.unlockedStage) {
    recordCurrentGauntletResult(isGauntletVictory);
  }
  const gauntletAdvanced = isGauntletVictory && advanceGauntletAfterVictory(gauntletRun.stageIndex);
  state.matchSummary = buildMatchSummary();
  if (gauntletRun) {
    state.matchSummary.nextGoal = gauntletAdvanced
      ? `Gauntlet advanced from battle ${gauntletRun.stageIndex + 1} to battle ${gauntletProgress.unlockedStage + 1}.`
      : state.matchWinner === "player"
        ? `Battle ${gauntletRun.stageIndex + 1} is cleared.`
        : `Gauntlet holds at battle ${gauntletRun.stageIndex + 1}.`;
    state.matchSummary.stats = [
      ...state.matchSummary.stats.map((item) => item.label === "Career Matches"
        ? { label: "Gauntlet Progress", value: `${gauntletProgress.completedWins} of ${GAUNTLET_STAGES.length}` }
        : item),
      { label: "Current Gauntlet Win %", value: `${getCurrentGauntletWinRate()}%` }
    ];
  }
  pendingGauntletReturn = isGauntletMatch
    ? {
        fromStageIndex: gauntletRun.stageIndex,
        toStageIndex: gauntletProgress.unlockedStage,
        advanced: gauntletAdvanced
      }
    : null;
  if (isGauntletVictory) {
    playGauntletVictorySfx();
  }
  state.gauntletRun = null;
  state.aiDifficultyOverride = "";
  state.aiStrategyOverride = "";
  state.cardDetailId = null;
  renderPixiCardDetailPanel();
  clearSavedMatchState();
  updateStatus(isGauntletMatch
    ? `${state.winnerText} Review the battle report, then continue the gauntlet.`
    : `${state.winnerText} Review the battle report or start a new match.`);
  refreshAllUI();
}

function continueFromMatchResults() {
  if (!pendingGauntletReturn) {
    return;
  }
  // a win that moved the frontier walks the orb there (advanceGauntletAfterVictory set the glide); otherwise the map
  // stays on the stage just played
  gauntletSelectedStage = pendingGauntletReturn.advanced ? null : pendingGauntletReturn.fromStageIndex;
  pendingGauntletReturn = null;
  setScreen("gauntlet");
  refreshAllUI();
}
window.continueFromMatchResults = continueFromMatchResults;

let _battleResolving = false;
function onBattleFinished() {
  if (_battleResolving) {
    return;
  }
  _battleResolving = true;
  clearTowerFireAnimations();
  const clearFlag = () => { _battleResolving = false; };
  if (multiplayerRole !== null && window.Lobby) {
    Promise.resolve(window.Lobby.onMultiplayerBattleFinished()).finally(clearFlag);
    return;
  }
  try {
    state.completedRounds = clamp((Number(state.completedRounds) || 0) + 1, 0, MAX_ROUNDS);
    if (state.completedRounds >= MAX_ROUNDS) {
      finishMatch();
      return;
    }
    openRoundShop();
  } finally {
    clearFlag();
  }
}

function applyTowerUpgradeToPlacedTowers(towerId) {
  for (let i = 0; i < state.playerTowers.length; i += 1) {
    const tower = state.playerTowers[i];
    if (!tower || tower.id !== towerId) {
      continue;
    }
    tower.damage *= TOWER_UPGRADE_MULTIPLIER;
    tower.range *= TOWER_UPGRADE_MULTIPLIER;
    tower.fireRate /= TOWER_UPGRADE_MULTIPLIER;
  }
}

function upgradeSelectedAttacker() {
  const attackerId = state.shopSelectionId;
  if (state.phase !== "shop") {
    return;
  }
  if ((state.playerAttackerUpgrades[attackerId] || 0) > 0) {
    updateStatus(`${getAttackerDef(attackerId).name} is already upgraded.`);
    refreshAllUI();
    return;
  }
  if (state.playerMana < SHOP_UPGRADE_COST) {
    updateStatus("Not enough mana for that upgrade.");
    triggerPlacementHaptic("error");
    refreshAllUI();
    return;
  }

  state.playerMana -= SHOP_UPGRADE_COST;
  state.playerAttackerUpgrades[attackerId] = 1;
  state.matchStats.upgradesBought += 1;
  updateStatus(`${getAttackerDef(attackerId).name} upgraded for the rest of the match.`);
  triggerPlacementHaptic("success");
  refreshAllUI();
}

function upgradeSelectedTower() {
  const towerId = state.shopSelectionId;
  if (state.phase !== "shop") {
    return;
  }
  if ((state.playerTowerUpgrades[towerId] || 0) >= MAX_TOWER_UPGRADES) {
    updateStatus(`${getTowerDef(towerId).name} is already at max level.`);
    triggerPlacementHaptic("error");
    refreshAllUI();
    return;
  }
  if (state.playerMana < TOWER_UPGRADE_COST) {
    updateStatus("Not enough mana for that upgrade.");
    triggerPlacementHaptic("error");
    refreshAllUI();
    return;
  }

  state.playerMana -= TOWER_UPGRADE_COST;
  state.playerTowerUpgrades[towerId] += 1;
  state.matchStats.upgradesBought += 1;
  applyTowerUpgradeToPlacedTowers(towerId);
  updateStatus(`${getTowerDef(towerId).name} upgraded to level ${getPlayerTowerUpgradeLevel(towerId)} for the rest of the match.`);
  triggerPlacementHaptic("success");
  refreshAllUI();
}
