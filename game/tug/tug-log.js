// Line Tower Wars runtime, tug mode playtest log: one anonymous row per tug match, written to Firestore so the team can
// see what testers do (what they buy, how matches end, which Difficulty or Gauntlet stage they beat or quit). Plan
// .plans/ltw-playtest-log.md (2026-10-29). tools/playtest/ holds the rules block for the console and the report script
// that turns the rows into tables.
// A classic script sharing the game's global scope, loaded after tug/tug-net.js and before 20-main.js. It reads
// tugState (match, mySide, net, desync, logInfo), match.stats (sim.js), TUG_NET_BUILD, window.ATW_BUILD,
// ATW_STORAGE_PREFIX and the firebase global (the app and the anonymous sign-in MP.init made at boot; this file never
// initialises an app or signs in). gameOptions and activeArtPackId reach it through tugState.logInfo, which
// tugStartMatch fills. It writes no game state: never state, never tugState, no UI; the only DOM it touches is the one
// script tag that loads the Firestore compat SDK. Every outside name is behind typeof and every step behind try/catch,
// so the harness (no firebase), an ad blocker (no gstatic) or a refused write costs one console.info line and nothing
// else. Pull-out: delete this file and its script tag; tug-mode.js's two calls are typeof-guarded.
//
// The one entry point, tugLogMatch(end, result), called by tug-mode.js:
//   tugFinish  -> tugLogMatch("finish", result)  result: the sim result { winner, reason, ... } (sim sides)
//   tugOnQuit  -> tugLogMatch("quit", null)      before tugState is dropped, only while the match is not over
// It returns at once when tugLogMode() is "off", tugState or its match is missing, the match is online and I am not
// the host (a match is counted once, by the host; a guest's quit is not written, the host's row ends left or gone), or
// this match already wrote (tugLogLastMatch, by identity). Otherwise it builds the row synchronously, then hands it to
// tugLogWrite, which is async and never awaited.
//
// Which copies write (tugLogMode(), computed once per page, checked in this order):
//   ?playtestlog=0                                                         off
//   ?playtestlog=1                                                         dev: writes even locally, row dev: true
//   file:, capacitor: or ionic: protocol, or Capacitor.isNativePlatform()  off (the Android app)
//   hostname localhost, 127.0.0.1, [::1] / ::1 or empty                    off (run-game.bat, the harness, the lab)
//   pathname under an entry of TUG_LOG_SKIP_PATHS                          off (Brian's preview)
//   anything else (atw-test, Leo's studio site)                            on, dev: false
//
// The row (version 1, collection TUG_LOG_COLLECTION, Firestore auto id; the 20 keys are the rules' hasOnly list):
//   { v: 1, at: serverTimestamp (the rules require at == request.time), site: host + first path segment,
//     build: TUG_NET_BUILD | "", commit, channel (ATW_BUILD's, or ""), dev: bool, player: the browser id | "",
//     kind: "solo" | "gauntlet" | "online", difficulty: id | "", stage: 1..16 | 0, skill: number | null,
//     pack: art pack id | "", end: result.reason | "quit", result: "win" | "loss" | "draw" | "quit" (from my side),
//     seconds: match.clock, gates: { me, them } (gate hp), me, them: side blocks, desync: tick | null }
//   Side block (from match.stats for one sim side; 16 keys): goldEarned, goldSpent, gold (goldBySource without other),
//   queued (mobQueued), spend (mobSpend), damage (mobDamage), gateDamage (mobGateDamage), killValue (mobKillValue),
//   built, lost (towersDestroyed), upgrades, mobKills, towerKills, gunKills, gateDamageTotal (stats.gateDamage),
//   cancelled. Per-mob maps copy whatever mob ids the stats hold. Every number is rounded to 0.1 (stage is a whole
//   number); a missing stat is 0 or {}. Strings are cut to TUG_LOG_MAX_STR characters (the rules' limit).
// The browser id is "p-" + 12 random base36 characters kept in localStorage (TUG_LOG_PLAYER_KEY): MP.init sets auth
// persistence to NONE, so the Firebase uid changes on every page load and can't count repeat visits.

