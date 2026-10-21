// Line Tower Wars runtime, tug mode online: the Firebase side of a tug match between two clients
// (.plans/ltw-tug-pvp-lockstep.md, slice A, 2026-10-13). It finds or hosts a tug room, agrees the seed and the start
// time, writes my inputs and my front, reads the opponent's, compares the hashes, ends the match on a forfeit or a lost
// connection, and provides the entry points for the menu's Play Online button and the match-end card's Play Again.
// A classic script sharing the game's global scope, loaded after tug/tug-mode.js and before 20-main.js. The Firebase
// SDK, multiplayer.js and lobby.js load later, so firebase, MP and the lobby's overlay are touched only inside
// functions that run on a user action (or a timer or listener one started), never at load time.
// Modular: this file and the Play Online button (#open-online-btn, via index.html's click map) are the whole online tug surface. multiplayer.js and lobby.js are
// never edited: of theirs this file only calls MP.isAvailable, MP.getMyUid and MP.getMyTabId and reuses the lobby's
// #matchmaking-overlay (its markup and ids; injected the same way when it is missing). Pull-out: delete game/tug/,
// its script tags and the click map's tugNetPlayOnline / tugNetPlayAgainOnline entries.
//
// The room, under the shared rooms/ root. Classic lists rooms with status "waiting" only, so no classic client, old or
// new, can list or join a tug room; the rules are classic's (rooms/$roomId writable by any signed-in user).
//   rooms/<roomId> = { createdAt: server ms, status: "tug-waiting" | "tug-active" | "tug-finished",
//     host: uid, hostTabId, hostName, hostPack, guest: null | uid, guestTabId, guestName, guestPack, mode: "tug",
//     build: TUG_NET_BUILD, (hostPack, guestPack: the player's Art screen pick, a pack id; may be missing)
//     seed: uint32 (the host's),
//     tug: { startAt: null | server ms (the host's server clock + TUG_NET_START_DELAY_MS, once the guest is in),
//       in: { host: { "000001": { t, k, a }, ... }, guest: { ... } } (the input log; keys: seq zero-padded to 6),
//       front: { host: { n, s }, guest: { n, s } } (n: no input of mine with t <= n is left unwritten; s: my last seq),
//       hash: { host: { t, h }, guest: { t, h } } (overwritten every TUG_MODE_HASH_EVERY ticks),
//       left: { host: null | ts, guest: null | ts } (quit or menu while live),
//       gone: { host: null | ts, guest: null | ts } (onDisconnect timestamps, cleared on every connect) } }
//   An input: { t: tick, k: "mob" | "tower" | "pick", a: creep id | slot | { slot, kind } }. Within one tick the
//   host's inputs apply before the guest's, each role's by seq.
//
// Matchmaking (tugNetFind; multiplayer.js's classic flow, mirrored without touching it): scan the tug-waiting rooms
// (the newest TUG_NET_SCAN_LIMIT); a candidate is not mine (hostTabId), not stale (createdAt within TUG_NET_STALE_MS
// of the server clock), mode "tug", build TUG_NET_BUILD; oldest first. Claim with update, re-read, keep it only when
// the guest is me (classic's verify): I am the guest. No candidate: host my own room (removed by onDisconnect while it
// waits) and re-scan every TUG_NET_POLL_MS, yielding to an older room (mine is removed first). My room turning
// tug-active with a guest makes me the host: the onDisconnect remove is cancelled and I write tug/startAt. Both watch
// the room for a numeric startAt (the guest also checks the room is still its), then the card says "Starting…" and
// startNewMatch({ mode: "tug", net: { roomId, role, seed, startAt, opponentName, opponentPack } }) opens the match. A room that
// vanishes or is given up before the start sends the other side back to searching. Cancel removes my waiting room,
// or marks a claimed one finished with my left. The display name is "Player-" + my uid's first four characters (the
// lobby's name is private to it).
//
// The lockstep contract with tug-mode.js, every function safe with no session:
//   tugNetActive() -> true from tugNetStart until tugNetLeave.
//   tugNetStart(net) (tugStartMatch, options.net): attaches child_added on tug/in/<opp> and value on tug/front/<opp>,
//     hash/<opp>, left/<opp>, gone/<opp>; on every connect arms my onDisconnect gone timestamp and clears gone/<me>;
//     starts the TUG_NET_HEARTBEAT_MS heartbeat that writes front/<me> = { n: target + TUG_NET_DELAY_TICKS - 1,
//     s: my last seq } when n moved.
//   tugNetTargetTick() -> floor((server now - startAt) / 1000 / ProtoSim.BATTLE_DT); negative before startAt (-1 with
//     no session).
//   tugNetSend(k, a) -> t: one input at t = target + TUG_NET_DELAY_TICKS (never at or under a front already
//     published) with my next seq, written with my front in one update on tug/ and put in my own pending store, so
//     both roles' inputs come back through tugNetInputsFor alike. null with no session.
//   tugNetAllowedTick() -> the last tick that is safe to step: the opponent's front.n when every opponent seq up to
//     front.s has arrived (front.s 0: none sent), else the last contiguous input's t - 1; -1 before any front. Never
//     lower than an answer it gave before (a tick once safe stays safe).
//   tugNetInputsFor(tick) -> removes and returns every pending input (both roles) with t <= tick, each { role, seq,
//     t, k, a }, sorted by (t, host before guest, seq); one with t < tick is logged as late and still returned.
//   tugNetReportHash(tick, h): writes hash/<me>, keeps my last TUG_NET_HASH_KEEP, compares with the opponent's on the
//     same tick in either arrival order; the first mismatch calls tugModeOnDesync(tick), once.
//   tugNetLeave(reason): idempotent, safe before any session and from inside this file's own listeners. A session
//     still open marks the room tug-finished and, unless reason is "over" (the sim ended the match: a left would hand
//     an opponent a few ticks behind a forfeit win), writes left/<me>; then cancels my onDisconnect, detaches every
//     listener, stops the heartbeat and clears the store. A search still running is cancelled.
//   Into tug-mode.js (each guarded with typeof, each on a fresh task so never inside tug-mode's own call or a Firebase
//   callback, dropped once the session was left): tugModeOnOpponentLeft("left") when left/<opp> is set;
//   tugModeOnNetStatus("Opponent disconnected…") when gone/<opp> is set, then tugModeOnOpponentLeft("gone") if it is
//   still set TUG_NET_GONE_GRACE_MS later, or tugModeOnNetStatus("Opponent is back.") when it clears first; at most one
//   tugModeOnOpponentLeft per session.
// Also public: tugNetFind(), tugNetCancel() (the overlay's Cancel while a tug search runs), tugNetServerNow().
// Menu entry points, called by index.html's click map (no listeners are wired here): Play Online (#open-online-btn) ->
// tugNetPlayOnline() -> MP.isAvailable() (else the lobby's alert) -> tugNetFind(); Play Again (#match-play-again-btn) ->
// tugNetPlayAgainOnline(), which for an online match (tugState.net set; the session is already left by then) runs
// tugNetLeave("play-again"), setScreen("menu") and tugNetPlayOnline() and returns true, else returns false and the
// click map falls back to startNewMatch(). No rematch with the same rival; Play Again searches again.
// Private names here start with tugNet / TUG_NET too.

