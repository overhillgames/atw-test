// Line Tower Wars runtime, part 16 of 20: flashes, fire animations, particles, projectile/attacker updates, updateGame.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function spawnTowerFlash(pos, color) {
  state.towerFlashes.push({
    x: pos.x,
    y: pos.y,
    color,
    life: 0.11,
    maxLife: 0.11
  });
}

function spawnTowerFireAnimation(owner, slotIndex, towerId) {
  const cfg = towerFireSheetConfig[towerId];
  if (!cfg) {
    return;
  }
  const key = `${owner}:${slotIndex}`;
  state.towerFireAnimations = state.towerFireAnimations.filter((anim) => anim.key !== key);
  state.towerFireAnimations.push({
    key,
    owner,
    slotIndex,
    towerId,
    life: cfg.duration || 0.24,
    maxLife: cfg.duration || 0.24
  });
  pixiState.lastTowerSignature = "";
}

function spawnDeathParticles(unit) {
  const origin = attackerPosition(unit);
  if (creepKillEffectConfig) {
    state.deathEffects.push({
      x: origin.x,
      y: origin.y,
      life: (creepKillEffectConfig.frames || 1) / Math.max(1, creepKillEffectConfig.fps || 12),
      maxLife: (creepKillEffectConfig.frames || 1) / Math.max(1, creepKillEffectConfig.fps || 12)
    });
    return;
  }
  const particleCount = 12;
  for (let i = 0; i < particleCount; i += 1) {
    const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.25;
    const speed = 0.08 + Math.random() * 0.14;
    state.deathParticles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.34 + Math.random() * 0.18,
      maxLife: 0.52,
      size: 1.5 + Math.random() * 2.4,
      color: unit.color
    });
  }
}

function spawnProjectileImpactParticles(x, y, color, particleCount) {
  for (let i = 0; i < particleCount; i += 1) {
    const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.45;
    const speed = 0.045 + Math.random() * 0.09;
    state.deathParticles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.12 + Math.random() * 0.08,
      maxLife: 0.2,
      size: 1.1 + Math.random() * 1.9,
      color
    });
  }
}

function updateTowerFire(dt) {
  for (let i = 0; i < state.playerTowers.length; i += 1) {
    const tower = state.playerTowers[i];
    if (!tower) {
      continue;
    }
    tower.cooldown -= dt;
    if (tower.cooldown > 0) {
      continue;
    }
    const targets = targetsForTower(tower, towerPosPlayer[i], state.attackersAI);
    if (targets.length === 0) {
      continue;
    }
    for (const target of targets) {
      spawnProjectile(
        towerPosPlayer[i],
        target,
        tower.damage,
        tower.color,
        tower.id,
        "player",
        null,
        tower.slowDuration,
        tower.poisonDotMultiplier,
        tower.shrapnelDamageMultiplier
      );
    }
    spawnTowerFlash(towerPosPlayer[i], tower.color);
    spawnTowerFireAnimation("player", i, tower.id);
    if ((tower.id === "violet" || tower.id === "yellow" || tower.id === "red" || tower.id === "green" || tower.id === "blue") && state.soundCooldowns[tower.id] <= 0) {
      playTowerFireSfx(tower.id);
      state.soundCooldowns[tower.id] = tower.id === "blue" ? 0.08 : tower.id === "red" ? 0.075 : tower.id === "violet" ? 0.07 : 0.06;
    }
    tower.cooldown = tower.fireRate;
  }

  for (let i = 0; i < state.aiTowers.length; i += 1) {
    const tower = state.aiTowers[i];
    if (!tower) {
      continue;
    }
    tower.cooldown -= dt;
    if (tower.cooldown > 0) {
      continue;
    }
    const targets = targetsForTower(tower, towerPosAI[i], state.attackersPlayer);
    if (targets.length === 0) {
      continue;
    }
    for (const target of targets) {
      spawnProjectile(
        towerPosAI[i],
        target,
        tower.damage,
        tower.color,
        tower.id,
        "ai",
        null,
        tower.slowDuration,
        tower.poisonDotMultiplier,
        tower.shrapnelDamageMultiplier
      );
    }
    spawnTowerFlash(towerPosAI[i], tower.color);
    spawnTowerFireAnimation("ai", i, tower.id);
    if ((tower.id === "violet" || tower.id === "yellow" || tower.id === "red" || tower.id === "green" || tower.id === "blue") && state.soundCooldowns[tower.id] <= 0) {
      playTowerFireSfx(tower.id);
      state.soundCooldowns[tower.id] = tower.id === "blue" ? 0.08 : tower.id === "red" ? 0.075 : tower.id === "violet" ? 0.07 : 0.06;
    }
    tower.cooldown = tower.fireRate;
  }
}

function findUnitById(owner, id) {
  const list = owner === "player" ? state.attackersPlayer : state.attackersAI;
  return list.find((unit) => unit.id === id) || null;
}

