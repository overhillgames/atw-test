// multiplayer.js - Firebase Realtime Database layer for Line Tower Wars
// Exposes window.MP. Requires Firebase compat SDK loaded before this file.
//
// Firebase Realtime Database rules:
// {
//   "rules": {
//     "rooms": {
//       ".read": "auth != null",
//       ".indexOn": ["status", "host"],
//       "$roomId": {
//         ".write": "auth != null"
//       }
//     }
//   }
// }

window.MP = (function () {
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC0uEiWvp5sU9C4PBC3YJLoW2hoiHZagSA",
    authDomain: "tower-wars-1d46b.firebaseapp.com",
    databaseURL: "https://tower-wars-1d46b-default-rtdb.firebaseio.com",
    projectId: "tower-wars-1d46b",
    storageBucket: "tower-wars-1d46b.firebasestorage.app",
    messagingSenderId: "1025721278227",
    appId: "1:1025721278227:web:b7ad7906643fbca40d84e6"
  };

  const STALE_QUEUE_MS = 90_000;
  const POLL_INTERVAL_MS = 2_500;
  const READY_TIMEOUT_MS = 45_000;

  let db = null;
  let myUid = null;
  let myTabId = null;
  let multiplayerAvailable = false;

  let _roomId = null;
  let _myRole = null;
  let _opponentRole = null;
  let _displayName = "Player";

  let _pollTimer = null;
  let _bothReadyOff = null;
  let _disconnectOff = null;
  let _readyTimeoutTimer = null;

  function _generateId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function init() {
    if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
      console.warn("[MP] Firebase not configured - multiplayer disabled.");
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      // Always generate a fresh tab ID so duplicated tabs never share an ID.
      myTabId = _generateId("tab");

      const auth = firebase.auth();
      // Use in-memory-only auth persistence so each tab gets its own UID.
      // Firebase compat defaults to IndexedDB (shared across same-origin tabs),
      // which would cause multiple tabs to share one anonymous user and break
      // matchmaking (clients filter/transact as if they were the same peer).
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      const cred = await auth.signInAnonymously();
      myUid = cred.user.uid;
      db = firebase.database();
      multiplayerAvailable = true;

      console.log("[MP] Ready.", { uid: myUid, tabId: myTabId });
      return true;
    } catch (err) {
      console.warn("[MP] Init failed:", err.message);
      multiplayerAvailable = false;
      return false;
    }
  }

  function isAvailable() {
    return multiplayerAvailable;
  }

  function getMyUid() {
    return myUid;
  }

  function getMyTabId() {
    return myTabId;
  }

  function setDisplayName(name) {
    _displayName = (name || "Player").slice(0, 20);
  }

  function getPlatform() {
    if (window.Capacitor) {
      return window.Capacitor.getPlatform() || "mobile";
    }
    return "web";
  }

  function _isRoomOlder(candidateRoomId, candidateRoom, ownRoomId, ownRoom) {
    const candidateCreatedAt = Number.isFinite(candidateRoom?.createdAt) ? candidateRoom.createdAt : null;
    const ownCreatedAt = Number.isFinite(ownRoom?.createdAt) ? ownRoom.createdAt : null;

    if (candidateCreatedAt !== null && ownCreatedAt !== null) {
      if (candidateCreatedAt !== ownCreatedAt) {
        return candidateCreatedAt < ownCreatedAt;
      }
      return candidateRoomId < ownRoomId;
    }

    return candidateRoomId < ownRoomId;
  }

  function _compareRoomAge(roomIdA, roomA, roomIdB, roomB) {
    if (_isRoomOlder(roomIdA, roomA, roomIdB, roomB)) {
      return -1;
    }
    if (_isRoomOlder(roomIdB, roomB, roomIdA, roomA)) {
      return 1;
    }
    return 0;
  }

  async function startMatchmaking(displayName, onFound, onError) {
    if (!multiplayerAvailable) {
      onError && onError(new Error("Multiplayer not available"));
      return;
    }
    setDisplayName(displayName);

    let matched = false;
    let myWaitingRoomId = null;
    let hostRoomListener = null;
    let matchmakingMode = "joining";
    let joiningIdlePolls = 0;

    function _detachHostRoomListener(roomId = myWaitingRoomId) {
      if (!hostRoomListener || !roomId) {
        hostRoomListener = null;
        return;
      }

      db.ref(`rooms/${roomId}`).off("value", hostRoomListener);
      hostRoomListener = null;
    }

    async function _removeOwnWaitingRoom(reason, extraDetails = null) {
      if (!myWaitingRoomId) {
        return;
      }

      const roomId = myWaitingRoomId;
      myWaitingRoomId = null;
      _detachHostRoomListener(roomId);

      console.info("[MP] Removing own waiting room.", {
        roomId,
        reason,
        uid: myUid,
        tabId: myTabId,
        ...(extraDetails || {})
      });

      try {
        await db.ref(`rooms/${roomId}`).remove();
      } catch (err) {
        console.warn("[MP] Failed to remove own waiting room.", {
          roomId,
          reason,
          message: err.message
        });
      }
    }

    function _finish(result) {
      if (matched) {
        return;
      }

      matched = true;
      _stopMatchmaking();
      _detachHostRoomListener();

      _roomId = result.roomId;
      _myRole = result.role;
      _opponentRole = result.role === "host" ? "guest" : "host";

      console.log("[MP] Match found.", {
        roomId: result.roomId,
        role: result.role,
        uid: myUid,
        tabId: myTabId
      });
      onFound(result);
    }

    async function _enterJoiningMode(reason, details = null) {
      if (matched) {
        return;
      }

      matchmakingMode = "joining";
      joiningIdlePolls = 0;

      console.info("[MP] Switching to joining mode.", {
        reason,
        uid: myUid,
        tabId: myTabId,
        ...(details || {})
      });

      await _removeOwnWaitingRoom(reason, details);
    }

    async function _enterHostingMode(reason) {
      if (matched || myWaitingRoomId) {
        return;
      }

      matchmakingMode = "hosting";
      joiningIdlePolls = 0;

      const roomId = await _createWaitingRoom();
      myWaitingRoomId = roomId;
      await db.ref(`rooms/${roomId}`).onDisconnect().remove();

      console.info("[MP] Switching to hosting mode.", {
        roomId,
        reason,
        uid: myUid,
        tabId: myTabId
      });

      const roomRef = db.ref(`rooms/${roomId}`);
      hostRoomListener = roomRef.on("value", (snap) => {
        const room = snap.val();
        if (!room || matched) {
          return;
        }
        if (room.guest && room.status === "active") {
          console.log("[MP] Waiting room accepted guest.", {
            roomId,
            guest: room.guest,
            guestTabId: room.guestTabId || null
          });
          _finish({
            roomId,
            role: "host",
            opponentName: room.guestName || "Opponent"
          });
        }
      });
    }

    async function _attemptJoin(skipRoomId) {
      const attempt = await _tryJoinWaitingRoom(skipRoomId);
      if (matched) {
        return attempt;
      }

      if (attempt.joinResult) {
        if (myWaitingRoomId) {
          await _removeOwnWaitingRoom("joined-older-room", {
            targetRoomId: attempt.joinResult.roomId
          });
        }

        _finish(attempt.joinResult);
      }

      if (attempt.sawOlderRoom && myWaitingRoomId) {
        await _enterJoiningMode("older-waiting-room-detected", {
          candidateRoomId: attempt.candidateRoomId,
          failureReason: attempt.failureReason
        });
      }

      return attempt;
    }

    try {
      const initialAttempt = await _attemptJoin(null);
      if (matched || initialAttempt.joinResult) {
        return;
      }
    } catch (err) {
      console.warn("[MP] Initial join attempt failed:", err.message);
    }

    try {
      await _enterHostingMode("initial-scan-found-no-joinable-room");
    } catch (err) {
      onError && onError(err);
      return;
    }

    try {
      const immediateAttempt = await _attemptJoin(myWaitingRoomId);
      if (matched || immediateAttempt.joinResult) {
        return;
      }
    } catch (err) {
      console.warn("[MP] Immediate retry after room creation failed:", err.message);
    }

    _pollTimer = setInterval(async () => {
      if (matched) {
        return;
      }

      try {
        const skipRoomId = matchmakingMode === "hosting" ? myWaitingRoomId : null;
        const pollAttempt = await _attemptJoin(skipRoomId);
        if (matched || pollAttempt.joinResult) {
          return;
        }

        if (matchmakingMode !== "joining") {
          return;
        }

        if (pollAttempt.sawOlderRoom) {
          joiningIdlePolls = 0;
          return;
        }

        joiningIdlePolls += 1;
        if (!myWaitingRoomId && joiningIdlePolls >= 1) {
          await _enterHostingMode("no-older-waiting-room-visible");
        }
      } catch (err) {
        console.warn("[MP] Poll error:", err.message);
      }
    }, POLL_INTERVAL_MS);
  }

  async function _tryJoinWaitingRoom(skipRoomId) {
    const result = {
      joinResult: null,
      sawOlderRoom: false,
      candidateRoomId: null,
      failureReason: null
    };

    const snap = await db.ref("rooms")
      .orderByChild("status")
      .equalTo("waiting")
      .limitToFirst(20)
      .once("value");

    const rooms = snap.val() || {};
    let ownWaitingRoom = skipRoomId ? rooms[skipRoomId] || null : null;
    if (skipRoomId && !ownWaitingRoom) {
      try {
        const ownRoomSnap = await db.ref(`rooms/${skipRoomId}`).once("value");
        ownWaitingRoom = ownRoomSnap.val();
      } catch (err) {
        console.warn("[MP] Failed to refresh own waiting room.", {
          roomId: skipRoomId,
          message: err.message
        });
      }
    }

    const now = Date.now();
    const candidates = Object.entries(rooms)
      .filter(([roomId, room]) => {
        if (!room || typeof room !== "object") {
          console.debug("[MP] Skipping candidate room: invalid payload.", { roomId });
          return false;
        }

        if (roomId === skipRoomId) {
          console.debug("[MP] Skipping candidate room: own waiting room.", {
            roomId,
            tabId: myTabId
          });
          return false;
        }

        const stale = !room.createdAt || room.createdAt < now - STALE_QUEUE_MS;
        if (stale) {
          console.debug("[MP] Skipping candidate room: stale.", {
            roomId,
            createdAt: room.createdAt || null
          });
          return false;
        }

        const shouldYieldToCandidate = skipRoomId && ownWaitingRoom
          ? _isRoomOlder(roomId, room, skipRoomId, ownWaitingRoom)
          : false;
        if (skipRoomId && ownWaitingRoom && !shouldYieldToCandidate) {
          console.info("[MP] Staying host; candidate room is newer.", {
            roomId,
            ownRoomId: skipRoomId,
            candidateCreatedAt: room.createdAt || null,
            ownCreatedAt: ownWaitingRoom.createdAt || null
          });
          return false;
        }

        const sameTab = room.hostTabId ? room.hostTabId === myTabId : room.host === myUid;
        if (sameTab) {
          console.debug("[MP] Skipping candidate room: same tab.", {
            roomId,
            host: room.host || null,
            hostTabId: room.hostTabId || null,
            uid: myUid,
            tabId: myTabId
          });
          return false;
        }

        if (shouldYieldToCandidate) {
          result.sawOlderRoom = true;
        }

        return true;
      })
      .sort(([roomIdA, roomA], [roomIdB, roomB]) => _compareRoomAge(roomIdA, roomA, roomIdB, roomB));

    for (const [roomId, room] of candidates) {
      if (!result.candidateRoomId) {
        result.candidateRoomId = roomId;
      }

      console.debug("[MP] Attempting to join candidate room.", {
        roomId,
        host: room.host,
        hostTabId: room.hostTabId || null,
        uid: myUid,
        tabId: myTabId
      });

      const roomRef = db.ref(`rooms/${roomId}`);
      let latestRoom = room;
      try {
        const candidateSnap = await roomRef.once("value");
        latestRoom = candidateSnap.val();
      } catch (err) {
        console.warn("[MP] Failed to refresh candidate room.", {
          roomId,
          message: err.message
        });
        result.failureReason = result.failureReason || "candidate-refresh-failed";
        continue;
      }

      if (!latestRoom || latestRoom.status !== "waiting" || latestRoom.guest) {
        const failureReason = !latestRoom
          ? "room-missing"
          : latestRoom.guest
            ? "already-claimed"
            : `status-${latestRoom.status || "unknown"}`;
        console.info("[MP] Refreshed candidate room is not joinable.", {
          roomId,
          reason: failureReason,
          status: latestRoom?.status || null,
          guest: latestRoom?.guest || null
        });
        result.failureReason = result.failureReason || failureReason;
        continue;
      }

      try {
        await roomRef.update({
          status: "active",
          guest: myUid,
          guestName: _displayName,
          guestTabId: myTabId
        });
      } catch (err) {
        console.warn(`[MP] Update failed on room ${roomId}: ${err.message}`);
        result.failureReason = result.failureReason || "update-failed";
        continue;
      }

      // Verify we won any race — re-read and confirm we're the guest.
      let verifyRoom = null;
      try {
        const verifySnap = await roomRef.once("value");
        verifyRoom = verifySnap.val();
      } catch (err) {
        console.warn(`[MP] Verify read failed for room ${roomId}: ${err.message}`);
      }

      if (verifyRoom && verifyRoom.guest === myUid && verifyRoom.status === "active") {
        console.log("[MP] Joined room as guest.", {
          roomId,
          uid: myUid,
          tabId: myTabId
        });
        result.joinResult = {
          roomId,
          role: "guest",
          opponentName: verifyRoom.hostName || latestRoom.hostName || "Opponent"
        };
        return result;
      }

      const failureReason = !verifyRoom
        ? "room-missing-after-claim"
        : verifyRoom.guest !== myUid
          ? "lost-race"
          : `status-${verifyRoom.status || "unknown"}`;
      console.warn(`[MP] Claim did not stick on room ${roomId}. reason=${failureReason} status=${verifyRoom?.status || "null"} guest=${verifyRoom?.guest || "null"}`);
      result.failureReason = result.failureReason || failureReason;
    }

    console.debug("[MP] No joinable waiting rooms found.", {
      roomCount: Object.keys(rooms).length,
      uid: myUid,
      tabId: myTabId
    });
    return result;
  }

  async function _createWaitingRoom() {
    const roomId = _generateId("room");
    await db.ref(`rooms/${roomId}`).set({
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: "waiting",
      host: myUid,
      hostTabId: myTabId,
      hostName: _displayName,
      guest: null,
      guestTabId: null,
      guestName: null,
      hostReady: false,
      guestReady: false,
      disconnect: { host: null, guest: null }
    });

    console.log("[MP] Created waiting room.", {
      roomId,
      uid: myUid,
      tabId: myTabId
    });
    return roomId;
  }

  async function cancelMatchmaking() {
    _stopMatchmaking();

    try {
      const snap = await db.ref("rooms")
        .orderByChild("status")
        .equalTo("waiting")
        .once("value");
      const rooms = snap.val() || {};

      for (const [roomId, room] of Object.entries(rooms)) {
        const ownWaitingRoom = room &&
          room.status === "waiting" &&
          (room.hostTabId ? room.hostTabId === myTabId : room.host === myUid);
        if (!ownWaitingRoom) {
          continue;
        }

        console.log("[MP] Removing waiting room during cancel.", {
          roomId,
          uid: myUid,
          tabId: myTabId
        });
        db.ref(`rooms/${roomId}`).remove();
      }
    } catch (_) {
      // Ignore cleanup failures.
    }
  }

  function _stopMatchmaking() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  async function setupPresence(roomId, role) {
    _roomId = roomId;
    _myRole = role;
    _opponentRole = role === "host" ? "guest" : "host";

    const presRef = db.ref(`rooms/${roomId}/disconnect/${role}`);
    await presRef.onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
    await presRef.set(null);
  }

  function watchOpponentPresence(onDisconnectCb, onReconnectCb) {
    if (!_roomId || !_opponentRole) {
      return () => {};
    }

    const ref = db.ref(`rooms/${_roomId}/disconnect/${_opponentRole}`);
    const handler = ref.on("value", (snap) => {
      const timestamp = snap.val();
      if (timestamp !== null && timestamp !== undefined) {
        onDisconnectCb && onDisconnectCb(timestamp);
      } else {
        onReconnectCb && onReconnectCb();
      }
    });

    _disconnectOff = () => ref.off("value", handler);
    return _disconnectOff;
  }

  async function clearMyPresenceDisconnect() {
    if (!_roomId || !_myRole) {
      return;
    }

    try {
      await db.ref(`rooms/${_roomId}/disconnect/${_myRole}`).set(null);
    } catch (_) {
      // Ignore transient disconnect cleanup failures.
    }
  }

  async function submitPrepData(data) {
    if (!_roomId || !_myRole) {
      throw new Error("No active room");
    }

    console.warn(`[MP] submitPrepData start. room=${_roomId} role=${_myRole} wave=${data.waveNumber}`);

    // Firebase RTDB strips trailing/leading null entries when storing arrays,
    // which truncates fixed-length slot arrays. Encode nulls as "empty" sentinel.
    const encodedTowers = (data.towers || []).map((t) => (t === null || t === undefined ? "empty" : t));

    const roundRef = db.ref(`rooms/${_roomId}/rounds/${data.waveNumber}/${_myRole}`);
    try {
      await roundRef.set({
        towers: encodedTowers,
        towerLevels: data.towerLevels,
        queue: data.queue,
        fanSeeds: data.fanSeeds,
        towerUpgrades: data.towerUpgrades,
        attackerUpgrades: data.attackerUpgrades,
        submittedAt: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (err) {
      console.error(`[MP] submitPrepData round write failed. room=${_roomId} role=${_myRole}: ${err.message}`);
      throw err;
    }

    try {
      await db.ref(`rooms/${_roomId}/rounds/${data.waveNumber}/${_myRole}Ready`).set(true);
      console.warn(`[MP] submitPrepData ready flag set. room=${_roomId} role=${_myRole} wave=${data.waveNumber}`);
    } catch (err) {
      console.error(`[MP] submitPrepData ready write failed. room=${_roomId} role=${_myRole}: ${err.message}`);
      throw err;
    }
  }

  function listenForBothReady(waveNumber, callback) {
    if (typeof waveNumber === "function") {
      callback = waveNumber;
      waveNumber = null;
    }
    if (!_roomId) {
      return () => {};
    }

    if (!Number.isFinite(waveNumber)) {
      console.error(`[MP] listenForBothReady missing wave number. room=${_roomId} role=${_myRole}`);
      callback && callback("timeout");
      return () => {};
    }

    console.warn(`[MP] listenForBothReady start. room=${_roomId} role=${_myRole} wave=${waveNumber}`);

    const ref = db.ref(`rooms/${_roomId}/rounds/${waveNumber}`);
    let fired = false;

    const handler = ref.on("value", (snap) => {
      const round = snap.val();
      if (!round || fired) {
        return;
      }
      console.warn(`[MP] listenForBothReady snap. wave=${waveNumber} hostReady=${!!round.hostReady} guestReady=${!!round.guestReady}`);
      if (round.hostReady && round.guestReady) {
        fired = true;
        ref.off("value", handler);
        if (_bothReadyOff === handler) {
          _bothReadyOff = null;
        }
        callback();
      }
    });

    _bothReadyOff = handler;
    _readyTimeoutTimer = setTimeout(() => {
      if (fired) {
        return;
      }
      fired = true;
      ref.off("value", handler);
      console.error(`[MP] listenForBothReady TIMEOUT after ${READY_TIMEOUT_MS}ms. room=${_roomId} role=${_myRole} wave=${waveNumber}`);
      callback("timeout");
    }, READY_TIMEOUT_MS);

    return () => {
      ref.off("value", handler);
      clearTimeout(_readyTimeoutTimer);
    };
  }

  async function getOpponentPrepData(waveNumber) {
    if (!_roomId || !_opponentRole) {
      throw new Error("No active room");
    }

    const snap = await db.ref(`rooms/${_roomId}/rounds/${waveNumber}/${_opponentRole}`).once("value");
    const data = snap.val();
    if (!data) {
      return data;
    }

    // Decode towers: pad back to length 5 and convert "empty" sentinel to null.
    const rawTowers = Array.isArray(data.towers) ? data.towers : [];
    const towers = new Array(5).fill(null);
    for (let i = 0; i < 5; i++) {
      const val = rawTowers[i];
      towers[i] = val === "empty" || val === undefined ? null : val;
    }
    data.towers = towers;

    const rawTowerLevels = Array.isArray(data.towerLevels) ? data.towerLevels : [];
    const towerLevels = new Array(5).fill(null);
    for (let i = 0; i < 5; i++) {
      const level = rawTowerLevels[i];
      towerLevels[i] = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : null;
    }
    data.towerLevels = towerLevels;

    // Firebase drops empty arrays — guarantee queue/fanSeeds are arrays.
    if (!Array.isArray(data.queue)) data.queue = [];
    if (!Array.isArray(data.fanSeeds)) data.fanSeeds = [];

    return data;
  }

  async function completeBattle(waveNumber, myScore) {
    if (!_roomId || !_myRole) {
      return { opponentScore: 0 };
    }

    await db.ref(`rooms/${_roomId}/rounds/${waveNumber}/${_myRole}Score`).set(myScore);

    // Wait up to 10s for the opponent's authoritative round score so both
    // clients reconcile their local sim divergences against a single source.
    const opponentRef = db.ref(`rooms/${_roomId}/rounds/${waveNumber}/${_opponentRole}Score`);
    const opponentScore = await new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        opponentRef.off("value", handler);
        clearTimeout(timeoutId);
        resolve(val);
      };
      const handler = opponentRef.on("value", (snap) => {
        const val = snap.val();
        if (val !== null && val !== undefined) {
          finish(val);
        }
      });
      const timeoutId = setTimeout(() => {
        console.warn(`[MP] completeBattle opponent-score wait timed out. room=${_roomId} wave=${waveNumber}`);
        finish(0);
      }, 10_000);
    });

    console.warn(`[MP] completeBattle resolved. wave=${waveNumber} myScore=${myScore} opponentScore=${opponentScore}`);
    return { opponentScore: Number(opponentScore) || 0 };
  }

  async function submitShopChoice(waveNumber, type, id) {
    if (!_roomId || !_myRole) {
      return;
    }

    try {
      await db.ref(`rooms/${_roomId}/rounds/${waveNumber}/${_myRole}/shopChoice`).set({ type, id });
    } catch (_) {
      // Shop choice logging is non-critical.
    }
  }

  async function closeRoom() {
    if (!_roomId) {
      return;
    }

    try {
      await db.ref(`rooms/${_roomId}/status`).set("finished");
    } catch (_) {
      // Ignore room close failures.
    }
    _cleanupRoomState();
  }

  function _cleanupRoomState() {
    if (_disconnectOff) {
      _disconnectOff();
      _disconnectOff = null;
    }
    if (_readyTimeoutTimer) {
      clearTimeout(_readyTimeoutTimer);
      _readyTimeoutTimer = null;
    }
    _roomId = null;
    _myRole = null;
    _opponentRole = null;
  }

  const VALID_TOWER_IDS = ["violet", "yellow", "red", "green", "blue", "orange", null];
  const VALID_ATTACKER_IDS = ["imp", "runner", "brute", "wisp", "tank"];

  function validatePrepData(data) {
    if (!data) {
      return false;
    }
    if (!Array.isArray(data.towers) || data.towers.length !== 5) {
      return false;
    }
    if (data.towerLevels !== undefined) {
      if (!Array.isArray(data.towerLevels) || data.towerLevels.length !== 5) {
        return false;
      }
      for (let i = 0; i < data.towerLevels.length; i += 1) {
        const towerId = data.towers[i];
        const level = data.towerLevels[i];
        if (towerId === null) {
          if (!(level === null || level === undefined)) {
            return false;
          }
          continue;
        }
        if (!Number.isFinite(level) || level < 1) {
          return false;
        }
      }
    }
    if (!Array.isArray(data.queue)) {
      return false;
    }
    if (!data.towers.every((towerId) => VALID_TOWER_IDS.includes(towerId))) {
      return false;
    }
    if (!data.queue.every((attackerId) => VALID_ATTACKER_IDS.includes(attackerId))) {
      return false;
    }
    if (data.fanSeeds !== undefined && !Array.isArray(data.fanSeeds)) {
      return false;
    }
    return true;
  }

  return {
    init,
    isAvailable,
    getMyUid,
    getMyTabId,
    setDisplayName,
    startMatchmaking,
    cancelMatchmaking,
    setupPresence,
    watchOpponentPresence,
    clearMyPresenceDisconnect,
    submitPrepData,
    listenForBothReady,
    getOpponentPrepData,
    completeBattle,
    submitShopChoice,
    closeRoom,
    validatePrepData,
    get roomId() { return _roomId; },
    get myRole() { return _myRole; },
    get opponentRole() { return _opponentRole; },
    get tabId() { return myTabId; }
  };
})();
