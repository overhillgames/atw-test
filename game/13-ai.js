// Line Tower Wars runtime, part 13 of 20: plan analysis, counter scores, ranking, placement, prepareAIMoves, finalizeAIMovesBeforeBattle.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function totalDefenseScore(towers) {
  return towers.reduce((sum, tower) => sum + towerPowerScore(tower), 0);
}

function countPlacedTowers(towers) {
  return towers.reduce((count, tower) => count + (tower ? 1 : 0), 0);
}

function getTowerTargetFromPlan(plan, waveNumber) {
  let target = 0;
  for (const step of plan) {
    if (waveNumber >= step.round) {
      target = step.towers;
    }
  }
  return target;
}

function getAIMinTowerTarget(waveNumber) {
  const stageSettings = getAIGauntletStageSettings();
  if (stageSettings?.towerPlan) {
    return getTowerTargetFromPlan(stageSettings.towerPlan, waveNumber);
  }

  const difficulty = state.aiDifficultyOverride || gameOptions.difficulty;
  const defaultPlans = {
    purple: [{ round: 1, towers: 1 }, { round: 5, towers: 2 }, { round: 8, towers: 3 }],
    yellow: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 6, towers: 3 }],
    red: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 8, towers: 4 }],
    green: [{ round: 1, towers: 1 }, { round: 3, towers: 2 }, { round: 5, towers: 3 }, { round: 7, towers: 4 }],
    blue: [{ round: 1, towers: 1 }, { round: 2, towers: 2 }, { round: 4, towers: 3 }, { round: 6, towers: 4 }]
  };
  return getTowerTargetFromPlan(defaultPlans[difficulty] || defaultPlans.yellow, waveNumber);
}

