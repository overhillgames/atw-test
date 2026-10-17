// Line Tower Wars runtime, tug mode: match control (start, fixed-step loop, bot cadence, end; online, the lockstep step
// loop), the player's actions, the selection and the dock model (tugState.dock, rebuilt once per frame; tug-pixi.js
// draws it in Pixi), the HUD model (tugState.hud: your gold and the clock; tug-pixi.js draws it), hiding all of
// classic's Pixi chrome and dock cards while tug runs (tug-pixi.js draws its own wood dock, tabs, frames and mob cards),
// the pause and quit dialogs' tug copy (borrowed at match start, put back at the end; the pause line counts the minutes
// left), the body class and the audio calls. Plans
// .plans/ltw-tug-mode.md (slice 1, 2026-10-08), .plans/ltw-tug-ui-pass.md (the dock, 2026-10-13),
// .plans/ltw-tug-dock-fixes.md (dock model v2, 2026-10-13), .plans/ltw-tug-hud-pass.md (dock model v3, tugState.hud,
// the hidden chrome, 2026-10-13), .plans/ltw-tug-hud-2a.md (dock model v4, tabs, mob cards, the end copy,
// 2026-10-16) and .plans/ltw-tug-pvp-lockstep.md (online lockstep, slice A, 2026-10-13). No card
// detail panel in tug (tugCardDetailLines is null for every id), no enemy turret selection, no Remove.
// A classic script sharing the game's global scope, loaded after 19-draw.js, tug/rules.js, tug/sim.js, tug/bot.js and
// tug/tug-pixi.js and before tug/tug-net.js and 20-main.js. Classic files reach tug only through `state.mode === "tug"`
// dispatch lines (startNewMatch, resetMatch, updateGame, drawBoard, the slot click, the dock card handlers,
// buildCardDetailLines, saveMatchStateNow, quitMatchNow); deleting game/tug/, its six script tags, the Tug Online button
// and those lines removes tug.
//
// Online (tugStartMatch with options.net = { roomId, role: "host" | "guest", seed, startAt, opponentName, opponentPack }, from
// tug-net.js; opponentPack: the opponent's pack id or null, startNewMatch draws the ai side with it): a delayed-input
// lockstep match against another client. tug-net.js owns everything Firebase (rooms and
// matchmaking, the input log, fronts, hashes, forfeit, disconnect, the server clock); this file owns the sim and what
// the player sees. Both clients create the match from net.seed and step it the same way: no bot, no dt accumulation.
// tugUpdate steps tick by tick up to tugNetTargetTick() (the server clock against startAt; negative before it, when
// the status line counts down), never past tugNetAllowedTick() (the opponent's front), at most TUG_MODE_MAX_STEPS per
// frame (a paused or slow client catches up); before each tick's step tugModeApplyInput applies tugNetInputsFor(tick)
// (both roles, already in the canonical order; host = sim side player, guest = sim side ai). An action never touches
// the sim online: it goes out through tugNetSend and comes back through that log about 0.6 s later; only my own
// refusals show. Every TUG_MODE_HASH_EVERY ticks tugModeHash (FNV-1a; both clients compute it, so its field order is
// the contract) goes to tugNetReportHash. tug-net.js calls back tugModeOnDesync(tick), tugModeOnOpponentLeft("left" |
// "gone") and tugModeOnNetStatus(text); tugFinish (match over) and tugEndMatch (quit, menu, a new match) hand the
// session back through tugModeNetLeave -> tugNetLeave. Every call into tug-net.js is guarded with typeof, so solo play
// never needs that file. Solo is as before: a random seed, the bot, dt accumulation, direct sim calls.
// mySide (tugState.mySide) is my side in the sim: player solo and host, ai guest; every read or action that means "me"
// goes through it. The view always shows me as the player side: for the guest tugModeViewSnap mirrors the raw snapshot
// (sides swapped, every y as mirrorY - y, mirrorY = the sum of the two sides' slot 0 y, so the turrets land on the
// pack's diamonds), so tug-pixi.js, the dock and the HUD never see the real side. The selection is a view side.
//
// The contract with tug-pixi.js: this file owns `tugState` (recreated by tugStartMatch, null after tugEndMatch):
//   { match (the ProtoSim match), snap (the view snapshot: ProtoSim.snapshot through tugModeViewSnap, refreshed once
//     per frame after stepping; null before the first), rawSnap (that frame's raw ProtoSim.snapshot), prevSnap (last
//     frame's snap), acc (accumulator seconds, solo), nextThink (sim clock of the next bot think, solo), seed, mySide,
//     net (options.net, or null solo), tick (online: ticks stepped), mirrorY, stalledSince (online: performance.now()
//     ms a stall began, or null), netNote (the status text the online loop last wrote), desync (null, or the tick the
//     hashes first differed), netLeft (the session was handed back),
//     selected (null = units mode; or { side: "player", slot } = your turret there, built or building),
//     dock (the dock model v4 below, "The contracts" in .plans/ltw-tug-hud-2a.md; rebuilt at the end of tugUpdate
//     and of tugStartMatch, never null after that, never written by tug-pixi.js; rebuilt once more by tugFinish, in
//     units mode, then not again), hud (the HUD model below; null until the first tugUpdateHud, never written by
//     tug-pixi.js), over (true once the end was handled),
//     colourFor(dominant) -> "violet" | "red" | "yellow" | "blue" | "green", slotPx(side, i) -> { x, y } frame px }
// The HUD model (tugState.hud, a new object from every tugUpdateHud that gets past its guard):
//   { gold: your gold as text ("12", one decimal at most, rounded down), time: m:ss left ("1:44"),
//     goldPopT0: null | the state.animationClock seconds your gold last changed (never in the match's first half
//     second); cleared here once HUD_POP_SECONDS have passed or the match is over }
// The dock model v4 (tugState.dock; "The contracts" in .plans/ltw-tug-hud-2a.md):
//   units mode (nothing selected): { mode: "units", title: "Your turrets: tap one to level it", titleRight: "",
//     tabs: [tab0, tab1], queue, mobs }
//   tower mode (your turret selected): { mode: "tower", slot, title, titleRight, ready, queue, mobs,
//     frames: [f0, f1, f2, fHeal] }
//     title "Turret N · Level L · HP h/m" (+ " · building"), also when a level is ready
//     titleRight ready ? "level ready: pick one" : ""
//   tab: { slot, state: "built" | "building" | "empty" | "rubble", name, line, ready, colourId, tappable }
//     built     name "Turret N", line "L{level} · HP {h}/{m}", ready t.ready === true, colourId colourFor(t.dominant),
//               tappable true
//     building  name "Turret N", line "building", ready false, colourId as built, tappable true
//     rubble    name "Turret N", line "rubble · {ceil s}s", ready false, colourId null, tappable false
//     empty     name "Slot N", line "tap to build · {turret price} gold", ready false, colourId null, tappable true
//   frame: { kind: "trait" | "open" | "heal", trait (kind "trait", else null), name (the role word: the trait's name,
//     "Open", "Heal"), rank and cap (kind "trait", else null), lit, action (a trait id or "heal" on a lit frame, else
//     null), dim (the turret has a level ready and this frame is not lit), hint (lit: the TUG_MODE_HINTS word of its
//     trait or "heal", else ""), sub (heal: "{hp}/{maxHp} hp", else null) }
//   mob: { id, cost, role, count, poor, blocked } one per attackerDefs entry, in that order: cost
//     match.tug.costs.mob[id], role TUG_MODE_ROLES[id] (GRUNT, RUNNER, ANTI-SIEGE, SNIPER, SIEGE), count
//     queue.counts[id] || 0, poor (gold < cost), blocked (poor, or the queue is full, or the match is over)
//   queue: { counts: { defId: n } (snap.player.build, head included), list: [{ defId, frac, training }] (snap.player.build
//     in order, head first; training is true for every entry while queue.parallel, else for the head only; frac is a
//     training entry's training fraction, 0 for the rest; [] when empty), head: list[0] | null
//     (kept from v2) }
// This file defines tugStartMatch, tugUpdate, tugEndMatch, tugQueueMob, tugCancelQueued, tugSlotTap, tugTabTap,
// tugFrameTap, tugPickOffer, tugDeselect, tugCardDetailLines, tugOnQuit, tugUpdateHud, tugUpdateCardStates and
// tugOnShot, and for tug-net.js tugModeOnOpponentLeft, tugModeOnDesync and tugModeOnNetStatus (plus tugModeApplyInput,
// tugModeViewSnap and tugModeHash, the lockstep core).
// tug-pixi.js defines updatePixiTug (the whole tug render: tug's own wood dock, title line, turret tabs, trait frames
// and mob cards drawn from tugState.dock (the cards from dock.mobs), the HUD chips and the queue column; it calls
// tugUpdateHud and tugUpdateCardStates every frame), tugPxFlashMob(id) (a mob card's flash, called by tugQueueMob),
// TUG_PX_DOCK (tug's dock rect; the arena deselect line is its y) and tugPixiDestroy; its taps call tugFrameTap(i),
// tugTabTap(slot) and tugQueueMob(id). Private names here start with tugMode / TUG_MODE (tug-pixi's with tugPx /
// TUG_PX).
//
// Classic state fields written here (nothing else): mode, phase, battleStartTimer, roundBannerTimer, hasActiveMatch,
// gameOver, winnerText, matchSummary. `paused` changes only through togglePause; cardDetailId never. Never the creeps,
// towers, mana, scores or queues. Tug matches are never saved and do not count in Records (no lifetime stats, no
// commitMatchUsageStats). The Pixi chrome tug borrows is re-applied when the scene is rebuilt (an Art screen pack
// change) and restored by tugEndMatch, all of it hidden while tug runs: every pixiState.chromeLayer child (the two
// columns, the five stat tiles and their labels, the timer tile and track, and the wood dock; a layers pack's chrome
// layer is empty), the five pixiState.hudText numbers, pixiState.timerFill and pixiState.timerIdleFill, and every
// TUG_MODE_CARD_PARTS node of every tower and creep card (visible false, the hit area's eventMode "none"). The DOM
// dialog copy tug borrows (tugModeBorrowDialogs at tugStartMatch, tugModeRestoreDialogs in tugEndMatch): a
// "quit-note tug-dialog-line" paragraph after the pause card's h2 ("m:ss left", kept current by tugUpdateHud)
// and after the quit card's h2 ("It counts as a loss." online, "The match ends here." solo), the quit card's title
// ("Quit the match?") and its two buttons ("Yes, quit", "No, keep playing"); index.html is never edited.

