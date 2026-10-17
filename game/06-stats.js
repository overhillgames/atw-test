// Line Tower Wars runtime, part 06 of 20: normalizePersistentStats, load/persist stats, match-state save/restore, profile stats, records rendering.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function normalizePersistentStats(raw) {
  const stats = createEmptyPersistentStats();
  if (!raw || typeof raw !== "object") {
    return stats;
  }

  stats.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  stats.profile.matchesPlayed = Number.isFinite(raw.profile?.matchesPlayed) ? raw.profile.matchesPlayed : 0;
  stats.profile.wins = Number.isFinite(raw.profile?.wins) ? raw.profile.wins : 0;
  stats.profile.losses = Number.isFinite(raw.profile?.losses) ? raw.profile.losses : 0;
  stats.profile.draws = Number.isFinite(raw.profile?.draws) ? raw.profile.draws : 0;
  stats.profile.currentWinStreak = Number.isFinite(raw.profile?.currentWinStreak) ? raw.profile.currentWinStreak : 0;
  stats.profile.bestWinStreak = Number.isFinite(raw.profile?.bestWinStreak) ? raw.profile.bestWinStreak : 0;

  for (const scope of ["total", "player", "ai"]) {
    for (const attacker of attackerDefs) {
      const value = raw.unitScores?.[scope]?.[attacker.id];
      stats.unitScores[scope][attacker.id] = Number.isFinite(value) ? value : 0;
    }
    for (const tower of towerDefs) {
      stats.towerKills[scope][tower.id] = readNumberWithLegacyId(raw.towerKills?.[scope], tower.id);
    }
  }

  for (const attacker of attackerDefs) {
    const usedValue = raw.matchUsage?.attackers?.used?.[attacker.id];
    const winningValue = raw.matchUsage?.attackers?.winningTeamUsed?.[attacker.id];
    stats.matchUsage.attackers.used[attacker.id] = Number.isFinite(usedValue) ? usedValue : 0;
    stats.matchUsage.attackers.winningTeamUsed[attacker.id] = Number.isFinite(winningValue) ? winningValue : 0;
  }

  for (const tower of towerDefs) {
    stats.matchUsage.towers.used[tower.id] = readNumberWithLegacyId(raw.matchUsage?.towers?.used, tower.id);
    stats.matchUsage.towers.winningTeamUsed[tower.id] = readNumberWithLegacyId(raw.matchUsage?.towers?.winningTeamUsed, tower.id);
  }

  return stats;
}

