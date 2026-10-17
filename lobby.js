// lobby.js — Multiplayer matchmaking UI and phase coordination for Line Tower Wars
// Depends on: multiplayer.js (window.MP), script.js globals

(function () {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const DISCONNECT_GRACE_SECONDS = 20;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let _disconnectCountdownTimer   = null;
  let _disconnectOverlayEl        = null;
  let _opponentName               = "Opponent";
  let _scoreAtBattleStart         = 0;
  let _aiScoreAtBattleStart       = 0;
  let _presenceUnwatch            = null;
  let _cancelBothReady            = null;
  let _isWaitingForOpponent       = false;

  // ---------------------------------------------------------------------------
  // Init — called once after Firebase init succeeds
  // ---------------------------------------------------------------------------
  function init() {
    _injectMatchmakingOverlay();
    _wireMenuButtons();
  }

  // ---------------------------------------------------------------------------
  // UI: Matchmaking overlay
  // ---------------------------------------------------------------------------
  function _injectMatchmakingOverlay() {
    if (document.getElementById("matchmaking-overlay")) return;

    const el = document.createElement("section");
    el.id = "matchmaking-overlay";
    el.className = "matchmaking-overlay hidden";
    el.setAttribute("aria-label", "Finding match");
    el.innerHTML = `
      <div class="matchmaking-card">
        <p class="eyebrow" id="matchmaking-eyebrow">Online match</p>
        <h2 id="matchmaking-title">Finding a rival\u2026</h2>
        <div class="matchmaking-spinner" id="matchmaking-spinner" aria-hidden="true"></div>
        <p class="matchmaking-status" id="matchmaking-status">Looking for a commander to challenge.</p>
        <div class="matchmaking-actions">
          <button id="matchmaking-cancel-btn" class="secondary" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.getElementById("app-shell").appendChild(el);

    document.getElementById("matchmaking-cancel-btn").addEventListener("click", () => {
      cancelMatchmaking();
    });
  }

  function _injectDisconnectOverlay() {
    if (document.getElementById("disconnect-overlay")) return;
    const el = document.createElement("div");
    el.id = "disconnect-overlay";
    el.className = "disconnect-overlay hidden";
    el.innerHTML = `
      <div class="disconnect-card">
        <p class="eyebrow">Connection lost</p>
        <h2 id="disconnect-title">Rival disconnected</h2>
        <p class="disconnect-status" id="disconnect-status">Waiting for them to return\u2026</p>
        <div class="disconnect-countdown" id="disconnect-countdown" hidden></div>
      </div>
    `;
    document.getElementById("app-shell").appendChild(el);
    _disconnectOverlayEl = el;
  }

  function _showMatchmakingOverlay(titleText, statusText) {
    const el = document.getElementById("matchmaking-overlay");
    if (!el) return;
    el.classList.remove("hidden");
    const eyebrowEl = document.getElementById("matchmaking-eyebrow");
    if (eyebrowEl) eyebrowEl.textContent = "Online match";
    document.getElementById("matchmaking-title").textContent   = titleText  || "Finding a rival\u2026";
    document.getElementById("matchmaking-status").textContent  = statusText || "Looking for a commander to challenge.";
    document.getElementById("matchmaking-spinner").hidden = false;
    document.getElementById("matchmaking-cancel-btn").hidden = false;
  }

  function _hideMatchmakingOverlay() {
    const el = document.getElementById("matchmaking-overlay");
    if (el) el.classList.add("hidden");
  }

  function _updateMatchmakingStatus(titleText, statusText, hideSpinner) {
    const titleEl  = document.getElementById("matchmaking-title");
    const statusEl = document.getElementById("matchmaking-status");
    const spinner  = document.getElementById("matchmaking-spinner");
    if (titleEl)  titleEl.textContent  = titleText  || "";
    if (statusEl) statusEl.textContent = statusText || "";
    if (spinner)  spinner.hidden = !!hideSpinner;
  }

  // ---------------------------------------------------------------------------
  // Menu wiring
  // ---------------------------------------------------------------------------
  function _wireMenuButtons() {
    const findBtn = document.getElementById("find-match-btn");
    const vsAiBtn = document.getElementById("play-match-btn");

    if (findBtn) {
      findBtn.addEventListener("click", () => {
        if (!MP.isAvailable()) {
          alert("Online multiplayer is not available right now. Check your connection.");
          return;
        }
        startMatchmaking();
      });
    }

    // "Play vs AI" uses the standard startNewMatch from script.js
    // (it already has this listener in script.js — no change needed)

    // "Play Again" after a multiplayer match — capture phase so we can stop propagation
    // and prevent script.js's bubble listener from also calling startNewMatch()
    const playAgainBtn = document.getElementById("match-play-again-btn");
    if (playAgainBtn) {
      playAgainBtn.addEventListener("click", (event) => {
        if (multiplayerRole !== null) {
          event.stopPropagation(); // prevent script.js bubble listener from firing
          _endMultiplayerSession();
          setScreen("menu");
        }
        // else: let the event bubble to script.js's startNewMatch() listener
      }, true); // capture phase
    }
  }

  // ---------------------------------------------------------------------------
  // Matchmaking flow
  // ---------------------------------------------------------------------------
  function startMatchmaking() {
    _showMatchmakingOverlay(
      "Finding a rival\u2026",
      "Looking for a commander to challenge."
    );

    MP.startMatchmaking(
      "Commander",   // display name (could be extended to let user set a name)
      (result) => {
        // Match found — result: { roomId, role, opponentName }
        _onMatchFound(result);
      },
      (err) => {
        console.error("[Lobby] Matchmaking error:", err);
        _hideMatchmakingOverlay();
        alert("Could not find a match. Please try again.");
      }
    );
  }

  function cancelMatchmaking() {
    MP.cancelMatchmaking();
    _hideMatchmakingOverlay();
  }

  async function _onMatchFound({ roomId, role, opponentName }) {
    _opponentName = opponentName || "Opponent";

    _updateMatchmakingStatus(
      `Rival found!`,
      `Matched with ${_opponentName}. Loading\u2026`,
      true
    );
    document.getElementById("matchmaking-cancel-btn").hidden = true;

    // Give the UI a brief moment to show the found state
    await _delay(800);

    _hideMatchmakingOverlay();

    // Set the global multiplayer mode flags (defined in script.js)
    multiplayerRole   = role;
    multiplayerRoomId = roomId;
    multiplayerOpponentName = _opponentName;

    // Update HUD label
    const opponentLabel = document.getElementById("opponent-label");
    if (opponentLabel) opponentLabel.textContent = _opponentName;

    // Setup Firebase presence (disconnect detection)
    await MP.setupPresence(roomId, role);
    _injectDisconnectOverlay();
    _presenceUnwatch = MP.watchOpponentPresence(
      (ts) => _onOpponentDisconnect(ts),
      ()   => _onOpponentReconnect()
    );

    // Start the match in single-player frame, then multiplayer overrides AI
    startNewMatch();
    updateStatus(`Online match vs ${_opponentName}. Build your lane.`);

    // Update connection dot
    _setConnectionDot("connected");
  }

  // ---------------------------------------------------------------------------
  // Prep phase submission (called from script.js launchWave guard)
  // ---------------------------------------------------------------------------
  function submitPrepPhaseData() {
    if (multiplayerRole === null || !multiplayerRoomId) return;

    // Snapshot current prep decisions
    const towers    = state.playerTowers.map((t) => (t ? t.id : null));
    const towerLevels = state.playerTowers.map((t) => (t ? Math.max(1, Number(t.level) || 1) : null));
    const queue     = [...state.playerQueue];
    const fanSeeds  = queue.map(() => Math.random() * 2 - 1); // precompute deterministic seeds

    const prepData = {
      waveNumber:       state.waveNumber,
      towers,
      towerLevels,
      queue,
      fanSeeds,
      towerUpgrades:    { ...state.playerTowerUpgrades },
      attackerUpgrades: { ...state.playerAttackerUpgrades }
    };

    // Record score snapshot before the battle starts
    _scoreAtBattleStart = state.playerScore;
    _aiScoreAtBattleStart = state.aiScore;

    // Freeze the game loop while waiting — prevents launchWave() re-firing every frame
    state.phase = "waiting";

    // Show waiting UI
    _isWaitingForOpponent = true;
    _setConnectionDot("pending");
    updateStatus("Submitted! Waiting for opponent\u2026");
    if (battleSkipBtnEl) {
      battleSkipBtnEl.textContent = "Waiting\u2026";
      battleSkipBtnEl.disabled    = true;
    }

    console.warn(`[Lobby] submitPrepPhaseData called. role=${multiplayerRole} room=${multiplayerRoomId} wave=${state.waveNumber}`);

    // Submit to Firebase
    MP.submitPrepData(prepData).then(() => {
      console.warn(`[Lobby] submitPrepData resolved. role=${multiplayerRole}`);
      // Listen for both players to be ready
      _cancelBothReady = MP.listenForBothReady(state.waveNumber, (reason) => {
        _cancelBothReady = null;
        _isWaitingForOpponent = false;
        _setConnectionDot("connected");

        console.warn(`[Lobby] listenForBothReady callback. reason=${reason || "both-ready"} role=${multiplayerRole}`);

        if (reason === "timeout") {
          // Opponent never submitted — treat as forfeit
          _handleOpponentForfeit("prep");
          return;
        }

        _launchBattleFromOpponentData();
      });
    }).catch((err) => {
      console.error("[Lobby] submitPrepData error:", err);
      updateStatus("Network error. Retrying\u2026");
    });
  }

  // Fetch opponent data, reconstruct their side, then launch battle
  async function _launchBattleFromOpponentData() {
    try {
      let data = await MP.getOpponentPrepData(state.waveNumber);

      if (!MP.validatePrepData(data)) {
        console.warn("[Lobby] Invalid opponent prep data; sanitizing.", data);
        data = _sanitizeOpponentPrepData(data);
      }

      // Load opponent tower upgrades globally (used by makeAttacker)
      opponentAttackerUpgrades = data.attackerUpgrades || {};
      const opponentTowerUpgrades = data.towerUpgrades || {};

      // Reconstruct opponent towers with the same runtime fields used in
      // normal gameplay (cone math, targeting, cooldown defaults, etc.).
      state.aiTowers = data.towers.map((towerId, slotIndex) => {
        if (!towerId) return null;
        const def = towerDefs.find((t) => t.id === towerId);
        if (!def) return null;
        const lvl = opponentTowerUpgrades[towerId] || 0;
        const mult = Math.pow(TOWER_UPGRADE_MULTIPLIER, lvl);
        const syncedLevel = Math.max(1, Number(data.towerLevels?.[slotIndex]) || 1);
        const tower = createTowerInstance(def, "ai", syncedLevel);
        tower.damage *= mult;
        tower.range *= mult;
        tower.fireRate /= mult;
        tower.cooldown = 0;
        return tower;
      });

      // Store queue + precomputed fanSeeds for _doLaunchWave
      state.aiQueue     = [...(data.queue || [])];
      state._aiFanSeeds = data.fanSeeds || [];

      // Reset battle skip button
      if (battleSkipBtnEl) {
        battleSkipBtnEl.textContent = "Battle";
        battleSkipBtnEl.disabled    = false;
      }

      // Actually launch the battle (the internal body of launchWave)
      _doLaunchWave();

    } catch (err) {
      console.error("[Lobby] _launchBattleFromOpponentData error:", err);
      updateStatus("Network error loading opponent data\u2026");
    }
  }

  function _sanitizeOpponentPrepData(raw) {
    const safe = (raw && typeof raw === "object") ? { ...raw } : {};
    const normalizeOpponentTowerId = (towerId) => towerId === "orange" ? "blue" : towerId;
    const validTowerIds = new Set(["violet", "yellow", "red", "green", "blue"]);
    const validAttackerIds = new Set(attackerDefs.map((attacker) => attacker.id));

    const towers = Array.isArray(safe.towers) ? safe.towers.slice(0, 5) : [];
    while (towers.length < 5) towers.push(null);
    for (let i = 0; i < towers.length; i += 1) {
      const towerId = normalizeOpponentTowerId(towers[i]);
      towers[i] = validTowerIds.has(towerId) ? towerId : null;
    }
    safe.towers = towers;

    const levels = Array.isArray(safe.towerLevels) ? safe.towerLevels.slice(0, 5) : [];
    while (levels.length < 5) levels.push(null);
    for (let i = 0; i < levels.length; i += 1) {
      if (safe.towers[i] === null) {
        levels[i] = null;
      } else {
        const level = Number(levels[i]);
        levels[i] = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
      }
    }
    safe.towerLevels = levels;

    const queue = Array.isArray(safe.queue) ? safe.queue.filter((id) => validAttackerIds.has(id)) : [];
    safe.queue = queue;

    const fanSeeds = Array.isArray(safe.fanSeeds) ? safe.fanSeeds : [];
    safe.fanSeeds = queue.map((_, idx) => Number.isFinite(fanSeeds[idx]) ? fanSeeds[idx] : 0);

    safe.towerUpgrades = (safe.towerUpgrades && typeof safe.towerUpgrades === "object") ? safe.towerUpgrades : {};
    safe.attackerUpgrades = (safe.attackerUpgrades && typeof safe.attackerUpgrades === "object") ? safe.attackerUpgrades : {};

    return safe;
  }

  // ---------------------------------------------------------------------------
  // Battle completion (called from script.js onBattleFinished hook)
  // ---------------------------------------------------------------------------
  async function onMultiplayerBattleFinished() {
    const roundScore = state.playerScore - _scoreAtBattleStart;
    console.warn(`[Lobby] onMultiplayerBattleFinished. wave=${state.waveNumber} role=${multiplayerRole} score=${roundScore} playerScore=${state.playerScore} aiScore=${state.aiScore}`);

    // Report my score, then receive the opponent's authoritative score.
    const result = await MP.completeBattle(state.waveNumber, roundScore).catch((err) => {
      console.warn("[Lobby] completeBattle error:", err);
      return { opponentScore: state.aiScore - _aiScoreAtBattleStart };
    });

    // Reconcile opponent side using their own sim's round score (source of truth
    // for what their attackers did), in case our local sim diverged.
    const opponentRoundScore = (result && typeof result.opponentScore === "number") ? result.opponentScore : (state.aiScore - _aiScoreAtBattleStart);
    state.aiScore = _aiScoreAtBattleStart + opponentRoundScore;
    console.warn(`[Lobby] Reconciled scores. playerScore=${state.playerScore} aiScore=${state.aiScore}`);

    // Advance match the same way single-player does
    if (state.waveNumber >= MAX_ROUNDS) {
      console.warn(`[Lobby] finishMatch branch. wave=${state.waveNumber} >= MAX_ROUNDS`);
      finishMatch();
    } else {
      console.warn(`[Lobby] advance-to-next-round branch. wave=${state.waveNumber}`);
      openRoundShop();
    }
  }

  // ---------------------------------------------------------------------------
  // Shop decision (called from script.js shopStartBtnEl hook)
  // ---------------------------------------------------------------------------
  function onShopStart() {
    console.warn(`[Lobby] onShopStart. role=${multiplayerRole} wave=${state.waveNumber}`);
    if (multiplayerRole === null) return;

    // Submit the upgrade choice for records (non-blocking)
    MP.submitShopChoice(
      state.waveNumber - 1,
      state.shopSelectionType,
      state.shopSelectionId
    ).catch(() => { /* non-critical */ });

    // Advance to next round banner immediately — sync happens at prep submission
    beginRoundBanner();
  }

  // ---------------------------------------------------------------------------
  // Match end
  // ---------------------------------------------------------------------------
  function _endMultiplayerSession() {
    MP.closeRoom().catch(() => { /* ignore */ });
    if (_presenceUnwatch)  { _presenceUnwatch(); _presenceUnwatch = null; }
    if (_cancelBothReady)  { _cancelBothReady(); _cancelBothReady = null; }
    _hideDisconnectOverlay();
    _setConnectionDot(null);

    // Clear globals in script.js
    multiplayerRole          = null;
    multiplayerRoomId        = null;
    multiplayerOpponentName  = "Opponent";
    opponentAttackerUpgrades = {};

    // Reset HUD label
    const opponentLabel = document.getElementById("opponent-label");
    if (opponentLabel) opponentLabel.textContent = "AI";

    if (battleSkipBtnEl) {
      battleSkipBtnEl.textContent = "Battle";
      battleSkipBtnEl.disabled    = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnect / forfeit handling
  // ---------------------------------------------------------------------------
  function _onOpponentDisconnect(timestamp) {
    if (state.gameOver) return;
    _showDisconnectOverlay();
    _startDisconnectCountdown();
    _setConnectionDot("disconnected");
  }

  function _onOpponentReconnect() {
    _hideDisconnectOverlay();
    _cancelDisconnectCountdown();
    _setConnectionDot("connected");
    updateStatus(`${_opponentName} reconnected.`);
  }

  function _handleOpponentForfeit(reason) {
    _hideDisconnectOverlay();
    _cancelDisconnectCountdown();
    console.error(`[Lobby] Opponent forfeit fired. reason=${reason} role=${multiplayerRole} room=${multiplayerRoomId}`);

    // Award win to local player
    state.matchWinner = "player";
    state.winnerText  = `${_opponentName} disconnected. You win!`;
    state.gameOver    = true;
    state.phase       = "gameover";
    state.hasActiveMatch = false;
    state.matchSummary = {
      title:    "Victory",
      copy:     `${_opponentName} left the match. Victory awarded to you.`,
      stats:    [
        { label: "Scoreline",    value: `${state.playerScore}-${state.aiScore}` },
        { label: "Towers Placed", value: state.matchStats ? state.matchStats.towersPlaced : 0 }
      ],
      nextGoal: ""
    };
    updateStatus(state.winnerText);
    refreshAllUI();
  }

  function _showDisconnectOverlay() {
    if (!_disconnectOverlayEl) return;
    _disconnectOverlayEl.classList.remove("hidden");
    const titleEl  = document.getElementById("disconnect-title");
    const statusEl = document.getElementById("disconnect-status");
    if (titleEl)  titleEl.textContent  = `${_opponentName} disconnected`;
    if (statusEl) statusEl.textContent = "Waiting for them to return\u2026";
    const countdownEl = document.getElementById("disconnect-countdown");
    if (countdownEl) countdownEl.hidden = true;
  }

  function _hideDisconnectOverlay() {
    if (_disconnectOverlayEl) _disconnectOverlayEl.classList.add("hidden");
  }

  function _startDisconnectCountdown() {
    _cancelDisconnectCountdown();
    let secondsLeft = DISCONNECT_GRACE_SECONDS;
    const countdownEl = document.getElementById("disconnect-countdown");
    const statusEl    = document.getElementById("disconnect-status");

    if (countdownEl) countdownEl.hidden = false;
    _updateDisconnectCountdown(secondsLeft, countdownEl, statusEl);

    _disconnectCountdownTimer = setInterval(() => {
      secondsLeft -= 1;
      _updateDisconnectCountdown(secondsLeft, countdownEl, statusEl);
      if (secondsLeft <= 0) {
        _cancelDisconnectCountdown();
        _handleOpponentForfeit("timeout");
      }
    }, 1000);
  }

  function _updateDisconnectCountdown(secondsLeft, countdownEl, statusEl) {
    if (countdownEl) countdownEl.textContent = `${secondsLeft}s`;
    if (statusEl)    statusEl.textContent = secondsLeft > 0
      ? `Forfeiting in ${secondsLeft} second${secondsLeft !== 1 ? "s" : ""}\u2026`
      : "Forfeited.";
  }

  function _cancelDisconnectCountdown() {
    if (_disconnectCountdownTimer) {
      clearInterval(_disconnectCountdownTimer);
      _disconnectCountdownTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Connection dot helper
  // ---------------------------------------------------------------------------
  function _setConnectionDot(dotState) {
    const dot = document.getElementById("connection-dot");
    if (!dot) return;
    dot.classList.remove("connected", "pending", "disconnected");
    dot.hidden = (dotState === null);
    if (dotState) dot.classList.add(dotState);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------
  function _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function _boot() {
    const available = await MP.init();

    // Always inject UI (even if unavailable — buttons will show "offline")
    init();

    const findBtn = document.getElementById("find-match-btn");
    if (!available && findBtn) {
      findBtn.disabled = true;
      findBtn.title    = "Online multiplayer unavailable";
    }
  }

  // Run after DOM + script.js are both ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }

  // ---------------------------------------------------------------------------
  // Public surface (functions called from script.js hooks)
  // ---------------------------------------------------------------------------
  window.Lobby = {
    startMatchmaking,
    cancelMatchmaking,
    submitPrepPhaseData,
    onMultiplayerBattleFinished,
    onShopStart,
    endSession: _endMultiplayerSession
  };
})();