let tugState = null;

const TUG_MODE_BOT = { style: "plays" };     // the AI: proto bot.js "plays" (difficulty is ignored in tug)
const TUG_MODE_MAX_STEPS = 8;                // sim steps per frame at most; solo, past that the backlog is dropped (a slow phone runs slow); online the server clock keeps it, so a paused or slow client catches up
const TUG_MODE_HASH_EVERY = 30;              // online: ticks between two tugNetReportHash calls (one sim second)
const TUG_MODE_STALL_MS = 1000;              // online: real ms without a step (the opponent's front behind) before "Waiting for opponent…"
// online: the turret traits in tugModeHash's order (sim.js TUG_TRAIT_KINDS); both clients hash the same list
const TUG_MODE_HASH_TRAITS = ["range", "rate", "hp", "dmg", "splash", "slow", "multi", "heavy"];
const TUG_MODE_SLOTS = 2;                    // turret slots per side: the pack's slot 0 and 1 diamonds
const TUG_MODE_SHOT_SFX_GAP = 0.12;          // seconds between two turret fire sounds of one colour
const TUG_MODE_GOLD_SFX_GAP = 0.25;          // seconds between two player gold-kill sounds
const TUG_MODE_BOT_ERROR_LOGS = 5;           // bot errors logged per match (then silent)
const TUG_MODE_DOMINANT_COLOUR = { splash: "red", slow: "yellow", multi: "blue", heavy: "green" }; // anything else (or none) is violet
// A dock card entry's nodes (buildPixiDockCards): recorded and hidden on every tower and creep card (tug-pixi.js draws
// tug's own mob cards)
const TUG_MODE_CARD_PARTS = ["frame", "sprite", "costText", "roleText", "flash", "queueText", "hitArea"];
const TUG_MODE_TRAIT_NAME = { range: "Range", rate: "Rate", hp: "HP", dmg: "Damage", splash: "Splash", slow: "Slow", multi: "Multi", heavy: "Heavy" };
const TUG_MODE_TRAIT_ORDER = ["splash", "slow", "multi", "heavy", "dmg", "rate", "range", "hp"];
const TUG_MODE_TRACK_FRAMES = 3;             // dock frames 0-2 hold the turret's traits (upgrade.slots is 3); 3 is Heal
// A lit frame's hint: the one or two words under its name ("Range" / "farther")
const TUG_MODE_HINTS = {
  range: "farther", rate: "faster", hp: "tougher", dmg: "harder", splash: "area hit", slow: "slows them",
  multi: "+1 target", heavy: "big hits", heal: "full hp"
};
// The dock frames that are not a trait: role word, what a tap on the lit frame does
const TUG_MODE_PLAIN_FRAMES = {
  open: { name: "Open", action: null },
  heal: { name: "Heal", action: "heal" }
};
const TUG_MODE_REFUSALS = { "not enough gold": "Not enough gold.", "queue full": "Queue full.", "under construction": "Under construction." };
// Tug's own mob card words (2026-10-16): the card word is the only name a player sees in tug. The old match keeps its own.
const TUG_MODE_ROLES = { imp: "GRUNT", runner: "RUNNER", brute: "ANTI-SIEGE", wisp: "SNIPER", tank: "SIEGE" };

// Bookkeeping (never on state or tugState)
let tugModeChrome = null;      // the Pixi nodes tug hid, with their classic values (tugModeApplyChrome)
let tugModeDialog = null;      // the dialog copy tug borrowed: inserted lines and classic's texts (tugModeBorrowDialogs)
let tugModeSfxLast = {};       // colour id (or "gold") -> performance.now() seconds of the last sound
let tugModeBotErrors = 0;

// ------------------------------------------------------------------------------------------------- helpers

function tugModeColourFor(dominant) {
  return TUG_MODE_DOMINANT_COLOUR[dominant] || "violet";
}

// The pack's slot 0 / 1 diamond of a side in frame px (towerPosPlayer / towerPosAI are normalised); null past slot 1.
function tugModeSlotPx(side, i) {
  const list = side === "ai" ? towerPosAI : towerPosPlayer;
  if (!Number.isInteger(i) || i < 0 || i >= TUG_MODE_SLOTS || !list[i]) {
    return null;
  }
  return { x: Math.round(list[i].x * LOGICAL_CANVAS_WIDTH), y: Math.round(list[i].y * LOGICAL_CANVAS_HEIGHT) };
}

// tugOverrides.slots: the turrets stand on the pack's diamonds, so the picture and the combat agree (player (147, 479),
// (273, 479); AI (147, 130), (273, 130): 21 px further from the gate than the bench's 500 / 100). Revert here.
function tugModeSlotOverrides() {
  const sideSlots = (side) => [0, 1].map((i) => Object.assign(tugModeSlotPx(side, i), { row: "front" }));
  return { player: sideSlots("player"), ai: sideSlots("ai") };
}

function tugModeThinkSeconds(match) {
  const every = Number(match.tug.bot.thinkSeconds);
  return every > 0 ? every : ProtoSim.BATTLE_DT; // runTug's rule
}

