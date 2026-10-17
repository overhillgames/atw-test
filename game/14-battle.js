// Line Tower Wars runtime, part 14 of 20: attackerPosition, targeting, projectiles, applyProjectileDamage, tank fire, red AoE.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function attackerPosition(unit) {
  if (unit.px != null) return { x: unit.px / LOGICAL_CANVAS_WIDTH, y: unit.py / LOGICAL_CANVAS_HEIGHT }; // tug mobs carry frame px (game/tug/tug-pixi.js); no classic unit has px
  const start = laneStarts[unit.owner];
  const end = laneEnds[unit.owner];
  const p = clamp(unit.progress, 0, 1);
  const baseX = start.x + (end.x - start.x) * p;
  const baseY = start.y + (end.y - start.y) * p;
  // sideways band: creeps stay between x 85 and 334 on the 420-wide board (10 px outside the outer tower slots at 95 and 324), clear of the side HUD pills
  const spread = 0.30 - 0.05 * p;
  const sway = Math.sin((p * Math.PI * 2) + unit.id * 0.37) * 0.025 * (1 - 0.5 * p);
  let x = baseX + unit.fanSeed * spread + sway;
  const yFan = (0.01 + 0.018 * p) * unit.fanSeed;
  const y = clamp(baseY + yFan, 0.04, 0.96);
  x = clamp(x, 85 / LOGICAL_CANVAS_WIDTH, 334 / LOGICAL_CANVAS_WIDTH);

  return {
    x,
    y
  };
}

function isUnitStatusActive(unit, statusType) {
  if (statusType === "slowed") {
    return unit.slowTimer > 0;
  }
  if (statusType === "poisoned") {
    return unit.poisonTimer > 0;
  }
  return false;
}

function getTowerCandidates(towerPos, incomingAttackers, range, coneHalfAngleCos) {
  const isPlayerTower = towerPos.y > 0.5;
  const dirX = 0;
  const dirY = isPlayerTower ? -1 : 1;
  const candidates = [];

  for (const unit of incomingAttackers) {
    const pos = attackerPosition(unit);
    const vx = pos.x - towerPos.x;
    const vy = pos.y - towerPos.y;
    const dist = Math.hypot(vx, vy);
    if (dist <= range) {
      if (dist === 0) {
        candidates.push({ unit, dist, progress: unit.progress });
        continue;
      }
      const cosAngle = (vx * dirX + vy * dirY) / dist;
      if (cosAngle >= coneHalfAngleCos) {
        candidates.push({ unit, dist, progress: unit.progress });
      }
    }
  }
  return candidates;
}

function chooseTargetByRule(candidates, towerId) {
  if (candidates.length === 0) {
    return null;
  }
  if (towerId === "yellow" || towerId === "green") {
    const statusType = towerId === "yellow" ? "slowed" : "poisoned";
    const freshTargets = candidates.filter((item) => !isUnitStatusActive(item.unit, statusType));
    const priorityPool = freshTargets.length > 0 ? freshTargets : candidates;
    priorityPool.sort((a, b) => {
      if (a.dist !== b.dist) {
        return a.dist - b.dist;
      }
      if (b.progress !== a.progress) {
        return b.progress - a.progress;
      }
      return a.unit.id - b.unit.id;
    });
    return priorityPool[0].unit;
  }
  candidates.sort((a, b) => {
    if (b.progress !== a.progress) {
      return b.progress - a.progress;
    }
    if (a.dist !== b.dist) {
      return a.dist - b.dist;
    }
    return a.unit.id - b.unit.id;
  });
  return candidates[0].unit;
}