const TUG_LOG_COLLECTION = "playtestMatches";
const TUG_LOG_VERSION = 1;
const TUG_LOG_SDK_URL = "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"; // the same v10.12.0 as index.html's firebase tags
const TUG_LOG_SKIP_PATHS = ["/atw-preview/"];   // paths that never write (Brian's preview, once baz-dev reaches it)
const TUG_LOG_PLAYER_KEY = (typeof ATW_STORAGE_PREFIX === "string" ? ATW_STORAGE_PREFIX : "") + "ltw-playtest-player";
const TUG_LOG_MAX_STR = 120;                    // the rules' shortStr limit
const TUG_LOG_WRITE_TIMEOUT_MS = 20000;         // no answer from the write by then: one "not sent" line (offline)

let tugLogModeCache = null;   // "off" | "dev" | "on", from the first tugLogMode()
let tugLogModeWhy = "";       // why it is off, for the skip line
let tugLogLastMatch = null;   // the last match tugLogMatch accepted (identity), so a match writes once
let tugLogSdkPromise = null;  // the Firestore SDK load, once per page (cleared after a failed load so a later match retries)

// "off" | "dev" | "on" per the table in the header; computed once and cached.
function tugLogMode() {
  if (tugLogModeCache) {
    return tugLogModeCache;
  }
  let mode = "off";
  let why = "";
  try {
    const loc = typeof location !== "undefined" ? location : null;
    let flag = null;
    try {
      flag = loc && typeof URLSearchParams === "function" ? new URLSearchParams(loc.search || "").get("playtestlog") : null;
    } catch (err) {
      flag = null;
    }
    const protocol = loc ? String(loc.protocol || "") : "";
    const host = loc ? String(loc.hostname || "") : "";
    const path = loc ? String(loc.pathname || "/") : "/";
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    const dirPath = path.endsWith("/") ? path : path + "/";
    if (!loc) {
      why = "no location";
    } else if (flag === "0") {
      why = "?playtestlog=0";
    } else if (flag === "1") {
      mode = "dev";
    } else if (protocol === "file:" || protocol === "capacitor:" || protocol === "ionic:" || native) {
      why = "app build";
    } else if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      why = "local copy (add ?playtestlog=1 to log)";
    } else if (TUG_LOG_SKIP_PATHS.some((p) => dirPath.startsWith(p))) {
      why = "skipped path";
    } else {
      mode = "on";
    }
  } catch (err) {
    mode = "off";
    why = "mode check failed";
  }
  tugLogModeCache = mode;
  tugLogModeWhy = why;
  return mode;
}

// The browser id, created once and kept in localStorage; "" when storage throws.
function tugLogPlayerId() {
  try {
    const stored = localStorage.getItem(TUG_LOG_PLAYER_KEY);
    if (typeof stored === "string" && /^p-[0-9a-z]{12}$/.test(stored)) {
      return stored;
    }
    let id = "p-";
    const cryptoObj = typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function" ? crypto : null;
    const bytes = cryptoObj ? cryptoObj.getRandomValues(new Uint8Array(12)) : null;
    for (let i = 0; i < 12; i++) {
      const n = bytes ? bytes[i] % 36 : Math.floor(Math.random() * 36);
      id += n.toString(36);
    }
    localStorage.setItem(TUG_LOG_PLAYER_KEY, id);
    return id;
  } catch (err) {
    return "";
  }
}

// location.host + the first path segment when it is a folder ("overhillgames.github.io/atw-test"); just the host at
// the root, or when the only segment is a file ("/index.html").
function tugLogSite() {
  try {
    const host = String(location.host || "");
    const m = /^\/([^/]+)(\/|$)/.exec(String(location.pathname || "/"));
    if (m && (m[2] === "/" || m[1].indexOf(".") < 0)) {
      return host + "/" + m[1];
    }
    return host;
  } catch (err) {
    return "";
  }
}