// One bot think for the AI side; an error is logged (the first few per match), never thrown into the frame loop.
function tugModeThink() {
  try {
    ProtoBot.act(tugState.match, "ai", TUG_MODE_BOT);
  } catch (error) {
    tugModeBotErrors += 1;
    if (tugModeBotErrors <= TUG_MODE_BOT_ERROR_LOGS) {
      console.error("[tug] bot think failed", error);
    }
  }
}

// Player actions are taken only in a live, unpaused tug match on the game screen; online, only once startAt has passed
// (tugNetTargetTick() >= 0).
function tugModeCanAct() {
  return !!tugState && !tugState.over && !state.paused && state.screen === "game" && tugState.match.phase === "live"
    && (!tugState.net || (typeof tugNetTargetTick === "function" && tugNetTargetTick() >= 0));
}

// A refused action: a short note in the status line and the console, and the error buzz classic uses. No modal.
function tugModeRefuse(reason) {
  const text = TUG_MODE_REFUSALS[reason]
    || (reason ? `${String(reason).charAt(0).toUpperCase()}${String(reason).slice(1)}.` : "Not now.");
  updateStatus(text);
  console.info(`[tug] ${text}`);
  triggerPlacementHaptic("error");
}

// HUD and card numbers: hp and gold to one decimal at most (an Imp hits a gate for 1.5); gold rounds down.
function tugModeNum(value) {
  return String(Math.round(Math.max(0, Number(value) || 0) * 10) / 10);
}

function tugModeGold(value) {
  return String(Math.floor(Math.max(0, Number(value) || 0) * 10 + 1e-9) / 10);
}