// ------------------------------------------------------------------------------------- constants and state

const TUG_NET_BUILD = "2026-10-21-a";        // bump whenever sim.js or rules.js changes: only equal builds meet
const TUG_NET_DELAY_TICKS = 18;              // a tap applies this many ticks later on both clients (0.6 s)
const TUG_NET_HEARTBEAT_MS = 100;            // my front is published this often (only when it moved)
const TUG_NET_STALE_MS = 90000;              // a waiting room older than this is skipped (classic's STALE_QUEUE_MS)
const TUG_NET_POLL_MS = 2500;                // matchmaking re-scan (classic's POLL_INTERVAL_MS)
const TUG_NET_START_DELAY_MS = 3000;         // startAt = the host's server clock + this
const TUG_NET_GONE_GRACE_MS = 10000;         // a disconnected opponent forfeits after this
const TUG_NET_HASH_KEEP = 10;                // my last hashes, kept for an opponent hash that arrives late
const TUG_NET_SEQ_DIGITS = 6;                // input keys: "000001"
const TUG_NET_SCAN_LIMIT = 20;               // waiting rooms read per scan (the newest keys)
const TUG_NET_SEARCH_TRIES = 3;              // consecutive failed scans before the search gives up with an alert
const TUG_NET_FOUND_SHOW_MS = 600;           // "Starting…" stays on the card this long before the match opens
const TUG_NET_UNAVAILABLE = "Online multiplayer is not available right now. Check your connection."; // the lobby's
const TUG_NET_SEARCHING = "Looking for an opponent…";

// Session and search (never on state or tugState)
let tugNet = null;             // the match session, tugNetStart until tugNetLeave (its fields: tugNetStart)
let tugNetSearch = null;       // the matchmaking search, tugNetFind until the match opens or tugNetCancel
let tugNetOffset = 0;          // the latest .info/serverTimeOffset, ms
let tugNetOffsetRef = null;    // that listener's ref once attached (it stays for the page's life)
let tugNetCancelBtnEl = null;  // the #matchmaking-cancel-btn carrying this file's listener

// ------------------------------------------------------------------------------------------------- helpers

// My Art screen pick (a pack id), sent in the room so the opponent can draw my army; null when there is none.
function tugNetMyPack() {
  return typeof gameOptions === "object" && gameOptions && typeof gameOptions.artPack === "string" ? gameOptions.artPack : null;
}

// The Firebase server clock in ms: my clock plus the latest .info/serverTimeOffset (0 until it arrives).
function tugNetServerNow() {
  return Date.now() + tugNetOffset;
}

// Keeps tugNetOffset live from the first search on: one local listener, never detached.
function tugNetWatchOffset(db) {
  if (tugNetOffsetRef) {
    return;
  }
  tugNetOffsetRef = db.ref(".info/serverTimeOffset");
  tugNetOffsetRef.on("value", (snap) => {
    const offset = Number(snap.val());
    if (Number.isFinite(offset)) {
      tugNetOffset = offset;
    }
  });
}

function tugNetStamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

