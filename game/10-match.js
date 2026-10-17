// Line Tower Wars runtime, part 10 of 20: scoring, kill records, createTowerInstance, resetMatch, startNewMatch, startGauntletChallenge.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function recordUnitScore(attackerId, owner) {
  persistentStats.unitScores.total[attackerId] += 1;
  persistentStats.unitScores[owner][attackerId] += 1;
  queueStatsSave();
}

function recordTowerKill(towerId, owner) {
  persistentStats.towerKills.total[towerId] += 1;
  persistentStats.towerKills[owner][towerId] += 1;
  queueStatsSave();
}

function grantRoundManaBonus(owner, amount = 1, source = "kill") {
  if (owner !== "player" && owner !== "ai") {
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  if (owner === "player") {
    state.playerMana = clamp(state.playerMana + amount, 0, MANA_CAP);
    playBonusManaSfx(source);
  } else {
    state.aiMana = clamp(state.aiMana + amount, 0, MANA_CAP);
  }

  // Keep legacy field neutral for save compatibility with old sessions.
  state.roundManaBonusPending[owner] = 0;
}

function markMatchUsage(kind, id, owner) {
  state.matchUsage[owner][kind][id] = true;
}

function commitMatchUsageStats() {
  for (const owner of ["player", "ai"]) {
    const isWinningSide = state.matchWinner === owner;

    for (const attacker of attackerDefs) {
      if (!state.matchUsage[owner].attackers[attacker.id]) {
        continue;
      }
      persistentStats.matchUsage.attackers.used[attacker.id] += 1;
      if (isWinningSide) {
        persistentStats.matchUsage.attackers.winningTeamUsed[attacker.id] += 1;
      }
    }

    for (const tower of towerDefs) {
      if (!state.matchUsage[owner].towers[tower.id]) {
        continue;
      }
      persistentStats.matchUsage.towers.used[tower.id] += 1;
      if (isWinningSide) {
        persistentStats.matchUsage.towers.winningTeamUsed[tower.id] += 1;
      }
    }
  }

  queueStatsSave();
}

function getAttackerDef(attackerId) {
  return attackerDefs.find((item) => item.id === attackerId) || null;
}

function getTowerDef(towerId) {
  return towerDefs.find((item) => item.id === towerId) || null;
}

function getPlayerUpgradeLevel(attackerId) {
  return 1 + (state.playerAttackerUpgrades[attackerId] || 0);
}

function getPlayerTowerUpgradeLevel(towerId) {
  return 1 + (state.playerTowerUpgrades[towerId] || 0);
}

function getTowerLevelRule(towerId) {
  const rule = TOWER_LEVEL_RULES[towerId];
  if (!rule) {
    return {
      maxLevel: 1,
      damagePerLevel: 1,
      rangePerLevel: 1,
      fireRatePerLevel: 1,
      iconScalePerLevel: 1
    };
  }
  return rule;
}

function getTowerMaxLevel(towerId) {
  return Math.max(1, getTowerLevelRule(towerId).maxLevel || 1);
}

function createTowerInstance(def, owner = "player", level = 1) {
  const upgradeMultiplier = owner === "player"
    ? Math.pow(TOWER_UPGRADE_MULTIPLIER, state.playerTowerUpgrades[def.id] || 0)
    : 1;
  const levelRule = getTowerLevelRule(def.id);
  const safeLevel = clamp(Math.floor(level), 1, getTowerMaxLevel(def.id));
  const levelSteps = safeLevel - 1;
  const levelDamageMultiplier = Math.pow(levelRule.damagePerLevel, levelSteps);
  const levelRangeMultiplier = Math.pow(levelRule.rangePerLevel, levelSteps);
  const levelFireRateMultiplier = Math.pow(levelRule.fireRatePerLevel, levelSteps);
  const iconScale = Math.pow(levelRule.iconScalePerLevel, levelSteps);
  const slowDurationPerLevel = levelRule.slowDurationPerLevel || 1;
  const shrapnelDamagePerLevel = levelRule.shrapnelDamagePerLevel || 1;
  const poisonDotPerLevel = levelRule.poisonDotPerLevel || 1;
  const slowDuration = def.id === "yellow"
    ? 1.2 * Math.pow(slowDurationPerLevel, levelSteps)
    : 0;
  const shrapnelDamageMultiplier = def.id === "red"
    ? Math.pow(shrapnelDamagePerLevel, levelSteps)
    : 1;
  const poisonDotMultiplier = def.id === "green"
    ? Math.pow(poisonDotPerLevel, levelSteps)
    : 1;
  const maxTargetsByLevel = levelRule.maxTargetsByLevel || null;
  const scaledMaxTargets = maxTargetsByLevel && Number.isFinite(maxTargetsByLevel[safeLevel])
    ? maxTargetsByLevel[safeLevel]
    : Math.max(1, def.maxTargets || 1);
  const coneDegrees = Number.isFinite(def.coneDegrees) ? def.coneDegrees : BASE_TOWER_CONE_DEGREES;
  return {
    ...def,
    level: safeLevel,
    iconScale,
    slowDuration,
    shrapnelDamageMultiplier,
    poisonDotMultiplier,
    damage: def.damage * upgradeMultiplier * levelDamageMultiplier,
    range: def.range * upgradeMultiplier * levelRangeMultiplier,
    fireRate: def.fireRate / (upgradeMultiplier * levelFireRateMultiplier),
    cooldown: 0,
    coneDegrees,
    coneHalfAngleRad: (coneDegrees * Math.PI) / 360,
    coneHalfAngleCos: Math.cos((coneDegrees * Math.PI) / 360),
    maxTargets: Math.max(1, scaledMaxTargets)
  };
}

function towerPowerScore(tower) {
  if (!tower) {
    return 0;
  }
  return tower.damage * tower.range / tower.fireRate;
}

function resetMatch() {
  _battleResolving = false;
  if (state.mode === "tug" && tugState) { tugEndMatch(); } // a finished tug match left by Return to Menu still owns the dock and HUD
  state.mode = "classic";
  state.waveNumber = 1;
  state.completedRounds = 0;
  state.phase = "banner";
  state.phaseTimer = PREP_SECONDS;
  state.playerMana = 9;
  state.aiMana = 9;
  state.playerScore = 0;
  state.aiScore = 0;
  state.gameOver = false;
  state.paused = false;
  state.winnerText = "";
  state.cardDetailId = null;
  renderPixiCardDetailPanel();
  state.playerTowers = [null, null, null, null, null];
  state.aiTowers = [null, null, null, null, null];
  state.playerQueue = [];
  state.aiQueue = [];
  state.playerQueueCounts = {};
  state.attackersPlayer = [];
  state.attackersAI = [];
  state.projectiles = [];
  state.fireBursts = [];
  state.yellowLeaps = [];
  state.towerFlashes = [];
  state.towerFireAnimations = [];
  state.deathParticles = [];
  state.deathEffects = [];
  state.nextUnitId = 1;
  state.nextProjectileId = 1;
  state.nextFireBurstId = 1;
  state.aiDraftDone = false;
  state.animationClock = 0;
  state.roundBannerTimer = ROUND_BANNER_SECONDS;
  state.battleStartTimer = 0;
  state.roundBannerText = "Round 1";
  state.battleSkipUsedThisRound = false;
  state.shopSelectionType = "attacker";
  state.shopSelectionId = attackerDefs[0].id;
  state.matchWinner = "";
  state.hasActiveMatch = true;
  state.matchSummary = null;
  state.matchStats = createEmptyMatchStats();
  state.playerTowerUpgrades = Object.fromEntries(towerDefs.map((tower) => [tower.id, 0]));
  state.playerAttackerUpgrades = Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, 0]));
  state.matchUsage = {
    player: {
      towers: Object.fromEntries(towerDefs.map((tower) => [tower.id, false])),
      attackers: Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, false]))
    },
    ai: {
      towers: Object.fromEntries(towerDefs.map((tower) => [tower.id, false])),
      attackers: Object.fromEntries(attackerDefs.map((attacker) => [attacker.id, false]))
    }
  };
  state.soundCooldowns.violet = 0;
  state.soundCooldowns.yellow = 0;
  state.soundCooldowns.red = 0;
  state.soundCooldowns.green = 0;
  state.soundCooldowns.blue = 0;
  state.roundManaBonusPending.player = 0;
  state.roundManaBonusPending.ai = 0;
  state._aiFanSeeds = [];
  pendingGauntletReturn = null;
  state.aiStrategyOverride = "";

  previousTime = performance.now();
  updateStatus("Round 1 coming up.");
  refreshAllUI();
  syncPauseButtons();
}

function startNewMatch(options = {}) {
  const mode = options.mode || (state.screen === "game" && state.mode === "tug" ? "tug" : "classic");
  clearSavedMatchState();
  resetMatch();
  state.gauntletRun = options.gauntlet
    ? { stageIndex: clamp(Math.floor(Number(options.stageIndex) || 0), 0, GAUNTLET_STAGES.length - 1) }
    : null;
  state.aiDifficultyOverride = options.difficulty || "";
  state.aiStrategyOverride = options.strategy || "";
  state.paused = false;
  setScreen("game");
  lockLandscapeOrientation();
  playCurrentMusicTrack();
  refreshAllUI();
  if (mode === "tug") tugStartMatch(options);
}

function startGauntletChallenge() {
  const stageIndex = clamp(gauntletProgress.unlockedStage, 0, GAUNTLET_STAGES.length - 1);
  const stage = getGauntletStage(stageIndex);
  startNewMatch({
    gauntlet: true,
    stageIndex,
    difficulty: stage.difficulty,
    strategy: stage.strategy
  });
  updateStatus(`Gauntlet battle ${stageIndex + 1}.`);
}

window.setScreen = setScreen;
window.startNewMatch = startNewMatch;
window.startGauntletChallenge = startGauntletChallenge;