function tugModeClockText(seconds) {
  const whole = Math.max(0, Math.floor((Number(seconds) || 0) + 1e-9));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function tugModeSfxReady(key, gap) {
  const now = performance.now() / 1000;
  const last = tugModeSfxLast[key];
  if (last !== undefined && now - last < gap) {
    return false;
  }
  tugModeSfxLast[key] = now;
  return true;
}

// After a sim step: a gold hit I earned this step (hit.side is my sim side; the sim ages every hit at the start of a
// step, so this step's hits have age 0) plays the kill coin, at most once per TUG_MODE_GOLD_SFX_GAP.
function tugModeGoldSfx(match) {
  for (const hit of match.hits) {
    if (hit.kind === "gold" && hit.side === tugState.mySide && hit.age === 0) {
      if (tugModeSfxReady("gold", TUG_MODE_GOLD_SFX_GAP)) {
        playBonusManaSfx("kill");
      }
      return;
    }
  }
}

// ------------------------------------------------------------------------------------------ match control

function tugStartMatch(options = {}) {
  if (tugState) {
    tugEndMatch(); // resetMatch normally did this already (Play Again); never assume it
  }
  document.body.classList.add("mode-tug");
  state.mode = "tug";
  state.phase = "battle";
  state.battleStartTimer = 0;
  state.roundBannerTimer = 0;
  state.hasActiveMatch = true;
  state.gameOver = false;
  const net = options.net && typeof options.net === "object" ? options.net : null; // tug-net.js's online match, else solo
  // online both clients take the room's seed; solo the harness seeds Math.random, so this stays reproducible there
  const seed = net ? net.seed : Math.floor(Math.random() * 2 ** 32);
  const rules = Object.assign({}, PROTO_PRESETS.tug, { tugOverrides: { slots: tugModeSlotOverrides() } });
  const match = ProtoSim.createMatch(rules, seed);
  tugState = {
    match,
    snap: null,
    rawSnap: null,
    prevSnap: null,
    acc: 0,
    nextThink: 0,
    seed,
    mySide: net && net.role === "guest" ? "ai" : "player", // my sim side; the view always shows it as the player side
    net,
    tick: 0, // online: ticks stepped
    mirrorY: tugModeSlotPx("player", 0).y + tugModeSlotPx("ai", 0).y, // the guest's view: y -> mirrorY - y
    stalledSince: null,
    netNote: null,
    desync: null,
    netLeft: false,
    selected: null,
    dock: null, // tugModeBuildDock at the end of this function
    hud: null, // tugUpdateHud, every frame once the Pixi scene is ready
    over: false,
    colourFor: tugModeColourFor,
    slotPx: tugModeSlotPx
  };
  tugModeChrome = null;
  tugModeSfxLast = {};
  tugModeBotErrors = 0;
  if (net) {
    // online: no bot ever; tug-net.js paces the match from the room's startAt (the countdown is tugUpdate's)
    if (typeof tugNetStart === "function") {
      tugNetStart(net);
    } else {
      console.error("[tug] tug-net.js is not loaded: the online match cannot run");
    }
    updateStatus("Starting…");
  } else {
    // runTug's order: the bot thinks at clock 0, before the first step, then every bot.thinkSeconds of sim time
    tugModeThink();
    tugState.nextThink = match.clock + tugModeThinkSeconds(match);
  }
  if (typeof tugPixiDestroy === "function") {
    tugPixiDestroy(); // updatePixiTug rebuilds its views on the first frame
  }
  tugModeApplyChrome(); // no-op until pixiState.ready; tugUpdateHud / tugUpdateCardStates retry every frame
  tugModeBorrowDialogs(); // tug's pause and quit copy (tugState.net picks the quit line)
  tugDeselect();
  tugModeBuildDock(tugModeViewSnap(ProtoSim.snapshot(match))); // the dock exists before the first frame (units mode)
  refreshAllUI();
}

// Solo: real dt in, fixed 1/30 s sim steps out (at most TUG_MODE_MAX_STEPS per frame), the bot thinking before the
// step whose clock reaches nextThink. Online: tugModeNetSteps. Then one snapshot for the frame (raw and view) and the
// dock model built from the view. The match's last frame ends at tugFinish, which builds the dock one last time (units
// mode).
function tugUpdate(dt) {
  if (!tugState || tugState.over) {
    return;
  }
  const match = tugState.match;
  const stepDt = ProtoSim.BATTLE_DT;
  if (tugState.net) {
    tugModeNetSteps(match, stepDt);
  } else {
    const every = tugModeThinkSeconds(match);
    tugState.acc += Math.max(0, Number(dt) || 0);
    let steps = 0;
    while (tugState.acc >= stepDt - 1e-9 && steps < TUG_MODE_MAX_STEPS && match.phase === "live") {
      if (match.clock >= tugState.nextThink - 1e-6) {
        tugModeThink();
        tugState.nextThink += every;
        if (match.phase !== "live") {
          break;
        }
      }
      ProtoSim.step(match, stepDt);
      tugModeGoldSfx(match);
      tugState.acc -= stepDt;
      steps += 1;
    }
    if (steps >= TUG_MODE_MAX_STEPS) {
      tugState.acc = 0;
    }
  }
  tugModeTakeSnap(match);
  if (match.phase === "over") {
    tugFinish();
    return;
  }
  tugModeBuildDock(tugState.snap);
}

// Online, one frame: before startAt (tugNetTargetTick() < 0) no step, the status line counts down ("Starting in 3…");
// then the lockstep loop (.plans/ltw-tug-pvp-lockstep.md): step tick by tick toward the server clock's target, never
// past the opponent's front, each tick's inputs (both roles, in the log's order) applied before its step, a hash every
// TUG_MODE_HASH_EVERY ticks. A stall (behind the target, the opponent's front behind me) of TUG_MODE_STALL_MS real
// time says "Waiting for opponent…" once; a step clears it.
function tugModeNetSteps(match, stepDt) {
  if (typeof tugNetTargetTick !== "function" || typeof tugNetAllowedTick !== "function" || typeof tugNetInputsFor !== "function") {
    return; // tug-net.js is not loaded (logged by tugStartMatch): nothing can step
  }
  const target = tugNetTargetTick();
  if (target < 0) {
    tugModeNetNote(`Starting in ${Math.max(1, Math.ceil(-target * stepDt - 1e-9))}…`);
    return;
  }
  const allowed = tugNetAllowedTick();
  let steps = 0;
  while (tugState.tick < target && tugState.tick <= allowed && steps < TUG_MODE_MAX_STEPS && match.phase === "live") {
    for (const input of tugNetInputsFor(tugState.tick)) tugModeApplyInput(input);
    ProtoSim.step(match, stepDt); tugModeGoldSfx(match); tugState.tick += 1; steps += 1;
    if (tugState.tick % TUG_MODE_HASH_EVERY === 0 && typeof tugNetReportHash === "function") {
      tugNetReportHash(tugState.tick, tugModeHash(match));
    }
  }
  if (steps > 0) {
    tugState.stalledSince = null;
    tugState.netNote = null;
  } else if (tugState.tick < target && tugState.tick > allowed) {
    const now = performance.now();
    if (tugState.stalledSince === null) {
      tugState.stalledSince = now;
    } else if (now - tugState.stalledSince >= TUG_MODE_STALL_MS) {
      tugModeNetNote("Waiting for opponent…");
    }
  }
}

// The online loop's status line: written only when the text changes (the countdown once per second, a stall once).
function tugModeNetNote(text) {
  if (tugState.netNote !== text) {
    tugState.netNote = text;
    updateStatus(text);
  }
}

// One input from the shared log ({ role, t, k, a }; tug-net.js removes it from its store): host plays sim side player,
// guest sim side ai, on both clients alike. A refusal of my own input shows as a tap's would have (late, about 0.6 s
// after the tap); the opponent's are silent. An unknown kind is logged and ignored (both clients ignore it).
function tugModeApplyInput(input) {
  const match = tugState.match;
  const role = input ? input.role : null;
  const side = role === "host" ? "player" : "ai";
  const a = input ? input.a : undefined;
  let res;
  if (input && input.k === "mob") {
    res = ProtoSim.queueMob(match, side, a);
  } else if (input && input.k === "tower") {
    res = ProtoSim.placeTower(match, side, a);
  } else if (input && input.k === "pick") {
    const pick = a && typeof a === "object" ? a : {};
    res = ProtoSim.pickUpgrade(match, side, pick.slot, pick.kind);
  } else {
    console.error("[tug] unknown input ignored", input);
    return;
  }
  if (res && !res.ok && tugState.net && role === tugState.net.role) {
    tugModeRefuse(input.k === "tower" && res.reason === "rubble"
      ? `rubble, ${Math.ceil(match[side].rubble[a] - 1e-9)} s`
      : res.reason);
  }
}

// The frame's snapshot: tugState.rawSnap as the sim has it, tugState.snap as I see it (tugModeViewSnap).
function tugModeTakeSnap(match) {
  tugState.prevSnap = tugState.snap;
  tugState.rawSnap = ProtoSim.snapshot(match);
  tugState.snap = tugModeViewSnap(tugState.rawSnap);
}

// The other sim side; anything else (a "draw" winner, a missing owner) as it is.
function tugModeFlipSide(side) {
  return side === "player" ? "ai" : (side === "ai" ? "player" : side);
}

// The view snapshot, a pure function of raw and tugState: raw itself when I am the player side (solo, host); for the
// guest a copy with the two sides swapped and every y mirrored (y -> mirrorY - y): the gates, units and their targets,
// turrets (dirY flipped), slots, fronts (null kept), projectiles (y, prevY; owner swapped), bursts and hits (side
// swapped), and the side-keyed tug price lists and result swapped. x never changes, so my slot i stays slot i. raw is
// never written; untouched fields are shared with it.
function tugModeViewSnap(raw) {
  if (!raw || !tugState || tugState.mySide === "player") {
    return raw;
  }
  const mirrorY = tugState.mirrorY;
  const my = (y) => (typeof y === "number" ? mirrorY - y : y);
  const view = Object.assign({}, raw, {
    player: tugModeMirrorSide(raw.ai, my),
    ai: tugModeMirrorSide(raw.player, my)
  });
  if (raw.front) {
    view.front = { player: my(raw.front.ai), ai: my(raw.front.player) };
  }
  if (raw.tug) {
    view.tug = { player: raw.tug.ai, ai: raw.tug.player };
  }
  if (raw.result) {
    view.result = Object.assign({}, raw.result, { winner: tugModeFlipSide(raw.result.winner), player: raw.result.ai, ai: raw.result.player });
  }
  if (Array.isArray(raw.projectiles)) {
    view.projectiles = raw.projectiles.map((p) => Object.assign({}, p, { y: my(p.y), prevY: my(p.prevY), owner: tugModeFlipSide(p.owner) }));
  }
  if (Array.isArray(raw.bursts)) {
    view.bursts = raw.bursts.map((b) => Object.assign({}, b, { y: my(b.y) }));
  }
  if (Array.isArray(raw.hits)) {
    view.hits = raw.hits.map((h) => Object.assign({}, h, { y: my(h.y), side: tugModeFlipSide(h.side) }));
  }
  return view;
}

// One snapshot side for the guest's view: a copy with the gate, slots, turrets, units and unit targets mirrored.
function tugModeMirrorSide(S, my) {
  if (!S) {
    return S;
  }
  const out = Object.assign({}, S);
  if (S.gate) {
    out.gate = Object.assign({}, S.gate, { y: my(S.gate.y) });
  }
  if (Array.isArray(S.slots)) {
    out.slots = S.slots.map((p) => (p ? Object.assign({}, p, { y: my(p.y) }) : p));
  }
  if (Array.isArray(S.towers)) {
    out.towers = S.towers.map((t) => (t
      ? Object.assign({}, t, { y: my(t.y), dirY: typeof t.dirY === "number" ? -t.dirY : t.dirY })
      : t));
  }
  if (Array.isArray(S.units)) {
    out.units = S.units.map((u) => Object.assign({}, u, {
      y: my(u.y),
      target: u.target && typeof u.target === "object" && typeof u.target.y === "number"
        ? Object.assign({}, u.target, { y: my(u.target.y) })
        : u.target
    }));
  }
  return out;
}

// The lockstep check both clients compute on the same tick (tugNetReportHash compares them): FNV-1a 32-bit over
// integers, in this order (the order is the contract): per side (player, then ai) round(gate hp * 10), round(gold *
// 10), the unit count, per unit id, round(x), round(y), round(hp * 10), per turret slot the level, round(hp * 10) and
// the TUG_MODE_HASH_TRAITS ranks (all 0 for an empty slot); then round(clock * 30).
function tugModeHash(match) {
  let h = 2166136261;
  const mix = (v) => {
    h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  };
  for (const side of ["player", "ai"]) {
    const S = match[side];
    mix(Math.round(S.gate.hp * 10));
    mix(Math.round(S.gold * 10));
    mix(S.units.length);
    for (const u of S.units) {
      mix(u.id);
      mix(Math.round(u.x));
      mix(Math.round(u.y));
      mix(Math.round(u.hp * 10));
    }
    for (const t of S.towers) {
      mix(t ? t.level : 0);
      mix(t ? Math.round(t.hp * 10) : 0);
      for (const k of TUG_MODE_HASH_TRAITS) {
        mix(t && t.traits ? t.traits[k] : 0);
      }
    }
  }
  mix(Math.round(match.clock * 30));
  return h;
}

// The match is over (a gate at 0, the clock, or online the opponent gone): the match-end card, shaped as
// buildMatchSummary's. The last snap stays on screen behind it; tugState lives on until Play Again (resetMatch) or
// Return to Menu (the next resetMatch). Online the session is handed back after the card (the room is finished).
function tugFinish() {
  const match = tugState.match;
  const me = tugState.mySide;
  const result = match.result || { winner: "draw", reason: "clock", player: match.player.gate.hp, ai: match.ai.gate.hp };
  tugState.over = true;
  state.gameOver = true;
  state.phase = "gameover";
  state.hasActiveMatch = false;
  state.winnerText = result.winner === me
    ? "You win"
    : (result.winner === tugModeFlipSide(me) ? (tugState.net ? "Opponent wins" : "AI wins") : "Draw");
  state.matchSummary = tugModeSummary(match, result);
  fadeOutMatchMusic(true);
  clearSavedMatchState();
  tugDeselect();
  tugModeBuildDock(tugState.snap); // the dock ends in units mode behind the match-end card
  refreshAllUI();
  tugModeNetLeave("over");
}

// The end card from my side, in the 2a handoff's words (README "Match-end copy"; the plan's Decision 6 adds left, gone
// and guard): title, why (summary.copy) and detail (summary.nextGoal). The stats grid is not shown in tug (stats: []).
//   win, gate down   "You win!"    / "Their gate fell"          / "in m:ss"
//   loss, gate down  "You lose"    / "Your gate fell"           / "in m:ss"
//   win, time up     "Time's up"   / "You win on gate HP"       / "after 5:00"
//   loss, time up    "Time's up"   / "They win on gate HP"      / "after 5:00"
//   draw, time up    "Time's up"   / "Draw: the gates are even" / "after 5:00"
//   rival left / disconnected (online, always my win)  "You win!" / "Your rival left" / "Your rival disconnected" / "in m:ss"
//   guard (a safety stop)  "You win!" | "You lose" | "Draw" / "The match was stopped" / "after m:ss"
// m:ss is the elapsed match clock; "5:00" is the rules' full length (time.matchSeconds).
function tugModeSummary(match, result) {
  const me = tugState.mySide;
  const them = tugModeFlipSide(me);
  const won = result.winner === me;
  const lost = result.winner === them;
  const elapsed = tugModeClockText(match.clock);
  const full = tugModeClockText(match.tug.time.matchSeconds);
  const byResult = won ? "You win!" : (lost ? "You lose" : "Draw");
  let title = byResult;
  let why;
  let detail = `in ${elapsed}`;
  if (result.reason === "left" || result.reason === "gone") {
    title = "You win!";
    why = result.reason === "left" ? "Your rival left" : "Your rival disconnected";
  } else if (result.reason === "clock") {
    title = "Time's up";
    why = won ? "You win on gate HP" : (lost ? "They win on gate HP" : "Draw: the gates are even");
    detail = `after ${full}`;
  } else if (result.reason === "guard") {
    why = "The match was stopped";
    detail = `after ${elapsed}`;
  } else {
    // gate down (both gates down at once is a draw)
    why = won ? "Their gate fell" : (lost ? "Your gate fell" : "Both gates fell");
  }
  return { title, copy: why, stats: [], nextGoal: detail };
}

// Online: hands this match's session back to tug-net.js (tugNetLeave), once per match; a solo match never calls it,
// so a solo or already finished match left behind cannot touch a later search.
function tugModeNetLeave(reason) {
  if (!tugState || !tugState.net || tugState.netLeft) {
    return;
  }
  tugState.netLeft = true;
  if (typeof tugNetLeave === "function") {
    tugNetLeave(reason);
  }
}

// tug-net.js: the opponent left ("left": quit or menu while live) or stayed disconnected ("gone"). A live match ends
// at once, won by me, as if the sim had ended it; a finished one is left as it is.
function tugModeOnOpponentLeft(reason) {
  if (!tugState || !tugState.net || tugState.over || tugState.match.phase !== "live") {
    return;
  }
  const match = tugState.match;
  match.result = { winner: tugState.mySide, reason, player: match.player.gate.hp, ai: match.ai.gate.hp };
  match.phase = "over";
  tugModeTakeSnap(match);
  tugFinish();
}

// tug-net.js: my hash and the opponent's differ at tick t (called once). The match goes on; the status line says so.
function tugModeOnDesync(t) {
  const seconds = Math.round(Number(t) * ProtoSim.BATTLE_DT * 10) / 10;
  console.error(`[tug] out of sync at tick ${t} (${seconds} s)`);
  if (!tugState || !tugState.net) {
    return;
  }
  tugState.desync = t;
  updateStatus(`Out of sync at ${seconds}s.`);
}

// tug-net.js: a line for the status bar ("Opponent disconnected…", "Opponent is back.") while an online match runs.
function tugModeOnNetStatus(text) {
  if (tugState && tugState.net) {
    updateStatus(String(text));
  }
}

// Leaves tug's borrowed chrome and dialog copy as classic built them, hands an online session back (tugModeNetLeave
// "end": quit, Return to Menu, Play Again, a new match) and drops the match. Idempotent; safe from resetMatch (Play
// Again, or the next match after Return to Menu), tugOnQuit and tugStartMatch. state.mode is resetMatch's to clear.
function tugEndMatch() {
  tugModeNetLeave("end");
  tugModeRestoreChrome();
  tugModeRestoreDialogs();
  if (typeof tugPixiDestroy === "function") {
    tugPixiDestroy();
  }
  document.body.classList.remove("mode-tug");
  tugDeselect();
  tugState = null;
}

// The quit confirm's Quit (quitMatchNow, before it goes to the menu): the match ends for good, nothing to resume.
function tugOnQuit() {
  state.hasActiveMatch = false;
  state.gameOver = false;
  tugEndMatch();
}

// ---------------------------------------------------------------------------------------------- actions

// Online: one action into the shared log (tug-net.js schedules it TUG_NET_DELAY_TICKS ahead; tugModeApplyInput applies
// it on both clients). Without tug-net.js the action is dropped and logged.
function tugModeSend(k, a) {
  if (typeof tugNetSend === "function") {
    tugNetSend(k, a);
  } else {
    console.error("[tug] tug-net.js is not loaded: input dropped", k, a);
  }
}

// A mob card tap (tug-pixi.js's own mob cards): pay and queue the mob; the card flashes (tugPxFlashMob). Online the card
// flashes at once and the mob goes out through the log (a refusal shows when it is applied).
function tugQueueMob(id) {
  if (!tugModeCanAct()) {
    return;
  }
  if (tugState.net) {
    if (typeof tugPxFlashMob === "function") {
      tugPxFlashMob(id);
    }
    tugModeSend("mob", id);
    return;
  }
  const res = ProtoSim.queueMob(tugState.match, tugState.mySide, id);
  if (res.ok) {
    if (typeof tugPxFlashMob === "function") {
      tugPxFlashMob(id);
    }
  } else {
    tugModeRefuse(res.reason);
  }
}

// Take back a queued mob, full refund. While queue.parallel every mob is training and any index (the head included)
// can go; otherwise the head (0) trains and only the mobs behind it can. No tap calls it since the dock fixes (the
// queue boxes went; a later pass may make a badge tap cancel). Solo only: the online log has no cancel input.
function tugCancelQueued(index) {
  const q = tugState.match && tugState.match.tug && tugState.match.tug.queue;
  const parallel = !!q && q.parallel === true;
  if (!tugModeCanAct() || tugState.net || !Number.isInteger(index) || index < (parallel ? 0 : 1)) {
    return;
  }
  const res = ProtoSim.cancelMob(tugState.match, tugState.mySide, index);
  if (!res.ok) {
    tugModeRefuse(res.reason);
  }
}

// A player slot tap (the .tower-slot.player click; slot i is my sim slot i, the view mirrors y only): a turret (built
// or building) becomes the selection (the dock shows its traits); an empty slot builds one (online: through the log)
// and leaves the selection as it was; rubble says how long it has left. Slots past the sim's two are ignored.
function tugSlotTap(slot) {
  if (!tugModeCanAct()) {
    return;
  }
  const match = tugState.match;
  const mine = match[tugState.mySide];
  if (!Number.isInteger(slot) || slot < 0 || slot >= mine.towers.length) {
    return;
  }
  if (mine.towers[slot]) {
    tugState.selected = { side: "player", slot };
    return;
  }
  if (tugState.net) {
    tugModeSend("tower", slot);
    return;
  }
  const res = ProtoSim.placeTower(match, tugState.mySide, slot);
  if (!res.ok) {
    tugModeRefuse(res.reason === "rubble" ? `rubble, ${Math.ceil(mine.rubble[slot] - 1e-9)} s` : res.reason);
  }
}

// The selected turret's slot (always yours), else null (units mode).
function tugModeOwnSlot() {
  const selected = tugState ? tugState.selected : null;
  return selected && selected.side === "player" ? selected.slot : null;
}

// Take a trait (its id) or "heal" from your selected turret's offer (ProtoSim.pickUpgrade takes the id; online it goes
// out through the log as { slot, kind }). The selection stays: the dock shows the new rank, or the next offer when one
// is pending at once.
function tugPickOffer(kind) {
  const slot = tugModeOwnSlot();
  if (!tugModeCanAct() || slot === null || typeof kind !== "string") {
    return;
  }
  if (tugState.net) {
    tugModeSend("pick", { slot, kind });
    return;
  }
  const res = ProtoSim.pickUpgrade(tugState.match, tugState.mySide, slot, kind);
  if (!res.ok) {
    tugModeRefuse(res.reason);
  }
}

// A turret tab tap (tug-pixi.js, units mode; slot is my sim slot, the view mirrors y only): does what a tap on that
// slot's diamond does (tugSlotTap): select a built or building turret, build on an empty slot, refuse rubble.
function tugTabTap(slot) {
  tugSlotTap(slot);
}

// A frame tap (tug-pixi.js; i is 0-3, indexing tugState.dock.frames): a dim frame does nothing, a lit one takes its
// action (a trait id or "heal") through tugPickOffer. A dock built for another selection than the current one (a tap
// landing before the next rebuild) is ignored.
function tugFrameTap(i) {
  const dock = tugState ? tugState.dock : null;
  const frames = dock && dock.mode === "tower" && Array.isArray(dock.frames) ? dock.frames : null;
  const frame = frames && Number.isInteger(i) && i >= 0 && i <= TUG_MODE_TRACK_FRAMES ? frames[i] : null;
  if (!frame || !frame.lit || !frame.action) {
    return;
  }
  const selected = tugState.selected;
  if (!tugModeCanAct() || !selected || selected.side !== "player" || selected.slot !== dock.slot) {
    return;
  }
  tugPickOffer(frame.action);
}

// Back to units mode; the dock follows on its next rebuild. Always allowed (no live check): it is harmless.
function tugDeselect() {
  if (tugState) {
    tugState.selected = null;
  }
}

// A press in the arena: the player's slots answer through their click (tugSlotTap) and the pause and quit cards are
// their own; anywhere else on the battlefield (the gate and the enemy slots included; enemy turrets cannot be
// selected) goes back to units mode. Tug's dock below the battlefield (from TUG_PX_DOCK.y, tug-pixi.js) is Pixi's (the
// tabs, the frames and the mob cards take their own taps), so a press there changes nothing.
if (arenaDropZoneEl) {
  arenaDropZoneEl.addEventListener("pointerdown", (event) => {
    if (!tugState) {
      return;
    }
    const target = event.target;
    if (target && target.closest) {
      if (target.closest(".tower-slot.player") || target.closest(".pause-overlay")) {
        return;
      }
    }
    const frame = playerSlotsEl.getBoundingClientRect(); // the slot row covers the safe frame exactly
    const frameY = frame.height > 0 ? ((event.clientY - frame.top) / frame.height) * LOGICAL_CANVAS_HEIGHT : 0;
    // tug-pixi.js defines TUG_PX_DOCK (it loads first); read here, at event time
    if (typeof TUG_PX_DOCK !== "undefined" && TUG_PX_DOCK && frameY < TUG_PX_DOCK.y) {
      tugDeselect();
    }
  });
}

// Keys 1 / 2 / 3 take that offer (in the sim's offer order, Heal included) while your selected turret has a level
// ready.
document.addEventListener("keydown", (event) => {
  const slot = tugModeOwnSlot();
  if (slot === null || state.mode !== "tug" || state.screen !== "game") {
    return;
  }
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    return;
  }
  if (event.key === "1" || event.key === "2" || event.key === "3") {
    event.preventDefault();
    const t = tugState.match[tugState.mySide].towers[slot];
    const kind = t && t.ready && Array.isArray(t.offer) ? t.offer[Number(event.key) - 1] : undefined;
    if (kind !== undefined) {
      tugPickOffer(kind);
    }
  }
});