function targetsForTower(tower, towerPos, incomingAttackers) {
  const candidates = getTowerCandidates(
    towerPos,
    incomingAttackers,
    tower.range,
    tower.coneHalfAngleCos
  );
  if (candidates.length === 0) {
    return [];
  }
  const selected = [];
  const maxTargets = Math.max(1, tower.maxTargets || 1);
  let candidatePool = candidates.slice();
  for (let i = 0; i < maxTargets; i += 1) {
    const chosen = chooseTargetByRule(candidatePool, tower.id);
    if (!chosen) {
      break;
    }
    selected.push(chosen);
    candidatePool = candidatePool.filter((item) => item.unit.id !== chosen.id);
    if (candidatePool.length === 0) {
      break;
    }
  }
  return selected;
}

function spawnProjectile(fromPos, target, damage, color, towerId, owner, speedOverride = null, slowDurationOverride = null, poisonDotMultiplierOverride = null, shrapnelDamageMultiplierOverride = null) {
  const projectileId = state.nextProjectileId;
  state.nextProjectileId += 1;
  state.projectiles.push({
    id: projectileId,
    x: fromPos.x,
    y: fromPos.y,
    prevX: fromPos.x,
    prevY: fromPos.y,
    targetId: target.id,
    targetOwner: target.owner,
    damage,
    speed: speedOverride || 1.35,
    slowDuration: Number.isFinite(slowDurationOverride) ? slowDurationOverride : null,
    poisonDotMultiplier: Number.isFinite(poisonDotMultiplierOverride) ? poisonDotMultiplierOverride : 1,
    shrapnelDamageMultiplier: Number.isFinite(shrapnelDamageMultiplierOverride) ? shrapnelDamageMultiplierOverride : 1,
    color,
    towerId,
    owner,
    age: 0,
    trail: [{ x: fromPos.x, y: fromPos.y }]
  });
}

function spawnYellowLeapBolt(fromPos, toPos) {
  state.yellowLeaps.push({
    fromX: fromPos.x,
    fromY: fromPos.y,
    toX: toPos.x,
    toY: toPos.y,
    life: 0.12,
    maxLife: 0.12
  });
}

function findYellowLeapTarget(sourceUnit, maxDistancePx = 48) {
  const sourcePos = attackerPosition(sourceUnit);
  const enemyList = sourceUnit.owner === "player" ? state.attackersPlayer : state.attackersAI;
  let best = null;
  for (const unit of enemyList) {
    if (unit.id === sourceUnit.id || unit.isDefeated || unit.hp <= 0 || unit.progress >= 1) {
      continue;
    }
    const pos = attackerPosition(unit);
    const distance = Math.hypot((pos.x - sourcePos.x) * canvas.width, (pos.y - sourcePos.y) * canvas.height);
    if (distance <= maxDistancePx && (!best || distance < best.distance)) {
      best = { unit, pos, distance };
    }
  }
  return best;
}

function applyProjectileDamage(target, damage, towerId, owner, allowAoe = true, slowDurationForHit = null, poisonDotMultiplierForHit = 1, shrapnelDamageMultiplierForHit = 1, allowYellowLeap = true) {
  if (!target || target.isDefeated || damage <= 0) {
    return;
  }
  target.hp -= damage;
  if (towerId === "yellow") {
    const appliedSlow = Number.isFinite(slowDurationForHit) ? slowDurationForHit : 1.2;
    target.slowTimer = Math.max(target.slowTimer, appliedSlow);
    if (allowYellowLeap && allowAoe) {
      const leap = findYellowLeapTarget(target, 48);
      if (leap) {
        spawnYellowLeapBolt(attackerPosition(target), leap.pos);
        applyProjectileDamage(leap.unit, damage * 0.5, towerId, owner, false, appliedSlow * 0.5, poisonDotMultiplierForHit, shrapnelDamageMultiplierForHit, false);
      }
    }
  }
  if (towerId === "green") {
    target.poisonTimer = 3;
    target.poisonTicksRemaining = 3;
    target.poisonTickInterval = 1;
    target.poisonTickTimer = 1;
    const appliedPoisonDotMultiplier = Number.isFinite(poisonDotMultiplierForHit) ? poisonDotMultiplierForHit : 1;
    target.poisonBaseDamage = damage * appliedPoisonDotMultiplier;
    target.poisonSourceOwner = owner;
  }
  if (towerId === "red" && allowAoe) {
    const appliedShrapnelMultiplier = Number.isFinite(shrapnelDamageMultiplierForHit) ? shrapnelDamageMultiplierForHit : 1;
    spawnRedAoeBursts(target, damage * 0.33 * appliedShrapnelMultiplier, target.id, owner);
  }
  if (target.hp <= 0 && !target.isDefeated) {
    target.isDefeated = true;
    if (getTowerDef(towerId)) {
      recordTowerKill(towerId, owner);
    }
  }
}