// A number rounded to 0.1; anything not finite is 0.
function tugLogNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

// A string cut to the rules' limit; anything else is "".
function tugLogStr(v) {
  return typeof v === "string" ? v.slice(0, TUG_LOG_MAX_STR) : (typeof v === "number" && Number.isFinite(v) ? String(v).slice(0, TUG_LOG_MAX_STR) : "");
}

// A { key: number } map's keys copied with their values rounded to 0.1, minus the skipped keys; {} when missing.
function tugLogMap(obj, skip) {
  const out = {};
  if (!obj || typeof obj !== "object") {
    return out;
  }
  for (const key of Object.keys(obj)) {
    if (skip && skip.indexOf(key) >= 0) {
      continue;
    }
    out[key] = tugLogNum(obj[key]);
  }
  return out;
}

// One side's block from match.stats (side: the sim side, "player" | "ai"). See the header for the 16 keys.
function tugLogSide(stats, side) {
  const s = stats && typeof stats === "object" ? stats : {};
  const one = (name) => (s[name] && typeof s[name] === "object" ? tugLogNum(s[name][side]) : 0);
  const map = (name, skip) => (s[name] && typeof s[name] === "object" ? tugLogMap(s[name][side], skip) : {});
  return {
    goldEarned: one("goldEarned"),
    goldSpent: one("goldSpent"),
    gold: map("goldBySource", ["other"]),
    queued: map("mobQueued"),
    spend: map("mobSpend"),
    damage: map("mobDamage"),
    gateDamage: map("mobGateDamage"),
    killValue: map("mobKillValue"),
    built: one("built"),
    lost: one("towersDestroyed"),
    upgrades: one("upgrades"),
    mobKills: one("mobKills"),
    towerKills: one("towerKills"),
    gunKills: one("gunKills"),
    gateDamageTotal: one("gateDamage"),
    cancelled: one("cancelled")
  };
}

// The row for the current tugState (without `at`, which tugLogWrite adds as the server timestamp). end: "finish" |
// "quit"; result: the sim result for a finish, null for a quit. Reads only; called synchronously by tugLogMatch.
function tugLogBuildRow(end, result) {
  const match = tugState.match;
  const me = tugState.mySide === "ai" ? "ai" : "player";
  const them = me === "player" ? "ai" : "player";
  const info = tugState.logInfo && typeof tugState.logInfo === "object" ? tugState.logInfo : {};
  const build = typeof window !== "undefined" ? window.ATW_BUILD : null;
  const quit = end === "quit";
  let outcome = "";
  if (quit) {
    outcome = "quit";
  } else if (result && typeof result === "object") {
    outcome = result.winner === me ? "win" : (result.winner === them ? "loss" : "draw");
  }
  const gateHp = (side) => (match[side] && match[side].gate ? tugLogNum(match[side].gate.hp) : 0);
  const stage = Number(info.stage);
  return {
    v: TUG_LOG_VERSION,
    site: tugLogStr(tugLogSite()),
    build: typeof TUG_NET_BUILD === "string" ? tugLogStr(TUG_NET_BUILD) : "",
    commit: build ? tugLogStr(build.commit) : "",
    channel: build ? tugLogStr(build.channel) : "",
    dev: tugLogMode() === "dev",
    player: tugLogPlayerId(),
    kind: tugLogStr(info.kind),
    difficulty: tugLogStr(info.difficulty),
    stage: Number.isFinite(stage) ? Math.max(0, Math.floor(stage)) : 0,
    skill: Number.isFinite(info.skill) ? Math.round(info.skill * 1000) / 1000 : null,
    pack: tugLogStr(info.pack),
    end: quit ? "quit" : tugLogStr(result && result.reason),
    result: outcome,
    seconds: tugLogNum(match.clock),
    gates: { me: gateHp(me), them: gateHp(them) },
    me: tugLogSide(match.stats, me),
    them: tugLogSide(match.stats, them),
    desync: Number.isFinite(tugState.desync) ? tugState.desync : null
  };
}