// ---------------------------------------------------------------------------------------------- dock model

// tugState.dock, the model tug-pixi.js draws on the dock: the v4 contract in the header above (and in
// .plans/ltw-tug-hud-2a.md "The contracts"). Built from the frame's snapshot: a selection whose turret is gone
// (destroyed) goes back to units mode first.
function tugModeBuildDock(snap) {
  if (!tugState || !snap) {
    return;
  }
  if (tugState.selected && !tugModeSnapTower(snap, tugState.selected)) {
    tugDeselect();
  }
  const selected = tugState.selected;
  const queue = tugModeDockQueue(snap);
  const mobs = tugModeDockMobs(snap, queue);
  tugState.dock = selected ? tugModeTowerDock(snap, selected, queue, mobs) : tugModeUnitsDock(snap, queue, mobs);
}

// The snapshot turret a selection names, or null.
function tugModeSnapTower(snap, selected) {
  const S = selected ? snap[selected.side] : null;
  return S && Array.isArray(S.towers) ? S.towers[selected.slot] || null : null;
}

// The queue: how many of each mob are in snap.player.build (the head included), the whole build in order (head first)
// with each training entry's fraction (1 when its seconds are 0 or less; 0 for an entry not training) and a training
// flag (every entry while the match's queue.parallel is on, else the head only), and the head (the list's first entry)
// or null when the queue is empty.
function tugModeDockQueue(snap) {
  const build = snap.player.build || [];
  const q = tugState.match && tugState.match.tug && tugState.match.tug.queue;
  const parallel = !!q && q.parallel === true;
  const counts = {};
  const list = [];
  for (let i = 0; i < build.length; i += 1) {
    const b = build[i];
    counts[b.defId] = (counts[b.defId] || 0) + 1;
    const training = parallel || i === 0;
    const frac = training ? (b.seconds > 0 ? clamp(1 - b.remaining / b.seconds, 0, 1) : 1) : 0;
    list.push({ defId: b.defId, frac, training });
  }
  return { counts, list, head: list[0] || null };
}