// 32 random bits for a room id and a room's seed: matchmaking only, the lockstep path draws nothing.
function tugNetRandom32() {
  const c = window.crypto;
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

// A room id in multiplayer.js's _generateId shape: "<prefix>-<ms in base 36>-<6 random base-36 digits>".
function tugNetGenerateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${tugNetRandom32().toString(36).padStart(6, "0").slice(-6)}`;
}

function tugNetSeqKey(seq) {
  return String(seq).padStart(TUG_NET_SEQ_DIGITS, "0");
}

// An input's argument as the database hands it back (it stores no null): null, undefined and non-finite numbers
// dropped, objects copied without them. Both my own stored copy and the opponent's received copy go through it, so
// the two clients apply the same value.
function tugNetCanon(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "object") {
    return null;
  }
  const out = {};
  let any = false;
  for (const key of Object.keys(value)) {
    const v = tugNetCanon(value[key]);
    if (v !== null) {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : null;
}

// A fire-and-forget database write: a synchronous throw (a bad value) and a rejection both end as one warning.
function tugNetWrite(what, run) {
  try {
    const pending = run();
    if (pending && typeof pending.catch === "function") {
      pending.catch((err) => console.warn(`[tug-net] ${what} failed:`, err && err.message));
    }
  } catch (err) {
    console.warn(`[tug-net] ${what} failed:`, err && err.message);
  }
}

// ref.on behind a liveness check; the matching off goes into offs (tugNetOffAll) before the listener is attached, so a
// detach from inside the handler (even its first call, which a cached value may raise inside ref.on) finds it.
function tugNetOn(offs, alive, ref, event, handler) {
  const callback = (snap) => {
    if (alive()) {
      handler(snap);
    }
  };
  offs.push(() => ref.off(event, callback));
  ref.on(event, callback, (err) => {
    console.warn(`[tug-net] listener cancelled (${event} ${ref.toString()}):`, err && err.message);
  });
}

function tugNetOffAll(offs) {
  while (offs.length) {
    const off = offs.pop();
    try {
      off();
    } catch (err) {
      console.warn("[tug-net] detach failed:", err && err.message);
    }
  }
}

// A call into tug-mode.js on a fresh task (never inside tug-mode's own call into this file or a Firebase callback,
// never before tugState is built), dropped when session s was left meanwhile.
function tugNetNotify(s, call) {
  setTimeout(() => {
    if (tugNet === s) {
      call();
    }
  }, 0);
}

// --------------------------------------------------------------------------------------------- matchmaking

// The Tug Online button (after its MP.isAvailable check): search, join or host, then open the match.
function tugNetFind() {
  if (tugNetSearch) {
    tugNetShowOverlay("Finding a rival…", TUG_NET_SEARCHING);
    return;
  }
  if (!window.MP || typeof MP.isAvailable !== "function" || !MP.isAvailable() || typeof firebase === "undefined") {
    console.warn("[tug-net] multiplayer is not available: no search");
    return;
  }
  if (tugNet) {
    tugNetLeave("new-search"); // never two sessions; before the search exists, so it is not cancelled
  }
  const db = firebase.database();
  tugNetWatchOffset(db);
  const uid = MP.getMyUid();
  const search = {
    db,
    uid,
    tabId: MP.getMyTabId(),
    name: `Player-${String(uid || "").slice(0, 4)}`,
    phase: "joining", // "joining" | "hosting" | "handshake" | "starting"
    roomId: null,     // hosting: my waiting room; handshake / starting: the match room
    room: null,       // that room's latest value
    role: null,       // handshake / starting: "host" | "guest"
    offs: [],
    pollTimer: null,
    goTimer: null,
    busy: false,
    failures: 0
  };
  tugNetSearch = search;
  tugNetShowOverlay("Finding a rival…", TUG_NET_SEARCHING);
  console.log("[tug-net] searching", { uid, tabId: search.tabId, build: TUG_NET_BUILD });
  search.pollTimer = setInterval(() => tugNetPoll(search), TUG_NET_POLL_MS);
  tugNetPoll(search);
}

// The overlay's Cancel (while a tug search runs) and tugNetLeave: my waiting room is removed; a room I already
// claimed or got a guest in is marked finished with my left, so the other side goes back to searching (or, if its
// match already opened, ends it as a forfeit).
function tugNetCancel() {
  const search = tugNetSearch;
  if (!search) {
    return;
  }
  const phase = search.phase;
  const roomId = search.roomId;
  const role = search.role;
  tugNetEndSearch(search);
  if (roomId) {
    const ref = search.db.ref(`rooms/${roomId}`);
    if (phase === "hosting") {
      tugNetWrite("waiting room cancel", () => ref.onDisconnect().cancel());
      tugNetWrite("waiting room remove", () => ref.remove());
    } else if ((phase === "handshake" || phase === "starting") && role) {
      tugNetWrite("room give-up", () => ref.update({ status: "tug-finished", [`tug/left/${role}`]: tugNetStamp() }));
    }
  }
  tugNetHideOverlay();
  console.log("[tug-net] search cancelled", { phase, roomId });
}

function tugNetEndSearch(search) {
  if (search.pollTimer) {
    clearInterval(search.pollTimer);
    search.pollTimer = null;
  }
  if (search.goTimer) {
    clearTimeout(search.goTimer);
    search.goTimer = null;
  }
  tugNetOffAll(search.offs);
  if (tugNetSearch === search) {
    tugNetSearch = null;
  }
}

// One scan (at once, then every TUG_NET_POLL_MS): join a waiting room, else host one. One scan at a time; nothing
// while a handshake runs. TUG_NET_SEARCH_TRIES failures in a row end the search with the lobby's kind of alert.
async function tugNetPoll(search) {
  if (tugNetSearch !== search || search.busy || (search.phase !== "joining" && search.phase !== "hosting")) {
    return;
  }
  search.busy = true;
  try {
    const joined = await tugNetTryJoin(search);
    if (!joined && tugNetSearch === search && search.phase === "joining") {
      await tugNetHost(search);
    }
    search.failures = 0;
  } catch (err) {
    search.failures += 1;
    console.warn(`[tug-net] matchmaking scan failed (${search.failures}/${TUG_NET_SEARCH_TRIES}):`, err && err.message);
    if (search.failures >= TUG_NET_SEARCH_TRIES && tugNetSearch === search) {
      tugNetCancel();
      alert("Could not find a match. Please try again.");
    }
  } finally {
    search.busy = false;
  }
}

// multiplayer.js's _isRoomOlder: the earlier createdAt; the smaller id on a tie or a missing createdAt.
function tugNetIsOlder(idA, roomA, idB, roomB) {
  const a = roomA && Number.isFinite(roomA.createdAt) ? roomA.createdAt : null;
  const b = roomB && Number.isFinite(roomB.createdAt) ? roomB.createdAt : null;
  if (a !== null && b !== null && a !== b) {
    return a < b;
  }
  return idA < idB;
}

// A room I may claim: a full tug room of this build, waiting, no guest, not mine, not stale.
function tugNetJoinable(search, roomId, room, now) {
  if (!room || typeof room !== "object" || roomId === search.roomId) {
    return false;
  }
  if (room.status !== "tug-waiting" || room.guest || room.mode !== "tug" || room.build !== TUG_NET_BUILD) {
    return false;
  }
  if (!room.host || !Number.isFinite(room.seed)) {
    return false;
  }
  if (room.hostTabId ? room.hostTabId === search.tabId : room.host === search.uid) {
    return false;
  }
  return Number.isFinite(room.createdAt) && room.createdAt >= now - TUG_NET_STALE_MS;
}

// The candidate scan. Joining: any joinable room, oldest first. Hosting: only a room older than mine (a stale room of
// mine yields to any: nobody else would join it); mine is removed before the claim, so a guest that claimed it
// meanwhile sees it vanish and searches again. Resolves true once I am a guest (the handshake has begun).
async function tugNetTryJoin(search) {
  const snap = await search.db.ref("rooms")
    .orderByChild("status")
    .equalTo("tug-waiting")
    .limitToLast(TUG_NET_SCAN_LIMIT)
    .once("value");
  if (tugNetSearch !== search || (search.phase !== "joining" && search.phase !== "hosting")) {
    return false;
  }
  const rooms = snap.val() || {};
  const now = tugNetServerNow();
  const hosting = search.phase === "hosting";
  const own = hosting ? search.room : null;
  const ownFresh = !!own && Number.isFinite(own.createdAt) && own.createdAt >= now - TUG_NET_STALE_MS;
  const candidates = Object.entries(rooms)
    .filter(([roomId, room]) => {
      if (!tugNetJoinable(search, roomId, room, now)) {
        return false;
      }
      if (!hosting) {
        return true;
      }
      if (!own) {
        return false; // my room's createdAt is not known yet: stay host
      }
      return !ownFresh || tugNetIsOlder(roomId, room, search.roomId, own);
    })
    .sort(([idA, roomA], [idB, roomB]) => {
      if (tugNetIsOlder(idA, roomA, idB, roomB)) {
        return -1;
      }
      return tugNetIsOlder(idB, roomB, idA, roomA) ? 1 : 0;
    });
  if (!candidates.length) {
    return false;
  }
  if (hosting) {
    tugNetBackToJoining(search, "an older waiting room");
  }
  for (const [roomId] of candidates) {
    if (await tugNetClaim(search, roomId)) {
      return true;
    }
    if (tugNetSearch !== search || search.phase !== "joining") {
      return false;
    }
  }
  return false;
}

// Classic's claim and verify: re-read, update, re-read, keep it only when the room is whole and its guest is me.
async function tugNetClaim(search, roomId) {
  const ref = search.db.ref(`rooms/${roomId}`);
  let latest = null;
  try {
    latest = (await ref.once("value")).val();
  } catch (err) {
    console.warn(`[tug-net] candidate ${roomId} refresh failed:`, err && err.message);
    return false;
  }
  if (tugNetSearch !== search || search.phase !== "joining") {
    return false;
  }
  if (!tugNetJoinable(search, roomId, latest, tugNetServerNow())) {
    console.info(`[tug-net] candidate ${roomId} is no longer joinable`);
    return false;
  }
  try {
    await ref.update({ status: "tug-active", guest: search.uid, guestName: search.name, guestTabId: search.tabId,
      guestPack: tugNetMyPack() });
  } catch (err) {
    console.warn(`[tug-net] claim on ${roomId} failed:`, err && err.message);
    return false;
  }
  let verify = null;
  try {
    verify = (await ref.once("value")).val();
  } catch (err) {
    console.warn(`[tug-net] verify read on ${roomId} failed:`, err && err.message);
  }
  const mine = !!verify && verify.guest === search.uid && verify.guestTabId === search.tabId
    && verify.status === "tug-active";
  if (mine && !verify.host) {
    // the room was removed under the claim, which left a stub of only my fields: drop it
    tugNetWrite("stub remove", () => ref.remove());
    return false;
  }
  if (!mine) {
    console.warn(`[tug-net] claim did not stick on ${roomId}`, { guest: verify ? verify.guest || null : null });
    return false;
  }
  if (tugNetSearch !== search) {
    // cancelled while claiming: the host must not start a match against nobody
    tugNetWrite("claim give-up", () => ref.update({ status: "tug-finished", "tug/left/guest": tugNetStamp() }));
    return false;
  }
  console.log("[tug-net] joined as guest", { roomId, host: verify.hostName || null });
  tugNetHandshake(search, roomId, "guest", verify);
  return true;
}

// Hosting: my waiting room (classic's _createWaitingRoom shape plus mode, build, seed and tug), removed by
// onDisconnect while it waits, watched for a guest.
async function tugNetHost(search) {
  const roomId = tugNetGenerateId("tug");
  const ref = search.db.ref(`rooms/${roomId}`);
  await ref.onDisconnect().remove();
  if (tugNetSearch !== search || search.phase !== "joining") {
    tugNetWrite("waiting room cancel", () => ref.onDisconnect().cancel());
    return;
  }
  try {
    await ref.set({
      createdAt: tugNetStamp(),
      status: "tug-waiting",
      host: search.uid,
      hostTabId: search.tabId,
      hostName: search.name,
      hostPack: tugNetMyPack(),
      guest: null,
      guestTabId: null,
      guestName: null,
      mode: "tug",
      build: TUG_NET_BUILD,
      seed: tugNetRandom32(),
      tug: { startAt: null }
    });
  } catch (err) {
    tugNetWrite("waiting room cancel", () => ref.onDisconnect().cancel());
    throw err;
  }
  if (tugNetSearch !== search || search.phase !== "joining") {
    tugNetWrite("waiting room cancel", () => ref.onDisconnect().cancel());
    tugNetWrite("waiting room remove", () => ref.remove());
    return;
  }
  search.phase = "hosting";
  search.roomId = roomId;
  search.room = null;
  tugNetOn(search.offs, () => tugNetSearch === search && search.roomId === roomId, ref, "value",
    (snap) => tugNetOnSearchRoom(search, roomId, snap.val()));
  console.log("[tug-net] hosting", { roomId });
}

// The room watch of a search. Hosting: a guest in my room makes me the host. Handshake (both roles): a numeric
// startAt opens the match; a room gone, finished, left by the other side or (guest) claimed by another tab sends me
// back to searching.
function tugNetOnSearchRoom(search, roomId, room) {
  if (search.phase === "hosting") {
    if (!room) {
      tugNetBackToJoining(search, "my waiting room vanished");
      return;
    }
    search.room = room;
    if (room.status === "tug-active" && room.guest) {
      tugNetHandshake(search, roomId, "host", room);
    }
    return;
  }
  if (search.phase !== "handshake" || search.roomId !== roomId) {
    return;
  }
  const other = search.role === "host" ? "guest" : "host";
  const otherLeft = !!(room && room.tug && room.tug.left && room.tug.left[other]);
  const taken = !!room && search.role === "guest" && room.guestTabId !== search.tabId;
  if (!room || room.status === "tug-finished" || otherLeft || taken) {
    const why = !room ? "the room vanished" : (taken ? "another tab took the room" : "the opponent left");
    tugNetBackToJoining(search, why);
    return;
  }
  search.room = room;
  const startAt = room.tug ? room.tug.startAt : null;
  if (typeof startAt === "number" && Number.isFinite(startAt)) {
    tugNetGo(search, room);
  }
}

// Rival found. The host keeps its room (cancels the onDisconnect remove) and writes startAt; the guest starts
// watching the room. The host's own startAt write may come back through its watch inside this call (a local event).
function tugNetHandshake(search, roomId, role, room) {
  search.phase = "handshake";
  search.role = role;
  search.roomId = roomId;
  search.room = room;
  const ref = search.db.ref(`rooms/${roomId}`);
  const opponentName = (role === "host" ? room.guestName : room.hostName) || "Opponent";
  tugNetOverlayText("Rival found", `Matched with ${opponentName}.`, false);
  if (role === "host") {
    const startAt = Math.round(tugNetServerNow()) + TUG_NET_START_DELAY_MS;
    console.log("[tug-net] guest in, starting", { roomId, guest: room.guest, startAt });
    tugNetWrite("waiting room keep", () => ref.onDisconnect().cancel());
    tugNetWrite("startAt", () => ref.child("tug/startAt").set(startAt));
    return;
  }
  tugNetOn(search.offs, () => tugNetSearch === search && search.roomId === roomId, ref, "value",
    (snap) => tugNetOnSearchRoom(search, roomId, snap.val()));
}

// Back to the joining scan: the room watch detached, my own room (hosting, or hosted in a handshake) removed.
function tugNetBackToJoining(search, why) {
  const roomId = search.roomId;
  const mine = search.phase === "hosting" || search.role === "host";
  console.info(`[tug-net] back to searching: ${why}`, { roomId });
  tugNetOffAll(search.offs);
  if (mine && roomId) {
    const ref = search.db.ref(`rooms/${roomId}`);
    tugNetWrite("waiting room cancel", () => ref.onDisconnect().cancel());
    tugNetWrite("waiting room remove", () => ref.remove());
  }
  search.phase = "joining";
  search.roomId = null;
  search.room = null;
  search.role = null;
  if (tugNetSearch === search) {
    tugNetOverlayText("Finding a rival…", TUG_NET_SEARCHING, false);
  }
}

// startAt is in: the search stops watching, the card says "Starting…" for TUG_NET_FOUND_SHOW_MS, then the match
// opens (tug-mode.js's tugStartMatch calls tugNetStart with this net).
function tugNetGo(search, room) {
  const role = search.role;
  const net = {
    roomId: search.roomId,
    role,
    seed: Number(room.seed),
    startAt: Number(room.tug.startAt),
    opponentName: (role === "host" ? room.guestName : room.hostName) || "Opponent",
    opponentPack: (role === "host" ? room.guestPack : room.hostPack) || null
  };
  search.phase = "starting";
  if (search.pollTimer) {
    clearInterval(search.pollTimer);
    search.pollTimer = null;
  }
  tugNetOffAll(search.offs);
  tugNetOverlayText("Rival found", "Starting…", true);
  console.log("[tug-net] match found", net);
  // the opponent's pictures load during the beat; startNewMatch's own call is then a no-op
  if (typeof setOpponentArtPack === "function") {
    setOpponentArtPack(net.opponentPack);
  }
  search.goTimer = setTimeout(() => {
    search.goTimer = null;
    if (tugNetSearch !== search) {
      return;
    }
    tugNetSearch = null; // cleared first: the new match's resetMatch may call tugNetLeave
    tugNetHideOverlay();
    try {
      if (typeof startNewMatch !== "function") {
        throw new Error("startNewMatch is not defined");
      }
      startNewMatch({ mode: "tug", net });
    } catch (err) {
      console.error("[tug-net] the tug match did not open", err);
      if (tugNet) {
        tugNetLeave("error");
      } else {
        const ref = search.db.ref(`rooms/${net.roomId}`);
        tugNetWrite("room give-up", () => ref.update({ status: "tug-finished", [`tug/left/${role}`]: tugNetStamp() }));
      }
    }
  }, TUG_NET_FOUND_SHOW_MS);
}

// --------------------------------------------------------------------------------- the matchmaking overlay

// The lobby's #matchmaking-overlay (lobby.js injects it at boot); the same markup when it is missing. This file's
// Cancel listener goes on once per button and acts only while a tug search runs (the lobby's own listener also runs
// and is harmless: it removes classic waiting rooms of mine, and there are none).
function tugNetOverlayEl() {
  let el = document.getElementById("matchmaking-overlay");
  if (!el) {
    el = document.createElement("section");
    el.id = "matchmaking-overlay";
    el.className = "matchmaking-overlay hidden";
    el.setAttribute("aria-label", "Finding match");
    el.innerHTML = `
      <div class="matchmaking-card">
        <p class="eyebrow" id="matchmaking-eyebrow">Online match</p>
        <h2 id="matchmaking-title">Finding a rival…</h2>
        <div class="matchmaking-spinner" id="matchmaking-spinner" aria-hidden="true"></div>
        <p class="matchmaking-status" id="matchmaking-status">Looking for a commander to challenge.</p>
        <div class="matchmaking-actions">
          <button id="matchmaking-cancel-btn" class="secondary" type="button">Cancel</button>
        </div>
      </div>
    `;
    (document.getElementById("app-shell") || document.body).appendChild(el);
  }
  const cancelBtn = document.getElementById("matchmaking-cancel-btn");
  if (cancelBtn && cancelBtn !== tugNetCancelBtnEl) {
    tugNetCancelBtnEl = cancelBtn;
    cancelBtn.addEventListener("click", () => {
      if (tugNetSearch) {
        tugNetCancel();
      }
    });
  }
  return el;
}

function tugNetShowOverlay(title, status) {
  tugNetOverlayEl().classList.remove("hidden");
  const eyebrowEl = document.getElementById("matchmaking-eyebrow");
  if (eyebrowEl) eyebrowEl.textContent = "Online match";
  tugNetOverlayText(title, status, false);
}

// Title and status lines; starting hides the spinner and Cancel (as the lobby's found state does).
function tugNetOverlayText(title, status, starting) {
  const titleEl = document.getElementById("matchmaking-title");
  const statusEl = document.getElementById("matchmaking-status");
  const spinnerEl = document.getElementById("matchmaking-spinner");
  const cancelBtn = document.getElementById("matchmaking-cancel-btn");
  if (titleEl) {
    titleEl.textContent = title || "";
  }
  if (statusEl) {
    statusEl.textContent = status || "";
  }
  if (spinnerEl) {
    spinnerEl.hidden = !!starting;
  }
  if (cancelBtn) {
    cancelBtn.hidden = !!starting;
  }
}

function tugNetHideOverlay() {
  const el = document.getElementById("matchmaking-overlay");
  if (el) {
    el.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------------------- lockstep session

function tugNetActive() {
  return tugNet !== null;
}

// tugStartMatch with options.net: the session and its listeners, presence and the heartbeat.
function tugNetStart(net) {
  if (tugNet) {
    tugNetLeave("restart");
  }
  const role = net ? net.role : null;
  if (!net || typeof net.roomId !== "string" || !net.roomId || (role !== "host" && role !== "guest")
    || !Number.isFinite(Number(net.startAt))) {
    console.error("[tug-net] tugNetStart: bad net", net);
    return;
  }
  if (typeof firebase === "undefined" || typeof firebase.database !== "function") {
    console.error("[tug-net] tugNetStart: Firebase is not loaded");
    return;
  }
  const db = firebase.database();
  tugNetWatchOffset(db);
  const roomRef = db.ref(`rooms/${net.roomId}`);
  const s = {
    roomId: net.roomId,
    role,
    opp: role === "host" ? "guest" : "host",
    seed: net.seed,
    startAt: Number(net.startAt),
    roomRef,
    base: roomRef.child("tug"),
    offs: [],
    heartbeat: null,
    goneTimer: null,
    goneNow: false,                       // gone/<opp> is set right now
    pending: { host: [], guest: [] },     // inputs not yet handed out, per role (the opponent's only once contiguous)
    lastSeq: { host: 0, guest: 0 },       // mine: my last sent seq; the opponent's: the highest contiguous seq
    oppEarly: {},                         // opponent inputs past a gap, by seq
    oppContigT: -1,                       // t of the opponent's last contiguous input
    front: null,                          // the opponent's latest { n, s }
    allowedHigh: -1,                      // tugNetAllowedTick's highest answer
    promisedN: -1,                        // the highest n I have published (my next input's t is above it)
    writtenN: null,                       // the n of my last front write
    myHashes: [],
    oppHash: null,
    desynced: false,
    oppLeft: false,                       // tugModeOnOpponentLeft was sent (left or gone)
    finished: false                       // the room is marked tug-finished (by me, or by the opponent's left)
  };
  tugNet = s;
  const alive = () => tugNet === s;
  tugNetOn(s.offs, alive, s.base.child(`in/${s.opp}`), "child_added",
    (snap) => tugNetOnOppInput(s, snap.key, snap.val()));
  tugNetOn(s.offs, alive, s.base.child(`front/${s.opp}`), "value", (snap) => tugNetOnOppFront(s, snap.val()));
  tugNetOn(s.offs, alive, s.base.child(`hash/${s.opp}`), "value", (snap) => tugNetOnOppHash(s, snap.val()));
  tugNetOn(s.offs, alive, s.base.child(`left/${s.opp}`), "value", (snap) => tugNetOnOppLeft(s, snap.val()));
  tugNetOn(s.offs, alive, s.base.child(`gone/${s.opp}`), "value", (snap) => tugNetOnOppGone(s, snap.val()));
  tugNetOn(s.offs, alive, db.ref(".info/connected"), "value", (snap) => {
    if (snap.val() === true) {
      tugNetArmPresence(s);
    }
  });
  s.heartbeat = setInterval(() => tugNetBeat(s), TUG_NET_HEARTBEAT_MS);
  tugNetBeat(s);
  console.log("[tug-net] session started", { roomId: s.roomId, role, startAt: s.startAt, seed: s.seed });
}

// On every connect: my onDisconnect gone timestamp armed again (a server-side disconnect uses it up), then gone/<me>
// cleared (classic's setupPresence order).
function tugNetArmPresence(s) {
  const goneRef = s.base.child(`gone/${s.role}`);
  tugNetWrite("presence", () => goneRef.onDisconnect().set(tugNetStamp())
    .then(() => (tugNet === s ? goneRef.set(null) : null)));
}

function tugNetTargetTick() {
  const s = tugNet;
  if (!s) {
    return -1;
  }
  return Math.floor((tugNetServerNow() - s.startAt) / 1000 / ProtoSim.BATTLE_DT);
}

// The heartbeat: front/<me> = { n, s } when n moved. n follows the server clock, not my sim tick, so a paused or
// backgrounded client never holds the opponent back; it never goes below a front already published.
function tugNetBeat(s) {
  if (tugNet !== s) {
    return;
  }
  const n = Math.max(tugNetTargetTick() + TUG_NET_DELAY_TICKS - 1, s.promisedN);
  if (n === s.writtenN) {
    return;
  }
  s.promisedN = n;
  s.writtenN = n;
  const seq = s.lastSeq[s.role];
  tugNetWrite("front", () => s.base.child(`front/${s.role}`).set({ n, s: seq }));
}

// One of my actions into the log. t sits above every front I have published (the server clock offset can step
// back), so no input of mine ever lands on a tick the opponent was told is complete.
function tugNetSend(k, a) {
  const s = tugNet;
  if (!s) {
    console.warn("[tug-net] tugNetSend with no session", k);
    return null;
  }
  const t = Math.max(tugNetTargetTick() + TUG_NET_DELAY_TICKS, s.promisedN + 1);
  const seq = s.lastSeq[s.role] + 1;
  const kind = String(k);
  const arg = tugNetCanon(a);
  s.lastSeq[s.role] = seq;
  s.promisedN = t - 1;
  s.writtenN = t - 1;
  s.pending[s.role].push({ role: s.role, seq, t, k: kind, a: arg });
  const wire = arg === null ? { t, k: kind } : { t, k: kind, a: arg };
  tugNetWrite("input", () => s.base.update({
    [`in/${s.role}/${tugNetSeqKey(seq)}`]: wire,
    [`front/${s.role}`]: { n: t - 1, s: seq }
  }));
  return t;
}

// The opponent's front and inputs arrive on separate listeners in either order: a front is trusted only as far as
// the inputs it covers have arrived.
function tugNetAllowedTick() {
  const s = tugNet;
  if (!s || !s.front) {
    return -1;
  }
  const contig = s.lastSeq[s.opp];
  let safe = -1;
  if (s.front.s <= contig) {
    safe = s.front.n; // every input it covers is here (front.s 0: none sent yet)
  } else if (contig > 0) {
    safe = s.oppContigT - 1; // the front that came with the last contiguous input; a later seq may share its tick
  }
  if (safe > s.allowedHigh) {
    s.allowedHigh = safe;
  }
  return s.allowedHigh;
}

function tugNetInputsFor(tick) {
  const s = tugNet;
  if (!s || !Number.isFinite(tick)) {
    return [];
  }
  const due = [];
  for (const role of ["host", "guest"]) {
    const list = s.pending[role];
    if (!list.length) {
      continue;
    }
    const keep = [];
    for (const input of list) {
      if (input.t <= tick) {
        due.push(input);
      } else {
        keep.push(input);
      }
    }
    s.pending[role] = keep;
  }
  if (due.length > 1) {
    due.sort(tugNetInputOrder);
  }
  for (const input of due) {
    if (input.t < tick) {
      console.error("[tug-net] late input", { role: input.role, seq: input.seq, t: input.t, tick });
    }
  }
  return due;
}

// The canonical apply order: t, then host before guest, then seq.
function tugNetInputOrder(a, b) {
  if (a.t !== b.t) {
    return a.t - b.t;
  }
  if (a.role !== b.role) {
    return a.role === "host" ? -1 : 1;
  }
  return a.seq - b.seq;
}

function tugNetReportHash(tick, h) {
  const s = tugNet;
  if (!s || !Number.isFinite(tick)) {
    return;
  }
  if (typeof h !== "number" && typeof h !== "string") {
    console.warn("[tug-net] tugNetReportHash: bad hash", { tick, h });
    return;
  }
  s.myHashes.push({ t: tick, h });
  if (s.myHashes.length > TUG_NET_HASH_KEEP) {
    s.myHashes.shift();
  }
  tugNetWrite("hash", () => s.base.child(`hash/${s.role}`).set({ t: tick, h }));
  if (s.oppHash && s.oppHash.t === tick) {
    tugNetCompareHash(s, tick, h, s.oppHash.h);
  }
}

function tugNetCompareHash(s, t, mine, theirs) {
  if (mine === theirs || s.desynced) {
    return;
  }
  s.desynced = true;
  console.error("[tug-net] desync", { tick: t, mine, theirs, role: s.role, roomId: s.roomId });
  tugNetNotify(s, () => {
    if (typeof tugModeOnDesync === "function") {
      tugModeOnDesync(t);
    }
  });
}

function tugNetLeave(reason) {
  const why = String(reason || "leave");
  if (tugNetSearch) {
    tugNetCancel();
  }
  const s = tugNet;
  if (!s) {
    return;
  }
  tugNet = null; // first: every listener and timer of s is dead from here, and a nested call returns above
  if (s.heartbeat) {
    clearInterval(s.heartbeat);
    s.heartbeat = null;
  }
  if (s.goneTimer) {
    clearTimeout(s.goneTimer);
    s.goneTimer = null;
  }
  tugNetOffAll(s.offs);
  tugNetWrite("presence cancel", () => s.base.child(`gone/${s.role}`).onDisconnect().cancel());
  if (!s.finished) {
    s.finished = true;
    const update = { status: "tug-finished" };
    if (why !== "over") {
      update[`tug/left/${s.role}`] = tugNetStamp();
    }
    tugNetWrite("leave", () => s.roomRef.update(update));
  }
  s.pending = { host: [], guest: [] };
  s.oppEarly = {};
  s.myHashes = [];
  console.log("[tug-net] session left", { roomId: s.roomId, role: s.role, reason: why });
}

// ----------------------------------------------------------------------------------------- opponent events

// An opponent input (child_added, key order; a gap is possible only across listeners): held until every earlier seq
// is here, then queued in seq order.
function tugNetOnOppInput(s, key, value) {
  const seq = parseInt(key, 10);
  if (!Number.isInteger(seq) || seq < 1 || seq <= s.lastSeq[s.opp] || s.oppEarly[seq]) {
    return;
  }
  const t = Number(value && value.t);
  if (!value || !Number.isInteger(t)) {
    console.error("[tug-net] malformed input", { role: s.opp, key, value });
  }
  s.oppEarly[seq] = {
    role: s.opp,
    seq,
    t: Number.isInteger(t) ? t : Math.max(0, s.oppContigT),
    k: value ? value.k : null,
    a: tugNetCanon(value ? value.a : null)
  };
  for (let next = s.lastSeq[s.opp] + 1; s.oppEarly[next]; next += 1) {
    const input = s.oppEarly[next];
    delete s.oppEarly[next];
    s.lastSeq[s.opp] = next;
    s.oppContigT = input.t;
    s.pending[s.opp].push(input);
  }
}

function tugNetOnOppFront(s, value) {
  const n = Number(value && value.n);
  if (!Number.isFinite(n)) {
    return; // null before the opponent's first front
  }
  const seq = Number(value.s);
  s.front = { n: Math.floor(n), s: Number.isInteger(seq) && seq > 0 ? seq : 0 };
}

function tugNetOnOppHash(s, value) {
  const t = Number(value && value.t);
  if (!Number.isFinite(t)) {
    return;
  }
  s.oppHash = { t, h: value.h };
  const mine = s.myHashes.find((entry) => entry.t === t);
  if (mine) {
    tugNetCompareHash(s, t, mine.h, value.h);
  }
}

// left/<opp> set (quit or menu while live): the opponent also marked the room finished.
function tugNetOnOppLeft(s, value) {
  if (value === null || value === undefined || s.oppLeft) {
    return;
  }
  s.oppLeft = true;
  s.finished = true;
  if (s.goneTimer) {
    clearTimeout(s.goneTimer);
    s.goneTimer = null;
  }
  console.log("[tug-net] opponent left", { roomId: s.roomId });
  tugNetNotify(s, () => {
    if (typeof tugModeOnOpponentLeft === "function") {
      tugModeOnOpponentLeft("left");
    }
  });
}

// gone/<opp> (the opponent's onDisconnect timestamp): a note at once, a forfeit if it is still set after the grace,
// "back" when it clears first.
function tugNetOnOppGone(s, value) {
  const gone = value !== null && value !== undefined;
  s.goneNow = gone;
  if (gone) {
    if (s.goneTimer || s.oppLeft) {
      return;
    }
    console.warn("[tug-net] opponent disconnected", { roomId: s.roomId });
    tugNetNotify(s, () => {
      if (typeof tugModeOnNetStatus === "function") {
        tugModeOnNetStatus("Opponent disconnected…");
      }
    });
    s.goneTimer = setTimeout(() => {
      s.goneTimer = null;
      if (tugNet !== s || !s.goneNow || s.oppLeft) {
        return;
      }
      s.oppLeft = true;
      console.warn("[tug-net] opponent did not come back", { roomId: s.roomId });
      tugNetNotify(s, () => {
        if (typeof tugModeOnOpponentLeft === "function") {
          tugModeOnOpponentLeft("gone");
        }
      });
    }, TUG_NET_GONE_GRACE_MS);
    return;
  }
  if (s.goneTimer) {
    clearTimeout(s.goneTimer);
    s.goneTimer = null;
    console.log("[tug-net] opponent is back", { roomId: s.roomId });
    tugNetNotify(s, () => {
      if (typeof tugModeOnNetStatus === "function") {
        tugModeOnNetStatus("Opponent is back.");
      }
    });
  }
}

// --------------------------------------------------------------------------------------------- menu wiring

// Play Online (#open-online-btn): index.html's click map calls this. Starts the online search at once, or shows the
// lobby's alert when online play is not available.
function tugNetPlayOnline() {
  if (!window.MP || typeof MP.isAvailable !== "function" || !MP.isAvailable()) {
    alert(TUG_NET_UNAVAILABLE);
    return;
  }
  tugNetFind();
}

// Play Again on an online match's end card (#match-play-again-btn): index.html's click map calls this first and falls
// back to startNewMatch() on false. The session is already left by then (tugFinish), so the test is tugState.net, not
// tugNetActive(). Online: back to the menu, then a new search, as Play Online does. Returns true when it handled an
// online match, false for a solo tug or classic match.
function tugNetPlayAgainOnline() {
  if (!(typeof tugState !== "undefined" && tugState && tugState.net)) {
    return false;
  }
  tugNetLeave("play-again");
  if (typeof setScreen === "function") {
    setScreen("menu");
  }
  tugNetPlayOnline();
  return true;
}