function getTankWeaponStats() {
  const violetDef = getTowerDef("violet");
  const range = (violetDef?.range || 0.416) * 0.5;
  const damage = (violetDef?.damage || 2) * 0.5;
  const coneHalfAngleRad = (180 * Math.PI) / 360;
  return {
    range,
    damage,
    fireRate: 1.1,
    coneHalfAngleCos: Math.cos(coneHalfAngleRad)
  };
}

function getTankTarget(tankUnit, enemyUnits, stats) {
  const origin = attackerPosition(tankUnit);
  const facingUp = tankUnit.owner === "player";
  const dirX = 0;
  const dirY = facingUp ? -1 : 1;
  const candidates = [];

  for (const enemy of enemyUnits) {
    if (enemy.hp <= 0 || enemy.isDefeated || enemy.progress >= 1) {
      continue;
    }
    const pos = attackerPosition(enemy);
    const vx = pos.x - origin.x;
    const vy = pos.y - origin.y;
    const dist = Math.hypot(vx, vy);
    if (dist > stats.range) {
      continue;
    }
    if (dist === 0) {
      candidates.push({ unit: enemy, dist });
      continue;
    }
    const cosAngle = (vx * dirX + vy * dirY) / dist;
    if (cosAngle >= stats.coneHalfAngleCos) {
      candidates.push({ unit: enemy, dist });
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => {
    if (a.dist !== b.dist) {
      return a.dist - b.dist;
    }
    return b.unit.progress - a.unit.progress;
  });
  return candidates[0].unit;
}

function updateTankCreepFire(dt) {
  const tankStats = getTankWeaponStats();
  const shootFrom = (ownerUnits, enemyUnits, ownerName) => {
    for (const unit of ownerUnits) {
      if (unit.defId !== "tank" || unit.hp <= 0 || unit.isDefeated || unit.progress >= 1) {
        continue;
      }
      unit.shootCooldown -= dt;
      if (unit.shootCooldown > 0) {
        continue;
      }
      const target = getTankTarget(unit, enemyUnits, tankStats);
      if (!target) {
        continue;
      }
      spawnProjectile(attackerPosition(unit), target, tankStats.damage, "#14532d", "tank", ownerName, 1.15);
      unit.shootCooldown = tankStats.fireRate;
    }
  };
  shootFrom(state.attackersPlayer, state.attackersAI, "player");
  shootFrom(state.attackersAI, state.attackersPlayer, "ai");
}

function spawnRedAoeBursts(centerUnit, splashDamage, ignoreUnitId, sourceOwner) {
  const origin = attackerPosition(centerUnit);
  const groupId = state.nextFireBurstId;
  state.nextFireBurstId += 1;
  const directions = 6;
  const particlesPerDirection = 8;
  for (let d = 0; d < directions; d += 1) {
    const baseAngle = (Math.PI * 2 * d) / directions;
    for (let i = 0; i < particlesPerDirection; i += 1) {
      const angle = baseAngle + (Math.random() - 0.5) * 0.32;
      const distancePx = 200 + Math.random() * 100;
      const normDistance = distancePx / Math.max(canvas.width, 1);
      const speed = 1.35 + Math.random() * 0.55;
      const life = normDistance / speed;
      state.fireBursts.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        groupId,
        splashDamage,
        sourceOwner,
        ignoreUnitId,
        hitIds: []
      });
    }
  }
}
