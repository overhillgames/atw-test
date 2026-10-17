// Line Tower Wars runtime, part 19 of 20: canvas drawing (lane, ranges, shadows, attackers, projectiles, effects, banner, board), gameLoop.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function drawLane() {
  const w = canvas.width;
  const h = canvas.height;
  if (pixiState.ready) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  if (battlefieldBackgroundImage.complete && battlefieldBackgroundImage.naturalWidth > 0) {
    ctx.drawImage(battlefieldBackgroundImage, 0, 0, w, h);
    return;
  }
  if (!laneBackgroundCanvas || laneBackgroundCanvas.width !== w || laneBackgroundCanvas.height !== h) {
    laneBackgroundCanvas = createOffscreenCanvas(w, h);
    const laneCtx = laneBackgroundCanvas.getContext("2d");
    laneCtx.fillStyle = "#6f6a78";
    laneCtx.fillRect(0, 0, w, h);

    laneCtx.fillStyle = "rgba(255,255,255,0.07)";
    laneCtx.fillRect(0, 0, w, h * 0.48);

    laneCtx.fillStyle = "rgba(0,0,0,0.07)";
    laneCtx.fillRect(0, h * 0.52, w, h * 0.48);

    laneCtx.strokeStyle = "rgba(255,255,255,0.2)";
    laneCtx.lineWidth = 2;
    laneCtx.beginPath();
    laneCtx.moveTo(w * 0.02, h * 0.5);
    laneCtx.lineTo(w * 0.98, h * 0.5);
    laneCtx.stroke();
  }

  ctx.drawImage(laneBackgroundCanvas, 0, 0);
}

function drawTowerRanges() {
  const drawTower = (tower, pos) => {
    if (!tower) {
      return;
    }
    const x = canvas.width * pos.x;
    const y = canvas.height * pos.y;
    const range = tower.range * canvas.width;
    const facingUp = pos.y > 0.5;
    const baseAngle = facingUp ? -Math.PI / 2 : Math.PI / 2;
    const halfAngle = tower.coneHalfAngleRad || ((BASE_TOWER_CONE_DEGREES * Math.PI) / 360);
    const startAngle = baseAngle - halfAngle;
    const endAngle = baseAngle + halfAngle;

    ctx.fillStyle = `${tower.color}33`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, range, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
  };

  for (let i = 0; i < 5; i += 1) {
    drawTower(state.playerTowers[i], towerPosPlayer[i]);
    drawTower(state.aiTowers[i], towerPosAI[i]);
  }
}

function getBattlefieldDepth(yNorm) {
  const y = yNorm * LOGICAL_CANVAS_HEIGHT;
  const top = BATTLEFIELD_BOUNDS.y;
  const bottom = BATTLEFIELD_BOUNDS.y + BATTLEFIELD_BOUNDS.height;
  return 1 - clamp((y - top) / Math.max(1, bottom - top), 0, 1);
}