function updateProjectiles(dt) {
  const stillActive = [];

  for (const projectile of state.projectiles) {
    const target = findUnitById(projectile.targetOwner, projectile.targetId);
    if (!target || target.isDefeated) {
      continue;
    }

    const targetPos = attackerPosition(target);
    const dx = targetPos.x - projectile.x;
    const dy = targetPos.y - projectile.y;
    const dist = Math.hypot(dx, dy);

    projectile.age += dt;
    projectile.prevX = projectile.x;
    projectile.prevY = projectile.y;

    if (dist <= 0.012) {
      applyProjectileDamage(
        target,
        projectile.damage,
        projectile.towerId,
        projectile.owner,
        true,
        projectile.slowDuration,
        projectile.poisonDotMultiplier,
        projectile.shrapnelDamageMultiplier
      );
      if (projectile.towerId === "blue") {
        spawnProjectileImpactParticles(projectile.x, projectile.y, "#93c5fd", 8);
      }
      continue;
    }

    const move = Math.min(dist, projectile.speed * dt);
    const invDist = dist > 0 ? 1 / dist : 0;
    projectile.x += dx * invDist * move;
    projectile.y += dy * invDist * move;
    projectile.trail.push({ x: projectile.x, y: projectile.y });
    if (projectile.trail.length > 10) {
      projectile.trail.shift();
    }
    stillActive.push(projectile);
  }

  state.projectiles = stillActive;
}

function updateFireBursts(dt) {
  const active = [];
  for (const burst of state.fireBursts) {
    burst.life -= dt;
    if (burst.life <= 0) {
      continue;
    }
    burst.x += burst.vx * dt;
    burst.y += burst.vy * dt;
    if (burst.x < 0.02 || burst.x > 0.98 || burst.y < 0.02 || burst.y > 0.98) {
      continue;
    }
    const enemyList = burst.sourceOwner === "player" ? state.attackersAI : state.attackersPlayer;
    let collided = false;
    for (const unit of enemyList) {
      if (unit.isDefeated || burst.hitIds.includes(unit.id)) {
        continue;
      }
      if (unit.id === burst.ignoreUnitId) {
        continue;
      }
      const pos = attackerPosition(unit);
      const dx = pos.x - burst.x;
      const dy = pos.y - burst.y;
      if (Math.hypot(dx, dy) <= 0.02) {
        burst.hitIds.push(unit.id);
        applyProjectileDamage(unit, burst.splashDamage, "red", burst.sourceOwner, false);
        collided = true;
      }
    }
    if (!collided) {
      active.push(burst);
    }
  }
  state.fireBursts = active;
}

function updateTowerFlashes(dt) {
  const active = [];
  for (const flash of state.towerFlashes) {
    flash.life -= dt;
    if (flash.life > 0) {
      active.push(flash);
    }
  }
  state.towerFlashes = active;
}

function updateTowerFireAnimations(dt) {
  const active = [];
  for (const anim of state.towerFireAnimations) {
    anim.life -= dt;
    if (anim.life > 0) {
      active.push(anim);
    }
  }
  if (active.length !== state.towerFireAnimations.length) {
    pixiState.lastTowerSignature = "";
  }
  state.towerFireAnimations = active;
}

function clearTowerFireAnimations() {
  if (!state.towerFireAnimations.length) {
    return;
  }
  state.towerFireAnimations = [];
  pixiState.lastTowerSignature = "";
  updatePixiTowers();
}

function updateYellowLeaps(dt) {
  const active = [];
  for (const leap of state.yellowLeaps) {
    leap.life -= dt;
    if (leap.life > 0) {
      active.push(leap);
    }
  }
  state.yellowLeaps = active;
}