// Units mode: a fixed title, one tab per slot of your side (each tab says whether its turret has a level ready).
function tugModeUnitsDock(snap, queue, mobs) {
  return {
    mode: "units",
    title: "Your turrets: tap one to level it",
    titleRight: "",
    tabs: tugModeTabs(snap),
    queue,
    mobs
  };
}

// Your selected turret: "Turret 1 · Level 2 · HP 36/40" (+ " · building" while under construction), also when a level
// is ready; the ready state shows on the right ("level ready: pick one") and in the frames (hint, dim).
function tugModeTowerDock(snap, selected, queue, mobs) {
  const t = tugModeSnapTower(snap, selected);
  const ready = t.ready === true;
  const n = selected.slot + 1;
  return {
    mode: "tower",
    slot: selected.slot,
    title: `Turret ${n} · Level ${t.level} · HP ${tugModeNum(t.hp)}/${tugModeNum(t.maxHp)}${t.building ? " · building" : ""}`,
    titleRight: ready ? "level ready: pick one" : "",
    ready,
    queue,
    mobs,
    frames: tugModeFrames(t)
  };
}

// The turret tabs of units mode: one per slot of my side (the view snapshot's player side: towers, slotStates, rubble).
// built / building: "Turret N" with its level and hp (or "building"), the turret's colour, tappable; rubble: the seconds
// left; empty: a build prompt with the turret price. Built, building and empty tabs are tappable, rubble is not (tugTabTap).
function tugModeTabs(snap) {
  const P = snap.player;
  const tabs = [];
  const price = ProtoSim.tugTowerPrice(tugState.match, tugState.mySide);
  for (let slot = 0; slot < TUG_MODE_SLOTS; slot += 1) {
    const t = Array.isArray(P.towers) ? P.towers[slot] || null : null;
    const raw = Array.isArray(P.slotStates) ? P.slotStates[slot] : null; // "empty" | "rubble" | "building" | "tower"
    let stateName;
    if (t) {
      stateName = raw === "building" || (raw !== "tower" && t.building) ? "building" : "built";
    } else {
      stateName = raw === "rubble" || (raw !== "empty" && Array.isArray(P.rubble) && P.rubble[slot] > 0) ? "rubble" : "empty";
    }
    const name = stateName === "empty" ? `Slot ${slot + 1}` : `Turret ${slot + 1}`;
    if (stateName === "built") {
      tabs.push({
        slot, state: "built", name, line: `L${t.level} · HP ${tugModeNum(t.hp)}/${tugModeNum(t.maxHp)}`,
        ready: t.ready === true, colourId: tugState.colourFor(t.dominant), tappable: true
      });
    } else if (stateName === "building") {
      tabs.push({ slot, state: "building", name, line: "building", ready: false, colourId: tugState.colourFor(t.dominant), tappable: true });
    } else if (stateName === "rubble") {
      const left = Array.isArray(P.rubble) ? Number(P.rubble[slot]) || 0 : 0;
      tabs.push({ slot, state: "rubble", name, line: `rubble · ${Math.ceil(left - 1e-9)}s`, ready: false, colourId: null, tappable: false });
    } else {
      tabs.push({
        slot, state: "empty", name, line: price === null ? "tap to build" : `tap to build · ${tugModeNum(price)} gold`,
        ready: false, colourId: null, tappable: true
      });
    }
  }
  return tabs;
}