function drawSoftOvalShadow(x, y, width, height, alpha) {
  const color = OBJECT_SHADOWS.color;
  ctx.save();
  ctx.fillStyle = `rgba(${color}, ${alpha * 0.48})`;
  ctx.beginPath();
  ctx.ellipse(x, y, width * 0.62, height * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(${color}, ${alpha * 0.3})`;
  ctx.beginPath();
  ctx.ellipse(x, y, width * 0.82, height * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawObjectShadow(xNorm, yNorm, renderWidth, renderHeight, kind) {
  const cfg = OBJECT_SHADOWS[kind] || OBJECT_SHADOWS.creep;
  const depth = Math.min(getBattlefieldDepth(yNorm), cfg.maxDepth ?? 1);
  const widthScale = OBJECT_SHADOWS.minWidthScale + (OBJECT_SHADOWS.maxWidthScale - OBJECT_SHADOWS.minWidthScale) * depth;
  const heightScale = OBJECT_SHADOWS.minHeightScale + (OBJECT_SHADOWS.maxHeightScale - OBJECT_SHADOWS.minHeightScale) * depth;
  const alpha = OBJECT_SHADOWS.minAlpha + (OBJECT_SHADOWS.maxAlpha - OBJECT_SHADOWS.minAlpha) * depth;
  const x = canvas.width * xNorm;
  const y = canvas.height * yNorm + renderHeight * cfg.yOffsetRatio;
  const width = renderWidth * cfg.widthRatio * widthScale;
  const height = renderHeight * cfg.heightRatio * heightScale;
  drawSoftOvalShadow(x, y, width, height, alpha);
}

function drawTowerShadows() {
  const drawTowerShadow = (tower, pos, yOffset = 0) => {
    if (!tower) {
      return;
    }
    const levelScale = Math.max(1, Number(tower.level) || 1) > 1 ? 1.16 : 1;
    drawObjectShadow(
      pos.x,
      (pos.y * LOGICAL_CANVAS_HEIGHT + yOffset) / LOGICAL_CANVAS_HEIGHT,
      TOWER_RENDER_BOX_WIDTH * levelScale,
      TOWER_RENDER_BOX_HEIGHT * levelScale,
      "tower"
    );
  };

  for (let i = 0; i < 5; i += 1) {
    drawTowerShadow(state.aiTowers[i], towerPosAI[i]);
    drawTowerShadow(state.playerTowers[i], towerPosPlayer[i], -6);
  }
}

function drawAttackerShadows(units) {
  for (const unit of units) {
    const pos = attackerPosition(unit);
    const side = getOwnerVisualSide(unit.owner);
    const spriteCfg = attackerSpriteConfigSets[side]?.[unit.defId] || attackerSpriteConfig[unit.defId];
    drawObjectShadow(
      pos.x,
      pos.y,
      spriteCfg?.renderWidth || 42,
      spriteCfg?.renderHeight || 42,
      "creep"
    );
  }
}

function drawAttackers(units) {
  for (const unit of units) {
    const pos = attackerPosition(unit);
    const x = canvas.width * pos.x;
    const y = canvas.height * pos.y;
    const side = getOwnerVisualSide(unit.owner);
    const spriteCfg = attackerSpriteConfigSets[side]?.[unit.defId] || attackerSpriteConfig[unit.defId];
    const renderWidth = spriteCfg?.renderWidth || 42;
    const renderHeight = spriteCfg?.renderHeight || 42;

    const spriteImg = attackerSpriteSets[side]?.[unit.defId] || attackerSprites[unit.defId];
    if (spriteCfg && spriteImg && spriteImg.complete) {
      const frame = Math.floor(state.animationClock * spriteCfg.fps) % spriteCfg.frames;
      const shouldInvertForAI = unit.owner === "ai" && (unit.defId === "wisp" || unit.defId === "tank");
      if (shouldInvertForAI) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, -1);
        ctx.drawImage(
          spriteImg,
          frame * spriteCfg.frameWidth,
          0,
          spriteCfg.frameWidth,
          spriteCfg.frameHeight,
          -renderWidth / 2,
          -renderHeight / 2,
          renderWidth,
          renderHeight
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          spriteImg,
          frame * spriteCfg.frameWidth,
          0,
          spriteCfg.frameWidth,
          spriteCfg.frameHeight,
          x - renderWidth / 2,
          y - renderHeight / 2,
          renderWidth,
          renderHeight
        );
      }
    } else {
      ctx.fillStyle = unit.color;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    const hpRatio = clamp(unit.hp / unit.maxHp, 0, 1);
    const hpBarY = y - (renderHeight / 2) - 6;
    ctx.fillStyle = "#111827";
    ctx.fillRect(x - 10, hpBarY, 20, 3);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x - 10, hpBarY, 20 * hpRatio, 3);

    if (unit.poisonTimer > 0) {
      ctx.fillStyle = "rgba(74, 222, 128, 0.38)";
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i += 1) {
        const a = state.animationClock * 5 + unit.id * 0.7 + i;
        ctx.fillStyle = "rgba(134, 239, 172, 0.7)";
        ctx.fillRect(
          x + Math.cos(a) * (4 + i * 0.7),
          y + Math.sin(a * 1.3) * (4 + i * 0.6),
          2,
          2
        );
      }
    }
  }
}

function drawTankCreepRanges() {
  const stats = getTankWeaponStats();
  const halfAngle = (180 * Math.PI) / 360;
  const drawForUnits = (units, facingUp) => {
    const baseAngle = facingUp ? -Math.PI / 2 : Math.PI / 2;
    const startAngle = baseAngle - halfAngle;
    const endAngle = baseAngle + halfAngle;
    for (const unit of units) {
      if (unit.defId !== "tank" || unit.hp <= 0 || unit.isDefeated || unit.progress >= 1) {
        continue;
      }
      const pos = attackerPosition(unit);
      const x = canvas.width * pos.x;
      const y = canvas.height * pos.y;
      const rangePx = stats.range * canvas.width;
      ctx.fillStyle = "rgba(20, 83, 45, 0.16)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, rangePx, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();
    }
  };
  drawForUnits(state.attackersPlayer, true);
  drawForUnits(state.attackersAI, false);
}

function drawProjectiles() {
  for (const projectile of state.projectiles) {
    const x = canvas.width * projectile.x;
    const y = canvas.height * projectile.y;
    if (projectile.towerId === "violet") {
      const trail = projectile.trail;
      const pNow = trail[trail.length - 1] || { x: projectile.x, y: projectile.y };
      const pPrev = trail[Math.max(0, trail.length - 4)] || { x: projectile.prevX, y: projectile.prevY };
      const x0 = canvas.width * pPrev.x;
      const y0 = canvas.height * pPrev.y;
      const x1 = canvas.width * pNow.x;
      const y1 = canvas.height * pNow.y;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const streak = 18;
      const backX = x1 - ux * streak;
      const backY = y1 - uy * streak;

      ctx.strokeStyle = "rgba(167, 139, 250, 0.8)";
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(backX, backY);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      ctx.strokeStyle = "rgba(233, 213, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(backX + ux * 3, backY + uy * 3);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      continue;
    }

    if (projectile.towerId === "yellow") {
      const trail = projectile.trail;
      if (trail.length > 1) {
        ctx.lineCap = "round";
        for (let i = 1; i < trail.length; i += 1) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          const x0 = canvas.width * p0.x;
          const y0 = canvas.height * p0.y;
          const x1 = canvas.width * p1.x;
          const y1 = canvas.height * p1.y;
          const midX = (x0 + x1) * 0.5;
          const midY = (y0 + y1) * 0.5;
          const jitter = ((projectile.id + i) % 2 === 0 ? 1 : -1) * 3;

          ctx.strokeStyle = "rgba(250, 204, 21, 0.42)";
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(midX + jitter, midY - jitter);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(x, y, 3.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (projectile.towerId === "red") {
      const pulse = 0.85 + 0.2 * Math.sin(state.animationClock * 25 + projectile.id);
      const radius = 3.1 * pulse;
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fca5a5";
      ctx.beginPath();
      ctx.arc(x - 0.8, y - 0.8, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 4; i += 1) {
        const angle = state.animationClock * 9 + projectile.id * 0.3 + i * (Math.PI / 2);
        const sx = x + Math.cos(angle) * 4.2;
        const sy = y + Math.sin(angle) * 4.2;
        ctx.fillStyle = i % 2 === 0 ? "#fb7185" : "#f97316";
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      }
      continue;
    }

    if (projectile.towerId === "green") {
      const trail = projectile.trail;
      const pNow = trail[trail.length - 1] || { x: projectile.x, y: projectile.y };
      const pPrev = trail[Math.max(0, trail.length - 3)] || { x: projectile.prevX, y: projectile.prevY };
      const x0 = canvas.width * pPrev.x;
      const y0 = canvas.height * pPrev.y;
      const x1 = canvas.width * pNow.x;
      const y1 = canvas.height * pNow.y;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;

      const trailLen = 14;
      ctx.strokeStyle = "rgba(74, 222, 128, 0.55)";
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.2) {
        const bx = x1 - ux * trailLen * t;
        const by = y1 - uy * trailLen * t;
        const twist = Math.sin((state.animationClock * 40) + projectile.id + t * 8) * (2.2 * (1 - t));
        const tx = bx + px * twist;
        const ty = by + py * twist;
        if (t === 0) {
          ctx.moveTo(tx, ty);
        } else {
          ctx.lineTo(tx, ty);
        }
      }
      ctx.stroke();

      const tipX = x1;
      const tipY = y1;
      const backX = tipX - ux * 8;
      const backY = tipY - uy * 8;
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX + px * 3.4, backY + py * 3.4);
      ctx.lineTo(backX - px * 3.4, backY - py * 3.4);
      ctx.closePath();
      ctx.fill();
      continue;
    }

    if (projectile.towerId === "blue") {
      ctx.fillStyle = "rgba(96, 165, 250, 0.28)";
      ctx.beginPath();
      ctx.arc(x, y, 7.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2563eb";
      ctx.beginPath();
      ctx.arc(x, y, 6.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#bfdbfe";
      ctx.beginPath();
      ctx.arc(x - 1.2, y - 1.2, 2.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (projectile.towerId === "tank") {
      ctx.fillStyle = "rgba(20, 83, 45, 0.45)";
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#14532d";
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(x, y, 3.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFireBursts() {
  for (const burst of state.fireBursts) {
    const x = canvas.width * burst.x;
    const y = canvas.height * burst.y;
    const t = clamp(burst.life / burst.maxLife, 0, 1);
    ctx.globalAlpha = 0.45 + t * 0.45;
    ctx.fillStyle = t > 0.5 ? "#fb923c" : "#fca5a5";
    ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
    ctx.globalAlpha = 1;
  }
}

function drawYellowLeaps() {
  for (const leap of state.yellowLeaps) {
    const t = clamp(leap.life / leap.maxLife, 0, 1);
    const x0 = canvas.width * leap.fromX;
    const y0 = canvas.height * leap.fromY;
    const x1 = canvas.width * leap.toX;
    const y1 = canvas.height * leap.toY;
    const midX = (x0 + x1) * 0.5;
    const midY = (y0 + y1) * 0.5;
    const jitter = Math.sin(state.animationClock * 80 + leap.fromX * 17) * 4;

    ctx.globalAlpha = 0.25 + t * 0.75;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(250, 204, 21, 0.86)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(midX + jitter, midY - jitter);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.strokeStyle = "rgba(254, 249, 195, 0.95)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(midX - jitter * 0.4, midY + jitter * 0.4);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawTowerFlashes() {
  for (const flash of state.towerFlashes) {
    const t = clamp(flash.life / flash.maxLife, 0, 1);
    const x = canvas.width * flash.x;
    const y = canvas.height * flash.y;
    const radius = 10 + (1 - t) * 18;
    ctx.fillStyle = `${flash.color}${Math.round(80 + t * 100).toString(16).padStart(2, "0")}`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDeathParticles() {
  for (const particle of state.deathParticles) {
    const x = canvas.width * particle.x;
    const y = canvas.height * particle.y;
    const t = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = t;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawDeathEffects() {
  const cfg = creepKillEffectConfig;
  const sprite = creepKillEffectSprite;
  if (!cfg || !sprite?.complete || sprite.naturalWidth <= 0) {
    return;
  }
  const frameCount = cfg.frames || 1;
  const frameWidth = cfg.frameWidth || Math.floor(sprite.naturalWidth / frameCount);
  const frameHeight = cfg.frameHeight || sprite.naturalHeight;
  const renderWidth = cfg.renderWidth || frameWidth;
  const renderHeight = cfg.renderHeight || frameHeight;
  for (const effect of state.deathEffects) {
    const progress = clamp(1 - effect.life / effect.maxLife, 0, 0.999);
    const frame = Math.min(frameCount - 1, Math.floor(progress * frameCount));
    const x = canvas.width * effect.x;
    const y = canvas.height * effect.y;
    ctx.drawImage(
      sprite,
      frame * frameWidth,
      0,
      frameWidth,
      frameHeight,
      x - renderWidth / 2,
      y - renderHeight / 2,
      renderWidth,
      renderHeight
    );
  }
}

function drawRoundBanner() {
  if (state.phase !== "banner" || state.roundBannerTimer <= 0) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "rgba(15, 23, 42, 0.42)";
  ctx.fillRect(w * 0.12, h * 0.41, w * 0.76, h * 0.18);
  ctx.strokeStyle = "rgba(226, 232, 240, 0.72)";
  ctx.lineWidth = 2;
  ctx.strokeRect(w * 0.12, h * 0.41, w * 0.76, h * 0.18);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 18px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Prepare Yourself", w * 0.5, h * 0.47);
  ctx.font = "700 40px Trebuchet MS";
  ctx.fillText(state.roundBannerText, w * 0.5, h * 0.535);
}

function drawBoard() {
  if (state.mode === "tug") { ensurePixiViewport(); updatePixiTug(); return; }
  ensurePixiViewport();
  drawLane();
  if (SHOW_RANGE_ARCS) {
    drawTowerRanges();
    drawTankCreepRanges();
  }
  // The split: once Pixi is ready, units, towers, projectiles, effects and the banner are persistent Pixi
  // display objects driven by state.animationClock (updatePixiUnits, 18b), so the canvas draws nothing and
  // nothing is uploaded. The canvas drawing below runs only as the pixi-failed fallback.
  if (!pixiState.ready) {
    drawTowerShadows();
    drawAttackerShadows(state.attackersPlayer);
    drawAttackerShadows(state.attackersAI);
    drawAttackers(state.attackersPlayer);
    drawAttackers(state.attackersAI);
    drawProjectiles();
    drawFireBursts();
    drawYellowLeaps();
    drawTowerFlashes();
    drawDeathParticles();
    drawDeathEffects();
    drawRoundBanner();
    updatePixiDynamicTexture();
  } else {
    updatePixiUnits();
  }
  updatePixiMarkers();
  updatePixiTowers();
  updatePixiTimerFill();
  updatePixiCardStates();
  updatePixiHudText();
}

let previousTime = performance.now();
function gameLoop(timestamp) {
  const dt = clamp((timestamp - previousTime) / 1000, 0, 0.25);
  previousTime = timestamp;

  if (state.screen === "game") {
    updateGame(dt);
    drawBoard();
    refreshHUD();
  }

  requestAnimationFrame(gameLoop);
}