function updateDeathParticles(dt) {
  const active = [];
  for (const particle of state.deathParticles) {
    particle.life -= dt;
    if (particle.life <= 0) {
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.94;
    particle.vy *= 0.94;
    active.push(particle);
  }
  state.deathParticles = active;
}

function updateDeathEffects(dt) {
  if (!state.deathEffects.length) {
    return;
  }
  const active = [];
  for (const effect of state.deathEffects) {
    effect.life -= dt;
    if (effect.life > 0) {
      active.push(effect);
    }
  }
  state.deathEffects = active;
}

function updateAttackers(dt) {
  let playerScored = 0;
  let aiScored = 0;

  for (const unit of state.attackersPlayer) {
    unit.slowTimer = Math.max(0, unit.slowTimer - dt);
    unit.speed = unit.slowTimer > 0 ? unit.baseSpeed * 0.7 : unit.baseSpeed;
    unit.poisonTimer = Math.max(0, unit.poisonTimer - dt);
    if (unit.poisonTicksRemaining > 0) {
      unit.poisonTickTimer -= dt;
      if (unit.poisonTickTimer <= 0) {
        const step = 4 - unit.poisonTicksRemaining;
        const ratios = [0.3, 0.2, 0.1];
        const dotDamage = unit.poisonBaseDamage * ratios[Math.min(step, ratios.length - 1)];
        unit.hp -= dotDamage;
        unit.poisonTicksRemaining -= 1;
        unit.poisonTickTimer += unit.poisonTickInterval;
      }
    }
    if (unit.hp <= 0) {
      continue;
    }
    unit.progress += unit.speed * dt;
    if (unit.progress >= 1) {
      playerScored += 1;
      recordUnitScore(unit.defId, "player");
    }
  }
  for (const unit of state.attackersAI) {
    unit.slowTimer = Math.max(0, unit.slowTimer - dt);
    unit.speed = unit.slowTimer > 0 ? unit.baseSpeed * 0.7 : unit.baseSpeed;
    unit.poisonTimer = Math.max(0, unit.poisonTimer - dt);
    if (unit.poisonTicksRemaining > 0) {
      unit.poisonTickTimer -= dt;
      if (unit.poisonTickTimer <= 0) {
        const step = 4 - unit.poisonTicksRemaining;
        const ratios = [0.3, 0.2, 0.1];
        const dotDamage = unit.poisonBaseDamage * ratios[Math.min(step, ratios.length - 1)];
        unit.hp -= dotDamage;
        unit.poisonTicksRemaining -= 1;
        unit.poisonTickTimer += unit.poisonTickInterval;
      }
    }
    if (unit.hp <= 0) {
      continue;
    }
    unit.progress += unit.speed * dt;
    if (unit.progress >= 1) {
      aiScored += 1;
      recordUnitScore(unit.defId, "ai");
    }
  }

  for (const unit of state.attackersPlayer) {
    if (unit.hp <= 0 && !unit.isDefeated) {
      unit.isDefeated = true;
      if (unit.poisonSourceOwner) {
        recordTowerKill("green", unit.poisonSourceOwner);
      }
    }
    if (unit.hp <= 0) {
      spawnDeathParticles(unit);
    }
  }
  for (const unit of state.attackersAI) {
    if (unit.hp <= 0 && !unit.isDefeated) {
      unit.isDefeated = true;
      if (unit.poisonSourceOwner) {
        recordTowerKill("green", unit.poisonSourceOwner);
      }
    }
    if (unit.hp <= 0) {
      spawnDeathParticles(unit);
    }
  }

  state.attackersPlayer = state.attackersPlayer.filter((unit) => unit.hp > 0 && unit.progress < 1);
  state.attackersAI = state.attackersAI.filter((unit) => unit.hp > 0 && unit.progress < 1);

  state.playerScore += playerScored;
  state.aiScore += aiScored;
  if (playerScored > 0) {
    grantRoundManaBonus("player", playerScored, "score");
  }
  if (aiScored > 0) {
    grantRoundManaBonus("ai", aiScored, "score");
  }
}

function updateGame(dt) {
  if (state.gameOver || state.paused) {
    return;
  }
  state.animationClock += dt;
  if (state.mode === "tug") { tugUpdate(dt); return; }
  state.soundCooldowns.violet = Math.max(0, state.soundCooldowns.violet - dt);
  state.soundCooldowns.yellow = Math.max(0, state.soundCooldowns.yellow - dt);
  state.soundCooldowns.red = Math.max(0, state.soundCooldowns.red - dt);
  state.soundCooldowns.green = Math.max(0, state.soundCooldowns.green - dt);
  state.soundCooldowns.blue = Math.max(0, state.soundCooldowns.blue - dt);

  if (state.phase === "banner") {
    state.roundBannerTimer -= dt;
    if (state.roundBannerTimer <= 0) {
      state.roundBannerTimer = 0;
      beginPrepPhase();
    }
    return;
  }

  if (state.phase === "shop") {
    return;
  }

  // Multiplayer: waiting for opponent to submit prep data — freeze the game loop
  if (state.phase === "waiting") {
    return;
  }

  if (state.phase === "prep") {
    if (!state.aiDraftDone) {
      prepareAIMoves();
    }

    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      state.phaseTimer = 0;
      launchWave();
    }
  } else {
    // the battle holds still while the Battle card is up (BATTLE_START_SECONDS): no movement, no shots. Then today's
    // battle, shifted later by that much
    if (state.battleStartTimer > 0) {
      state.battleStartTimer = Math.max(0, state.battleStartTimer - dt);
    } else {
      updateAttackers(dt);
      updateTowerFire(dt);
      updateTankCreepFire(dt);
    }
  updateProjectiles(dt);
  updateFireBursts(dt);
  updateTowerFlashes(dt);
  updateTowerFireAnimations(dt);
  updateYellowLeaps(dt);
  updateDeathParticles(dt);
  updateDeathEffects(dt);

    if (
      state.attackersPlayer.length === 0 &&
      state.attackersAI.length === 0 &&
      state.projectiles.length === 0 &&
      state.fireBursts.length === 0 &&
      state.yellowLeaps.length === 0 &&
      state.deathParticles.length === 0 &&
      state.deathEffects.length === 0
    ) {
      onBattleFinished();
    }
  }
}