// The five mob cards' model, one per attackerDefs entry in that order: coin cost, role word, how many of it are queued,
// poor (gold short) and blocked (poor, queue full, or the match over).
function tugModeDockMobs(snap, queue) {
  const match = tugState.match;
  const gold = Number(snap.player.gold) || 0;
  const full = snap.player.build.length >= Math.floor(Number(match.tug.queue.max));
  return attackerDefs.map((def) => {
    const cost = match.tug.costs.mob[def.id];
    const poor = gold < cost;
    return {
      id: def.id,
      cost,
      role: TUG_MODE_ROLES[def.id] || "",
      count: queue.counts[def.id] || 0,
      poor,
      blocked: poor || full || tugState.over
    };
  });
}

// The four frames for snapshot turret t. 0-2: its traits (rank > 0) in TUG_MODE_TRAIT_ORDER, padded with "open"; with
// a level ready, each offered trait in offer order lights its own frame, else takes the first open frame, else
// replaces the last unlit trait frame (2 back to 0), so an owned track may hide for that level. 3: Heal, lit when the
// offer holds "heal".
function tugModeFrames(t) {
  const tracks = TUG_MODE_TRAIT_ORDER.filter((k) => t.traits[k] > 0).slice(0, TUG_MODE_TRACK_FRAMES);
  const frames = [];
  for (let i = 0; i < TUG_MODE_TRACK_FRAMES; i += 1) {
    frames.push(i < tracks.length ? tugModeTraitFrame(t, tracks[i], false) : tugModePlainFrame(t, "open", false));
  }
  const offer = t.ready === true && Array.isArray(t.offer) ? t.offer : [];
  for (const k of offer) {
    if (k === "heal" || !TUG_MODE_TRAIT_NAME[k]) {
      continue;
    }
    let at = frames.findIndex((f) => f.kind === "trait" && f.trait === k);
    if (at < 0) {
      at = frames.findIndex((f) => f.kind === "open");
    }
    for (let j = TUG_MODE_TRACK_FRAMES - 1; at < 0 && j >= 0; j -= 1) {
      if (frames[j].kind === "trait" && !frames[j].lit) {
        at = j;
      }
    }
    if (at >= 0) {
      frames[at] = tugModeTraitFrame(t, k, true);
    }
  }
  frames.push(tugModePlainFrame(t, "heal", offer.indexOf("heal") >= 0));
  return frames;
}

// dim: the turret has a level ready and this frame is not lit; hint: the lit frame's TUG_MODE_HINTS word; sub: only
// Heal's line ("hp/maxHp hp").
function tugModeTraitFrame(t, kind, lit) {
  const rank = (t.traits && t.traits[kind]) || 0;
  return {
    kind: "trait",
    trait: kind,
    name: TUG_MODE_TRAIT_NAME[kind],
    rank,
    cap: tugModeTraitCap(t, kind),
    lit,
    action: lit ? kind : null,
    dim: t.ready === true && !lit,
    hint: lit ? TUG_MODE_HINTS[kind] || "" : "",
    sub: null
  };
}

function tugModePlainFrame(t, kind, lit) {
  const spec = TUG_MODE_PLAIN_FRAMES[kind];
  return {
    kind,
    trait: null,
    name: spec.name,
    rank: null,
    cap: null,
    lit: !!lit,
    action: lit ? spec.action : null,
    dim: t.ready === true && !lit,
    hint: lit ? TUG_MODE_HINTS[kind] || "" : "",
    sub: kind === "heal" ? `${tugModeNum(t.hp)}/${tugModeNum(t.maxHp)} hp` : null
  };
}

// A trait's rank cap: the snapshot's caps, else the rules'.
function tugModeTraitCap(t, kind) {
  const cap = t && t.caps ? Number(t.caps[kind]) : NaN;
  if (Number.isFinite(cap)) {
    return cap;
  }
  const T = tugState.match.tug.traits[kind];
  return T ? Math.max(0, Math.floor(Number(T.cap) || 0)) : 0;
}

// --------------------------------------------------------------------------------------- HUD, dock, cards

// Hides all of classic's Pixi chrome (every chrome layer child, the HUD numbers, the timer fills) and every part of
// every classic dock card (tower and creep: visible false, the hit area's eventMode "none") on whatever Pixi nodes are
// current, remembering the classic values (each hidden node's visible, every card part's visible and eventMode).
// tug-pixi.js draws tug's own wood dock, tabs, frames and mob cards in their place. Each part is re-applied when its
// nodes were rebuilt (buildJonChrome, buildPixiDockCards and buildPixiHudText make new objects on an Art screen pack
// change), so the remembered values are always the live nodes' classic ones; every call also hides again any card part
// classic showed since (refreshAllUI's updatePixiCardStates writes the creep cards' queueText), which never touches the
// record.
function tugModeApplyChrome() {
  if (!tugState || !pixiState.ready) {
    return;
  }
  if (!tugModeChrome) {
    tugModeChrome = { layer: null, hud: null, hidden: [], entries: null, saved: [] };
  }
  const chrome = tugModeChrome;
  if (chrome.layer !== pixiState.chromeLayer || chrome.hud !== pixiState.hudText) {
    // either may be rebuilt alone: the recorded nodes still alive go back first, so every node is recorded at
    // classic's value
    tugModeShowHidden(chrome.hidden);
    chrome.layer = pixiState.chromeLayer;
    chrome.hud = pixiState.hudText;
    chrome.hidden = [];
    const nodes = [];
    if (chrome.layer && Array.isArray(chrome.layer.children)) {
      // the two columns, the stat tiles and their labels, the timer tile and track, and the wood dock (a layers
      // pack's chrome layer is empty)
      nodes.push(...chrome.layer.children);
    }
    if (chrome.hud) {
      nodes.push(...Object.values(chrome.hud));
    }
    nodes.push(pixiState.timerFill, pixiState.timerIdleFill);
    for (const node of nodes) {
      if (!node || node.destroyed) {
        continue;
      }
      chrome.hidden.push({ node, visible: node.visible });
      if (node.visible) {
        node.visible = false;
      }
    }
  }
  if (chrome.entries !== pixiState.cardEntries) {
    chrome.entries = pixiState.cardEntries;
    chrome.saved = [];
    for (const entry of chrome.entries || []) {
      if (entry.type !== "tower" && entry.type !== "attacker") {
        continue;
      }
      const parts = [];
      for (const key of TUG_MODE_CARD_PARTS) {
        const node = entry[key];
        if (node) {
          parts.push({ node, visible: node.visible, eventMode: node.eventMode, hit: key === "hitArea" });
        }
      }
      chrome.saved.push({ entry, parts });
    }
  }
  for (const item of chrome.saved) {
    for (const part of item.parts) {
      tugModeSetNode(part.node, false, part.hit ? "none" : part.node.eventMode);
    }
  }
}

