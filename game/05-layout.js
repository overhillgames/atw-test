// Line Tower Wars runtime, part 05 of 20: viewport size, frame layout, orientation, gesture guard, offscreen canvas, Capacitor plugin, haptics, clamp.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function readVisualViewportSize() {
  return {
    width: Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || LOGICAL_CANVAS_WIDTH),
    height: Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || LOGICAL_CANVAS_HEIGHT)
  };
}

function readPixelValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getShellContentBox(viewportWidth, viewportHeight) {
  if (state.screen === "game") {
    const rootStyles = window.getComputedStyle(document.documentElement);
    const safeLeft = readPixelValue(rootStyles.getPropertyValue("--safe-left"));
    const safeRight = readPixelValue(rootStyles.getPropertyValue("--safe-right"));
    const safeTop = readPixelValue(rootStyles.getPropertyValue("--safe-top"));
    const safeBottom = readPixelValue(rootStyles.getPropertyValue("--safe-bottom"));
    return {
      width: Math.max(1, viewportWidth - safeLeft - safeRight),
      height: Math.max(1, viewportHeight - safeTop - safeBottom)
    };
  }
  const shellStyles = window.getComputedStyle(appShellEl);
  const paddingLeft = readPixelValue(shellStyles.paddingLeft);
  const paddingRight = readPixelValue(shellStyles.paddingRight);
  const paddingTop = readPixelValue(shellStyles.paddingTop);
  const paddingBottom = readPixelValue(shellStyles.paddingBottom);
  return {
    width: Math.max(1, viewportWidth - paddingLeft - paddingRight),
    height: Math.max(1, viewportHeight - paddingTop - paddingBottom)
  };
}

function isDesktopDebugPreviewViewport() {
  return window.matchMedia("(min-width: 901px) and (pointer: fine)").matches;
}

function measureGameChromeHeight() {
  if (state.screen !== "game") {
    return 0;
  }
  return Math.ceil(
    (topBarEl?.getBoundingClientRect().height || 0) +
    (hudStripEl?.getBoundingClientRect().height || 0) +
    (bottomBarEl?.getBoundingClientRect().height || 0)
  );
}

function applyGameFrameLayout(layout) {
  gameFrameLayout = layout;
  window.gameFrameLayout = gameFrameLayout;
  document.documentElement.style.setProperty("--app-width", `${layout.viewportWidth}px`);
  document.documentElement.style.setProperty("--app-height", `${layout.viewportHeight}px`);
  document.documentElement.style.setProperty("--game-frame-width", `${layout.frameWidth}px`);
  document.documentElement.style.setProperty("--game-frame-height", `${layout.frameHeight}px`);
  document.documentElement.style.setProperty("--safe-frame-x", `${layout.safeFrameX || 0}px`);
  document.documentElement.style.setProperty("--safe-frame-y", `${layout.safeFrameY || 0}px`);
  document.documentElement.style.setProperty("--pixi-safe-width", `${layout.safeFrameWidth || layout.frameWidth}px`);
  document.documentElement.style.setProperty("--pixi-safe-height", `${layout.safeFrameHeight || layout.frameHeight}px`);
  document.documentElement.style.setProperty("--game-frame-scale", layout.scale.toFixed(4));
  document.documentElement.style.setProperty("--game-frame-aspect", String(GAME_FRAME_ASPECT));
  appShellEl.classList.toggle("game-active", state.screen === "game");
  gameScreenEl.classList.toggle("desktop-debug-preview", layout.desktopPreview);
  resizePixiRendererToLayout();
}

function calculateGameFrameLayout() {
  const viewport = readVisualViewportSize();
  const desktopPreview = state.screen === "game" && isDesktopDebugPreviewViewport();
  const shellBox = getShellContentBox(viewport.width, viewport.height);
  const maxScale = desktopPreview ? MAX_DESKTOP_PREVIEW_SCALE : MAX_PHONE_FRAME_SCALE;
  const reservedHeight = measureGameChromeHeight();
  const availableWidth = shellBox.width;
  const availableHeight = Math.max(1, shellBox.height - reservedHeight);
  let scale = Math.min(maxScale, availableWidth / LOGICAL_CANVAS_WIDTH, availableHeight / LOGICAL_CANVAS_HEIGHT);
  scale = Math.max(MIN_GAME_FRAME_SCALE, scale);

  const maxBleedWidth = ARTBOARD_WIDTH * scale;
  const frameWidth = Math.round(Math.min(availableWidth, maxBleedWidth));
  // the frame fills the available height; the paper (CSS on #pixi-viewport) covers whatever the artboard does not
  const frameHeight = Math.round(availableHeight);
  const safeFrameWidth = LOGICAL_CANVAS_WIDTH * scale;
  const safeFrameHeight = LOGICAL_CANVAS_HEIGHT * scale;
  const safeFrameX = (frameWidth - safeFrameWidth) / 2;
  const safeFrameY = (frameHeight - safeFrameHeight) / 2;
  const visibleLogicalWidth = frameWidth / scale;
  const visibleLogicalHeight = frameHeight / scale;

  applyGameFrameLayout({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    frameWidth,
    frameHeight,
    safeFrameWidth,
    safeFrameHeight,
    safeFrameX,
    safeFrameY,
    visibleLogicalWidth,
    visibleLogicalHeight,
    safeOffsetLogicalX: safeFrameX / scale,
    safeOffsetLogicalY: safeFrameY / scale,
    scale,
    reservedHeight,
    desktopPreview
  });
}

function updateViewportHeight() {
  calculateGameFrameLayout();
}

function resizeBattlefieldFrame() {
  calculateGameFrameLayout();
}

function updateOrientationNotice() {
  if (!orientationNoticeEl) {
    return;
  }
  // Portrait-first mobile UX: never block gameplay with orientation prompts.
  orientationNoticeEl.classList.add("hidden");
}

async function lockLandscapeOrientation() {
  // Intentionally no-op: do not force landscape on mobile.
  updateOrientationNotice();
}

function preventBrowserGestures(event) {
  if (!appShellEl.contains(event.target)) {
    return;
  }
  if (event.type === "touchmove" && state.screen !== "game" && !touchDragState) {
    return;
  }
  event.preventDefault();
}

function createOffscreenCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  return offscreen;
}

function getCapacitorPlugin(pluginName) {
  return window.Capacitor?.Plugins?.[pluginName] || null;
}

async function triggerPlacementHaptic(type) {
  const haptics = getCapacitorPlugin("Haptics");
  try {
    if (haptics) {
      if (type === "impact") {
        await haptics.impact({ style: "MEDIUM" });
        return;
      }
      await haptics.notification({ type: type.toUpperCase() });
      return;
    }
  } catch {
  }

  if (!navigator.vibrate) {
    return;
  }

  if (type === "impact") {
    navigator.vibrate(14);
  } else if (type === "success") {
    navigator.vibrate([12, 28, 16]);
  } else if (type === "error") {
    navigator.vibrate([24, 40, 24]);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