function canUsePreviewStatsEndpoint() {
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

async function loadPersistentStats() {
  if (canUsePreviewStatsEndpoint()) {
    try {
      const response = await fetch("./stats", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Stats load failed: ${response.status}`);
      }
      persistentStats = normalizePersistentStats(await response.json());
      return;
    } catch {
    }
  }

  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (raw) {
      persistentStats = normalizePersistentStats(JSON.parse(raw));
    }
  } catch {
    persistentStats = createEmptyPersistentStats();
  }

  refreshMetaUI();
  refreshAllUI();
}

async function persistStatsNow() {
  persistentStats.updatedAt = new Date().toISOString();
  const body = JSON.stringify(persistentStats, null, 2);

  if (canUsePreviewStatsEndpoint()) {
    try {
      const response = await fetch("./stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      if (!response.ok) {
        throw new Error(`Stats save failed: ${response.status}`);
      }
      return;
    } catch {
    }
  }

  try {
    localStorage.setItem(STATS_STORAGE_KEY, body);
  } catch {
  }
}

function queueStatsSave() {
  if (statsSaveTimeout) {
    clearTimeout(statsSaveTimeout);
  }
  statsSaveTimeout = setTimeout(() => {
    statsSaveTimeout = null;
    persistStatsNow();
  }, 150);
}

function saveMatchStateNow() {
  if (!state.hasActiveMatch || state.gameOver || multiplayerRole !== null || state.mode === "tug") {
    localStorage.removeItem(MATCH_STATE_STORAGE_KEY);
    return;
  }

  const snapshot = {
    waveNumber: state.waveNumber,
    completedRounds: state.completedRounds,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    playerMana: state.playerMana,
    aiMana: state.aiMana,
    playerScore: state.playerScore,
    aiScore: state.aiScore,
    paused: state.paused,
    winnerText: state.winnerText,
    playerTowers: state.playerTowers,
    aiTowers: state.aiTowers,
    playerQueue: state.playerQueue,
    aiQueue: state.aiQueue,
    playerQueueCounts: state.playerQueueCounts,
    attackersPlayer: state.attackersPlayer,
    attackersAI: state.attackersAI,
    projectiles: state.projectiles,
    fireBursts: state.fireBursts,
    yellowLeaps: state.yellowLeaps,
    towerFlashes: state.towerFlashes,
    towerFireAnimations: state.towerFireAnimations,
    deathParticles: state.deathParticles,
    deathEffects: state.deathEffects,
    nextUnitId: state.nextUnitId,
    nextProjectileId: state.nextProjectileId,
    nextFireBurstId: state.nextFireBurstId,
    aiDraftDone: state.aiDraftDone,
    animationClock: state.animationClock,
    roundBannerTimer: state.roundBannerTimer,
    battleStartTimer: state.battleStartTimer,
    roundBannerText: state.roundBannerText,
    battleSkipUsedThisRound: state.battleSkipUsedThisRound,
    shopSelectionType: state.shopSelectionType,
    shopSelectionId: state.shopSelectionId,
    matchWinner: state.matchWinner,
    matchSummary: state.matchSummary,
    matchStats: state.matchStats,
    playerTowerUpgrades: state.playerTowerUpgrades,
    playerAttackerUpgrades: state.playerAttackerUpgrades,
    matchUsage: state.matchUsage,
    soundCooldowns: state.soundCooldowns,
    roundManaBonusPending: state.roundManaBonusPending,
    gauntletRun: state.gauntletRun,
    aiDifficultyOverride: state.aiDifficultyOverride,
    aiStrategyOverride: state.aiStrategyOverride,
    hasActiveMatch: state.hasActiveMatch
  };

  try {
    localStorage.setItem(MATCH_STATE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
  }
}

function restoreSavedMatchState() {
  try {
    const raw = localStorage.getItem(MATCH_STATE_STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }

    Object.assign(state, snapshot);
    state.playerTowers = Array.isArray(state.playerTowers) ? state.playerTowers.map(normalizeTowerInstance) : [null, null, null, null, null];
    state.aiTowers = Array.isArray(state.aiTowers) ? state.aiTowers.map(normalizeTowerInstance) : [null, null, null, null, null];
    state.playerTowerUpgrades = Object.fromEntries(towerDefs.map((tower) => [
      tower.id,
      readNumberWithLegacyId(state.playerTowerUpgrades, tower.id)
    ]));
    state.matchUsage = {
      player: {
        attackers: state.matchUsage?.player?.attackers || {},
        towers: Object.fromEntries(towerDefs.map((tower) => [
          tower.id,
          readBooleanWithLegacyId(state.matchUsage?.player?.towers, tower.id)
        ]))
      },
      ai: {
        attackers: state.matchUsage?.ai?.attackers || {},
        towers: Object.fromEntries(towerDefs.map((tower) => [
          tower.id,
          readBooleanWithLegacyId(state.matchUsage?.ai?.towers, tower.id)
        ]))
      }
    };
    state.projectiles = Array.isArray(state.projectiles)
      ? state.projectiles.map((projectile) => {
          const towerId = normalizeTowerId(projectile.towerId);
          return {
            ...projectile,
            towerId,
            color: towerId === "blue" ? "#2563eb" : projectile.color
          };
        })
      : [];
    state.soundCooldowns = Object.fromEntries(towerDefs.map((tower) => [
      tower.id,
      readNumberWithLegacyId(state.soundCooldowns, tower.id)
    ]));
    state.shopSelectionId = normalizeTowerId(state.shopSelectionId);
    state.fireBursts = Array.isArray(state.fireBursts) ? state.fireBursts : [];
    state.yellowLeaps = Array.isArray(state.yellowLeaps) ? state.yellowLeaps : [];
    state.towerFireAnimations = [];
    state.nextFireBurstId = Number.isFinite(state.nextFireBurstId) ? state.nextFireBurstId : 1;
    state.battleStartTimer = Number.isFinite(state.battleStartTimer) ? Math.max(0, state.battleStartTimer) : 0;
    state.completedRounds = Number.isFinite(state.completedRounds)
      ? clamp(Math.floor(state.completedRounds), 0, MAX_ROUNDS)
      : clamp(Math.floor((Number(state.waveNumber) || 1) - 1), 0, MAX_ROUNDS);
    state.roundManaBonusPending = state.roundManaBonusPending && typeof state.roundManaBonusPending === "object"
      ? {
          player: Number.isFinite(state.roundManaBonusPending.player) ? state.roundManaBonusPending.player : 0,
          ai: Number.isFinite(state.roundManaBonusPending.ai) ? state.roundManaBonusPending.ai : 0
        }
      : { player: 0, ai: 0 };
    state.gameOver = false;
    state.hasActiveMatch = true;
    state.paused = true;
    state.gauntletRun = state.gauntletRun && Number.isFinite(state.gauntletRun.stageIndex)
      ? { stageIndex: clamp(Math.floor(state.gauntletRun.stageIndex), 0, GAUNTLET_STAGES.length - 1) }
      : null;
    state.aiDifficultyOverride = AI_DIFFICULTY_SETTINGS[state.aiDifficultyOverride] ? state.aiDifficultyOverride : "";
    state.aiStrategyOverride = AI_STRATEGY_SETTINGS[state.aiStrategyOverride] ? state.aiStrategyOverride : "";
    refreshAllUI();
    return true;
  } catch {
    return false;
  }
}

function clearSavedMatchState() {
  try {
    localStorage.removeItem(MATCH_STATE_STORAGE_KEY);
  } catch {
  }
}

function getProfileStats() {
  return persistentStats.profile || createEmptyProfileStats();
}

function sumMapValues(map) {
  return Object.values(map || {}).reduce((sum, value) => sum + value, 0);
}

function formatUpdatedAt(isoString) {
  if (!isoString) {
    return "No saved records yet.";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "No saved records yet.";
  }

  return `Updated ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function getWinRate(profile) {
  if (profile.matchesPlayed === 0) {
    return 0;
  }
  return Math.round((profile.wins / profile.matchesPlayed) * 100);
}

function getTopEntries(recordMap, defs, count) {
  return defs
    .map((def) => ({
      name: def.name,
      value: recordMap?.[def.id] || 0
    }))
    .sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, count);
}

function getMilestones(profile) {
  const scoredUnits = sumMapValues(persistentStats.unitScores.player);
  const towerKills = sumMapValues(persistentStats.towerKills.player);

  return [
    {
      label: "Play 3 matches",
      value: Math.min(profile.matchesPlayed, 3),
      target: 3,
      progress: `${Math.min(profile.matchesPlayed, 3)}/3`,
      done: profile.matchesPlayed >= 3
    },
    {
      label: "Reach a 2-match win streak",
      value: Math.min(profile.bestWinStreak, 2),
      target: 2,
      progress: `${Math.min(profile.bestWinStreak, 2)}/2`,
      done: profile.bestWinStreak >= 2
    },
    {
      label: "Score 10 attackers",
      value: Math.min(scoredUnits, 10),
      target: 10,
      progress: `${Math.min(scoredUnits, 10)}/10`,
      done: scoredUnits >= 10
    },
    {
      label: "Destroy 25 enemy units with towers",
      value: Math.min(towerKills, 25),
      target: 25,
      progress: `${Math.min(towerKills, 25)}/25`,
      done: towerKills >= 25
    }
  ];
}

function getNextGoalText(profile) {
  const milestones = getMilestones(profile);
  const nextMilestone = milestones.find((item) => !item.done);
  if (nextMilestone) {
    return `Next goal: ${nextMilestone.label} (${nextMilestone.progress}).`;
  }
  return "Next goal: defend your best streak and keep improving your records.";
}

function renderStatCards(container, items) {
  container.innerHTML = items.map((item) => `
    <article class="stat-card">
      <strong>${item.value}</strong>
      <span>${item.label}</span>
    </article>
  `).join("");
}

function renderRankingRows(container, items, emptyLabel) {
  if (!items.some((item) => item.value > 0)) {
    container.innerHTML = `<div class="ranking-row"><span class="row-title">${emptyLabel}</span><span class="row-sub">Complete a match to start filling this board.</span></div>`;
    return;
  }

  container.innerHTML = items.map((item, index) => `
    <div class="ranking-row">
      <span class="row-title">#${index + 1} ${item.name}</span>
      <span class="row-sub">${item.value} lifetime impact</span>
    </div>
  `).join("");
}