function countIds(ids) {
  return ids.reduce((counts, id) => {
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function analyzePlayerPlan(playerDefenseScore) {
  const towerCounts = countIds(state.playerTowers.filter(Boolean).map((tower) => tower.id));
  const queuedCounts = countIds(state.playerQueue);
  const towerTotal = state.playerTowers.filter(Boolean).length;
  const queueTotal = state.playerQueue.length;
  const emptySlots = Math.max(0, state.playerTowers.length - towerTotal);
  const antiFast = (towerCounts.violet || 0) * 0.8 + (towerCounts.yellow || 0) * 1.3 + (towerCounts.blue || 0) * 0.55;
  const antiSwarm = (towerCounts.red || 0) * 1.15 + (towerCounts.yellow || 0) * 0.8 + (towerCounts.blue || 0) * 1.45;
  const antiTank = (towerCounts.red || 0) * 1.15 + (towerCounts.green || 0) * 1.45 + (towerCounts.blue || 0) * 0.8;
  const pressureDefense = Math.max(0, playerDefenseScore - 8) * 0.08;
  const fastGap = clamp(2.35 - antiFast + emptySlots * 0.35, 0, 3.2);
  const swarmGap = clamp(2.2 - antiSwarm + emptySlots * 0.3, 0, 3.2);
  const tankGap = clamp(2.35 - antiTank + pressureDefense, 0, 3.2);
  const queuedFast = (queuedCounts.runner || 0) + (queuedCounts.wisp || 0);
  const queuedSwarm = queuedCounts.imp || 0;
  const queuedHeavy = (queuedCounts.brute || 0) + (queuedCounts.tank || 0);
  const scoreDeficit = Math.max(0, state.playerScore - state.aiScore);
  const scoreLead = Math.max(0, state.aiScore - state.playerScore);

  return {
    playerDefenseScore,
    towerCounts,
    queuedCounts,
    towerTotal,
    queueTotal,
    emptySlots,
    fastGap,
    swarmGap,
    tankGap,
    weakDefense: playerDefenseScore < 6 || towerTotal <= 1,
    overbuiltDefense: playerDefenseScore > 10.5 && queueTotal <= 1,
    playerRush: queueTotal >= 4 || queuedFast + queuedSwarm >= 3,
    queuedFast,
    queuedSwarm,
    queuedHeavy,
    scoreDeficit,
    scoreLead
  };
}

function getAIAttackerCounterScore(attackerId, playerPlan) {
  const pressureBonus = playerPlan.weakDefense ? 0.75 : 0;
  const overbuildBonus = playerPlan.overbuiltDefense ? 0.45 : 0;
  const behindBonus = playerPlan.scoreDeficit * 0.16;
  const scoreById = {
    imp: playerPlan.swarmGap * 1.2 + pressureBonus + overbuildBonus + behindBonus,
    runner: playerPlan.fastGap * 1.25 + pressureBonus + behindBonus,
    brute: playerPlan.tankGap * 0.9 + overbuildBonus + playerPlan.playerDefenseScore * 0.035,
    wisp: playerPlan.fastGap * 0.65 + playerPlan.tankGap * 0.55 + behindBonus * 0.7,
    tank: playerPlan.tankGap * 1.3 + overbuildBonus + playerPlan.playerDefenseScore * 0.045
  };
  return scoreById[attackerId] || 0;
}

function getAITowerCounterScore(towerId, playerPlan) {
  const scoreById = {
    violet: playerPlan.queuedFast * 0.45 + playerPlan.queuedSwarm * 0.25 + playerPlan.playerRush * 0.35,
    yellow: playerPlan.queuedFast * 0.85 + playerPlan.queuedSwarm * 0.45 + playerPlan.playerRush * 0.55,
    red: playerPlan.queuedSwarm * 0.9 + playerPlan.queuedHeavy * 0.5,
    green: playerPlan.queuedHeavy * 0.9 + playerPlan.queueTotal * 0.18,
    blue: playerPlan.queuedSwarm * 0.75 + playerPlan.queuedFast * 0.45 + playerPlan.queueTotal * 0.22
  };
  return scoreById[towerId] || 0;
}

function rankAIAttackers(playerPlan, mana, waveNumber) {
  const difficulty = getAIDifficultySettings();
  const strategy = getAIStrategySettings();
  const stageSettings = getAIGauntletStageSettings();
  return attackerDefs
    .filter((attacker) => attacker.cost <= mana)
    .map((attacker) => {
      const hpValue = attacker.hp / attacker.cost;
      const speedValue = attacker.speed * 6;
      const strategyBias = strategy.fallbackBias?.[attacker.id] || 1;
      const stageBias = 1 + (stageSettings?.attackerBias?.[attacker.id] || 0);
      const counterValue = getAIAttackerCounterScore(attacker.id, playerPlan) * (difficulty.adaptation || 0) * strategy.counterScale;
      const earlyTankPenalty = attacker.id === "tank" && waveNumber < 7 && !(stageSettings?.attackerBias?.tank > 0.3) ? 1.4 : 0;
      return {
        attacker,
        score: (hpValue + speedValue) * strategyBias * stageBias + counterValue - attacker.cost * 0.05 - earlyTankPenalty
      };
    })
    .sort((a, b) => b.score - a.score);
}

function pickBestAITowerPlacement(mana, defenseBudget, playerPlan, waveNumber) {
  const difficulty = getAIDifficultySettings();
  const strategy = getAIStrategySettings();
  const stageSettings = getAIGauntletStageSettings();
  const usedTowerTypes = new Set();
  const towerCounts = {};
  for (const tower of state.aiTowers) {
    if (tower) {
      usedTowerTypes.add(tower.id);
      towerCounts[tower.id] = (towerCounts[tower.id] || 0) + 1;
    }
  }
  const missingTowerTypes = towerDefs
    .map((tower) => tower.id)
    .filter((towerId) => !usedTowerTypes.has(towerId));
  const maxAffordableCost = Math.min(mana, defenseBudget);
  const hasAffordableMissingTower = towerDefs.some((tower) => missingTowerTypes.includes(tower.id) && tower.cost <= maxAffordableCost);
  const forceTowerDiversity = missingTowerTypes.length > 0 && hasAffordableMissingTower;

  let best = null;
  for (let slotIndex = 0; slotIndex < state.aiTowers.length; slotIndex += 1) {
    const existing = state.aiTowers[slotIndex];
    const existingPower = towerPowerScore(existing);

    for (const candidate of towerDefs) {
      if (candidate.cost > mana || candidate.cost > defenseBudget) {
        continue;
      }
      const canUpgrade = !!existing
        && existing.id === candidate.id
        && existing.level < getTowerMaxLevel(candidate.id);
      if (forceTowerDiversity && !missingTowerTypes.includes(candidate.id) && !(difficulty.considerTowerUpgrades && canUpgrade)) {
        continue;
      }
      const nextLevel = canUpgrade ? existing.level + 1 : 1;
      if (existing && existing.id === candidate.id && !canUpgrade) {
        continue;
      }

      const candidateTower = createTowerInstance(candidate, "ai", nextLevel);
      const candidatePower = towerPowerScore(candidateTower);
      const improvement = existing ? candidatePower - existingPower : candidatePower + 0.9;
      if (existing && improvement < 0.1) {
        continue;
      }

      const diversityPenalty = (towerCounts[candidate.id] || 0) * 0.85;
      const expensiveEarlyPenalty = waveNumber <= 2 && candidate.cost >= 9 ? 1.3 : 0;
      const counterBoost = playerPlan.playerDefenseScore > 9 ? candidate.range * 2.1 : candidate.damage * 0.2;
      const playerQueueCounter = getAITowerCounterScore(candidate.id, playerPlan) * (difficulty.adaptation || 0) * strategy.counterScale;
      const emptyBonus = existing ? 0 : 0.8;
      const diversityPriority = forceTowerDiversity ? 1.35 : 0;
      const upgradeBias = canUpgrade ? 0.65 + strategy.upgradeBias : 0;
      const difficultyBias = difficulty.towerWeights[candidate.id] || 0;
      const strategyBias = strategy.towerBias?.[candidate.id] || 0;
      const stageBias = stageSettings?.towerBias?.[candidate.id] || 0;
      const value = improvement + counterBoost + playerQueueCounter + emptyBonus + diversityPriority + upgradeBias + difficultyBias + strategyBias + stageBias - diversityPenalty - candidate.cost * 0.09 - expensiveEarlyPenalty + Math.random() * difficulty.randomTowerNoise;

      if (!best || value > best.value) {
        best = { slotIndex, tower: candidate, value, nextLevel };
      }
    }
  }

  return best;
}

function chooseAIBatchPattern(playerPlan, waveNumber, mana) {
  const difficulty = getAIDifficultySettings();
  const strategy = getAIStrategySettings();
  const adaptation = difficulty.adaptation || 0;

  if (adaptation >= 0.45) {
    const ranked = rankAIAttackers(playerPlan, mana, waveNumber).map((entry) => entry.attacker.id);
    if (ranked.length > 0) {
      const preferred = ranked[0];
      const secondary = ranked[1] || preferred;
      const tertiary = ranked[2] || secondary;
      const burst = waveNumber % strategy.burstInterval === 0 || playerPlan.scoreDeficit > 0;
      return burst
        ? [preferred, secondary, preferred, tertiary, preferred, secondary, preferred]
        : [preferred, secondary, preferred, tertiary, secondary];
    }
  }

  if (difficulty.attackerPatterns?.length) {
    if (playerPlan.playerDefenseScore < 6 || waveNumber <= 2) {
      return difficulty.attackerPatterns[0];
    }
    if (playerPlan.playerDefenseScore > 10 && difficulty.attackerPatterns[2]) {
      return difficulty.attackerPatterns[2];
    }
    return difficulty.attackerPatterns[1] || difficulty.attackerPatterns[0];
  }

  if (playerPlan.playerDefenseScore < 6 || waveNumber <= 2) {
    return ["runner", "runner", "imp", "runner", "imp"];
  }
  if (playerPlan.playerDefenseScore > 10) {
    return ["tank", "brute", "wisp", "imp"];
  }
  return ["imp", "runner", "brute", "wisp", "runner"];
}

function queueAIBatch(pattern, attackBudget) {
  let spent = 0;
  let sent = 0;
  let cursor = 0;

  while (cursor < pattern.length) {
    const attacker = attackerDefs.find((item) => item.id === pattern[cursor]);
    if (!attacker) {
      cursor += 1;
      continue;
    }
    if (spent + attacker.cost > attackBudget || state.aiMana < attacker.cost) {
      cursor += 1;
      continue;
    }
    state.aiMana -= attacker.cost;
    spent += attacker.cost;
    sent += 1;
    state.aiQueue.push(attacker.id);
    markMatchUsage("attackers", attacker.id, "ai");
    cursor += 1;
  }

  return sent;
}

function chooseAIAttackerByDefense(playerPlan, mana, waveNumber) {
  const difficulty = getAIDifficultySettings();
  const strategy = getAIStrategySettings();
  const options = attackerDefs.filter((attacker) => attacker.cost <= mana);
  if (options.length === 0) {
    return null;
  }

  if ((difficulty.adaptation || 0) >= 0.45) {
    return rankAIAttackers(playerPlan, mana, waveNumber)[0]?.attacker || options[0];
  }

  for (const attackerId of difficulty.fallbackOrder || []) {
    const attacker = options.find((item) => item.id === attackerId);
    if (attacker) {
      return attacker;
    }
  }

  const pressure = playerPlan.playerDefenseScore / Math.max(1, waveNumber);
  const weightById = {
    imp: pressure < 1.8 ? 1.25 : 0.75,
    runner: pressure < 1.8 ? 1.35 : 0.8,
    brute: pressure > 2.2 ? 1.25 : 0.9,
    wisp: pressure > 2.6 ? 1.2 : 1,
    tank: pressure > 2.1 ? 1.4 : 0.85
  };

  let best = options[0];
  let bestScore = -Infinity;
  for (const attacker of options) {
    const hpValue = attacker.hp / attacker.cost;
    const speedValue = attacker.speed * 6;
    const score = (hpValue + speedValue) * (weightById[attacker.id] || 1) * (strategy.fallbackBias?.[attacker.id] || 1);
    if (score > bestScore) {
      bestScore = score;
      best = attacker;
    }
  }
  return best;
}

function prepareAIMoves() {
  if (state.aiDraftDone || state.gameOver) {
    return;
  }

  const difficulty = getAIDifficultySettings();
  const playerDefenseScore = totalDefenseScore(state.playerTowers);
  const playerPlan = analyzePlayerPlan(playerDefenseScore);
  const strategy = getAIStrategySettings();
  const minAttackerCost = Math.min(...attackerDefs.map((item) => item.cost));
  const burstInterval = Math.max(2, strategy.burstInterval || 3);
  const isSpikeSaveRound = state.waveNumber % burstInterval === 0 || (state.waveNumber >= 6 && playerDefenseScore > 9);
  const pressureStateScale = 1 + playerPlan.scoreDeficit * 0.08 * strategy.forceAttackWhenBehind - playerPlan.scoreLead * 0.025;
  const baseReserveTarget = isSpikeSaveRound
    ? clamp(10 + state.waveNumber * 1.9, 12, 36)
    : clamp(7 + state.waveNumber * 1.5, 9, 30);
  const reserveTarget = clamp(baseReserveTarget * difficulty.reserveScale * strategy.reserveScale, 3, 54);
  const playerRushDefenseScale = playerPlan.playerRush ? 1.25 : 1;
  const defenseRatio = (isSpikeSaveRound ? 0.12 : 0.22) * difficulty.defenseRatioScale * strategy.defenseBudgetScale * playerRushDefenseScale;
  const attackBiasFloor = Math.max(0, state.aiMana - reserveTarget);
  let defenseBudget = Math.min(Math.max(0, state.aiMana * defenseRatio), attackBiasFloor);
  let placementCount = 0;
  const maxPlacements = isSpikeSaveRound && strategy.label !== "Fortress" ? 1 : difficulty.maxPlacements;
  const minTowerTarget = getAIMinTowerTarget(state.waveNumber);
  const mandatoryReserve = strategy.label === "Fortress" ? 3 : 1;

  while (countPlacedTowers(state.aiTowers) < minTowerTarget && placementCount < Math.max(1, difficulty.maxPlacements)) {
    const mandatoryDefenseBudget = Math.max(defenseBudget, state.aiMana - mandatoryReserve);
    const bestPlacement = pickBestAITowerPlacement(state.aiMana, mandatoryDefenseBudget, playerPlan, state.waveNumber);
    if (!bestPlacement) {
      break;
    }
    if (bestPlacement.tower.cost > state.aiMana || bestPlacement.tower.cost > mandatoryDefenseBudget) {
      break;
    }
    state.aiMana -= bestPlacement.tower.cost;
    defenseBudget = Math.max(0, defenseBudget - bestPlacement.tower.cost);
    state.aiTowers[bestPlacement.slotIndex] = createTowerInstance(bestPlacement.tower, "ai", bestPlacement.nextLevel || 1);
    markMatchUsage("towers", bestPlacement.tower.id, "ai");
    placementCount += 1;
  }

  while (placementCount < maxPlacements) {
    const bestPlacement = pickBestAITowerPlacement(state.aiMana, defenseBudget, playerPlan, state.waveNumber);
    if (!bestPlacement) {
      break;
    }
    if (bestPlacement.tower.cost > state.aiMana || bestPlacement.tower.cost > defenseBudget) {
      break;
    }
    state.aiMana -= bestPlacement.tower.cost;
    defenseBudget -= bestPlacement.tower.cost;
    state.aiTowers[bestPlacement.slotIndex] = createTowerInstance(bestPlacement.tower, "ai", bestPlacement.nextLevel || 1);
    markMatchUsage("towers", bestPlacement.tower.id, "ai");
    placementCount += 1;
  }

  const postDefenseReserve = isSpikeSaveRound
    ? clamp(reserveTarget * 0.28, 2, 12)
    : clamp(reserveTarget * 0.55 * difficulty.postReserveScale, 2, 24);
  let sentCount = 0;
  const attackScale = difficulty.minAttackBudgetScale * strategy.attackBudgetScale * clamp(pressureStateScale, 0.7, 1.65) * (isSpikeSaveRound ? 1 + difficulty.burstPressure * 0.22 : 1);
  let attackBudget = Math.max(0, (state.aiMana - postDefenseReserve) * attackScale);
  const pattern = chooseAIBatchPattern(playerPlan, state.waveNumber, state.aiMana);

  while (attackBudget >= minAttackerCost) {
    const sentInBatch = queueAIBatch(pattern, attackBudget);
    if (sentInBatch === 0) {
      break;
    }
    sentCount += sentInBatch;
    attackBudget = Math.max(0, (state.aiMana - postDefenseReserve) * attackScale);
  }

  if (sentCount === 0 && state.aiMana >= minAttackerCost) {
    const fallback = chooseAIAttackerByDefense(playerPlan, state.aiMana, state.waveNumber) || attackerDefs[0];
    state.aiMana -= fallback.cost;
    state.aiQueue.push(fallback.id);
    markMatchUsage("attackers", fallback.id, "ai");
  }

  state.aiDraftDone = true;
}

function finalizeAIMovesBeforeBattle() {
  if (state.gameOver || multiplayerRole !== null) {
    return;
  }
  if (!state.aiDraftDone) {
    prepareAIMoves();
  }

  const difficulty = getAIDifficultySettings();
  if ((difficulty.adaptation || 0) < 0.45) {
    return;
  }

  const strategy = getAIStrategySettings();
  const playerPlan = analyzePlayerPlan(totalDefenseScore(state.playerTowers));
  const minAttackerCost = Math.min(...attackerDefs.map((item) => item.cost));

  if ((playerPlan.queueTotal >= 2 || playerPlan.playerRush) && state.aiMana >= minAttackerCost + 2) {
    const defenseBudget = Math.max(0, (state.aiMana - minAttackerCost) * 0.38 * strategy.defenseBudgetScale);
    const bestPlacement = pickBestAITowerPlacement(state.aiMana, defenseBudget, playerPlan, state.waveNumber);
    if (bestPlacement && bestPlacement.tower.cost <= state.aiMana && bestPlacement.tower.cost <= defenseBudget) {
      state.aiMana -= bestPlacement.tower.cost;
      state.aiTowers[bestPlacement.slotIndex] = createTowerInstance(bestPlacement.tower, "ai", bestPlacement.nextLevel || 1);
      markMatchUsage("towers", bestPlacement.tower.id, "ai");
    }
  }

  const reserve = strategy.label === "Fortress" ? 5 : 2;
  const attackScale = difficulty.minAttackBudgetScale * strategy.attackBudgetScale * (playerPlan.scoreDeficit > 0 ? 0.8 : 0.55);
  const attackBudget = Math.max(0, (state.aiMana - reserve) * attackScale);
  if (attackBudget >= minAttackerCost) {
    queueAIBatch(chooseAIBatchPattern(playerPlan, state.waveNumber, state.aiMana), attackBudget);
  }
}