// Loads the Firestore compat SDK once (a script tag; skipped when firebase.firestore already exists). Resolves when
// firebase.firestore is there; rejects on a load error (the tag is removed and the cache cleared, so a later match
// retries).
function tugLogLoadSdk() {
  if (typeof firebase !== "undefined" && typeof firebase.firestore === "function") {
    return Promise.resolve();
  }
  if (tugLogSdkPromise) {
    return tugLogSdkPromise;
  }
  tugLogSdkPromise = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = TUG_LOG_SDK_URL;
    tag.async = true;
    tag.onload = () => {
      if (typeof firebase !== "undefined" && typeof firebase.firestore === "function") {
        resolve();
      } else {
        reject(new Error("Firestore SDK loaded without firebase.firestore"));
      }
    };
    tag.onerror = () => {
      tugLogSdkPromise = null;
      if (tag.parentNode) {
        tag.parentNode.removeChild(tag);
      }
      reject(new Error("Firestore SDK did not load (offline or blocked)"));
    };
    (document.head || document.documentElement).appendChild(tag);
  });
  return tugLogSdkPromise;
}

// The async writer: one row into TUG_LOG_COLLECTION. Exactly one console.info line per row, never a throw.
async function tugLogWrite(row, dev) {
  const extra = dev ? [row] : [];
  try {
    if (typeof firebase === "undefined" || !firebase || !firebase.apps || !firebase.apps.length) {
      console.info("[tug-log] not sent: Firebase is not loaded", ...extra);
      return;
    }
    if (typeof firebase.auth !== "function" || !firebase.auth().currentUser) {
      console.info("[tug-log] not sent: not signed in", ...extra);
      return;
    }
    await tugLogLoadSdk();
    const doc = Object.assign({}, row, { at: firebase.firestore.FieldValue.serverTimestamp() });
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), TUG_LOG_WRITE_TIMEOUT_MS);
    });
    const ref = await Promise.race([firebase.firestore().collection(TUG_LOG_COLLECTION).add(doc), timeout]);
    clearTimeout(timer);
    if (!ref) {
      console.info(`[tug-log] not sent: no answer after ${TUG_LOG_WRITE_TIMEOUT_MS / 1000} s (offline?)`, ...extra);
      return;
    }
    console.info("[tug-log] row sent", ref.id, ...extra);
  } catch (err) {
    const reason = err && (err.code || err.message) ? String(err.code || err.message) : String(err);
    console.info(`[tug-log] not sent: ${reason}`, ...extra);
  }
}

// The entry point (tug-mode.js: tugFinish "finish" with the sim result, tugOnQuit "quit" with null). Builds the row
// now, writes it later; never throws, never waits.
function tugLogMatch(end, result) {
  try {
    const mode = tugLogMode();
    if (mode === "off") {
      console.info(`[tug-log] not sent: off (${tugLogModeWhy})`);
      return;
    }
    if (typeof tugState === "undefined" || !tugState || !tugState.match) {
      console.info("[tug-log] not sent: no match");
      return;
    }
    if (tugState.net && tugState.net.role !== "host") {
      console.info("[tug-log] not sent: online guest (the host logs the match)");
      return;
    }
    if (tugLogLastMatch === tugState.match) {
      return; // this match already logged its one line
    }
    tugLogLastMatch = tugState.match;
    const row = tugLogBuildRow(end === "quit" ? "quit" : "finish", end === "quit" ? null : result);
    tugLogWrite(row, mode === "dev").catch(() => {});
  } catch (err) {
    console.info(`[tug-log] not sent: ${err && err.message ? err.message : String(err)}`);
  }
}