// The hidden HUD chrome back to classic's visible as recorded (a destroyed node is left alone).
function tugModeShowHidden(hidden) {
  for (const item of hidden || []) {
    const node = item.node;
    if (node && !node.destroyed && node.visible !== item.visible) {
      node.visible = item.visible;
    }
  }
}

function tugModeRestoreChrome() {
  const chrome = tugModeChrome;
  tugModeChrome = null;
  if (chrome) {
    // the rails, stat tiles, labels, timer tile and track, the wood dock, the HUD numbers and the timer fills
    tugModeShowHidden(chrome.hidden);
    // every part of every tower and creep card back to classic's visible and eventMode as recorded
    for (const item of chrome.saved) {
      for (const part of item.parts) {
        tugModeSetNode(part.node, part.visible, part.eventMode);
      }
    }
  }
  // classic rewrites its HUD numbers and recolours its card costs on the next frame
  pixiState.lastHudSignature = "";
  pixiState.lastCardSignature = "";
}

// One Pixi node's visible and eventMode, written only where they differ (a destroyed node is left alone).
function tugModeSetNode(node, visible, eventMode) {
  if (!node || node.destroyed) {
    return;
  }
  if (node.visible !== visible) {
    node.visible = visible;
  }
  if (node.eventMode !== eventMode) {
    node.eventMode = eventMode;
  }
}

// The pause and quit dialogs' tug copy (index.html stays classic's; jon-battle.css's body.mode-tug rules place it):
// one <p class="quit-note tug-dialog-line"> right after each card's h2 (pause: "m:ss left", written by
// tugUpdateHud; quit: "It counts as a loss." online, "The match ends here." solo), and the quit card's title and
// buttons ("Quit the match?", "Yes, quit", "No, keep playing"). Borrowed by tugStartMatch once tugState exists,
// restored by tugEndMatch; a second borrow puts the first back before it inserts, so nothing is ever inserted twice.
function tugModeBorrowDialogs() {
  tugModeRestoreDialogs();
  if (!tugState) {
    return;
  }
  const pauseCard = pauseOverlayEl ? pauseOverlayEl.querySelector(".pause-card") : null;
  const quitCard = quitOverlayEl ? quitOverlayEl.querySelector(".pause-card") : null;
  for (const card of [pauseCard, quitCard]) {
    if (card) {
      card.querySelectorAll(".tug-dialog-line").forEach((el) => el.remove()); // a stray line left by anything else
    }
  }
  const borrowed = { pauseLine: null, quitLine: null, pauseText: null, texts: [] };
  tugModeDialog = borrowed;
  const insertLine = (card, text) => {
    const h2 = card ? card.querySelector("h2") : null;
    if (!h2) {
      return null;
    }
    const line = document.createElement("p");
    line.className = "quit-note tug-dialog-line";
    line.textContent = text;
    h2.insertAdjacentElement("afterend", line);
    return line;
  };
  const setText = (el, text) => {
    if (el) {
      borrowed.texts.push({ el, text: el.textContent });
      el.textContent = text;
    }
  };
  borrowed.pauseLine = insertLine(pauseCard, "");
  tugModeSetPauseLine(tugModeClockText(Math.max(0, Number(tugState.match.tug.time.matchSeconds) || 0)));
  borrowed.quitLine = insertLine(quitCard, tugState.net ? "It counts as a loss." : "The match ends here.");
  setText(quitCard ? quitCard.querySelector("h2") : null, "Quit the match?");
  setText(quitConfirmBtnEl, "Yes, quit");
  setText(quitCancelBtnEl, "No, keep playing");
}

// The pause line's "m:ss left", written only when the text changed (no-op when nothing is borrowed).
function tugModeSetPauseLine(time) {
  const borrowed = tugModeDialog;
  if (!borrowed || !borrowed.pauseLine) {
    return;
  }
  const text = `${time} left`;
  if (borrowed.pauseText !== text) {
    borrowed.pauseText = text;
    borrowed.pauseLine.textContent = text;
  }
}

// The dialogs back to classic's words: the inserted lines removed, every borrowed text put back. Idempotent.
function tugModeRestoreDialogs() {
  const borrowed = tugModeDialog;
  tugModeDialog = null;
  if (!borrowed) {
    return;
  }
  for (const line of [borrowed.pauseLine, borrowed.quitLine]) {
    if (line) {
      line.remove();
    }
  }
  for (let i = borrowed.texts.length - 1; i >= 0; i -= 1) {
    borrowed.texts[i].el.textContent = borrowed.texts[i].text;
  }
}

// Re-applies the chrome setup (classic's HUD stays hidden across a rebuild), then publishes tugState.hud (the header's
// HUD model): your gold, the time left, and when your gold last changed for tug-pixi.js's pop. The match's first half
// second is exempt from the pop, as classic's; the pop clears once HUD_POP_SECONDS have passed or the match is over.
// The pause dialog's line follows the same time text ("1:44 left", tugModeSetPauseLine).
function tugUpdateHud() {
  if (!tugState || !pixiState.ready || !pixiState.hudText || !pixiState.hudText.round) {
    return;
  }
  tugModeApplyChrome();
  const match = tugState.match;
  const total = Number(match.tug.time.matchSeconds) || 0;
  const remaining = Math.max(0, total - match.clock);
  const gold = tugModeGold(match[tugState.mySide].gold);
  const prev = tugState.hud;
  const now = state.animationClock;
  let goldPopT0 = prev ? prev.goldPopT0 : null;
  if (prev && prev.gold !== gold) {
    goldPopT0 = now > 0.5 ? now : null;
  }
  if (goldPopT0 !== null && (tugState.over || now < goldPopT0 || now - goldPopT0 >= HUD_POP_SECONDS)) {
    goldPopT0 = null;
  }
  const time = tugModeClockText(remaining);
  tugState.hud = { gold, time, goldPopT0 };
  tugModeSetPauseLine(time);
}

// tug-pixi.js calls this every frame: it only re-applies the chrome setup, so classic's dock cards stay hidden across
// a rebuild (tugModeApplyChrome compares pixiState.cardEntries). Tug's own mob cards are drawn from tugState.dock.mobs.
function tugUpdateCardStates() {
  if (!tugState || !pixiState.ready || !pixiState.cardEntries.length) {
    return;
  }
  tugModeApplyChrome();
}

// buildCardDetailLines' answer in tug (its first line routes here while state.mode === "tug"): null for every id, so
// no card detail panel opens in tug (the panel covers the lane in a live match).
function tugCardDetailLines(_id) {
  return null;
}

// ---------------------------------------------------------------------------------------------------- audio

// A turret shot (tug-pixi.js sees its cooldown restart): that colour's classic fire sound, at most one per colour per
// TUG_MODE_SHOT_SFX_GAP. Both sides' turrets play, as classic's towers do.
function tugOnShot(side, colourId) {
  if (!tugState || tugState.over || !colourId) {
    return;
  }
  if (tugModeSfxReady(colourId, TUG_MODE_SHOT_SFX_GAP)) {
    playTowerFireSfx(colourId);
  }
}
