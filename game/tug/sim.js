// Line Tower Wars greybox prototype: the whole simulation. No DOM, no timers, no Math.random (seeded mulberry32 only).
// Control rules reproduce atw-dev/www/game (12-rounds.js, 14-battle.js, 16-effects.js, 10-match.js, 11-cards.js);
// every candidate fix is a key in rules.js PROTO_RULES and defaults to the shipped behaviour.
// rules.mode "evolves" (plan .plans/ltw-proto-evolves-mode.md) swaps the economy and spawn model: free portal spawns on a
// timer, kill mana, portal and in-place tower upgrades, a gate per side, contact explosions, a 30 s battle clock. It
// branches on match.evo; the combat code is shared, and every classic path behaves exactly as before.
// rules.mode "tug" (plans .plans/ltw-proto-tug-mode.md, .plans/ltw-proto-tug-pass2.md, .plans/ltw-proto-tug-pass3.md,
// .plans/ltw-proto-tug-pass4.md, .plans/ltw-proto-tug-pass5.md, .plans/ltw-proto-tug-pass7.md) is real time on one
// shared lane: no prep and no rounds (phase "live" from createMatch). The economy is gold, earned by kills (any
// killer: a mob, a turret's shot, splash or chain, the gate gun; a destroyed turret pays its price + a bonus + a bonus
// per level) plus a slow drip (gold.dripSeconds); queueMob pays and puts a mob in a build queue (every mob trains at
// once while queue.parallel, else one at a time), and cancelMob takes back a queued mob that is not yet training (any
// queued mob while queue.parallel) for a full refund. The one tower is the turret:
// placeTower builds one on an empty slot at any moment (the tower id is ignored), under construction for
// turret.buildSeconds (no shots, full hp, killable only by a mob with hitsBuilding while turret.buildSafe is on), and a destroyed one leaves its slot as rubble for
// build.rubbleSeconds (slotState: empty / rubble / building / tower); removeTower takes one off. Every turret has an
// XP bar that fills from kills and its own damage (xp.perDamage) and, when full, offers traits (tugDrawOffer, with
// the Heal rule); a pick (pickUpgrade) takes one rank and tugApplyTraits recomputes every derived stat from the plain
// turret and the ranks.
// Mobs move in frame px and fight enemy mobs, turrets (which have hp) and the gate; gate guns; a safety clock (the
// higher gate wins, equal is a draw; with time.overtime "crumble" the match goes on instead and both gates lose
// time.crumbleHpPerSecond until one falls). match.tug is the merged number table (PROTO_TUG + rules.tugOverrides) and every
// tug branch reads it; tug has its own tower fire, projectiles and statuses, so the shared combat code is classic's and
// evolves' alone.
// Positions are kept normalised (x / 420, y / 760) as atw-dev does; anything handed to a drawer is in frame px.

const ProtoSim = (function () {
  "use strict";

  const RULES = typeof ProtoRules !== "undefined" ? ProtoRules : require("./rules.js");
  const DEFAULT_RULES = RULES.PROTO_RULES;
  const TOWERS = RULES.PROTO_TOWERS;
  const CREEPS = RULES.PROTO_CREEPS;
  const LEVELS = RULES.PROTO_LEVEL_RULES;
  const COUNTERS = RULES.PROTO_COUNTERS;
  const GEO = RULES.PROTO_GEOMETRY;
  const K = RULES.PROTO_CONSTANTS;
  const EV = RULES.PROTO_EVOLVES;
  const TUG = RULES.PROTO_TUG;

  const W = GEO.width;
  const H = GEO.height;
  const SIDES = ["player", "ai"];
  const BATTLE_DT = 1 / 30;
  const GUARD_STEPS = 20000;
  const TUG_GATE_LOG_STEP = 10;      // tug logs a gate hit each time the gate's lost hp crosses a multiple of this
  const TUG_ATTACK_FLASH = 0.15;     // tug snapshot: a unit is "attacking" for this long after a hit
  const TUG_MELEE_REACH = 40;        // tug: a mob with reach <= this is melee (combat.structureReachMelee on towers)
  const TUG_COLUMN_LATERAL_PX = 20;  // tug column spacing: an ally ahead counts when within this many px across
  const TUG_HIT_SECONDS = 0.6;       // tug: match.hits keeps damage and gold events this long (the page's damage numbers and gold popups)
  const TUG_TRAIT_KINDS = ["range", "rate", "hp", "dmg", "splash", "slow", "multi", "heavy"]; // tug turret traits (match.tug.traits), in the order the offer pool is built before its shuffle
  const TUG_DOMINANT_ORDER = ["splash", "slow", "multi", "heavy", "dmg", "rate", "range", "hp"]; // tug snapshot: rank ties for dominant and badges go to the earlier trait
  const TUG_TRAIT_LETTER = { range: "R", rate: "F", hp: "H", dmg: "D", splash: "S", slow: "L", multi: "M", heavy: "B" }; // tug snapshot badges ("S2")
  const TUG_TRAIT_COLOR = { splash: "#dc2626", slow: "#eab308", multi: "#2563eb", heavy: "#22c55e" }; // tug turret tint by dominant trait
  const TUG_TURRET_COLOR = "#6b7280"; // tug turret tint with any other dominant trait, or none
  const TUG_TURRET_ID = "turret";     // tug: the one tower's id (snapshot, projectiles)
  const TUG_TURRET_NAME = "Turret";   // tug: its name in the log
  const TUG_STACK_PX = 25;           // tug snapshot: a unit's stack = allies within this many px, itself included
  const TUG_GATE_GUN_COLOR = "#94a3b8";
  const SIDE_LABEL = { player: "Player", ai: "AI" };

  const TOWER_BY_ID = {};
  for (const t of TOWERS) TOWER_BY_ID[t.id] = t;
  const CREEP_BY_ID = {};
  for (const c of CREEPS) CREEP_BY_ID[c.id] = c;

  // atw-dev towerPosPlayer / towerPosAI (normalised).
  const TOWER_POS = {
    player: GEO.towerPosPx.player.map((p) => ({ x: p.x / W, y: p.y / H })),
    ai: GEO.towerPosPx.ai.map((p) => ({ x: p.x / W, y: p.y / H }))
  };
  // Frame px copies for drawers.
  const towerPositions = {
    player: GEO.towerPosPx.player.map((p) => ({ x: p.x, y: p.y })),
    ai: GEO.towerPosPx.ai.map((p) => ({ x: p.x, y: p.y }))
  };

  // Lanes (normalised). Classic: atw-dev's lanes. Evolves: a side's own portal straight to the enemy gate line.
  const LANES_CLASSIC = { starts: GEO.laneStarts, ends: GEO.laneEnds };
  const LANES_EVOLVES = {
    starts: {
      player: { x: EV.portalPos.player.x / W, y: EV.portalPos.player.y / H },
      ai: { x: EV.portalPos.ai.x / W, y: EV.portalPos.ai.y / H }
    },
    ends: {
      player: { x: EV.portalPos.player.x / W, y: EV.gateY.ai / H },
      ai: { x: EV.portalPos.ai.x / W, y: EV.gateY.player / H }
    }
  };
  const UPGRADE_KINDS = ["damage", "rate", "range", "hp"];
  const PORTAL_KINDS = ["evolve", "faster", "more"];

  // ---------------------------------------------------------------- helpers

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function other(side) {
    return side === "player" ? "ai" : "player";
  }

  function isSide(side) {
    return side === "player" || side === "ai";
  }

  function fail(reason) {
    return { ok: false, reason };
  }

  // Tug lines carry the match clock instead of the round.
  function addLog(match, text) {
    if (match.tug) {
      match.log.push(`${match.clock.toFixed(1)}s ${text}`);
      return;
    }
    const t = match.phase === "battle" ? ` ${match.battleTime.toFixed(1)}s` : "";
    match.log.push(`R${match.round}${t} ${text}`);
  }

  // Coerce a partial or string-valued rules object onto the defaults (keeps unknown keys as given). An object-valued
  // default (tugOverrides) passes a plain object through as given; a JSON string is parsed; anything else becomes {}.
  function normaliseRules(input) {
    const out = Object.assign({}, DEFAULT_RULES);
    if (!input || typeof input !== "object") return out;
    for (const key of Object.keys(input)) {
      const value = input[key];
      const def = DEFAULT_RULES[key];
      if (typeof def === "number") {
        const n = Number(value);
        out[key] = Number.isFinite(n) ? n : def;
      } else if (typeof def === "boolean") {
        out[key] = value === true || value === "true" || value === 1 || value === "1";
      } else if (isPlainObject(def)) {
        let v = value;
        if (typeof v === "string") {
          try { v = JSON.parse(v); } catch (err) { v = null; }
        }
        out[key] = isPlainObject(v) ? v : {};
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // Tug overrides: a string that reads as a number becomes the number; "true" / "false" become booleans where the
  // table holds a boolean. Inside a replaced array or object every numeric string is coerced the same way.
  function tugCoerceLeaf(base, v) {
    if (typeof v !== "string") return v;
    if (typeof base === "boolean" && (v === "true" || v === "false")) return v === "true";
    const t = v.trim();
    if (t !== "" && Number.isFinite(Number(t))) return Number(t);
    return v;
  }

  function tugCloneCoerced(v) {
    if (Array.isArray(v)) return v.map(tugCloneCoerced);
    if (isPlainObject(v)) {
      const out = {};
      for (const key of Object.keys(v)) out[key] = tugCloneCoerced(v[key]);
      return out;
    }
    return tugCoerceLeaf(undefined, v);
  }

  // Deep merge over into base (mutates base): plain objects merge key by key, arrays and anything else replace whole.
  function tugMergeInto(base, over) {
    for (const key of Object.keys(over)) {
      const v = over[key];
      if (isPlainObject(v) && isPlainObject(base[key])) tugMergeInto(base[key], v);
      else if (Array.isArray(v) || isPlainObject(v)) base[key] = tugCloneCoerced(v);
      else base[key] = tugCoerceLeaf(base[key], v);
    }
    return base;
  }

  // The tug number table for one match: a fresh copy of PROTO_TUG with the overrides deep-merged over it.
  function buildTugTable(overrides) {
    const table = tugCloneCoerced(TUG);
    if (isPlainObject(overrides)) tugMergeInto(table, overrides);
    return table;
  }

  function counterMultiplier(match, towerId, creepId) {
    if (!match.rules.counters) return 1;
    const row = COUNTERS[towerId];
    if (!row) return 1; // the tank's gun has no counter row
    const m = row[creepId];
    return Number.isFinite(m) ? m : 1;
  }

  // --------------------------------------------------------------- positions

  // 14-battle.js:6-23 attackerPosition, verbatim (normalised units). The lane comes from the mode: the explicit mode
  // argument when given, else the unit's own (evolves units carry evolves: true).
  function attackerPositionNorm(unit, side, mode) {
    const lane = side || unit.owner;
    const evo = mode ? mode === "evolves" : unit.evolves === true;
    const lanes = evo ? LANES_EVOLVES : LANES_CLASSIC;
    const start = lanes.starts[lane];
    const end = lanes.ends[lane];
    const p = clamp(unit.progress, 0, 1);
    const baseX = start.x + (end.x - start.x) * p;
    const baseY = start.y + (end.y - start.y) * p;
    const spread = 0.39 - 0.05 * p;
    const sway = Math.sin((p * Math.PI * 2) + unit.id * 0.37) * 0.025 * (1 - 0.5 * p);
    let x = baseX + unit.fanSeed * spread + sway;
    const yFan = (0.01 + 0.018 * p) * unit.fanSeed;
    const y = clamp(baseY + yFan, 0.04, 0.96);
    x = clamp(x, 0.05, 0.95);
    return { x, y };
  }

  // Positions only change when progress does, so each unit caches its normalised position after it moves.
  function refreshPosition(unit) {
    const pos = attackerPositionNorm(unit);
    unit.nx = pos.x;
    unit.ny = pos.y;
  }

  function unitPosition(unit, side, mode) {
    const pos = attackerPositionNorm(unit, side, mode);
    return { x: pos.x * W, y: pos.y * H };
  }

  // The distance used for range checks: normalised hypot (shipped) or with dy scaled to px parity (trueRange).
  function rangeVector(match, fromX, fromY, toX, toY) {
    const vx = toX - fromX;
    let vy = toY - fromY;
    if (match.rules.trueRange) vy *= H / W;
    return { vx, vy, dist: Math.hypot(vx, vy) };
  }

  // ------------------------------------------------------------------ towers

  function levelRule(towerId) {
    return LEVELS[towerId] || { maxLevel: 1, damagePerLevel: 1, rangePerLevel: 1, fireRatePerLevel: 1, iconScalePerLevel: 1 };
  }

  function maxLevelOf(towerId) {
    return Math.max(1, levelRule(towerId).maxLevel || 1);
  }

  function towerMaxHp(def, level) {
    return (K.kamikazeHpBase + def.cost) * Math.pow(K.kamikazeHpLevelMultiplier, level - 1);
  }

  // 10-match.js:102-146 createTowerInstance (shop upgrades are dead code in the live game, so the upgrade multiplier is 1).
  // base holds the def's numbers at this level; recomputeTower derives damage / range / fireRate / maxHp from it.
  function buildTower(def, level, rules) {
    const rule = levelRule(def.id);
    const safeLevel = clamp(Math.floor(level), 1, maxLevelOf(def.id));
    const levelSteps = safeLevel - 1;
    const slowDurationPerLevel = rule.slowDurationPerLevel || 1;
    const shrapnelDamagePerLevel = rule.shrapnelDamagePerLevel || 1;
    const poisonDotPerLevel = rule.poisonDotPerLevel || 1;
    const maxTargetsByLevel = rule.maxTargetsByLevel || null;
    const scaledMaxTargets = maxTargetsByLevel && Number.isFinite(maxTargetsByLevel[safeLevel])
      ? maxTargetsByLevel[safeLevel]
      : Math.max(1, def.maxTargets || 1);
    const coneDegrees = Number.isFinite(def.coneDegrees) ? def.coneDegrees : 130;
    const tower = {
      id: def.id,
      level: safeLevel,
      hp: 0,
      maxHp: 0,
      cooldown: 0,
      paid: 0,
      cost: def.cost,
      damage: 0,
      range: 0,
      fireRate: 0,
      slowDuration: def.id === "yellow" ? K.yellowSlowSeconds * Math.pow(slowDurationPerLevel, levelSteps) : 0,
      shrapnelDamageMultiplier: def.id === "red" ? Math.pow(shrapnelDamagePerLevel, levelSteps) : 1,
      poisonDotMultiplier: def.id === "green" ? Math.pow(poisonDotPerLevel, levelSteps) : 1,
      coneDegrees,
      coneHalfAngleCos: Math.cos((coneDegrees * Math.PI) / 360),
      maxTargets: Math.max(1, scaledMaxTargets),
      base: {
        damage: def.damage * Math.pow(rule.damagePerLevel, levelSteps),
        range: def.range * Math.pow(rule.rangePerLevel, levelSteps),
        fireRate: def.fireRate / Math.pow(rule.fireRatePerLevel, levelSteps),
        maxHp: towerMaxHp(def, safeLevel)
      },
      upgrades: { damage: 0, rate: 0, range: 0, hp: 0 } // evolves ranks; always 0 in classic
    };
    recomputeTower(tower, rules);
    tower.hp = tower.maxHp;
    return tower;
  }

  // Stats from base: evolves scales range by rangeScale and applies the upgrade ranks (damage and range multiply per
  // rank, rate divides fireRate, hp adds). Classic has scale 1 and no ranks, so x * 1, x / 1 and x + 0 leave every
  // number exactly as the base. Tug towers are built by makeTugTower instead. Does not touch current hp.
  function recomputeTower(tower, rules) {
    const mode = rules ? rules.mode : null;
    const scale = mode === "evolves" ? EV.rangeScale : 1;
    const up = EV.upgrades;
    const ranks = tower.upgrades;
    tower.damage = tower.base.damage * Math.pow(up.damage.mult, ranks.damage);
    tower.range = tower.base.range * scale * Math.pow(up.range.mult, ranks.range);
    tower.fireRate = tower.base.fireRate / Math.pow(up.rate.mult, ranks.rate);
    tower.maxHp = tower.base.maxHp + up.hp.add * ranks.hp;
    return tower;
  }

  // ------------------------------------------------------------------- match

  // tug is the match's merged tug table (null outside tug): it sets the slot count, start gold, gate and gun. Tug has no
  // mana (null) and adds gold, the build queue and its counters.
  function makeSide(rules, side, tug) {
    const evo = rules.mode === "evolves";
    const S = {
      mana: tug ? null : (evo ? EV.startMana : K.startMana),
      income: 0,          // permanent per-round bonus from sends (sendIncomePerCreep)
      score: 0,
      lives: tug ? tug.gate.hp : (evo ? EV.gateHp : rules.startLives), // evolves and tug: mirrors gate.hp
      towers: tug ? (Array.isArray(tug.slots[side]) ? tug.slots[side] : []).map(() => null) : [null, null, null, null, null],
      queue: [],          // creep ids added this prep
      roster: [],         // persistentMobs: every creep bought so far
      units: [],          // this side's creeps on the field (walking toward the other side's towers)
      pending: [],        // stream spawns not yet released: { releaseAt, defId, offset, fanSeed }
      // evolves only (null in classic): the free spawner and this side's gate
      portal: evo
        ? { tier: 0, interval: EV.startInterval, maxAlive: EV.startMaxAlive, fasterRank: 0, moreRank: 0, spawnTimer: 0 }
        : null,
      gate: evo
        ? { hp: EV.gateHp, maxHp: EV.gateHp, y: EV.gateY[side] }
        : (tug ? { hp: tug.gate.hp, maxHp: tug.gate.hp, y: tug.lane.gateY[side], gunCooldown: 0, attackers: 0 } : null)
    };
    if (tug) {
      const start = Number(tug.gold.start);
      Object.assign(S, {
        gold: Number.isFinite(start) ? Math.max(0, start) : 0, // no cap
        gateGoldBank: 0,  // fractional gate-pay progress: gate damage this side's mobs dealt not yet paid as whole gold (gold.perGateDamage)
        build: [],        // the build queue, head first: { defId, remaining (seconds left), seconds (its build time) }
        queued: 0,        // mobs this side put in the queue (a cancelled one counts)
        spawned: 0,       // mobs that left the queue and walked
        built: 0,         // turrets built
        rubble: (Array.isArray(tug.slots[side]) ? tug.slots[side] : []).map(() => 0) // seconds each slot stays rubble (refuses a turret) after its turret was destroyed; 0 = clear
      });
    }
    return S;
  }

  function createMatch(rules, seed) {
    const r = normaliseRules(rules);
    const n = Number(seed);
    const s = Number.isFinite(n) ? (Math.floor(n) >>> 0) : 1;
    const tugTable = r.mode === "tug" ? buildTugTable(r.tugOverrides) : null;
    const tug = tugTable !== null;
    const match = {
      rules: r,
      evo: r.mode === "evolves", // hoisted mode check; every evolves branch reads this
      tug: tugTable,             // tug: PROTO_TUG with rules.tugOverrides merged in, read by every tug branch; null elsewhere
      seed: s,
      rng: mulberry32(s),
      round: 1,
      maxRounds: tug ? 1 : K.maxRounds,
      phase: tug ? "live" : "prep", // tug has no prep: the match is live from the start
      clock: 0,                     // tug: match seconds so far; 0 elsewhere
      player: makeSide(r, "player", tugTable),
      ai: makeSide(r, "ai", tugTable),
      projectiles: [],
      bursts: [],
      log: [],
      result: null,
      battleTime: 0,
      nextUnitId: 1,
      nextProjectileId: 1,
      stats: {
        battles: 0,
        battleSeconds: 0,
        guardHits: 0,
        leaks: { player: 0, ai: 0 },          // creeps of that side that got through
        kills: { player: 0, ai: 0 },          // enemy creeps killed by that side's towers and tanks
        towersDestroyed: { player: 0, ai: 0 } // that side's towers lost to kamikaze
      }
    };
    if (match.evo) {
      Object.assign(match.stats, {
        spawned: { player: 0, ai: 0 },    // mobs that side's portal spawned
        explosions: { player: 0, ai: 0 }, // that side's mobs that exploded on an enemy tower
        gateHits: { player: 0, ai: 0 },   // that side's mobs that reached the enemy gate
        gateDamage: { player: 0, ai: 0 }, // gate damage that side dealt
        killMana: { player: 0, ai: 0 }    // mana that side earned from kills (after the cap)
      });
    }
    if (match.tug) {
      // towersDestroyed (above) keeps its meaning in tug: that side's towers lost, here to mob hits
      const perMob = () => { const o = {}; for (const c of CREEPS) o[c.id] = 0; return o; }; // one counter per mob id (imp, runner, ...)
      Object.assign(match.stats, {
        queued: { player: 0, ai: 0 },     // mobs that side put in its build queue
        spawned: { player: 0, ai: 0 },    // mobs that left that side's queue and walked
        built: { player: 0, ai: 0 },      // turrets that side built
        upgrades: { player: 0, ai: 0 },   // levels that side picked (a trait rank or a heal)
        turretDamage: { player: 0, ai: 0 }, // damage that side's turrets' own shots, splash and chain dealt to enemy mobs (overkill not counted)
        damageXp: { player: 0, ai: 0 },   // xp that damage put on that side's turret bars (xp.perDamage; none while ready and holding)
        mobKills: { player: 0, ai: 0 },   // enemy mobs killed by that side's mobs
        towerKills: { player: 0, ai: 0 }, // enemy mobs killed by that side's towers (shots, chains, splash)
        gunKills: { player: 0, ai: 0 },   // enemy mobs killed by that side's gate gun (kills = towerKills + gunKills)
        gateDamage: { player: 0, ai: 0 }, // gate damage that side dealt
        goldEarned: { player: 0, ai: 0 }, // gold that side earned (kills and drip; a sellRefund refund is not earned)
        goldSpent: { player: 0, ai: 0 },  // gold that side paid for mobs and towers (a cancelled mob's refund comes off it)
        goldBySource: { player: { mob: 0, turret: 0, gun: 0, gate: 0, drip: 0, other: 0 }, ai: { mob: 0, turret: 0, gun: 0, gate: 0, drip: 0, other: 0 } }, // goldEarned split by who earned it: that side's mobs, turrets, gate gun, gate damage (gold.perGateDamage), the drip (other = a kill with no known source; stays 0)
        mobDamage: { player: perMob(), ai: perMob() }, // hp that side's mobs of each id took off enemy mobs, turrets and the gate (overkill not counted)
        mobKillValue: { player: perMob(), ai: perMob() }, // gold the kills of that side's mobs of each id paid: enemy mobs and turrets; turret and gun kills are not a mob's
        mobGateDamage: { player: perMob(), ai: perMob() }, // gate hp that side's mobs of each id took off the enemy gate
        mobSpend: { player: perMob(), ai: perMob() },  // gold that side paid for each mob id (a cancelled mob's refund comes off it, like goldSpent)
        mobQueued: { player: perMob(), ai: perMob() }, // mobs of each id that side queued (a cancelled mob comes off it)
        mobSoak: { player: perMob(), ai: perMob() }, // raw turret and gun damage that side's mobs of each id took while another of its living mobs was also in the shooter's range (fire drawn away from an ally; the scorecard's soak credit)
        cancelled: { player: 0, ai: 0 },  // queued mobs that side cancelled (cancelMob)
        lostBuilding: { player: 0, ai: 0 }, // that side's towers destroyed while under construction (also in towersDestroyed)
        idleSeconds: 0                    // the longest stretch (s) both sides sat with gold below the cheapest mob and empty queues
      });
      match.idleRun = 0;             // the current such stretch (s)
      match.dripTimer = 0;           // seconds banked toward the next gold.dripSeconds payment (from match start)
      match.crumbleBank = 0;         // crumble overtime: hp banked toward the next whole point both gates lose (time.crumbleHpPerSecond x dt)
      match.crumbling = false;       // true once the clock passed time.matchSeconds with time.overtime "crumble"
      match.hits = [];               // the last TUG_HIT_SECONDS of events: { x, y, amount, side, age, kind } (kind "damage": side dealt it; "gold": side earned it)
      addLog(match, `live: ${tugTable.time.matchSeconds} s on the clock, gates ${tugTable.gate.hp}, gold ${tugNum(match.player.gold)}.`);
      return match;
    }
    addLog(match, "prep.");
    return match;
  }

  // ------------------------------------------------------------ prep actions

  // 11-cards.js:271-312 placePlayerTower: full card price; same id levels up to max; different id replaces.
  // Evolves: an occupied slot is always replaced by a fresh level 1 tower (no level 2), refund only by sellRefund.
  // Tug: a turret on an empty slot during the live phase, towerId ignored (placeTowerTug).
  function placeTower(match, side, slot, towerId) {
    if (match && match.tug) return placeTowerTug(match, side, slot, towerId);
    if (!match || match.phase !== "prep") return fail("not in prep");
    if (!isSide(side)) return fail("bad side");
    if (!Number.isInteger(slot) || slot < 0 || slot >= K.slotCount) return fail("bad slot");
    const def = TOWER_BY_ID[towerId];
    if (!def) return fail("unknown tower");
    const S = match[side];
    const existing = S.towers[slot];
    if (match.evo) {
      if (S.mana < def.cost) return fail("not enough mana");
      const refund = existing ? refundFor(match, existing) : 0;
      S.mana -= def.cost;
      if (refund > 0) S.mana = clamp(S.mana + refund, 0, K.manaCap);
      const fresh = buildTower(def, 1, match.rules);
      fresh.paid = def.cost;
      S.towers[slot] = fresh;
      return { ok: true, reason: existing ? (refund > 0 ? `replaced, refund ${refund}` : "replaced") : "placed" };
    }
    if (existing && existing.id === def.id && existing.level >= maxLevelOf(def.id)) return fail("max level");
    if (S.mana < def.cost) return fail("not enough mana");
    S.mana -= def.cost;
    if (existing && existing.id === def.id) {
      const tower = buildTower(def, existing.level + 1, match.rules);
      const fraction = existing.maxHp > 0 ? existing.hp / existing.maxHp : 1;
      tower.hp = tower.maxHp * fraction;
      tower.paid = existing.paid + def.cost;
      S.towers[slot] = tower;
      return { ok: true, reason: "levelled" };
    }
    const tower = buildTower(def, 1, match.rules);
    tower.paid = def.cost;
    S.towers[slot] = tower;
    return { ok: true, reason: existing ? "replaced" : "placed" };
  }

  // What a sale / removal / replacement gives back: the tower's total paid price x sellRefund, rounded down.
  function refundFor(match, tower) {
    return match.rules.sellRefund > 0 ? Math.floor(tower.paid * match.rules.sellRefund) : 0;
  }

  function sellTower(match, side, slot) {
    if (match && match.tug) return fail("not in tug");
    if (!match || match.phase !== "prep") return fail("not in prep");
    if (!isSide(side)) return fail("bad side");
    if (!Number.isInteger(slot) || slot < 0 || slot >= K.slotCount) return fail("bad slot");
    if (!(match.rules.sellRefund > 0)) return fail("selling is off");
    const S = match[side];
    const tower = S.towers[slot];
    if (!tower) return fail("empty slot");
    const refund = Math.floor(tower.paid * match.rules.sellRefund);
    S.mana = clamp(S.mana + refund, 0, K.manaCap);
    S.towers[slot] = null;
    return { ok: true, reason: `refund ${refund}` };
  }

  // 11-cards.js:328-347 queuePlayerAttacker.
  function queueCreep(match, side, creepId) {
    if (match && match.tug) return fail("not in tug");
    if (!match || match.phase !== "prep") return fail("not in prep");
    if (!isSide(side)) return fail("bad side");
    if (match.evo) return fail("no sends in evolves (the portal spawns for free)");
    const def = CREEP_BY_ID[creepId];
    if (!def) return fail("unknown creep");
    const S = match[side];
    if (S.mana < def.cost) return fail("not enough mana");
    S.mana -= def.cost;
    S.queue.push(def.id);
    S.income += match.rules.sendIncomePerCreep;
    return { ok: true, reason: "queued" };
  }

  // Not in the shipped game (a queued creep is final there); here a full refund that also takes back the send income.
  function unqueueCreep(match, side, creepId) {
    if (match && match.tug) return fail("not in tug");
    if (!match || match.phase !== "prep") return fail("not in prep");
    if (!isSide(side)) return fail("bad side");
    if (match.evo) return fail("no sends in evolves (the portal spawns for free)");
    const def = CREEP_BY_ID[creepId];
    if (!def) return fail("unknown creep");
    const S = match[side];
    const index = S.queue.lastIndexOf(def.id);
    if (index < 0) return fail("none queued");
    S.queue.splice(index, 1);
    S.mana = clamp(S.mana + def.cost, 0, K.manaCap);
    S.income -= match.rules.sendIncomePerCreep;
    return { ok: true, reason: "unqueued" };
  }

  // ------------------------------------------------- evolves prep actions

  function portalInterval(fasterRank) {
    return Math.max(EV.minInterval, EV.startInterval - EV.intervalStep * fasterRank);
  }

  // The price of a portal upgrade right now: { cost, reason }. cost null = maxed or not applicable; reason null = doable.
  function portalOffer(match, side, kind) {
    if (!match || !match.evo) return { cost: null, reason: "evolves mode only" };
    if (!isSide(side)) return { cost: null, reason: "bad side" };
    const S = match[side];
    const P = S.portal;
    let cost;
    if (kind === "evolve") {
      if (P.tier >= EV.tiers.length - 1 || !Number.isFinite(EV.evolveCosts[P.tier])) return { cost: null, reason: "max tier" };
      cost = EV.evolveCosts[P.tier];
    } else if (kind === "faster") {
      if (P.fasterRank >= EV.fasterMax || P.interval <= EV.minInterval) return { cost: null, reason: "max rank" };
      cost = EV.fasterCost;
    } else if (kind === "more") {
      if (P.moreRank >= EV.moreMax) return { cost: null, reason: "max rank" };
      cost = EV.moreCost;
    } else {
      return { cost: null, reason: "unknown portal upgrade" };
    }
    if (match.phase !== "prep") return { cost, reason: "not in prep" };
    if (S.mana < cost) return { cost, reason: "not enough mana" };
    return { cost, reason: null };
  }

  // The price of a tower action (an upgrade kind, "repair" or "remove") right now: { cost, reason } as portalOffer.
  function towerOffer(match, side, slot, kind) {
    if (!match || !match.evo) return { cost: null, reason: "evolves mode only" };
    if (!isSide(side)) return { cost: null, reason: "bad side" };
    if (!Number.isInteger(slot) || slot < 0 || slot >= K.slotCount) return { cost: null, reason: "bad slot" };
    const S = match[side];
    const tower = S.towers[slot];
    if (!tower) return { cost: null, reason: "empty slot" };
    let cost;
    if (kind === "repair") {
      if (tower.hp >= tower.maxHp) return { cost: null, reason: "full hp" };
      cost = EV.repairCost;
    } else if (kind === "remove") {
      cost = 0;
    } else if (UPGRADE_KINDS.indexOf(kind) >= 0) {
      const up = EV.upgrades[kind];
      if (tower.upgrades[kind] >= up.max) return { cost: null, reason: "max rank" };
      cost = up.cost;
    } else {
      return { cost: null, reason: "unknown upgrade" };
    }
    if (match.phase !== "prep") return { cost, reason: "not in prep" };
    if (S.mana < cost) return { cost, reason: "not enough mana" };
    return { cost, reason: null };
  }

  // Evolves: "evolve" moves the portal to the next tier, "faster" takes intervalStep off the spawn interval, "more"
  // raises maxAlive by moreStep.
  function upgradePortal(match, side, kind) {
    if (match && match.tug) return fail("not in tug");
    if (PORTAL_KINDS.indexOf(kind) < 0) return fail("unknown portal upgrade");
    const offer = portalOffer(match, side, kind);
    if (offer.reason) return fail(offer.reason);
    const S = match[side];
    const P = S.portal;
    S.mana -= offer.cost;
    if (kind === "evolve") {
      P.tier += 1;
      return { ok: true, reason: `evolved to ${CREEP_BY_ID[EV.tiers[P.tier]].name}` };
    }
    if (kind === "faster") {
      P.fasterRank += 1;
      P.interval = portalInterval(P.fasterRank);
      return { ok: true, reason: `faster: every ${P.interval.toFixed(1)} s` };
    }
    P.moreRank += 1;
    P.maxAlive = EV.startMaxAlive + EV.moreStep * P.moreRank;
    return { ok: true, reason: `more: max ${P.maxAlive} alive` };
  }

  // Evolves: one rank of damage / rate / range / hp on a placed tower. An hp rank also heals by the hp it adds.
  function upgradeTower(match, side, slot, kind) {
    if (match && match.tug) return fail("not in tug");
    if (UPGRADE_KINDS.indexOf(kind) < 0) return fail("unknown upgrade");
    const offer = towerOffer(match, side, slot, kind);
    if (offer.reason) return fail(offer.reason);
    const S = match[side];
    const tower = S.towers[slot];
    S.mana -= offer.cost;
    tower.paid += offer.cost;
    tower.upgrades[kind] += 1;
    recomputeTower(tower, match.rules);
    if (kind === "hp") tower.hp = Math.min(tower.maxHp, tower.hp + EV.upgrades.hp.add);
    return { ok: true, reason: `${kind} rank ${tower.upgrades[kind]}` };
  }

  // Evolves: restore a damaged tower to max hp for repairCost.
  function repairTower(match, side, slot) {
    if (match && match.tug) return fail("not in tug");
    const offer = towerOffer(match, side, slot, "repair");
    if (offer.reason) return fail(offer.reason);
    const S = match[side];
    const tower = S.towers[slot];
    S.mana -= offer.cost;
    tower.hp = tower.maxHp;
    return { ok: true, reason: "repaired" };
  }

  // Evolves: take a tower off its slot for free; gives back paid x sellRefund (0 by default). Tug: the same, live.
  function removeTower(match, side, slot) {
    if (match && match.tug) return removeTowerTug(match, side, slot);
    const offer = towerOffer(match, side, slot, "remove");
    if (offer.reason) return fail(offer.reason);
    const S = match[side];
    const refund = refundFor(match, S.towers[slot]);
    if (refund > 0) S.mana = clamp(S.mana + refund, 0, K.manaCap);
    S.towers[slot] = null;
    return { ok: true, reason: refund > 0 ? `removed, refund ${refund}` : "removed" };
  }

  // Evolves price list for the page: every portal upgrade and, when slot holds a tower, every tower action, each as
  // { cost, available, reason, ... }. cost null = maxed or not applicable; available = doable right now. null in classic.
  function evolvesCosts(match, side, slot) {
    if (!match || !match.evo || !isSide(side)) return null;
    const S = match[side];
    const P = S.portal;
    const entry = (offer, extra) => Object.assign({ cost: offer.cost, available: offer.reason === null, reason: offer.reason }, extra);
    const portal = {
      evolve: entry(portalOffer(match, side, "evolve"), {
        tier: EV.tiers[P.tier],
        nextTier: P.tier + 1 < EV.tiers.length ? EV.tiers[P.tier + 1] : null,
        rank: P.tier,
        max: EV.tiers.length - 1
      }),
      faster: entry(portalOffer(match, side, "faster"), { rank: P.fasterRank, max: EV.fasterMax, interval: P.interval }),
      more: entry(portalOffer(match, side, "more"), { rank: P.moreRank, max: EV.moreMax, maxAlive: P.maxAlive })
    };
    const hasSlot = Number.isInteger(slot) && slot >= 0 && slot < K.slotCount;
    const t = hasSlot ? S.towers[slot] : null;
    const none = { cost: null, reason: hasSlot ? "empty slot" : "no slot" };
    const tower = {};
    for (const kind of UPGRADE_KINDS) {
      tower[kind] = entry(t ? towerOffer(match, side, slot, kind) : none, { rank: t ? t.upgrades[kind] : 0, max: EV.upgrades[kind].max });
    }
    tower.repair = entry(t ? towerOffer(match, side, slot, "repair") : none, { hp: t ? t.hp : 0, maxHp: t ? t.maxHp : 0 });
    tower.remove = entry(t ? towerOffer(match, side, slot, "remove") : none, { refund: t ? refundFor(match, t) : 0 });
    return { mana: S.mana, slot: hasSlot ? slot : null, towerId: t ? t.id : null, portal, tower };
  }

  // ---------------------------------------------------- tug live actions

  // Tug slots: the count is the length of that side's slots list in match.tug (4 by the sheet; 5 in classic and evolves).
  function slotCount(match, side) {
    if (match && match.tug && isSide(side)) return match[side].towers.length;
    return K.slotCount;
  }

  function isTugSlot(match, side, slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < match[side].towers.length;
  }

  // Tug: a side's slots as { x, y, row } frame px copies (null outside tug or for a bad side).
  function tugSlots(match, side) {
    if (!match || !match.tug || !isSide(side)) return null;
    return match.tug.slots[side].map((p) => ({ x: p.x, y: p.y, row: p.row }));
  }

  // Tug: what a slot holds: "tower" (finished), "building" (under construction), "rubble" (its tower was destroyed
  // less than build.rubbleSeconds ago; refuses a tower) or "empty". null outside tug or for a bad side or slot.
  function slotState(match, side, slot) {
    if (!match || !match.tug || !isSide(side) || !isTugSlot(match, side, slot)) return null;
    const S = match[side];
    const tower = S.towers[slot];
    if (tower) return tower.building ? "building" : "tower";
    return S.rubble[slot] > 0 ? "rubble" : "empty";
  }

  // Seconds a new turret stays under construction (turret.buildSeconds); 0 (instant) when missing or not > 0.
  function tugBuildSeconds(match) {
    const v = Number(isPlainObject(match.tug.turret) ? match.tug.turret.buildSeconds : NaN);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // Seconds a slot stays rubble after its tower is destroyed (build.rubbleSeconds); 0 (off) when missing or not > 0.
  function tugRubbleSeconds(match) {
    const v = Number(match.tug.build.rubbleSeconds);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // Tug: what a turret costs side: turret.cost, fixed (no ramp); null when it is not a finite number, 0 when below 0.
  // side is checked but does not change the price; a tower id passed third is ignored (there is one tower).
  function tugTowerPrice(match, side) {
    if (!match || !match.tug || !isSide(side) || !isPlainObject(match.tug.turret)) return null;
    const cost = Number(match.tug.turret.cost);
    if (!Number.isFinite(cost)) return null;
    return Math.max(0, cost);
  }

  // A trait knob (match.tug.traits[kind][key]) as a finite number, or fallback when missing or not a number.
  function tugTraitNum(match, kind, key, fallback) {
    const row = isPlainObject(match.tug.traits) ? match.tug.traits[kind] : null;
    const v = Number(isPlainObject(row) ? row[key] : NaN);
    return Number.isFinite(v) ? v : fallback;
  }

  // The ranks a turret can take in a trait (traits[kind].cap, a whole number >= 0; 0 when missing).
  function tugTraitCap(match, kind) {
    return Math.max(0, Math.floor(tugTraitNum(match, kind, "cap", 0)));
  }

  // Every derived stat of a turret, recomputed from its plain base (tower.base, copied from turret at build) and its
  // trait ranks (tower.traits); called after every pick. range = base x (1 + range.pct x rank); rate = base x
  // rate.mult^rank, then x heavy.rateMult once at heavy >= 1; maxHp = base x (1 + hp.pct x rank) (hp is not raised
  // here: an hp pick sets it to maxHp; it is only clamped to maxHp); dmg = base + dmg.add x rank + heavy.add x heavy
  // rank; targets = base + multi.add x rank; targeting highestHp at heavy >= 1, else the base's; splashPx 0 below
  // splash 1, else px + pxPerRank x (rank - 1); slow null below slow 1, else { move: f, attack: f, seconds, chainPx (0
  // below chainAtRank), chainFraction } with f = factor - factorPerRank x (rank - 1), kept in 0..1. The cooldown is
  // clamped to the new rate. Returns the tower.
  function tugApplyTraits(match, tower) {
    const b = tower.base;
    const r = tower.traits;
    const n = (kind, key, fallback) => tugTraitNum(match, kind, key, fallback);
    tower.range = Math.max(0, b.range * (1 + n("range", "pct", 0) * r.range));
    const rateMult = n("rate", "mult", 1);
    let rate = b.rate * Math.pow(rateMult > 0 ? rateMult : 1, r.rate);
    if (r.heavy >= 1) {
      const heavyMult = n("heavy", "rateMult", 1);
      rate *= heavyMult > 0 ? heavyMult : 1;
    }
    tower.rate = rate;
    tower.maxHp = Math.max(1, b.hp * (1 + n("hp", "pct", 0) * r.hp));
    tower.hp = Math.min(tower.hp, tower.maxHp);
    tower.dmg = Math.max(0, b.dmg + n("dmg", "add", 0) * r.dmg + n("heavy", "add", 0) * r.heavy);
    tower.targets = Math.max(1, Math.floor(b.targets + n("multi", "add", 0) * r.multi));
    tower.targeting = r.heavy >= 1 ? "highestHp" : b.targeting;
    tower.splashPx = r.splash >= 1 ? Math.max(0, n("splash", "px", 0) + n("splash", "pxPerRank", 0) * (r.splash - 1)) : 0;
    if (r.slow >= 1) {
      const f = clamp(n("slow", "factor", 1) - n("slow", "factorPerRank", 0) * (r.slow - 1), 0, 1);
      tower.slow = {
        move: f,
        attack: f,
        seconds: Math.max(0, n("slow", "seconds", 0)),
        chainPx: r.slow >= n("slow", "chainAtRank", Infinity) ? Math.max(0, n("slow", "chainPx", 0)) : 0,
        chainFraction: Math.max(0, n("slow", "chainFraction", 0))
      };
    } else {
      tower.slow = null;
    }
    tower.cooldown = Math.min(tower.cooldown, tower.rate);
    return tower;
  }

  // XP a turret needs for its next level: xp.need.base + xp.need.perLevel x the levels it already took (>= 0).
  function tugXpNeed(match, level) {
    const need = match.tug.xp.need;
    const base = Number(need.base);
    const per = Number(need.perLevel);
    return Math.max(0, (Number.isFinite(base) ? base : 0) + (Number.isFinite(per) ? per : 0) * level);
  }

  // A turret from match.tug.turret: the plain gun (range px from its slot, rate seconds per shot) at rank 0 in every
  // trait with an empty XP bar; base keeps the plain stats and tugApplyTraits derives the rest from base + traits.
  // With turret.buildSeconds > 0 it starts under construction at full hp (the build is only a timer; damage taken during it comes off hp); instant at 0.
  function makeTugTower(match, paid) {
    const spec = isPlainObject(match.tug.turret) ? match.tug.turret : {};
    const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
    const hp = num(spec.hp, 0) > 0 ? num(spec.hp, 0) : 1;
    const seconds = tugBuildSeconds(match);
    const startHp = hp;
    const tower = {
      id: TUG_TURRET_ID,
      level: 0,            // levels taken (a trait rank or a heal)
      hp: startHp,
      maxHp: hp,
      // under construction (no shots; null once up or when instant): remaining / seconds of the build. It starts at
      // full hp (the build is only a timer); damage taken during the build comes off hp, never off reached
      building: seconds > 0 ? { remaining: seconds, seconds, reached: startHp } : null,
      dmg: 0,              // derived (tugApplyTraits) from here to slow
      rate: 0,
      range: 0,
      targets: 1,
      targeting: "nearest",
      slow: null,
      splashPx: 0,
      cooldown: 0,
      paid,
      cost: paid,
      attackers: 0,        // enemy mobs attacking it this tick (combat.engagementWidth caps it)
      xp: 0,               // xp on the bar
      need: tugXpNeed(match, 0),
      traits: { range: 0, rate: 0, hp: 0, dmg: 0, splash: 0, slow: 0, multi: 0, heavy: 0 }, // ranks taken per trait
      ready: false,        // the bar is full: a level waits to be picked (pickUpgrade)
      offer: null,         // while ready: the traits on offer, e.g. ["splash", "heal", "rate"], or ["heal"]
      base: {              // the plain turret, copied at build: what tugApplyTraits starts from
        hp,
        dmg: num(spec.dmg, 0),
        rate: num(spec.rate, 1),
        range: num(spec.range, 0),
        targets: Math.max(1, Math.floor(num(spec.targets, 1)) || 1),
        targeting: typeof spec.targeting === "string" ? spec.targeting : "nearest"
      }
    };
    return tugApplyTraits(match, tower);
  }

  // Tug: build a turret on an empty slot at tugTowerPrice any time during the live phase; towerId is ignored (any value,
  // undefined too). Refused on rubble ("rubble"), on a turret under construction ("under construction"), on a finished
  // turret ("occupied"; a tap on it selects it on the page) and when gold is short ("not enough gold"). The turret is
  // under construction for turret.buildSeconds ("started Turret (slot 1) for 4, 4 s" in the log), or up at once when
  // that is 0 ("built").
  function placeTowerTug(match, side, slot) {
    if (match.phase !== "live") return fail("not live");
    if (!isSide(side)) return fail("bad side");
    if (!isTugSlot(match, side, slot)) return fail("bad slot");
    const cost = tugTowerPrice(match, side);
    if (cost === null) return fail("unknown tower");
    const S = match[side];
    const existing = S.towers[slot];
    if (S.rubble[slot] > 0) return fail("rubble");
    if (existing && existing.building) return fail("under construction");
    if (existing) return fail("occupied");
    if (S.gold < cost) return fail("not enough gold");
    S.gold -= cost;
    match.stats.goldSpent[side] += cost;
    const tower = makeTugTower(match, cost);
    S.towers[slot] = tower;
    S.built += 1;
    match.stats.built[side] += 1;
    if (tower.building) {
      addLog(match, `${SIDE_LABEL[side]} started ${TUG_TURRET_NAME} (slot ${slot + 1}) for ${tugNum(cost)}, ${tugNum(tower.building.seconds)} s.`);
    } else {
      addLog(match, `${SIDE_LABEL[side]} built ${TUG_TURRET_NAME} (slot ${slot + 1}) for ${tugNum(cost)}.`);
    }
    return { ok: true, reason: "placed" };
  }

  // Tug: take a turret off its slot for free during the live phase (its xp and trait ranks are gone; one under
  // construction too); gives back paid x sellRefund into gold (0 by default; not counted as earned). Leaves no rubble.
  function removeTowerTug(match, side, slot) {
    if (match.phase !== "live") return fail("not live");
    if (!isSide(side)) return fail("bad side");
    if (!isTugSlot(match, side, slot)) return fail("bad slot");
    const S = match[side];
    const tower = S.towers[slot];
    if (!tower) return fail("empty slot");
    const refund = refundFor(match, tower);
    if (refund > 0) S.gold += refund;
    S.towers[slot] = null;
    return { ok: true, reason: refund > 0 ? `removed, refund ${refund}` : "removed" };
  }

  // Tug: pay costs.mob and the mob joins the back of side's build queue with build[creepId] seconds to train (with
  // queue.parallel it starts training at once, else when it reaches the head; it walks when stepTugQueue finishes it).
  // Refused when the queue holds queue.max mobs or gold is short.
  function queueMob(match, side, creepId) {
    if (!match || !match.tug) return fail("tug mode only");
    if (match.phase !== "live") return fail("not live");
    if (!isSide(side)) return fail("bad side");
    const def = CREEP_BY_ID[creepId];
    if (!def || !match.tug.mobs[def.id]) return fail("unknown creep");
    const cost = match.tug.costs.mob[def.id];
    if (!Number.isFinite(cost)) return fail("unknown creep");
    const S = match[side];
    if (!(S.build.length < Math.floor(Number(match.tug.queue.max)))) return fail("queue full");
    if (S.gold < cost) return fail("not enough gold");
    const t = Number(match.tug.build[def.id]);
    const seconds = Number.isFinite(t) && t > 0 ? t : 0;
    S.gold -= cost;
    match.stats.goldSpent[side] += cost;
    match.stats.mobSpend[side][def.id] += cost;
    match.stats.mobQueued[side][def.id] += 1;
    S.build.push({ defId: def.id, remaining: seconds, seconds });
    S.queued += 1;
    match.stats.queued[side] += 1;
    addLog(match, `${SIDE_LABEL[side]} queued ${def.name}.`);
    return { ok: true, reason: "queued" };
  }

  // Tug: take the queued mob at index out of side's build queue and refund costs.mob in full. While queue.parallel
  // (2026-10-16) every entry is training and any index can be cancelled; otherwise the head (index 0) is training and
  // cannot be cancelled ("training"), so index is 1 .. build.length - 1. The refund comes off stats.goldSpent, so
  // gold = gold.start + goldEarned - goldSpent still holds; stats.cancelled counts it.
  function cancelMob(match, side, index) {
    if (!match || !match.tug) return fail("tug mode only");
    if (match.phase !== "live") return fail("not live");
    if (!isSide(side)) return fail("bad side");
    const S = match[side];
    if (!Number.isInteger(index) || index < 0 || index >= S.build.length) return fail("bad index");
    if (index === 0 && !tugQueueParallel(match)) return fail("training");
    const entry = S.build.splice(index, 1)[0];
    const cost = Number(match.tug.costs.mob[entry.defId]);
    const refund = Number.isFinite(cost) && cost > 0 ? cost : 0;
    S.gold += refund;
    match.stats.goldSpent[side] -= refund;
    match.stats.mobSpend[side][entry.defId] -= refund;
    match.stats.mobQueued[side][entry.defId] -= 1;
    match.stats.cancelled[side] += 1;
    addLog(match, `${SIDE_LABEL[side]} cancelled ${CREEP_BY_ID[entry.defId].name}${tugGoldNote(refund)}.`);
    return { ok: true, reason: "cancelled" };
  }

  // "Player Turret (slot 2)" for the log.
  function tugTowerLabel(side, slot) {
    return `${SIDE_LABEL[side]} ${TUG_TURRET_NAME} (slot ${slot + 1})`;
  }

  // Fisher-Yates in place with match.rng (one draw per entry after the first).
  function tugShuffle(match, list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(match.rng() * (i + 1));
      const swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  // An upgrade threshold (upgrade.healAlways / healPool) as a finite number; fallback when missing or not a number.
  function tugUpgradeNum(match, key, fallback) {
    const v = Number(isPlainObject(match.tug.upgrade) ? match.tug.upgrade[key] : NaN);
    return Number.isFinite(v) ? v : fallback;
  }

  // xp.maxLevel as a finite number (tug pass 9); 0 when missing or not a number. 0 or less = no cap (pass 8).
  function tugMaxLevel(match) {
    const v = Number(match.tug.xp.maxLevel);
    return Number.isFinite(v) ? v : 0;
  }

  // Trait-slots (2026-10-08): upgrade.slots as a whole number >= 0, the distinct traits a turret may own; 0 = no limit.
  function tugSlotLimit(match) {
    return Math.max(0, Math.floor(tugUpgradeNum(match, "slots", 0)));
  }

  // Trait-slots: how many distinct traits the turret owns (rank 1 or more).
  function tugOwnedCount(tower) {
    return TUG_TRAIT_KINDS.filter((kind) => tower.traits[kind] > 0).length;
  }

  // Trait-slots: the traits an offer may draw from, in TUG_TRAIT_KINDS order (keeps the seeded shuffle stable). A trait
  // is eligible when below its cap and either already owned, or the turret owns fewer than upgrade.slots (0 = no limit).
  function tugEligible(match, tower) {
    const slots = tugSlotLimit(match);
    const owned = tugOwnedCount(tower);
    return TUG_TRAIT_KINDS.filter((kind) => tower.traits[kind] < tugTraitCap(match, kind)
      && (tower.traits[kind] > 0 || slots <= 0 || owned < slots));
  }

  // Trait-slots: the build is complete when no trait is eligible (every owned trait at its cap and the slots full, or all capped).
  function tugComplete(match, tower) {
    return tugEligible(match, tower).length === 0;
  }

  // Tug pass 9 + trait-slots: a turret at xp.maxLevel (when on) or with a complete build takes no more traits; its full
  // bar is a Heal charge (tugCheckReady, pickUpgrade).
  function tugMaxed(match, tower) {
    const max = tugMaxLevel(match);
    return (max > 0 && tower.level >= max) || tugComplete(match, tower);
  }

  // The offer for a turret whose bar just filled. Eligible (tugEligible) = the traits still below their caps (TUG_TRAIT_KINDS
  // order), limited to the ones already owned once the turret owns upgrade.slots distinct traits; none = ["heal"]. Else the pool is the eligible traits plus "heal" when hp / maxHp < upgrade.healPool, shuffled with
  // match.rng (Fisher-Yates from that fixed order, so a seed fixes the offer), and the first upgrade.offers (at least
  // 1) are taken. When hp / maxHp < upgrade.healAlways and "heal" is not among them, the last taken becomes "heal" and
  // the taken list is shuffled once more (so Heal's position is random). Entries are always distinct.
  function tugDrawOffer(match, tower) {
    const eligible = tugEligible(match, tower);
    if (eligible.length === 0) return ["heal"];
    const hpFrac = tower.maxHp > 0 ? tower.hp / tower.maxHp : 1;
    const pool = eligible.slice();
    if (hpFrac < tugUpgradeNum(match, "healPool", 0)) pool.push("heal");
    tugShuffle(match, pool);
    const count = Math.max(1, Math.floor(tugUpgradeNum(match, "offers", 1)) || 1);
    const taken = pool.slice(0, count);
    if (hpFrac < tugUpgradeNum(match, "healAlways", 0) && taken.indexOf("heal") < 0) {
      taken[taken.length - 1] = "heal";
      tugShuffle(match, taken);
    }
    return taken;
  }

  // A turret whose xp reached its need becomes ready: holding (xp.holdWhileReady) clamps xp to need, the offer is drawn.
  // A maxed turret (tugMaxed, tug pass 9) clamps the same way but becomes ready, with offer ["heal"] and no draw (no
  // rng), only while hp / maxHp < upgrade.healPool; at or above it the full bar waits, not ready, with no log line, and
  // the per-step tugReadySweep re-checks it once damage takes it below.
  function tugCheckReady(match, side, slot, tower) {
    if (tower.ready || !(tower.xp >= tower.need - 1e-9)) return;
    if (match.tug.xp.holdWhileReady) tower.xp = tower.need;
    if (tugMaxed(match, tower)) {
      const hpFrac = tower.maxHp > 0 ? tower.hp / tower.maxHp : 1;
      if (!(hpFrac < tugUpgradeNum(match, "healPool", 0))) return;
      tower.ready = true;
      tower.offer = ["heal"];
    } else {
      tower.ready = true;
      tower.offer = tugDrawOffer(match, tower);
    }
    const list = tower.offer.length > 1
      ? `${tower.offer.slice(0, -1).join(", ")} or ${tower.offer[tower.offer.length - 1]}`
      : tower.offer[0];
    addLog(match, `${tugTowerLabel(side, slot)} is ready: ${list}.`);
  }

  // XP onto one turret's bar; a ready turret earns nothing while xp.holdWhileReady (else the xp banks past the bar).
  function tugAddXp(match, side, slot, tower, amount) {
    if (!(amount > 0)) return;
    if (tower.ready && match.tug.xp.holdWhileReady) return;
    tower.xp += amount;
    tugCheckReady(match, side, slot, tower);
  }

  // Tug: pick one of a ready turret's offers (choice = an index into offer, or the trait id / "heal"). A trait takes one
  // rank (refused "max rank" at its cap, which an offer never holds) and tugApplyTraits recomputes the derived stats;
  // an hp pick also heals to the new max. heal: hp to max, no rank. Every pick is a level: xp back to 0 (holdWhileReady
  // false: the xp banked past the bar carries over), need recomputed, the bar may fill again at once. Tug pass 9: the
  // pick that reaches xp.maxLevel logs its line with " (max level)"; a maxed turret (tugMaxed) takes only "heal" (a
  // trait is refused "max level", which its ["heal"] offer never holds): hp to max, xp back to 0 (or the carry), level
  // and need unchanged, logged "healed to 40/40 (max level)."; it still counts in stats.upgrades. Trait-slots: a
  // complete build (tugComplete) is maxed too, refused "complete" for a trait and logged " (complete)".
  function pickUpgrade(match, side, slot, choice) {
    if (!match || !match.tug) return fail("tug mode only");
    if (match.phase !== "live") return fail("not live");
    if (!isSide(side)) return fail("bad side");
    if (!isTugSlot(match, side, slot)) return fail("bad slot");
    const tower = match[side].towers[slot];
    if (!tower) return fail("empty slot");
    if (!tower.ready || !Array.isArray(tower.offer)) return fail("not ready");
    let kind = null;
    if (typeof choice === "string") kind = tower.offer.indexOf(choice) >= 0 ? choice : null;
    else if (Number.isInteger(choice) && choice >= 0 && choice < tower.offer.length) kind = tower.offer[choice];
    if (kind === null) return fail("not on offer");
    const maxed = tugMaxed(match, tower);
    if (maxed && kind !== "heal") return fail(tugComplete(match, tower) ? "complete" : "max level");
    let what;
    if (kind === "heal") {
      tower.hp = tower.maxHp;
      what = `healed to ${tugNum(tower.hp)}/${tugNum(tower.maxHp)}`;
    } else {
      if (TUG_TRAIT_KINDS.indexOf(kind) < 0) return fail("not on offer");
      const cap = tugTraitCap(match, kind);
      if (tower.traits[kind] >= cap) return fail("max rank");
      const rank = tower.traits[kind] + 1;
      tower.traits[kind] = rank;
      tugApplyTraits(match, tower);
      if (kind === "hp") tower.hp = tower.maxHp;
      what = `upgraded ${kind} to ${rank}/${cap}`;
    }
    // A turret under construction may pick too; an hp pick or a heal sets hp to max, which finishes the build's hp
    // early (the build keeps running for its shots, and later damage is kept).
    if (tower.building && (kind === "hp" || kind === "heal")) tower.building.reached = tower.maxHp;
    const carry = match.tug.xp.holdWhileReady ? 0 : Math.max(0, tower.xp - tower.need);
    if (!maxed) {
      tower.level += 1;
      tower.need = tugXpNeed(match, tower.level);
    }
    tower.xp = carry;
    tower.ready = false;
    tower.offer = null;
    match.stats.upgrades[side] += 1;
    const maxLv = tugMaxLevel(match);
    const maxNote = maxLv > 0 && tower.level >= maxLv ? " (max level)" : (tugComplete(match, tower) ? " (complete)" : "");
    addLog(match, `${tugTowerLabel(side, slot)} ${what}${maxNote}.`);
    tugCheckReady(match, side, slot, tower);
    return { ok: true, reason: kind };
  }

  // ------------------------------------------------------------------ spawns

  // 12-rounds.js:40-71 makeAttacker (attacker upgrades are dead code, so no multiplier); hp scaled per round if asked.
  function makeUnit(match, side, defId, sequenceOffset, fanSeed) {
    const def = CREEP_BY_ID[defId];
    const hpScale = Math.max(0.1, 1 + match.rules.mobHpScalePerRound * (match.round - 1));
    const hp = def.hp * hpScale;
    const unit = {
      id: match.nextUnitId,
      owner: side,
      defId: def.id,
      cost: def.cost,
      hp,
      maxHp: hp,
      baseSpeed: def.speed,
      speed: def.speed,
      progress: -sequenceOffset,
      fanSeed,
      slowTimer: 0,
      poisonTimer: 0,
      poisonTicksRemaining: 0,
      poisonTickInterval: 1,
      poisonTickTimer: 0,
      poisonBaseDamage: 0,
      poisonSourceOwner: null,
      shootCooldown: 0,
      isDefeated: false,
      evolves: match.evo, // picks the lane in attackerPositionNorm
      exploded: false,    // evolves: blew up on an enemy tower this step (removed in cleanup)
      nx: 0,
      ny: 0
    };
    match.nextUnitId += 1;
    refreshPosition(unit);
    return unit;
  }

  function aliveCount(units) {
    let n = 0;
    for (let i = 0; i < units.length; i += 1) {
      const u = units[i];
      if (u.hp > 0 && !u.isDefeated && !u.exploded) n += 1;
    }
    return n;
  }

  // Evolves: each portal counts down; at 0 (the first at battle time 0) it spawns one mob of its tier at progress 0,
  // if fewer than maxAlive of its mobs are alive, and restarts at interval. Player first, then AI (rng order).
  function spawnFromPortals(match, dt) {
    for (const side of SIDES) {
      const S = match[side];
      const P = S.portal;
      P.spawnTimer -= dt;
      if (P.spawnTimer > 1e-9) continue;
      if (aliveCount(S.units) >= P.maxAlive) continue;
      const fanSeed = (match.rng() * 2 - 1) * EV.fanSpread;
      S.units.push(makeUnit(match, side, EV.tiers[P.tier], 0, fanSeed));
      P.spawnTimer = P.interval;
      match.stats.spawned[side] += 1;
    }
  }

  // 12-rounds.js:73-83 buildSpawnOffsets (the gap is rules.spawnGap, shipped 0.035; the gap after a Tank gets +0.11).
  function columnOffsets(list, gap) {
    const offsets = [];
    let cumulative = 0;
    for (let i = 0; i < list.length; i += 1) {
      offsets.push(cumulative);
      const leadGapBonus = list[i] === "tank" ? K.columnTankGapBonus : 0;
      cumulative += gap + leadGapBonus;
    }
    return offsets;
  }

  // Ranks: slowest type first (stable), three abreast, one gap per rank, no Tank bonus. A partial last rank is centred
  // (one creep at fan 0, two at -0.6 / +0.6) so a lone creep doesn't always walk the left edge.
  function rankLayout(list, gap) {
    const sorted = list
      .map((id, index) => ({ id, index }))
      .sort((a, b) => (CREEP_BY_ID[a.id].speed - CREEP_BY_ID[b.id].speed) || (a.index - b.index));
    const perRank = K.ranksFan.length;
    const out = [];
    for (let start = 0; start < sorted.length; start += perRank) {
      const rank = sorted.slice(start, start + perRank);
      const fans = rank.length === perRank
        ? K.ranksFan
        : rank.length === 1
          ? [K.ranksFan[1]]
          : [K.ranksFan[0], K.ranksFan[perRank - 1]];
      const offset = (start / perRank) * gap;
      rank.forEach((item, i) => out.push({ defId: item.id, offset, fanSeed: fans[i] }));
    }
    return out;
  }

  function releaseDue(match) {
    for (const side of SIDES) {
      const S = match[side];
      if (S.pending.length === 0) continue;
      while (S.pending.length > 0 && S.pending[0].releaseAt <= match.battleTime + 1e-9) {
        const spec = S.pending.shift();
        S.units.push(makeUnit(match, side, spec.defId, spec.offset, spec.fanSeed));
      }
    }
  }

  // 12-rounds.js:97-122 _doLaunchWave. Evolves: nothing is queued; the portals spawn inside step from battle time 0.
  function launchBattle(match) {
    if (match && match.tug) return fail("not in tug");
    if (!match || match.phase !== "prep") return fail("not in prep");
    if (match.evo) {
      for (const side of SIDES) {
        const S = match[side];
        S.queue = [];
        S.units = [];
        S.pending = [];
        S.portal.spawnTimer = 0;
      }
      match.projectiles = [];
      match.bursts = [];
      match.battleTime = 0;
      match.phase = "battle";
      const describe = (side) => {
        const P = match[side].portal;
        return `${CREEP_BY_ID[EV.tiers[P.tier]].name} every ${P.interval.toFixed(1)} s, max ${P.maxAlive}`;
      };
      addLog(match, `battle: Player portal ${describe("player")}, AI portal ${describe("ai")}.`);
      return { ok: true, reason: "battle" };
    }
    const rules = match.rules;
    const gap = rules.spawnGap;
    const lists = {};
    for (const side of SIDES) {
      const S = match[side];
      if (rules.persistentMobs) {
        for (const id of S.queue) S.roster.push(id);
        lists[side] = S.roster.slice();
      } else {
        lists[side] = S.queue.slice();
      }
      S.queue = [];
      S.units = [];
      S.pending = [];
    }
    match.projectiles = [];
    match.bursts = [];
    match.battleTime = 0;
    match.phase = "battle";

    for (const side of SIDES) {
      const S = match[side];
      const list = lists[side];
      if (rules.spawnShape === "ranks") {
        for (const spec of rankLayout(list, gap)) {
          S.units.push(makeUnit(match, side, spec.defId, spec.offset, spec.fanSeed));
        }
      } else if (rules.spawnShape === "stream") {
        const size = Math.max(1, Math.floor(rules.streamGroupSize) || 1);
        const interval = Math.max(0, Number(rules.streamIntervalSeconds) || 0);
        for (let g = 0; g * size < list.length; g += 1) {
          const group = list.slice(g * size, (g + 1) * size);
          for (const spec of rankLayout(group, gap)) {
            S.pending.push({ releaseAt: g * interval, defId: spec.defId, offset: spec.offset, fanSeed: spec.fanSeed });
          }
        }
      } else {
        // column (shipped): random fan per creep, drawn player first then AI as atw-dev's two map() calls do
        const offsets = columnOffsets(list, gap);
        for (let i = 0; i < list.length; i += 1) {
          S.units.push(makeUnit(match, side, list[i], offsets[i], match.rng() * 2 - 1));
        }
      }
    }

    const sent = (side) => lists[side].length;
    addLog(match, `battle: Player sends ${sent("player")}, AI sends ${sent("ai")}.`);
    return { ok: true, reason: "battle" };
  }

  // ------------------------------------------------------------------- combat

  function isUnitStatusActive(unit, statusType) {
    if (statusType === "slowed") return unit.slowTimer > 0;
    if (statusType === "poisoned") return unit.poisonTimer > 0;
    return false;
  }

  // 14-battle.js:35-58 getTowerCandidates, plus the cones / trueRange / redCloseOnly switches.
  function getTowerCandidates(match, tower, towerPos, dirY, incoming) {
    const rules = match.rules;
    const redGate = rules.redCloseOnly && tower.id === "red";
    const candidates = [];
    for (const unit of incoming) {
      if (redGate && unit.progress < K.redCloseProgress) continue;
      const v = rangeVector(match, towerPos.x, towerPos.y, unit.nx, unit.ny);
      if (v.dist <= tower.range) {
        if (v.dist === 0 || !rules.cones) {
          candidates.push({ unit, dist: v.dist, progress: unit.progress });
          continue;
        }
        const cosAngle = (v.vy * dirY) / v.dist;
        if (cosAngle >= tower.coneHalfAngleCos) {
          candidates.push({ unit, dist: v.dist, progress: unit.progress });
        }
      }
    }
    return candidates;
  }

  // 14-battle.js:60-89 chooseTargetByRule, verbatim.
  function chooseTargetByRule(candidates, towerId) {
    if (candidates.length === 0) return null;
    if (towerId === "yellow" || towerId === "green") {
      const statusType = towerId === "yellow" ? "slowed" : "poisoned";
      const freshTargets = candidates.filter((item) => !isUnitStatusActive(item.unit, statusType));
      const priorityPool = freshTargets.length > 0 ? freshTargets : candidates;
      priorityPool.sort((a, b) => {
        if (a.dist !== b.dist) return a.dist - b.dist;
        if (b.progress !== a.progress) return b.progress - a.progress;
        return a.unit.id - b.unit.id;
      });
      return priorityPool[0].unit;
    }
    candidates.sort((a, b) => {
      if (b.progress !== a.progress) return b.progress - a.progress;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.unit.id - b.unit.id;
    });
    return candidates[0].unit;
  }

  // 14-battle.js:91-116 targetsForTower, verbatim.
  function targetsForTower(match, tower, towerPos, dirY, incoming) {
    const candidates = getTowerCandidates(match, tower, towerPos, dirY, incoming);
    if (candidates.length === 0) return [];
    const selected = [];
    const maxTargets = Math.max(1, tower.maxTargets || 1);
    let candidatePool = candidates.slice();
    for (let i = 0; i < maxTargets; i += 1) {
      const chosen = chooseTargetByRule(candidatePool, tower.id);
      if (!chosen) break;
      selected.push(chosen);
      candidatePool = candidatePool.filter((item) => item.unit.id !== chosen.id);
      if (candidatePool.length === 0) break;
    }
    return selected;
  }

  // 14-battle.js:118-140 spawnProjectile.
  function spawnProjectile(match, from, target, damage, towerId, owner, speed, slowDuration, poisonDotMultiplier, shrapnelDamageMultiplier) {
    match.projectiles.push({
      id: match.nextProjectileId,
      x: from.x,
      y: from.y,
      prevX: from.x,
      prevY: from.y,
      targetId: target.id,
      targetOwner: target.owner,
      damage,
      speed: speed || K.projectileSpeed,
      slowDuration: Number.isFinite(slowDuration) ? slowDuration : null,
      poisonDotMultiplier: Number.isFinite(poisonDotMultiplier) ? poisonDotMultiplier : 1,
      shrapnelDamageMultiplier: Number.isFinite(shrapnelDamageMultiplier) ? shrapnelDamageMultiplier : 1,
      towerId,
      owner
    });
    match.nextProjectileId += 1;
  }

  // 14-battle.js:153-168 findYellowLeapTarget (px distance in the 420 x 760 frame).
  function findYellowLeapTarget(match, sourceUnit, maxDistancePx) {
    const list = match[sourceUnit.owner].units;
    let best = null;
    for (const unit of list) {
      if (unit.id === sourceUnit.id || unit.isDefeated || unit.hp <= 0 || unit.progress >= 1) continue;
      const distance = Math.hypot((unit.nx - sourceUnit.nx) * W, (unit.ny - sourceUnit.ny) * H);
      if (distance <= maxDistancePx && (!best || distance < best.distance)) {
        best = { unit, distance };
      }
    }
    return best;
  }

  // Evolves also pays killMana[creep] to the killer's owner (towers, splash, poison and the Tank gun alike), cap 99.
  // Classic and evolves only: tug credits its kills in tugPayKill and tugKillXp.
  function creditKill(match, target, killerId, owner) {
    match.stats.kills[owner] = (match.stats.kills[owner] || 0) + 1;
    const killer = killerId === "tank" ? "Tank" : (TOWER_BY_ID[killerId] ? TOWER_BY_ID[killerId].name : killerId);
    let paid = "";
    if (match.evo) {
      const S = match[owner];
      const before = S.mana;
      S.mana = clamp(S.mana + (EV.killMana[target.defId] || 0), 0, K.manaCap);
      match.stats.killMana[owner] += S.mana - before;
      paid = ` (+${S.mana - before} mana)`;
    }
    addLog(match, `${SIDE_LABEL[owner]} ${killer} killed ${SIDE_LABEL[target.owner]} ${CREEP_BY_ID[target.defId].name}${paid}.`);
  }

  // 14-battle.js:170-205 applyProjectileDamage. rawDamage is the projectile's damage; the counter multiplier (when on)
  // applies per creep hit, so the leap and the splash use the raw damage and get their own creep's multiplier.
  function applyHit(match, target, rawDamage, towerId, owner, allowAoe, slowDurationForHit, poisonDotMultiplierForHit, shrapnelDamageMultiplierForHit, allowYellowLeap) {
    if (!target || target.isDefeated || rawDamage <= 0) return;
    const damage = rawDamage * counterMultiplier(match, towerId, target.defId);
    target.hp -= damage;
    if (towerId === "yellow") {
      const appliedSlow = Number.isFinite(slowDurationForHit) ? slowDurationForHit : K.yellowSlowSeconds;
      target.slowTimer = Math.max(target.slowTimer, appliedSlow);
      if (allowYellowLeap && allowAoe) {
        const leap = findYellowLeapTarget(match, target, K.yellowLeapPx);
        if (leap) {
          applyHit(match, leap.unit, rawDamage * K.yellowLeapDamage, towerId, owner, false, appliedSlow * K.yellowLeapSlow, poisonDotMultiplierForHit, shrapnelDamageMultiplierForHit, false);
        }
      }
    }
    if (towerId === "green") {
      target.poisonTimer = K.poisonSeconds;
      target.poisonTicksRemaining = K.poisonTicks;
      target.poisonTickInterval = K.poisonTickInterval;
      target.poisonTickTimer = K.poisonTickInterval;
      const appliedPoisonDotMultiplier = Number.isFinite(poisonDotMultiplierForHit) ? poisonDotMultiplierForHit : 1;
      target.poisonBaseDamage = damage * appliedPoisonDotMultiplier;
      target.poisonSourceOwner = owner;
    }
    if (towerId === "red" && allowAoe) {
      // GREYBOX APPROXIMATION of Red's shrapnel. atw-dev (14-battle.js:283-312, 16-effects.js:207-242) throws 48
      // particles (6 directions x 8, random spread, 200-300 px flight), each dealing 0.33 x hit x the level's shrapnel
      // multiplier to the first creeps it touches (hit radius 0.02). Here: every other enemy creep within 60 px of the
      // target takes 0.33 x damage x 3 (three pieces) x the shrapnel multiplier, instantly, once per hit.
      const appliedShrapnelMultiplier = Number.isFinite(shrapnelDamageMultiplierForHit) ? shrapnelDamageMultiplierForHit : 1;
      const splashDamage = rawDamage * K.redShrapnelFraction * K.redSplashPieces * appliedShrapnelMultiplier;
      const cx = target.nx * W;
      const cy = target.ny * H;
      match.bursts.push({ x: cx, y: cy, life: K.burstLifeSeconds, maxLife: K.burstLifeSeconds, center: true });
      for (const unit of match[target.owner].units) {
        if (unit === target || unit.isDefeated || unit.hp <= 0) continue;
        const ux = unit.nx * W;
        const uy = unit.ny * H;
        if (Math.hypot(ux - cx, uy - cy) <= K.redSplashRadiusPx) {
          match.bursts.push({ x: ux, y: uy, life: K.burstLifeSeconds, maxLife: K.burstLifeSeconds, center: false });
          applyHit(match, unit, splashDamage, "red", owner, false);
        }
      }
    }
    if (target.hp <= 0 && !target.isDefeated) {
      target.isDefeated = true;
      creditKill(match, target, towerId, owner);
    }
  }

  // 16-effects.js:79-151 updateTowerFire (player towers face up, AI towers face down).
  function updateTowerFire(match, dt) {
    const rules = match.rules;
    for (const side of SIDES) {
      const S = match[side];
      const incoming = match[other(side)].units;
      const positions = TOWER_POS[side];
      const dirY = side === "player" ? -1 : 1;
      for (let i = 0; i < S.towers.length; i += 1) {
        const tower = S.towers[i];
        if (!tower) continue;
        tower.cooldown -= dt;
        if (tower.cooldown > 0) continue;
        const targets = targetsForTower(match, tower, positions[i], dirY, incoming);
        if (targets.length === 0) continue;
        const damage = rules.redCloseOnly && tower.id === "red" ? tower.damage * K.redCloseDamage : tower.damage;
        for (const target of targets) {
          spawnProjectile(match, positions[i], target, damage, tower.id, side, null, tower.slowDuration, tower.poisonDotMultiplier, tower.shrapnelDamageMultiplier);
        }
        tower.cooldown = tower.fireRate;
      }
    }
  }

  // 14-battle.js:207-281 the Tank's gun: nearest enemy creep within 0.5 x Violet range, 0.5 x Violet damage, every 1.1 s,
  // 180 degree cone facing its travel direction.
  const VIOLET = TOWER_BY_ID.violet;
  const TANK_GUN = {
    range: VIOLET.range * K.tankRangeOfViolet,
    damage: VIOLET.damage * K.tankDamageOfViolet,
    fireRate: K.tankFireRate,
    coneHalfAngleCos: Math.cos((K.tankConeDegrees * Math.PI) / 360)
  };

  function getTankTarget(match, tankUnit, enemyUnits) {
    const dirY = tankUnit.owner === "player" ? -1 : 1;
    const candidates = [];
    for (const enemy of enemyUnits) {
      if (enemy.hp <= 0 || enemy.isDefeated || enemy.progress >= 1) continue;
      const v = rangeVector(match, tankUnit.nx, tankUnit.ny, enemy.nx, enemy.ny);
      if (v.dist > TANK_GUN.range) continue;
      if (v.dist === 0) {
        candidates.push({ unit: enemy, dist: v.dist });
        continue;
      }
      const cosAngle = (v.vy * dirY) / v.dist;
      if (cosAngle >= TANK_GUN.coneHalfAngleCos) {
        candidates.push({ unit: enemy, dist: v.dist });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      return b.unit.progress - a.unit.progress;
    });
    return candidates[0].unit;
  }

  function updateTankFire(match, dt) {
    for (const side of SIDES) {
      const enemies = match[other(side)].units;
      for (const unit of match[side].units) {
        if (unit.defId !== "tank" || unit.hp <= 0 || unit.isDefeated || unit.progress >= 1) continue;
        unit.shootCooldown -= dt;
        if (unit.shootCooldown > 0) continue;
        const target = getTankTarget(match, unit, enemies);
        if (!target) continue;
        spawnProjectile(match, { x: unit.nx, y: unit.ny }, target, TANK_GUN.damage, "tank", side, K.tankProjectileSpeed);
        unit.shootCooldown = TANK_GUN.fireRate;
      }
    }
  }

  function findUnitById(match, owner, id) {
    const list = match[owner].units;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // 16-effects.js:158-205 updateProjectiles: hit inside 0.012, else move; a projectile whose target is gone is dropped.
  function updateProjectiles(match, dt) {
    const stillActive = [];
    for (const projectile of match.projectiles) {
      const target = findUnitById(match, projectile.targetOwner, projectile.targetId);
      if (!target || target.isDefeated) continue;
      const dx = target.nx - projectile.x;
      const dy = target.ny - projectile.y;
      const dist = Math.hypot(dx, dy);
      projectile.prevX = projectile.x;
      projectile.prevY = projectile.y;
      if (dist <= K.projectileHitRadius) {
        applyHit(match, target, projectile.damage, projectile.towerId, projectile.owner, true, projectile.slowDuration, projectile.poisonDotMultiplier, projectile.shrapnelDamageMultiplier, true);
        continue;
      }
      const move = Math.min(dist, projectile.speed * dt);
      const invDist = dist > 0 ? 1 / dist : 0;
      projectile.x += dx * invDist * move;
      projectile.y += dy * invDist * move;
      stillActive.push(projectile);
    }
    match.projectiles = stillActive;
  }

  // Visual only: Red splash dots fade out. The battle waits for them as atw-dev waits for its fire bursts.
  function updateBursts(match, dt) {
    if (match.bursts.length === 0) return;
    const active = [];
    for (const burst of match.bursts) {
      burst.life -= dt;
      if (burst.life > 0) active.push(burst);
    }
    match.bursts = active;
  }

  // Kamikaze: the leaker hits the defender's tower nearest its exit point (px distance) for its cost.
  function kamikazeHit(match, unit) {
    const defender = other(unit.owner);
    const towers = match[defender].towers;
    const ex = unit.nx * W;
    const ey = unit.ny * H;
    let bestSlot = -1;
    let bestDist = Infinity;
    for (let i = 0; i < towers.length; i += 1) {
      if (!towers[i]) continue;
      const p = towerPositions[defender][i];
      const d = Math.hypot(p.x - ex, p.y - ey);
      if (d < bestDist) {
        bestDist = d;
        bestSlot = i;
      }
    }
    if (bestSlot < 0) return;
    hitTower(match, unit, bestSlot);
  }

  // The kamikaze hit itself: the creep's cost off the defender's tower in slot; 0 hp empties the slot.
  function hitTower(match, unit, slot) {
    const defender = other(unit.owner);
    const towers = match[defender].towers;
    const tower = towers[slot];
    tower.hp -= unit.cost;
    if (tower.hp <= 0) {
      towers[slot] = null;
      match.stats.towersDestroyed[defender] += 1;
      addLog(match, `${SIDE_LABEL[unit.owner]} ${CREEP_BY_ID[unit.defId].name} destroyed ${SIDE_LABEL[defender]} ${TOWER_BY_ID[tower.id].name} (slot ${slot + 1}).`);
    }
  }

  // Evolves contact: the slot of the nearest living enemy tower within contactRadiusPx of the mob (px), or -1.
  function contactSlot(match, unit) {
    const defender = other(unit.owner);
    const towers = match[defender].towers;
    const ux = unit.nx * W;
    const uy = unit.ny * H;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < towers.length; i += 1) {
      if (!towers[i]) continue;
      const p = towerPositions[defender][i];
      const d = Math.hypot(p.x - ux, p.y - uy);
      if (d <= EV.contactRadiusPx && d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Evolves: the mob blows up on that tower (the shared kamikaze hit) and leaves the field without a kill.
  function explodeOnTower(match, unit, slot) {
    const defender = other(unit.owner);
    const tower = match[defender].towers[slot];
    unit.exploded = true;
    match.stats.explosions[unit.owner] += 1;
    const hpAfter = Math.max(0, tower.hp - unit.cost);
    addLog(match, `${SIDE_LABEL[unit.owner]} ${CREEP_BY_ID[unit.defId].name} exploded on ${SIDE_LABEL[defender]} ${TOWER_BY_ID[tower.id].name} (slot ${slot + 1}) for ${unit.cost}: hp ${Math.round(hpAfter)}/${Math.round(tower.maxHp)}.`);
    hitTower(match, unit, slot);
  }

  function gateDamageOf(unit) {
    if (EV.gateDamage === "cost") return unit.cost;
    const n = Number(EV.gateDamage);
    return Number.isFinite(n) ? n : unit.cost;
  }

  // Evolves: mobs at the end of their lane hit the enemy gate (lives mirror it); a gate at 0 ends the match.
  function hitGates(match, leakers) {
    for (const unit of leakers) {
      const leaker = unit.owner;
      const defender = other(leaker);
      const D = match[defender];
      const damage = gateDamageOf(unit);
      D.gate.hp = Math.max(0, D.gate.hp - damage);
      D.lives = D.gate.hp;
      match.stats.leaks[leaker] += 1;
      match.stats.gateHits[leaker] += 1;
      match.stats.gateDamage[leaker] += damage;
      addLog(match, `${SIDE_LABEL[leaker]} ${CREEP_BY_ID[unit.defId].name} hit the ${SIDE_LABEL[defender]} gate for ${damage}: gate ${D.gate.hp}/${D.gate.maxHp}.`);
    }
    if (match.player.gate.hp <= 0 || match.ai.gate.hp <= 0) {
      match.stats.battles += 1;
      match.stats.battleSeconds += match.battleTime;
      finishMatch(match, "gate");
    }
  }

  // 16-effects.js:319-345, the status part of updateAttackers: slow decay (sets speed) and poison ticks.
  function tickStatuses(unit, dt) {
    unit.slowTimer = Math.max(0, unit.slowTimer - dt);
    unit.speed = unit.slowTimer > 0 ? unit.baseSpeed * K.slowSpeedFactor : unit.baseSpeed;
    unit.poisonTimer = Math.max(0, unit.poisonTimer - dt);
    if (unit.poisonTicksRemaining > 0) {
      unit.poisonTickTimer -= dt;
      if (unit.poisonTickTimer <= 0) {
        // Verbatim from atw-dev, including its indexing: with 3 ticks remaining the first tick reads ratios[1], so
        // the shipped ticks are 0.2 / 0.1 / 0.1 of the hit, not the 0.3 / 0.2 / 0.1 the array suggests.
        const step = 4 - unit.poisonTicksRemaining;
        const ratios = K.poisonRatios;
        const dotDamage = unit.poisonBaseDamage * ratios[Math.min(step, ratios.length - 1)];
        unit.hp -= dotDamage;
        unit.poisonTicksRemaining -= 1;
        unit.poisonTickTimer += unit.poisonTickInterval;
      }
    }
  }

  // 16-effects.js:319-406 updateAttackers: slow, poison ticks, movement, leaks, cleanup, scoring.
  // Evolves: after moving, a mob touching an enemy tower explodes on it; one at the lane end hits the enemy gate.
  function updateAttackers(match, dt) {
    const rules = match.rules;
    const evo = match.evo;
    const leakers = [];
    for (const side of SIDES) {
      for (const unit of match[side].units) {
        tickStatuses(unit, dt);
        if (unit.hp <= 0) continue;
        unit.progress += unit.speed * dt;
        refreshPosition(unit);
        if (evo) {
          const slot = contactSlot(match, unit);
          if (slot >= 0) {
            explodeOnTower(match, unit, slot);
            continue;
          }
        }
        if (unit.progress >= 1) leakers.push(unit);
      }
    }

    for (const side of SIDES) {
      const S = match[side];
      let write = 0;
      for (let i = 0; i < S.units.length; i += 1) {
        const unit = S.units[i];
        if (unit.hp <= 0 && !unit.isDefeated) {
          unit.isDefeated = true;
          if (unit.poisonSourceOwner) creditKill(match, unit, "green", unit.poisonSourceOwner);
        }
        if (unit.hp > 0 && unit.progress < 1 && !unit.exploded) {
          S.units[write] = unit;
          write += 1;
        }
      }
      S.units.length = write;
    }

    if (leakers.length === 0) return;
    if (evo) {
      hitGates(match, leakers);
      return;
    }
    const lives = rules.scoring === "lives";
    for (const unit of leakers) {
      const leaker = unit.owner;
      const defender = other(leaker);
      match.stats.leaks[leaker] += 1;
      if (lives) {
        match[defender].lives = Math.max(0, match[defender].lives - unit.cost);
      } else {
        match[leaker].score += 1;
      }
      if (rules.leakMana > 0) {
        match[leaker].mana = clamp(match[leaker].mana + rules.leakMana, 0, K.manaCap);
      }
      const name = CREEP_BY_ID[unit.defId].name;
      addLog(match, lives
        ? `${SIDE_LABEL[leaker]} ${name} leaked: ${SIDE_LABEL[defender]} lives ${match[defender].lives}.`
        : `${SIDE_LABEL[leaker]} ${name} leaked: ${SIDE_LABEL[leaker]} score ${match[leaker].score}.`);
      if (rules.kamikaze) kamikazeHit(match, unit);
    }
    if (lives && (match.player.lives <= 0 || match.ai.lives <= 0)) {
      match.stats.battles += 1;
      match.stats.battleSeconds += match.battleTime;
      finishMatch(match, "lives");
    }
  }

  // ---------------------------------------------------------------------- tug
  //
  // Every number comes from match.tug. Tug units carry x, y in frame px (nx, ny normalised copies) and progress from 0
  // on their own spawn line to 1 at the enemy gate line. A tick: hit events age, the gold drip, each side's build queue
  // (the head trains; a finished mob spawns), tower construction and rubble timers (stepTugBuild), statuses, charges
  // start or drop (tugChargeSight; tug pass 11), every unit that is not charging picks a target from the positions at
  // the start of
  // the tick (units that were attacking last tick claim first, so a newcomer never pushes one off a full target), every
  // due hit lands (simultaneously, so a mob that dies this tick still lands its own hit and neither seat moves first),
  // charging units run at their target and blow up on contact (tugChargeMove), units with no target walk (front-most
  // first, so a follower in a column sees its leader's new position), the dead
  // are cleared; then the gate check, tower and gate gun fire, projectiles, bursts, cleanup, the XP sweep, the idle
  // stretch and the clock. Every death pays gold once, to the side whose damage took the hp to 0 (tugPayKill), then
  // xp (tugKillXp).

  // A default-table guard (exported); runTug uses the match's own table.
  // A crumble overtime (time.overtime "crumble") adds the seconds it can last: the full gate at
  // time.crumbleHpPerSecond, plus one; with overtime "draw" (or a bad rate) nothing changes.
  function tugGuardStepsFor(table) {
    const s = Number(table && table.time ? table.time.matchSeconds : NaN);
    let seconds = Number.isFinite(s) ? Math.max(0, s) : 0;
    const rate = tugCrumbleRate(table);
    const hp = Number(table && table.gate ? table.gate.hp : NaN);
    if (rate > 0 && Number.isFinite(hp) && hp > 0) seconds += Math.ceil(hp / rate) + 1;
    return Math.round(seconds * 30) + 100; // the whole match at 1/30 plus slack
  }

  // The crumble rate (hp per second both gates lose after time.matchSeconds): time.crumbleHpPerSecond when
  // time.overtime is "crumble" and it is a finite number > 0, else 0 (no crumble: the clock ends the match as before).
  function tugCrumbleRate(table) {
    const T = table && table.time ? table.time : null;
    if (!T || T.overtime !== "crumble") return 0;
    const rate = Number(T.crumbleHpPerSecond);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  }
  const TUG_GUARD_STEPS = tugGuardStepsFor(TUG);

  function tugAlive(unit) {
    return unit.hp > 0 && !unit.isDefeated;
  }

  // A side's mobs walk up the frame (player) or down (ai).
  function tugDir(side) {
    return side === "player" ? -1 : 1;
  }

  function tugNum(v) {
    return String(Math.round(v * 10) / 10);
  }

  // Refresh the normalised copy and progress after x / y change.
  function tugPlace(match, unit) {
    const lane = match.tug.lane;
    const side = unit.owner;
    const span = Math.abs(lane.gateY[other(side)] - lane.spawnY[side]) || 1;
    unit.nx = unit.x / W;
    unit.ny = unit.y / H;
    unit.progress = ((unit.y - lane.spawnY[side]) * tugDir(side)) / span;
  }

  // A tug mob from match.tug.mobs[defId] (speed in px per second). slowMove / slowAttack are the factors of the slow in
  // force (1 when not slowed). Tug has no poison; poisonTimer stays 0 for the snapshot's flag.
  function makeTugUnit(match, side, defId, x) {
    const spec = match.tug.mobs[defId];
    const hp = Number(spec.hp) > 0 ? spec.hp : 1;
    const unit = {
      id: match.nextUnitId,
      owner: side,
      defId,
      cost: match.tug.costs.mob[defId],
      hp,
      maxHp: hp,
      baseSpeed: spec.speed,
      speed: spec.speed,
      progress: 0,
      fanSeed: 0,
      slowTimer: 0,
      slowMove: 1,
      slowAttack: 1,
      poisonTimer: 0,
      isDefeated: false,
      nx: 0,
      ny: 0,
      x,
      y: match.tug.lane.spawnY[side],
      targetKind: null,  // "mob" | "tower" | "gate" | "charge" | null (walking)
      targetId: null,    // the enemy unit's id, the enemy tower's slot, the charging value ("charge"), or null
      attackTimer: 0,    // seconds until this unit may hit again (drains while walking, so contact hits at once)
      lastHitAt: -1,    // match.clock of its last hit (snapshot "attacking")
      attackers: 0,      // enemy mobs attacking it this tick (combat.engagementWidth caps it)
      charging: null     // tug pass 11: what this unit is charging (spec.charge, the Brute): the enemy unit's id, or with charge.structures (2026-10-17) "tower:<slot>" / "gate"; else null
    };
    match.nextUnitId += 1;
    tugPlace(match, unit);
    return unit;
  }

  // Slow decay: a slow in force scales speed by slowMove (and attackTimer's drain by slowAttack, in stepTugUnits).
  function tugTickStatuses(unit, dt) {
    unit.slowTimer = Math.max(0, unit.slowTimer - dt);
    if (unit.slowTimer <= 0) {
      unit.slowMove = 1;
      unit.slowAttack = 1;
    }
    unit.speed = unit.baseSpeed * unit.slowMove;
  }

  // Reach to an enemy tower: the spec's own structureReach when it is a finite number > 0 (Tank), else
  // combat.structureReachMelee for a melee mob (reach <= 40) and its own reach for a ranged one.
  function tugStructureReach(match, spec) {
    const own = Number(spec.structureReach);
    if (Number.isFinite(own) && own > 0) return own;
    return spec.reach <= TUG_MELEE_REACH ? match.tug.combat.structureReachMelee : spec.reach;
  }

  function tugAtGate(match, unit) {
    const line = match.tug.lane.gateY[other(unit.owner)];
    return unit.owner === "player" ? unit.y <= line + 1e-6 : unit.y >= line - 1e-6;
  }

  // A mob's gate reach: within gateReach px of the enemy gate line along the lane (a mob never walks past the
  // line); gateReach <= 0 or missing = only at the line (tugAtGate).
  function tugGateInReach(match, unit, gateReach) {
    const g = Number(gateReach);
    if (!(Number.isFinite(g) && g > 0)) return tugAtGate(match, unit);
    const line = match.tug.lane.gateY[other(unit.owner)];
    return Math.abs(unit.y - line) <= g + 1e-6;
  }

  // Tug pass 11: turret.buildSafe on = a turret under construction cannot be targeted or hit by mobs.
  function tugBuildSafe(match) {
    return isPlainObject(match.tug.turret) && match.tug.turret.buildSafe === true;
  }

  // 2026-10-16: queue.parallel on = every queued mob trains at once (stepTugQueue) and any can be cancelled (cancelMob).
  function tugQueueParallel(match) {
    return isPlainObject(match.tug.queue) && match.tug.queue.parallel === true;
  }

  // Lane-bands (2026-10-08): combat.laneBand on = every reach, range and sight in tug is measured along the lane only
  // (|dy|), lateral offset ignored. Splash, the Slow chain and the Brute's contact stay circles.
  function tugLaneBand(match) {
    return isPlainObject(match.tug.combat) && match.tug.combat.laneBand === true;
  }

  // Distance for a reach / range / sight check: along the lane (|dy|) when band, else the straight line.
  function tugReachDist(band, ax, ay, bx, by) {
    return band ? Math.abs(by - ay) : Math.hypot(bx - ax, by - ay);
  }

  // The nearest enemy tower within maxPx of the unit with fewer than width attackers, as { slot, tower }, or null;
  // ties go to the lower slot. band = measure along the lane only (|dy|, lateral offset ignored; Tank's
  // structureBand; combat.laneBand turns it on for everyone), else the straight-line distance. A tower under construction is skipped while turret.buildSafe is on
  // (tug pass 11) unless hitsBuilding (breakthrough, 2026-10-08: only the Tank's spec sets it; every other caller passes
  // nothing = false).
  function tugNearestTower(match, unit, maxPx, width, band, hitsBuilding) {
    const enemy = other(unit.owner);
    const towers = match[enemy].towers;
    const slots = match.tug.slots[enemy];
    const buildSafe = tugBuildSafe(match);
    const laneBand = tugLaneBand(match);
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < towers.length; i += 1) {
      const tower = towers[i];
      if (!tower || tower.attackers >= width) continue;
      if (tower.building && buildSafe && !hitsBuilding) continue;
      const p = slots[i];
      const d = (band || laneBand) ? Math.abs(p.y - unit.y) : Math.hypot(p.x - unit.x, p.y - unit.y);
      if (d <= maxPx && d < bestDist) {
        bestDist = d;
        best = { slot: i, tower };
      }
    }
    return best;
  }

  // The nearest living enemy mob within maxPx with fewer than width attackers, or null; ties go to the lower id (the
  // list is in id order).
  function tugNearestMob(match, unit, maxPx, width) {
    const laneBand = tugLaneBand(match);
    let best = null;
    let bestDist = Infinity;
    for (const enemy of match[other(unit.owner)].units) {
      if (!tugAlive(enemy) || enemy.attackers >= width) continue;
      const d = tugReachDist(laneBand, unit.x, unit.y, enemy.x, enemy.y);
      if (d <= maxPx && d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  // The target order: an enemy mob in reach (nearest; never for ignoresMobs), an enemy tower in structure reach
  // (nearest; one under construction counts only while turret.buildSafe is off, or for a mob whose spec has hitsBuilding
  // (the Tank, breakthrough); structureBand measures along the lane),
  // the enemy gate within the mob's gateReach of its line (at the line when it has none; 2026-10-16, Baz: ranged mobs
  // shoot the gate from range). Lane-bands (2026-10-08): with combat.laneBand on, every reach here (mob and tower) is
  // measured along the lane only (|dy|). A charging unit (tug pass 11) never comes here: stepTugUnits moves it itself.
  // structuresFirst (Tank) moves the mob to the end: tower, gate, then a mob within its reach. gateOnly (Runner) skips
  // mobs and towers: the gate once within gateReach of its line, else walk. A full target (engagementWidth attackers
  // already) is passed over for the next one in that order; none left = walk. { kind, unit | slot + tower } or null.
  function tugPickTarget(match, unit, spec, width) {
    if (spec.gateOnly) {
      if (tugGateInReach(match, unit, spec.gateReach) && match[other(unit.owner)].gate.attackers < width) return { kind: "gate" };
      return null;
    }
    const mobFirst = !spec.ignoresMobs && !spec.structuresFirst;
    if (mobFirst) {
      const mob = tugNearestMob(match, unit, spec.reach, width);
      if (mob) return { kind: "mob", unit: mob };
    }
    const t = tugNearestTower(match, unit, tugStructureReach(match, spec), width, spec.structureBand === true, spec.hitsBuilding === true);
    if (t) return { kind: "tower", slot: t.slot, tower: t.tower };
    if (tugGateInReach(match, unit, spec.gateReach) && match[other(unit.owner)].gate.attackers < width) return { kind: "gate" };
    if (spec.structuresFirst && !spec.ignoresMobs) {
      const mob = tugNearestMob(match, unit, spec.reach, width);
      if (mob) return { kind: "mob", unit: mob };
    }
    return null;
  }

  // A damage event for the page (match.hits, kept TUG_HIT_SECONDS; the simulation never reads it). side = the dealer.
  function tugRecordHit(match, x, y, amount, side) {
    match.hits.push({ x, y, amount, side, age: 0, kind: "damage" });
  }

  // A death pays gold once, to the side whose damage took the hp to 0 (killerSide): value = the kill's gold value
  // (gold.perKill for a mob, tugTowerValue for a turret), also put on match.hits as a "gold" event at
  // the death point. source = who killed ("mob", "turret" or "gun"; anything else counts as "other"), only for
  // stats.goldBySource. Returns the gold paid (for the log line); the caller logs the kill, then calls tugKillXp.
  function tugPayKill(match, killerSide, value, x, y, source) {
    const v = Number(value);
    if (!(Number.isFinite(v) && v > 0)) return 0;
    match[killerSide].gold += v;
    match.stats.goldEarned[killerSide] += v;
    const bucket = match.stats.goldBySource[killerSide];
    bucket[source in bucket ? source : "other"] += v;
    match.hits.push({ x, y, amount: v, side: killerSide, age: 0, kind: "gold" });
    return v;
  }

  // The xp for the same death. sourceTower = the tower whose own shot, splash or chain killed: it alone earns
  // xp.ownKillShare x value (nothing if it no longer stands); null (a mob or the gate gun) = every tower killerSide
  // owns earns xp.unitKillShare x value.
  function tugKillXp(match, killerSide, value, sourceTower) {
    const v = Number(value);
    if (!(Number.isFinite(v) && v > 0)) return;
    const S = match[killerSide];
    const X = match.tug.xp;
    if (sourceTower) {
      const slot = S.towers.indexOf(sourceTower);
      const share = Number(X.ownKillShare);
      if (slot >= 0 && Number.isFinite(share)) tugAddXp(match, killerSide, slot, sourceTower, share * v);
      return;
    }
    const share = Number(X.unitKillShare);
    if (!Number.isFinite(share)) return;
    for (let i = 0; i < S.towers.length; i += 1) {
      if (S.towers[i]) tugAddXp(match, killerSide, i, S.towers[i], share * v);
    }
  }

  // Damage xp (tug pass 7): a turret whose own shot, splash or chain dealt `dealt` damage to an enemy mob (overkill
  // already left out by the caller) earns xp.perDamage x dealt, through tugAddXp (nothing while ready and holding;
  // nothing if it no longer stands). stats.turretDamage counts every such point, stats.damageXp the xp it put on bars.
  function tugDamageXp(match, side, tower, dealt) {
    if (!(dealt > 0)) return;
    match.stats.turretDamage[side] += dealt;
    const per = Number(match.tug.xp.perDamage);
    if (!(Number.isFinite(per) && per > 0)) return;
    const slot = match[side].towers.indexOf(tower);
    if (slot < 0) return;
    const before = tower.xp;
    tugAddXp(match, side, slot, tower, per * dealt);
    match.stats.damageXp[side] += Math.max(0, tower.xp - before);
  }

  // The gold value of a mob kill (gold.perKill[defId]; 0 when missing) and of a turret kill (turret.cost +
  // gold.towerKillBonus + gold.towerKillPerLevel x the turret's level, so 4 + 0 + 0 = 4 at level 0 and 4 + 0 + 3 = 7 at
  // level 3 with tug pass 8's numbers; the attacker's xp share uses the same value).
  function tugMobValue(match, defId) {
    const table = match.tug.gold.perKill;
    const v = Number(isPlainObject(table) ? table[defId] : NaN);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function tugTowerValue(match, tower) {
    const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const base = isPlainObject(match.tug.turret) ? fin(match.tug.turret.cost) : 0;
    const G = match.tug.gold;
    return Math.max(0, base + fin(G.towerKillBonus) + fin(G.towerKillPerLevel) * (tower.level || 0));
  }

  // The log suffix for a payout: " (+3 gold)", or "" when nothing was paid.
  function tugGoldNote(paid) {
    return paid > 0 ? ` (+${tugNum(paid)} gold)` : "";
  }

  function tugAgeHits(match, dt) {
    if (match.hits.length === 0) return;
    const keep = [];
    for (const h of match.hits) {
      h.age += dt;
      if (h.age < TUG_HIT_SECONDS - 1e-9) keep.push(h);
    }
    match.hits = keep;
  }

  // dmg from unit (side's mob) on an enemy tower the caller has checked is still in its slot and hittable: lastHitAt,
  // mobDamage (capped at the hp it had), a hit marker at the slot; at hp <= 0 it falls (slot null, rubble,
  // towersDestroyed, lostBuilding, tugTowerValue paid via tugPayKill "mob", log "<name> <verb> … Turret", tugKillXp).
  // True if it fell. tugHit (verb "destroyed") and the Brute's structure blow (verb "blew up").
  function tugDamageTower(match, side, unit, slot, tower, dmg, name, verb) {
    const enemy = other(side);
    const E = match[enemy];
    unit.lastHitAt = match.clock;
    const towerHpBefore = tower.hp;
    tower.hp -= dmg;
    match.stats.mobDamage[side][unit.defId] += Math.min(dmg, Math.max(0, towerHpBefore));
    const p = match.tug.slots[enemy][slot];
    tugRecordHit(match, p.x, p.y, dmg, side);
    if (tower.hp <= 0) {
      E.towers[slot] = null;
      E.rubble[slot] = tugRubbleSeconds(match);
      match.stats.towersDestroyed[enemy] += 1;
      if (tower.building) match.stats.lostBuilding[enemy] += 1;
      const value = tugTowerValue(match, tower);
      const paid = tugPayKill(match, side, value, p.x, p.y, "mob");
      match.stats.mobKillValue[side][unit.defId] += paid;
      addLog(match, `${SIDE_LABEL[side]} ${name} ${verb} ${SIDE_LABEL[enemy]} ${TUG_TURRET_NAME} L${tower.level} (slot ${slot + 1})${tugGoldNote(paid)}.`);
      tugKillXp(match, side, value, null);
      return true;
    }
    return false;
  }

  // Gate pay (2026-10-17, finish levers): gold.perGateDamage > 0 = `dealt` points of gate damage by side's mobs go
  // into S.gateGoldBank and every perGateDamage points banked pay side 1 whole gold (gold, goldEarned,
  // goldBySource.gate; the remainder stays banked), with one "gold" event on match.hits at (x, y) for the total, as a
  // kill does. Off (not a finite number > 0) or nothing dealt = nothing. The crumble never comes here (nobody dealt
  // it). Returns the gold paid (for the log line).
  function tugPayGateDamage(match, side, dealt, x, y) {
    const per = Number(match.tug.gold.perGateDamage);
    if (!(Number.isFinite(per) && per > 0) || !(dealt > 0)) return 0;
    const S = match[side];
    S.gateGoldBank = (Number(S.gateGoldBank) || 0) + dealt;
    let paid = 0;
    for (let i = 0; i < 1000 && S.gateGoldBank >= per - 1e-9; i += 1) { // capped: defensive only
      S.gateGoldBank -= per;
      S.gold += 1;
      match.stats.goldEarned[side] += 1;
      match.stats.goldBySource[side].gate += 1;
      paid += 1;
    }
    if (paid > 0) match.hits.push({ x, y, amount: paid, side, age: 0, kind: "gold" });
    return paid;
  }

  // damage from unit (side's mob) on the enemy gate (nothing when it is already at 0): lastHitAt, gate hp (never
  // below 0) and lives, gateDamage and mobDamage by the hp taken, a hit marker at (unit.x, gate line), gate pay
  // (tugPayGateDamage; off by default). Log: blow false (tugHit) = "hit the … gate" only on a TUG_GATE_LOG_STEP
  // crossing or the last hp; blow true (the Brute's structure blow) = "blew up at the … gate" every time; either line
  // gains " (+N gold)" only when gate pay paid on that hit. Returns the hp taken.
  function tugDamageGate(match, side, unit, damage, name, blow) {
    const enemy = other(side);
    const E = match[enemy];
    const G = E.gate;
    if (G.hp <= 0) return 0;
    unit.lastHitAt = match.clock;
    const before = G.hp;
    G.hp = Math.max(0, G.hp - damage);
    E.lives = G.hp;
    match.stats.gateDamage[side] += before - G.hp;
    match.stats.mobDamage[side][unit.defId] += before - G.hp;
    match.stats.mobGateDamage[side][unit.defId] += before - G.hp;
    tugRecordHit(match, unit.x, G.y, before - G.hp, side);
    const paid = tugPayGateDamage(match, side, before - G.hp, unit.x, G.y);
    const lostSteps = (hp) => Math.floor((G.maxHp - hp) / TUG_GATE_LOG_STEP + 1e-9);
    if (blow) {
      addLog(match, `${SIDE_LABEL[side]} ${name} blew up at the ${SIDE_LABEL[enemy]} gate: gate ${tugNum(G.hp)}/${G.maxHp}${tugGoldNote(paid)}.`);
    } else if (G.hp <= 0 || lostSteps(G.hp) > lostSteps(before)) {
      addLog(match, `${SIDE_LABEL[side]} ${name} hit the ${SIDE_LABEL[enemy]} gate: gate ${tugNum(G.hp)}/${G.maxHp}${tugGoldNote(paid)}.`);
    }
    return before - G.hp;
  }

  // One instant mob hit: mobDmg (when a finite number >= 0, else dmg) on a mob, dmg on a tower, gateDmg (else dmg) on
  // the gate. A target already gone this tick (killed, destroyed or removed by an earlier hit) wastes the hit. The
  // killing blow on an enemy mob pays the hitter's side that mob's gold value; destroying a turret (finished or under
  // construction) pays tugTowerValue (turret.cost + towerKillBonus + towerKillPerLevel x its level: 4 at level 0, 7 at
  // level 3 since tug pass 8) and leaves its slot
  // as rubble for build.rubbleSeconds; either way every turret of the hitter's side earns xp.unitKillShare of it
  // (tugPayKill, tugKillXp). Tug pass 11: a mob with splashPx > 0 (the Wisp) also deals the same damage to every other
  // living enemy mob within splashPx of the victim (victim first, then the others in id order; a victim this hit killed
  // still splashes; never on a tower or the gate). A turret under construction is never hit while turret.buildSafe is on,
  // except by a mob whose spec has hitsBuilding (the Tank, breakthrough). The tower and gate bodies live in
  // tugDamageTower / tugDamageGate (balance sweep 1, 2026-10-17: the Brute's structure blow reuses them).
  function tugHit(match, hit) {
    const unit = hit.unit;
    const spec = hit.spec;
    const target = hit.target;
    const side = unit.owner;
    const enemy = other(side);
    const E = match[enemy];
    const name = CREEP_BY_ID[unit.defId].name;
    if (target.kind === "mob") {
      const victim = target.unit;
      if (!tugAlive(victim)) return;
      const dmg = Number.isFinite(spec.mobDmg) && spec.mobDmg >= 0 ? spec.mobDmg : spec.dmg;
      unit.lastHitAt = match.clock;
      const strike = (mob) => {
        const hpBefore = mob.hp;
        mob.hp -= dmg;
        match.stats.mobDamage[side][unit.defId] += Math.min(dmg, Math.max(0, hpBefore));
        tugRecordHit(match, mob.x, mob.y, dmg, side);
        if (mob.hp <= 0) {
          mob.isDefeated = true;
          match.stats.mobKills[side] += 1;
          const value = tugMobValue(match, mob.defId);
          const paid = tugPayKill(match, side, value, mob.x, mob.y, "mob");
          match.stats.mobKillValue[side][unit.defId] += paid;
          addLog(match, `${SIDE_LABEL[side]} ${name} killed ${SIDE_LABEL[enemy]} ${CREEP_BY_ID[mob.defId].name}${tugGoldNote(paid)}.`);
          tugKillXp(match, side, value, null);
        }
      };
      strike(victim);
      const splashPx = Number(spec.splashPx);
      if (Number.isFinite(splashPx) && splashPx > 0) {
        const vx = victim.x;
        const vy = victim.y;
        for (const mob of E.units) {
          if (mob === victim || !tugAlive(mob)) continue;
          if (Math.hypot(mob.x - vx, mob.y - vy) <= splashPx) strike(mob);
        }
      }
      return;
    }
    if (target.kind === "tower") {
      const tower = target.tower;
      if (E.towers[target.slot] !== tower) return;
      if (tower.building && tugBuildSafe(match) && !(spec.hitsBuilding === true)) return;
      tugDamageTower(match, side, unit, target.slot, tower, spec.dmg, name, "destroyed");
      return;
    }
    tugDamageGate(match, side, unit, Number.isFinite(spec.gateDmg) ? spec.gateDmg : spec.dmg, name, false);
  }

  // Remove the dead (tug has no poison, so every kill was credited when it happened).
  function tugCleanup(match) {
    for (const side of SIDES) {
      const S = match[side];
      let write = 0;
      for (let i = 0; i < S.units.length; i += 1) {
        const unit = S.units[i];
        if (unit.hp <= 0) unit.isDefeated = true;
        if (!unit.isDefeated) {
          S.units[write] = unit;
          write += 1;
        }
      }
      S.units.length = write;
    }
  }

  // Statuses, targets (with engagement width), hits, movement, cleanup (see the section comment for the order).
  function stepTugUnits(match, dt) {
    const T = match.tug;
    const width = Math.max(1, Math.floor(Number(T.combat.engagementWidth)) || 1);
    for (const side of SIDES) {
      const S = match[side];
      S.gate.attackers = 0;
      for (const tower of S.towers) if (tower) tower.attackers = 0;
      for (const unit of S.units) {
        unit.attackers = 0;
        if (tugAlive(unit)) tugTickStatuses(unit, dt);
      }
    }
    // Tug pass 11: charges are checked before any target is picked; a charging unit skips the pick and the walk.
    tugChargeSight(match);
    // Units that had a target last tick claim first (in list order, Player then AI), then the rest.
    const order = [];
    for (const side of SIDES) for (const unit of match[side].units) if (tugAlive(unit) && !unit.charging && unit.targetKind !== null) order.push(unit);
    for (const side of SIDES) for (const unit of match[side].units) if (tugAlive(unit) && !unit.charging && unit.targetKind === null) order.push(unit);
    const hits = [];
    const walkers = { player: [], ai: [] };
    for (const unit of order) {
      const spec = T.mobs[unit.defId];
      unit.attackTimer = Math.max(0, unit.attackTimer - dt * (unit.slowTimer > 0 ? unit.slowAttack : 1));
      const target = tugPickTarget(match, unit, spec, width);
      if (!target) {
        unit.targetKind = null;
        unit.targetId = null;
        walkers[unit.owner].push(unit);
        continue;
      }
      unit.targetKind = target.kind;
      if (target.kind === "mob") {
        target.unit.attackers += 1;
        unit.targetId = target.unit.id;
      } else if (target.kind === "tower") {
        target.tower.attackers += 1;
        unit.targetId = target.slot;
      } else {
        match[other(unit.owner)].gate.attackers += 1;
        unit.targetId = null;
      }
      if (unit.attackTimer <= 1e-9) {
        hits.push({ unit, spec, target });
        unit.attackTimer += spec.rate;
      }
    }
    for (const hit of hits) tugHit(match, hit);
    tugChargeMove(match, dt);
    for (const side of SIDES) {
      const dir = tugDir(side);
      const list = walkers[side];
      list.sort((a, b) => (b.y * dir - a.y * dir) || (a.id - b.id));
      for (const unit of list) {
        if (tugAlive(unit)) tugWalk(match, unit, dt);
      }
    }
    tugCleanup(match);
  }

  // ------------------------------------------------------ tug charge (pass 11)

  // A mob spec's charge block when it has a non-empty targets list (an array of mob ids, or a comma string), as
  // { C, targets }, else null.
  function tugChargeSpec(spec) {
    const C = spec && isPlainObject(spec.charge) ? spec.charge : null;
    if (!C) return null;
    const raw = Array.isArray(C.targets) ? C.targets : (typeof C.targets === "string" ? C.targets.split(",") : []);
    const targets = raw.map((t) => String(t).trim()).filter((t) => t !== "");
    return targets.length > 0 ? { C, targets } : null;
  }

  // unit.charging (balance sweep 1, 2026-10-17): an enemy mob's id (a number, as since pass 11), "tower:<slot>" (the
  // enemy slot index) or "gate"; always truthy. Resolved to { kind: "mob", unit } | { kind: "tower", slot, tower } |
  // { kind: "gate", gate } with x, y (mob: its position; tower: its slot; gate: (lane.x, gate line)), or null when gone:
  // a dead mob, an empty slot, a turret under construction while turret.buildSafe (the Brute has no hitsBuilding), a
  // gate at 0.
  function tugChargeTarget(match, enemy, charging) {
    const E = match[enemy];
    if (typeof charging !== "string") {
      const unit = findUnitById(match, enemy, charging);
      return unit && tugAlive(unit) ? { kind: "mob", unit, x: unit.x, y: unit.y } : null;
    }
    if (charging === "gate") {
      const gate = E.gate;
      return gate && gate.hp > 0 ? { kind: "gate", gate, x: match.tug.lane.x, y: gate.y } : null;
    }
    if (charging.indexOf("tower:") === 0) {
      const slot = Number(charging.slice(6));
      const tower = E.towers[slot];
      if (!tower || (tower.building && tugBuildSafe(match))) return null;
      const p = match.tug.slots[enemy][slot];
      return { kind: "tower", slot, tower, x: p.x, y: p.y };
    }
    return null;
  }

  // Before the targets are picked: a charging unit whose target is gone (tugChargeTarget null; a structure charge also
  // while charge.structures is off) drops the charge (back to normal: targetKind null); a living unit with a charge
  // spec that is not charging starts one on the nearest living enemy unit whose defId is in charge.targets within
  // charge.sightPx (a circle, or along the lane only while combat.laneBand is on; contact and movement in tugChargeMove
  // stay circles; ties to the lower id). Only when none is in sight and charge.structures is true: the nearest enemy
  // turret (finished, or building while buildSafe is off) or the enemy gate (hp > 0) within sightPx, measured the same
  // way (a tie goes to the lower slot, a turret before the gate). A charging unit has targetKind "charge" and targetId
  // its charging value, and attacks no one. Player first, then AI.
  function tugChargeSight(match) {
    const laneBand = tugLaneBand(match);
    for (const side of SIDES) {
      const enemy = other(side);
      for (const unit of match[side].units) {
        if (!tugAlive(unit)) continue;
        const cs = tugChargeSpec(match.tug.mobs[unit.defId]);
        if (!cs) {
          if (unit.charging) {
            unit.charging = null;
            unit.targetKind = null;
            unit.targetId = null;
          }
          continue;
        }
        if (unit.charging) {
          const off = typeof unit.charging === "string" && cs.C.structures !== true;
          const t = off ? null : tugChargeTarget(match, enemy, unit.charging);
          if (t) {
            unit.targetKind = "charge";
            unit.targetId = unit.charging;
            continue;
          }
          unit.charging = null;
          unit.targetKind = null;
          unit.targetId = null;
        }
        const sight = Number(cs.C.sightPx);
        if (!(Number.isFinite(sight) && sight > 0)) continue;
        let best = null;
        let bestDist = Infinity;
        for (const e of match[enemy].units) {
          if (!tugAlive(e) || cs.targets.indexOf(e.defId) < 0) continue;
          const d = tugReachDist(laneBand, unit.x, unit.y, e.x, e.y);
          if (d <= sight && d < bestDist) {
            bestDist = d;
            best = e;
          }
        }
        if (!best) {
          if (cs.C.structures !== true) continue;
          let pick = null;
          const towers = match[enemy].towers;
          for (let i = 0; i < towers.length; i += 1) {
            const s = tugChargeTarget(match, enemy, `tower:${i}`);
            if (!s) continue;
            const d = tugReachDist(laneBand, unit.x, unit.y, s.x, s.y);
            if (d <= sight && d < bestDist) {
              bestDist = d;
              pick = s;
            }
          }
          const g = tugChargeTarget(match, enemy, "gate");
          if (g) {
            const d = tugReachDist(laneBand, unit.x, unit.y, g.x, g.y);
            if (d <= sight && d < bestDist) {
              bestDist = d;
              pick = g;
            }
          }
          if (!pick) continue;
          const key = pick.kind === "gate" ? "gate" : `tower:${pick.slot}`;
          unit.charging = key;
          unit.targetKind = "charge";
          unit.targetId = key;
          const what = pick.kind === "gate"
            ? `the ${SIDE_LABEL[enemy]} gate`
            : `${SIDE_LABEL[enemy]} ${TUG_TURRET_NAME} L${pick.tower.level} (slot ${pick.slot + 1})`;
          addLog(match, `${SIDE_LABEL[side]} ${CREEP_BY_ID[unit.defId].name} charges ${what}.`);
          continue;
        }
        unit.charging = best.id;
        unit.targetKind = "charge";
        unit.targetId = best.id;
        addLog(match, `${SIDE_LABEL[side]} ${CREEP_BY_ID[unit.defId].name} charges ${SIDE_LABEL[enemy]} ${CREEP_BY_ID[best.defId].name}.`);
      }
    }
  }

  // After the hits, before the walkers: each living charging unit (Player first, then AI, list order) whose target
  // (tugChargeTarget: a mob, a turret's slot, or the gate at (lane.x, gate line)) is still there blows up at once when
  // within charge.contactPx, else runs charge.speed (x slowMove while slowed) x dt straight at the target's current
  // position (both axes, never past it; no engagement width, columns or gate line), then blows up if now within
  // contactPx. A target killed or destroyed earlier this tick leaves the charge to be dropped next tick.
  function tugChargeMove(match, dt) {
    for (const side of SIDES) {
      const enemy = other(side);
      for (const unit of match[side].units) {
        if (!tugAlive(unit) || !unit.charging) continue;
        const cs = tugChargeSpec(match.tug.mobs[unit.defId]);
        if (!cs) continue;
        const target = tugChargeTarget(match, enemy, unit.charging);
        if (!target) continue;
        const contact = Math.max(0, Number(cs.C.contactPx) || 0);
        let d = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (d <= contact) {
          tugChargeBlow(match, unit, target, cs.C);
          continue;
        }
        const speed = Math.max(0, Number(cs.C.speed) || 0) * (unit.slowTimer > 0 ? unit.slowMove : 1);
        const stride = Math.min(d, speed * dt);
        if (d > 0 && stride > 0) {
          unit.x += ((target.x - unit.x) / d) * stride;
          unit.y += ((target.y - unit.y) / d) * stride;
          tugPlace(match, unit);
        }
        d = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (d <= contact) tugChargeBlow(match, unit, target, cs.C);
      }
    }
  }

  // Contact (hit = tugChargeTarget's result). A mob: charge.kill true = the target's hp goes to 0; false = it takes
  // charge.dmg. The charger dies either way (no kill credit, gold, xp or mobKills to anyone). A target that died is the
  // charger side's kill: stats.mobKills, its gold.perKill (tugPayKill at the target), tugKillXp (null source), log
  // "blew up"; one that survived logs "hit … for". A turret or the gate (charge.structures): the charger dies, then
  // charge.structureDmg through tugDamageTower (a fall logs "blew up", a survivor "hit … for") / tugDamageGate (log
  // "blew up at the … gate" every blow); mobDamage is counted inside them.
  function tugChargeBlow(match, unit, hit, C) {
    const side = unit.owner;
    const enemy = other(side);
    const name = CREEP_BY_ID[unit.defId].name;
    if (hit.kind === "tower") {
      const dmg = Math.max(0, Number(C.structureDmg) || 0);
      unit.hp = 0;
      unit.isDefeated = true;
      const level = hit.tower.level;
      if (!tugDamageTower(match, side, unit, hit.slot, hit.tower, dmg, name, "blew up")) {
        addLog(match, `${SIDE_LABEL[side]} ${name} hit ${SIDE_LABEL[enemy]} ${TUG_TURRET_NAME} L${level} (slot ${hit.slot + 1}) for ${tugNum(dmg)}.`);
      }
      return;
    }
    if (hit.kind === "gate") {
      const dmg = Math.max(0, Number(C.structureDmg) || 0);
      unit.hp = 0;
      unit.isDefeated = true;
      tugDamageGate(match, side, unit, dmg, name, true);
      return;
    }
    const target = hit.unit;
    const targetName = CREEP_BY_ID[target.defId].name;
    const hpBefore = target.hp;
    const kill = C.kill !== false;
    const dmg = kill ? hpBefore : Math.max(0, Number(C.dmg) || 0);
    target.hp = kill ? 0 : target.hp - dmg;
    match.stats.mobDamage[side][unit.defId] += kill ? hpBefore : Math.min(dmg, Math.max(0, hpBefore));
    tugRecordHit(match, target.x, target.y, kill ? hpBefore : dmg, side);
    unit.hp = 0;
    unit.isDefeated = true;
    if (target.hp <= 0) {
      target.isDefeated = true;
      match.stats.mobKills[side] += 1;
      const value = tugMobValue(match, target.defId);
      const paid = tugPayKill(match, side, value, target.x, target.y, "mob");
      match.stats.mobKillValue[side][unit.defId] += paid;
      addLog(match, `${SIDE_LABEL[side]} ${name} blew up ${SIDE_LABEL[enemy]} ${targetName}${tugGoldNote(paid)}.`);
      tugKillXp(match, side, value, null);
    } else {
      addLog(match, `${SIDE_LABEL[side]} ${name} hit ${SIDE_LABEL[enemy]} ${targetName} for ${tugNum(dmg)}.`);
    }
  }

  // How far forward unit may move before it is closer than combat.columnSpacingPx behind an ally further along the
  // lane (equal position: the lower id is ahead) within TUG_COLUMN_LATERAL_PX across; Infinity with no such ally, and
  // always Infinity when columnSpacingPx is 0 (off: before tug pass 4 a spacing of 0 still capped a faster mob at the
  // distance to the ally ahead, so it caught up and then walked welded to it at the ally's pace).
  function tugColumnRoom(match, unit) {
    const spacing = Math.max(0, Number(match.tug.combat.columnSpacingPx) || 0);
    if (!(spacing > 0)) return Infinity;
    const dir = tugDir(unit.owner);
    const f0 = unit.y * dir;
    let room = Infinity;
    for (const ally of match[unit.owner].units) {
      if (ally === unit || !tugAlive(ally)) continue;
      if (Math.abs(ally.x - unit.x) > TUG_COLUMN_LATERAL_PX) continue;
      const fa = ally.y * dir;
      if (fa < f0 || (fa === f0 && ally.id > unit.id)) continue;
      const r = Math.max(0, fa - f0 - spacing);
      if (r < room) room = r;
    }
    return room;
  }

  // One walker's step: straight along its x toward the enemy gate line. Column spacing caps the step (so it keeps its
  // leader's pace and stops when the leader stops); never past the gate line.
  function tugWalk(match, unit, dt) {
    const T = match.tug;
    const side = unit.owner;
    const enemy = other(side);
    const dir = tugDir(side);
    const stride = Math.max(0, unit.speed * dt);
    let my = dir * stride;
    const forward = my * dir;
    if (forward > 0) {
      const room = tugColumnRoom(match, unit);
      if (forward > room) my *= room / forward;
    }
    unit.y += my;
    const line = T.lane.gateY[enemy];
    unit.y = side === "player" ? Math.max(line, unit.y) : Math.min(line, unit.y);
    tugPlace(match, unit);
  }

  // --------------------------------------------------------- tug turrets

  // Up to count living mobs within range px of from, by targeting: "nearest", or "lowestHp" / "highestHp" with hp ties
  // to the nearest; distance ties go to the lower id (the list is in id order). band = measure along the lane only
  // (|dy|; combat.laneBand), else the straight-line distance.
  function tugPickShots(from, enemies, range, count, targeting, band) {
    const picked = [];
    for (let n = 0; n < count; n += 1) {
      let best = null;
      let bestD = Infinity;
      for (const e of enemies) {
        if (!tugAlive(e) || picked.indexOf(e) >= 0) continue;
        const d = tugReachDist(band, from.x, from.y, e.x, e.y);
        if (d > range) continue;
        if (best === null) {
          best = e;
          bestD = d;
          continue;
        }
        let better;
        if (targeting === "lowestHp" && e.hp !== best.hp) better = e.hp < best.hp;
        else if (targeting === "highestHp" && e.hp !== best.hp) better = e.hp > best.hp;
        else better = d < bestD;
        if (better) {
          best = e;
          bestD = d;
        }
      }
      if (!best) break;
      picked.push(best);
    }
    return picked;
  }

  // How many living mobs are within range px of from (the same distance test as tugPickShots, no targeting): the soak flag's "was someone else in range".
  function tugCountInRange(from, enemies, range, band) {
    let n = 0;
    for (const e of enemies) {
      if (tugAlive(e) && tugReachDist(band, from.x, from.y, e.x, e.y) <= range) n += 1;
    }
    return n;
  }

  // A homing shot in frame px (tug projectiles never use the normalised fields).
  function tugSpawnShot(match, from, target, damage, towerId, owner, slow, splashPx, source, drawn) {
    match.projectiles.push({
      id: match.nextProjectileId,
      x: from.x,
      y: from.y,
      prevX: from.x,
      prevY: from.y,
      targetId: target.id,
      targetOwner: target.owner,
      damage,
      speed: match.tug.combat.projectileSpeedPx,
      towerId,     // "turret", or "gate" for a gate gun
      owner,
      slow,        // the turret's slow at fire time (slow trait >= 1) or null
      splashPx,    // > 0: full damage to every enemy mob this close to the target (splash trait >= 1)
      source,      // the turret that fired (its kills earn it xp while it still stands), or null for a gate gun
      drawn,       // true when another living enemy mob was also in the shooter's range at fire time (a shot that could have gone to someone else): the primary target's soak
      color: source ? tugTurretLook(source).color : TUG_GATE_GUN_COLOR // the shooter's tint at fire time (snapshot)
    });
    match.nextProjectileId += 1;
  }

  // Every finished turret (one under construction never fires and its cooldown waits), then each side's gate gun (from
  // the gate line's centre, nearest target, while gate.gun.enabled): the cooldown counts down; at 0 with a target in
  // range, one shot per target and the cooldown restarts at rate. Lane-bands (2026-10-08): with combat.laneBand on,
  // "in range" for a turret and for the gate gun is the distance along the lane only (|dy|), not a circle.
  function tugTowerFire(match, dt) {
    const T = match.tug;
    const gun = T.gate.gun;
    for (const side of SIDES) {
      const S = match[side];
      const enemies = match[other(side)].units;
      const slots = T.slots[side];
      for (let i = 0; i < S.towers.length; i += 1) {
        const tower = S.towers[i];
        if (!tower || tower.building) continue;
        tower.cooldown -= dt;
        if (tower.cooldown > 1e-9) continue;
        const targets = tugPickShots(slots[i], enemies, tower.range, tower.targets, tower.targeting, tugLaneBand(match));
        if (targets.length === 0) continue;
        const inRange = tugCountInRange(slots[i], enemies, tower.range, tugLaneBand(match));
        for (const target of targets) tugSpawnShot(match, slots[i], target, tower.dmg, tower.id, side, tower.slow, tower.splashPx, tower, inRange > targets.length);
        tower.cooldown = tower.rate;
      }
      if (!gun.enabled) continue;
      S.gate.gunCooldown -= dt;
      if (S.gate.gunCooldown > 1e-9) continue;
      const from = { x: T.lane.x, y: T.lane.gateY[side] };
      const targets = tugPickShots(from, enemies, gun.range, 1, "nearest", tugLaneBand(match));
      if (targets.length === 0) continue;
      const inRange = tugCountInRange(from, enemies, gun.range, tugLaneBand(match));
      tugSpawnShot(match, from, targets[0], gun.dmg, "gate", side, null, 0, null, inRange > 1);
      S.gate.gunCooldown = gun.rate;
    }
  }

  // A mob's turretDamageTaken (tug pass 10: the Tank's 0.5) from the resolved mobs table, so a panel override counts; a missing or invalid value is 1.
  function tugTurretDamageTaken(match, defId) {
    const spec = match.tug.mobs[defId];
    const f = spec ? spec.turretDamageTaken : undefined;
    return Number.isFinite(f) && f >= 0 ? f : 1;
  }

  // Turret or gun damage on one mob: raw x counters (when on; the gun has no counter row), then x the victim's turretDamageTaken for a turret's hit (not the gun; tug pass 10). A turret's hit (source =
  // the turret: its shot, splash or chain) first pays it damage xp (tugDamageXp, overkill not counted); the gun pays
  // none. At 0 hp it is a kill for owner: a turret kill (source earns the xp) or a gun kill (towerId "gate": every
  // turret of owner shares), paid once (tugPayKill, tugKillXp); a mob already dead is never hit again.
  function tugDamageMob(match, victim, raw, towerId, owner, source) {
    if (!tugAlive(victim) || !(raw > 0)) return 0;
    let damage = raw * counterMultiplier(match, towerId, victim.defId);
    if (towerId !== "gate") damage *= tugTurretDamageTaken(match, victim.defId);
    const hpBefore = victim.hp;
    victim.hp -= damage;
    tugRecordHit(match, victim.x, victim.y, damage, owner);
    if (source && towerId !== "gate") tugDamageXp(match, owner, source, Math.min(damage, hpBefore));
    if (victim.hp <= 0) {
      victim.isDefeated = true;
      const gun = towerId === "gate";
      match.stats.kills[owner] = (match.stats.kills[owner] || 0) + 1;
      match.stats[gun ? "gunKills" : "towerKills"][owner] += 1;
      const value = tugMobValue(match, victim.defId);
      const paid = tugPayKill(match, owner, value, victim.x, victim.y, gun ? "gun" : "turret");
      const killer = gun ? "gate gun" : (towerId === TUG_TURRET_ID ? TUG_TURRET_NAME : towerId);
      addLog(match, `${SIDE_LABEL[owner]} ${killer} killed ${SIDE_LABEL[victim.owner]} ${CREEP_BY_ID[victim.defId].name}${tugGoldNote(paid)}.`);
      tugKillXp(match, owner, value, gun ? null : (source || null));
    }
    return Math.min(damage, Math.max(0, hpBefore));
  }

  // A slow for slow.seconds x fraction (a longer one in force is kept): move speed x slow.move, attack drain x slow.attack.
  function tugApplySlow(unit, slow, fraction) {
    const seconds = (Number(slow.seconds) || 0) * fraction;
    if (!(seconds > 0) || !tugAlive(unit)) return;
    unit.slowTimer = Math.max(unit.slowTimer, seconds);
    unit.slowMove = Number.isFinite(slow.move) ? slow.move : 1;
    unit.slowAttack = Number.isFinite(slow.attack) ? slow.attack : 1;
  }

  // The nearest other living mob of the target's side within maxPx of it (the slow trait's chain), or null.
  function tugChainTarget(match, target, maxPx) {
    let best = null;
    let bestDist = Infinity;
    for (const unit of match[target.owner].units) {
      if (unit === target || !tugAlive(unit)) continue;
      const d = Math.hypot(unit.x - target.x, unit.y - target.y);
      if (d <= maxPx && d < bestDist) {
        bestDist = d;
        best = unit;
      }
    }
    return best;
  }

  // A shot lands: damage on the target; a slow shot slows it and chains once to the nearest other enemy mob within
  // chainPx (chainFraction of the damage and of the seconds); a splash shot deals its full damage to every other enemy
  // mob within splashPx of the target (bursts for the page).
  function tugShotHit(match, p, target) {
    const tx = target.x;
    const ty = target.y;
    const taken = tugDamageMob(match, target, p.damage, p.towerId, p.owner, p.source);
    if (p.drawn && taken > 0) match.stats.mobSoak[target.owner][target.defId] += p.damage;
    const slow = p.slow;
    if (slow) {
      tugApplySlow(target, slow, 1);
      const fraction = Number(slow.chainFraction) || 0;
      if (slow.chainPx > 0 && fraction > 0) {
        const chain = tugChainTarget(match, target, slow.chainPx);
        if (chain) {
          tugDamageMob(match, chain, p.damage * fraction, p.towerId, p.owner, p.source);
          tugApplySlow(chain, slow, fraction);
        }
      }
    }
    if (p.splashPx > 0) {
      match.bursts.push({ x: tx, y: ty, life: K.burstLifeSeconds, maxLife: K.burstLifeSeconds, center: true });
      for (const unit of match[target.owner].units) {
        if (unit === target || !tugAlive(unit)) continue;
        if (Math.hypot(unit.x - tx, unit.y - ty) <= p.splashPx) {
          match.bursts.push({ x: unit.x, y: unit.y, life: K.burstLifeSeconds, maxLife: K.burstLifeSeconds, center: false });
          tugDamageMob(match, unit, p.damage, p.towerId, p.owner, p.source);
        }
      }
    }
  }

  // Shots home at their own speed (frame px per second) and land on the tick they would reach the target; a shot whose
  // target is gone is dropped.
  function updateTugProjectiles(match, dt) {
    if (match.projectiles.length === 0) return;
    const still = [];
    for (const p of match.projectiles) {
      const target = findUnitById(match, p.targetOwner, p.targetId);
      if (!target || !tugAlive(target)) continue;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.hypot(dx, dy);
      p.prevX = p.x;
      p.prevY = p.y;
      const stride = p.speed > 0 ? p.speed * dt : Infinity;
      if (dist <= stride) {
        p.x = target.x;
        p.y = target.y;
        tugShotHit(match, p, target);
        continue;
      }
      p.x += (dx / dist) * stride;
      p.y += (dy / dist) * stride;
      still.push(p);
    }
    match.projectiles = still;
  }

  // ------------------------------------------------------ tug economy and end

  // gold.dripSeconds > 0: one gold to each side every that many seconds of match time (the timer runs from match start,
  // counted as earned); 0 or less = no drip.
  function stepTugDrip(match, dt) {
    const period = Number(match.tug.gold.dripSeconds);
    if (!(Number.isFinite(period) && period > 0)) return;
    match.dripTimer += dt;
    while (match.dripTimer >= period - 1e-9) {
      match.dripTimer -= period;
      for (const side of SIDES) {
        match[side].gold += 1;
        match.stats.goldEarned[side] += 1;
        match.stats.goldBySource[side].drip += 1;
      }
    }
  }

  // Each side's build queue. A finished mob leaves the queue and spawns on its own spawn line, x jittered around the
  // lane centre (match.rng), and walks this tick. Player first, then AI (rng order).
  // queue.parallel on (2026-10-16, Baz: "we can't make like an army"): every entry trains at once, remaining -= dt for
  // all of them first, then every entry at 0 spawns in queue order (one rng draw each, in that order), so mobs bought
  // together leave together; more than one spawn per side per tick is possible. S.build is edited in place (nothing
  // else reassigns it).
  // queue.parallel off (the pre-2026-10-16 queue): only the head trains; one spawn per side per tick; time left over
  // after a spawn does not carry into the next head.
  function stepTugQueue(match, dt) {
    const lane = match.tug.lane;
    const parallel = tugQueueParallel(match);
    for (const side of SIDES) {
      const S = match[side];
      if (S.build.length === 0) continue;
      if (parallel) {
        for (const entry of S.build) entry.remaining -= dt;
        const done = [];
        const kept = [];
        for (const entry of S.build) {
          if (entry.remaining > 1e-9) kept.push(entry);
          else done.push(entry);
        }
        if (done.length === 0) continue;
        S.build.length = 0;
        for (const entry of kept) S.build.push(entry);
        for (const entry of done) {
          const x = lane.x + (match.rng() * 2 - 1) * lane.jitterPx;
          S.units.push(makeTugUnit(match, side, entry.defId, x));
          S.spawned += 1;
          match.stats.spawned[side] += 1;
          addLog(match, `${SIDE_LABEL[side]} sent ${CREEP_BY_ID[entry.defId].name}.`);
        }
        continue;
      }
      const head = S.build[0];
      head.remaining -= dt;
      if (head.remaining > 1e-9) continue;
      S.build.shift();
      const x = lane.x + (match.rng() * 2 - 1) * lane.jitterPx;
      S.units.push(makeTugUnit(match, side, head.defId, x));
      S.spawned += 1;
      match.stats.spawned[side] += 1;
      addLog(match, `${SIDE_LABEL[side]} sent ${CREEP_BY_ID[head.defId].name}.`);
    }
  }

  // Construction and rubble, after the queue and before the units. A tower under construction: remaining -= dt; hp is
  // untouched (full from the start since 2026-10-08, "build is a timer"); the reached bookkeeping is kept so a lower
  // start hp would still work. At remaining <= 0 it is up (building null) and the log says so. Each rubble timer
  // counts down to 0 (the log says when a slot is clear). Player first, then AI.
  function stepTugBuild(match, dt) {
    for (const side of SIDES) {
      const S = match[side];
      for (let i = 0; i < S.towers.length; i += 1) {
        const tower = S.towers[i];
        if (!tower || !tower.building) continue;
        const b = tower.building;
        b.remaining -= dt;
        const done = b.remaining <= 1e-9;
        const frac = done ? 1 : clamp(1 - b.remaining / b.seconds, 0, 1);
        const reached = Math.min(tower.maxHp, Math.max(b.reached, tower.maxHp * frac));
        const lost = Math.max(0, b.reached - tower.hp);
        tower.hp = Math.min(tower.maxHp, Math.max(tower.hp, reached - lost));
        b.reached = reached;
        if (done) {
          tower.building = null;
          addLog(match, `${tugTowerLabel(side, i)} is up.`);
        }
      }
      for (let i = 0; i < S.rubble.length; i += 1) {
        if (!(S.rubble[i] > 0)) continue;
        S.rubble[i] -= dt;
        if (S.rubble[i] <= 1e-9) {
          S.rubble[i] = 0;
          addLog(match, `${SIDE_LABEL[side]} slot ${i + 1} is clear.`);
        }
      }
    }
  }

  // Every standing tower whose xp reached its need becomes ready (kills do this at once; the sweep catches xp set from
  // outside, e.g. by the page or a test). Player slots first, then AI (rng order for the offers). Tug pass 9: it is also
  // the per-step check for a maxed turret (tugMaxed) whose full bar waits at or above upgrade.healPool hp: once damage
  // takes it below, this step's sweep makes it ready with ["heal"].
  function tugReadySweep(match) {
    for (const side of SIDES) {
      const towers = match[side].towers;
      for (let i = 0; i < towers.length; i += 1) if (towers[i]) tugCheckReady(match, side, i, towers[i]);
    }
  }

  // The cheapest mob on the price list (Infinity when there is none).
  function tugCheapestMob(match) {
    let min = Infinity;
    for (const c of CREEPS) {
      const cost = match.tug.costs.mob[c.id];
      if (Number.isFinite(cost) && match.tug.mobs[c.id] && cost < min) min = cost;
    }
    return min;
  }

  // stats.idleSeconds: the longest stretch both sides sat with gold below the cheapest mob and empty build queues.
  function tugTrackIdle(match, dt) {
    const cheapest = tugCheapestMob(match);
    const idle = SIDES.every((side) => match[side].gold < cheapest && match[side].build.length === 0);
    match.idleRun = idle ? match.idleRun + dt : 0;
    if (match.idleRun > match.stats.idleSeconds) match.stats.idleSeconds = match.idleRun;
  }

  // The match ends; lives mirror the gates first (so a gate set from outside counts too).
  function finishTug(match, reason) {
    for (const side of SIDES) match[side].lives = match[side].gate.hp;
    match.stats.battles = 1;
    match.stats.battleSeconds = match.clock;
    finishMatch(match, reason);
  }

  // At time.matchSeconds the higher gate wins (result.reason "clock"); equal gates are a draw. Nothing else.
  // time.overtime "crumble" (2026-10-17, finish levers; tugCrumbleRate > 0, else the clock finish above): the match
  // goes on. The tick the clock reaches matchSeconds logs "Overtime: the walls crumble." once; every later tick banks
  // rate x dt in match.crumbleBank and each whole point banked takes 1 hp off both gates (never below 0, lives
  // mirrored; no gold, no gateDamage: nobody dealt it), stopping once a gate is at 0. A gate at 0 ends the match here,
  // with the same check and reason as stepTug's gate check ("gate"; both at 0 together = a draw).
  function tugClockCheck(match, dt) {
    if (match.clock < Number(match.tug.time.matchSeconds) - 1e-9) return;
    const rate = tugCrumbleRate(match.tug);
    if (!(rate > 0)) {
      finishTug(match, "clock");
      return;
    }
    if (!match.crumbling) {
      match.crumbling = true;
      match.crumbleBank = 0;
      addLog(match, "Overtime: the walls crumble.");
      return;
    }
    match.crumbleBank = (Number(match.crumbleBank) || 0) + rate * (Number(dt) > 0 ? Number(dt) : 0);
    while (match.crumbleBank >= 1 - 1e-9 && match.player.gate.hp > 0 && match.ai.gate.hp > 0) {
      match.crumbleBank -= 1;
      for (const side of SIDES) {
        const G = match[side].gate;
        G.hp = Math.max(0, G.hp - 1);
        match[side].lives = G.hp;
      }
    }
    if (match.player.gate.hp <= 0 || match.ai.gate.hp <= 0) {
      finishTug(match, "gate");
      return;
    }
  }

  // A tug tick: hits age, drip, queues, construction and rubble, units, the gate check (a gate at 0 ends the match
  // before tower fire), tower and gun fire, projectiles, bursts, cleanup, the XP sweep, the idle stretch, then the clock
  // (and, in a crumble overtime, the crumble).
  function stepTug(match, dt) {
    if (match.phase !== "live") return;
    tugAgeHits(match, dt);
    stepTugDrip(match, dt);
    stepTugQueue(match, dt);
    stepTugBuild(match, dt);
    stepTugUnits(match, dt);
    if (match.player.gate.hp <= 0 || match.ai.gate.hp <= 0) {
      finishTug(match, "gate");
      return;
    }
    tugTowerFire(match, dt);
    updateTugProjectiles(match, dt);
    updateBursts(match, dt);
    tugCleanup(match);
    tugReadySweep(match);
    tugTrackIdle(match, dt);
    match.clock += dt;
    tugClockCheck(match, dt);
  }

  // Tug runBattle: steps at 1/30 until the match is over, calling onThink(match) at once and then every
  // bot.thinkSeconds of sim time (before that tick's step).
  function runTug(match, onThink) {
    if (match.phase !== "live") return { ok: false, reason: "not live", steps: 0, guardHit: false };
    const think = typeof onThink === "function" ? onThink : null;
    const guard = tugGuardStepsFor(match.tug);
    const every = Number(match.tug.bot.thinkSeconds) > 0 ? Number(match.tug.bot.thinkSeconds) : BATTLE_DT;
    let nextThink = match.clock;
    let steps = 0;
    while (match.phase === "live" && steps < guard) {
      if (think && match.clock >= nextThink - 1e-9) {
        think(match);
        nextThink += every;
        if (match.phase !== "live") break;
      }
      step(match, BATTLE_DT);
      steps += 1;
    }
    if (match.phase === "live") {
      match.stats.guardHits += 1;
      addLog(match, `guard: match force-ended after ${guard} steps.`);
      finishTug(match, "guard");
      return { ok: true, reason: "guard", steps, guardHit: true };
    }
    return { ok: true, reason: match.phase, steps, guardHit: false };
  }

  // Snapshot helpers: where a unit's target is (frame px), and each side's forward-most mob.
  function tugTargetPoint(match, unit) {
    const enemy = other(unit.owner);
    if (unit.targetKind === "mob") {
      const t = findUnitById(match, enemy, unit.targetId);
      return t && tugAlive(t) ? { kind: "mob", x: t.x, y: t.y } : null;
    }
    if (unit.targetKind === "tower") {
      if (!match[enemy].towers[unit.targetId]) return null;
      const p = match.tug.slots[enemy][unit.targetId];
      return { kind: "tower", x: p.x, y: p.y };
    }
    if (unit.targetKind === "gate") return { kind: "gate", x: unit.x, y: match.tug.lane.gateY[enemy] };
    return null;
  }

  // Allies of the unit's side within TUG_STACK_PX of it, itself included (the page's stack badge).
  function tugStack(match, unit) {
    let n = 0;
    for (const ally of match[unit.owner].units) {
      if (!tugAlive(ally)) continue;
      if (Math.hypot(ally.x - unit.x, ally.y - unit.y) <= TUG_STACK_PX) n += 1;
    }
    return n;
  }

  // Tug price list for a side: { towers: { turret: tugTowerPrice } (empty when it has none), mobs: every mob at its
  // cost }.
  function tugPrices(match, side) {
    const towers = {};
    const price = tugTowerPrice(match, side);
    if (price !== null) towers[TUG_TURRET_ID] = price;
    const mobs = {};
    for (const c of CREEPS) {
      const cost = match.tug.costs.mob[c.id];
      if (Number.isFinite(cost) && match.tug.mobs[c.id]) mobs[c.id] = cost;
    }
    return { towers, mobs };
  }

  // The y of side's forward-most living mob, or null (the snapshot's front).
  function tugFront(match, side) {
    let front = null;
    for (const unit of match[side].units) {
      if (!tugAlive(unit)) continue;
      if (front === null || (side === "player" ? unit.y < front : unit.y > front)) front = unit.y;
    }
    return front;
  }

  // ------------------------------------------------------------- round flow

  // Evolves and tug always compare gate hp (mirrored in lives), whatever scoring says.
  function finishMatch(match, reason) {
    const measure = match.evo || match.tug || match.rules.scoring === "lives" ? "lives" : "score";
    const p = match.player[measure];
    const a = match.ai[measure];
    const winner = p === a ? "draw" : (p > a ? "player" : "ai");
    match.result = { winner, reason, round: match.round, measure, player: p, ai: a };
    addLog(match, winner === "draw"
      ? `Match drawn ${p}-${a} (${reason}).`
      : `${SIDE_LABEL[winner]} wins ${p}-${a} (${reason}).`);
    match.phase = "over";
  }

  // 12-rounds.js:284-305 onBattleFinished + 153-162 openRoundShop: income 9 + the round just played (+ send bonus), cap 99.
  // Evolves: a flat roundIncome instead, and the portals rewind so the next battle's first spawn is at time 0.
  function endBattle(match) {
    match.stats.battles += 1;
    match.stats.battleSeconds += match.battleTime;
    for (const side of SIDES) {
      match[side].units = [];
      match[side].pending = [];
    }
    match.projectiles = [];
    match.bursts = [];
    if (match.round >= match.maxRounds) {
      match.phase = "over"; // leave "battle" before the result line so it isn't time-stamped
      finishMatch(match, "rounds");
      return;
    }
    const played = match.round;
    for (const side of SIDES) {
      const S = match[side];
      if (match.evo) {
        S.mana = clamp(S.mana + EV.roundIncome, 0, K.manaCap);
        S.portal.spawnTimer = 0;
      } else {
        S.mana = clamp(S.mana + K.roundIncomeBase + played + S.income, 0, K.manaCap);
      }
    }
    match.round += 1;
    match.phase = "prep";
    match.battleTime = 0;
    addLog(match, "prep.");
  }

  function battleIsOver(match) {
    return match.player.units.length === 0
      && match.ai.units.length === 0
      && match.player.pending.length === 0
      && match.ai.pending.length === 0
      && match.projectiles.length === 0
      && match.bursts.length === 0;
  }

  // One tick, in atw-dev's order (16-effects.js:447-470): attackers, tower fire, tank fire, projectiles, bursts, end check.
  // Evolves: portals spawn first instead of the stream release, and only the battle clock (or a gate) ends the battle.
  // Tug: stepTug (phase "live").
  function step(match, dt) {
    if (match && match.tug) {
      stepTug(match, Number.isFinite(dt) && dt > 0 ? dt : 1 / 60);
      return;
    }
    if (!match || match.phase !== "battle") return;
    const h = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    if (match.evo) spawnFromPortals(match, h);
    else releaseDue(match);
    updateAttackers(match, h);
    if (match.phase !== "battle") return; // lives (or a gate) ran out
    updateTowerFire(match, h);
    updateTankFire(match, h);
    updateProjectiles(match, h);
    updateBursts(match, h);
    match.battleTime += h;
    if (match.evo) {
      if (match.battleTime >= EV.battleSeconds - 1e-9) endBattle(match);
    } else if (battleIsOver(match)) {
      endBattle(match);
    }
  }

  // onThink is tug's (runTug); classic and evolves ignore it.
  function runBattle(match, onThink) {
    if (match && match.tug) return runTug(match, onThink);
    if (!match || match.phase !== "battle") return { ok: false, reason: "not in battle", steps: 0, guardHit: false };
    let steps = 0;
    while (match.phase === "battle" && steps < GUARD_STEPS) {
      step(match, BATTLE_DT);
      steps += 1;
    }
    if (match.phase === "battle") {
      match.stats.guardHits += 1;
      addLog(match, `guard: battle force-ended after ${GUARD_STEPS} steps.`);
      endBattle(match);
      return { ok: true, reason: "guard", steps, guardHit: true };
    }
    return { ok: true, reason: match.phase, steps, guardHit: false };
  }

  // ---------------------------------------------------------------- snapshot

  function countIds(list) {
    const counts = {};
    for (const c of CREEPS) counts[c.id] = 0;
    for (const id of list) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }

  // Evolves portal for drawers: tier (index) and its creep id / letter, position (frame px), interval, maxAlive, ranks,
  // seconds to the next spawn, and how many of its mobs are alive.
  function snapshotPortal(match, side) {
    const S = match[side];
    const P = S.portal;
    const def = CREEP_BY_ID[EV.tiers[P.tier]];
    return {
      tier: P.tier,
      tierId: def.id,
      letter: def.letter,
      name: def.name,
      color: def.color,
      x: EV.portalPos[side].x,
      y: EV.portalPos[side].y,
      interval: P.interval,
      maxAlive: P.maxAlive,
      fasterRank: P.fasterRank,
      moreRank: P.moreRank,
      spawnIn: Math.max(0, P.spawnTimer),
      alive: aliveCount(S.units)
    };
  }

  // A turret's look for drawers: dominant = the trait with the highest rank (ties to the earlier in TUG_DOMINANT_ORDER:
  // splash, slow, multi, heavy, dmg, rate, range, hp; null when every rank is 0, so at level 0), badges = up to three
  // "S2"-style strings (TUG_TRAIT_LETTER + rank) for the top-ranked traits in the same order (ranks > 0 only), color =
  // the dominant trait's tint (splash red, slow yellow, multi blue, heavy green), any other or none grey.
  function tugTurretLook(tower) {
    const ranked = TUG_DOMINANT_ORDER
      .filter((kind) => tower.traits[kind] > 0)
      .sort((a, b) => (tower.traits[b] - tower.traits[a]) || (TUG_DOMINANT_ORDER.indexOf(a) - TUG_DOMINANT_ORDER.indexOf(b)));
    const dominant = ranked.length > 0 ? ranked[0] : null;
    return {
      dominant,
      badges: ranked.slice(0, 3).map((kind) => `${TUG_TRAIT_LETTER[kind]}${tower.traits[kind]}`),
      color: (dominant && TUG_TRAIT_COLOR[dominant]) || TUG_TURRET_COLOR
    };
  }

  // A turret for drawers: the classic fields (range and rangePx in px, a full circle, evolves' upgrades all 0) plus
  // row, dmg, rate, targets, targeting, splashPx, the XP bar: level (levels taken), xp, need, xpFrac (xp / need, 0..1),
  // maxLevel (xp.maxLevel, 0 = no cap) and maxed (tugMaxed; tug pass 9), slots (upgrade.slots, 0 = no limit), owned
  // (distinct traits owned), complete (tugComplete) and caps (each trait's rank cap), traits (a copy of the ranks: range,
  // rate, hp, dmg, splash, slow, multi, heavy), dominant, badges and color (tugTurretLook), ready and offer (a copy of the
  // traits on offer, or null), and building ({ remaining, seconds, progress (0..1) } while under construction, else
  // null).
  function snapshotTugTower(match, side, t, slot) {
    const pos = match.tug.slots[side][slot];
    const b = t.building;
    const look = tugTurretLook(t);
    return {
      slot,
      id: t.id,
      level: t.level,
      x: pos.x,
      y: pos.y,
      row: pos.row,
      hp: t.hp,
      maxHp: t.maxHp,
      cooldown: t.rate > 0 ? clamp(t.cooldown / t.rate, 0, 1) : 0,
      paid: t.paid,
      range: t.range,
      rangePx: { rx: t.range, ry: t.range, band: tugLaneBand(match) },
      coneDegrees: 360,
      dirY: side === "player" ? -1 : 1,
      color: look.color,
      upgrades: { damage: 0, rate: 0, range: 0, hp: 0 },
      dmg: t.dmg,
      rate: t.rate,
      targets: t.targets,
      targeting: t.targeting,
      splashPx: t.splashPx,
      xp: t.xp,
      need: t.need,
      xpFrac: t.need > 0 ? clamp(t.xp / t.need, 0, 1) : (t.ready ? 1 : 0),
      maxLevel: Math.max(0, tugMaxLevel(match)),
      maxed: tugMaxed(match, t),
      slots: tugSlotLimit(match),
      owned: tugOwnedCount(t),
      complete: tugComplete(match, t),
      caps: TUG_TRAIT_KINDS.reduce((caps, kind) => { caps[kind] = tugTraitCap(match, kind); return caps; }, {}),
      traits: Object.assign({}, t.traits),
      dominant: look.dominant,
      badges: look.badges,
      ready: t.ready,
      offer: Array.isArray(t.offer) ? t.offer.slice() : null,
      building: b
        ? { remaining: Math.max(0, b.remaining), seconds: b.seconds, progress: b.seconds > 0 ? clamp(1 - b.remaining / b.seconds, 0, 1) : 1 }
        : null
    };
  }

  // The build queue for drawers: [{ defId, letter, remaining, seconds, progress (0..1; every entry moves while queue.parallel, else only the head) }].
  function snapshotBuild(S) {
    return S.build.map((b) => ({
      defId: b.defId,
      letter: CREEP_BY_ID[b.defId].letter,
      remaining: Math.max(0, b.remaining),
      seconds: b.seconds,
      progress: b.seconds > 0 ? clamp(1 - b.remaining / b.seconds, 0, 1) : 0
    }));
  }

  // Tug: mana is null; adds gold, build (snapshotBuild), queued, spawned and built, slots ([{ x, y, row }] frame px;
  // null elsewhere), and on each unit target ({ kind, x, y } frame px, or null), attacking (a hit in the last
  // TUG_ATTACK_FLASH s) and stack (allies within TUG_STACK_PX, itself included; null elsewhere). Tug only (the keys
  // are absent elsewhere, so classic and evolves snapshots keep their shape): rubble (seconds left per slot, 0 when
  // clear) and slotStates ("empty" | "rubble" | "building" | "tower" per slot).
  function snapshotSide(match, side) {
    const S = match[side];
    const rules = match.rules;
    const tug = match.tug;
    const dirY = side === "player" ? -1 : 1;
    const out = {
      mana: tug ? null : S.mana,
      income: S.income,
      nextIncome: tug ? 0 : (match.evo ? EV.roundIncome : K.roundIncomeBase + match.round + S.income),
      portal: match.evo ? snapshotPortal(match, side) : null,
      gate: match.evo || tug ? { hp: S.gate.hp, maxHp: S.gate.maxHp, y: S.gate.y } : null,
      gold: tug ? S.gold : null,
      build: tug ? snapshotBuild(S) : null,
      queued: tug ? S.queued : null,
      spawned: tug ? S.spawned : null,
      built: tug ? S.built : null,
      slots: tug ? tugSlots(match, side) : null,
      score: S.score,
      lives: S.lives,
      queueCounts: countIds(S.queue),
      queueLength: S.queue.length,
      rosterCounts: countIds(S.roster),
      rosterLength: S.roster.length,
      pending: S.pending.length,
      towers: S.towers.map((t, slot) => {
        if (!t) return null;
        if (tug) return snapshotTugTower(match, side, t, slot);
        const pos = towerPositions[side][slot];
        return {
          slot,
          id: t.id,
          level: t.level,
          x: pos.x,
          y: pos.y,
          hp: t.hp,
          maxHp: t.maxHp,
          cooldown: t.fireRate > 0 ? clamp(t.cooldown / t.fireRate, 0, 1) : 0,
          paid: t.paid,
          range: t.range,
          rangePx: rules.trueRange ? { rx: t.range * W, ry: t.range * W } : { rx: t.range * W, ry: t.range * H },
          coneDegrees: t.coneDegrees,
          dirY,
          color: TOWER_BY_ID[t.id].color,
          upgrades: Object.assign({}, t.upgrades)
        };
      }),
      units: S.units.map((u) => ({
        id: u.id,
        defId: u.defId,
        x: tug ? u.x : u.nx * W,
        y: tug ? u.y : u.ny * H,
        hp: u.hp,
        maxHp: u.maxHp,
        progress: u.progress,
        slowed: u.slowTimer > 0,
        poisoned: u.poisonTimer > 0,
        color: CREEP_BY_ID[u.defId].color,
        target: tug ? tugTargetPoint(match, u) : null,
        attacking: tug ? match.clock - u.lastHitAt <= TUG_ATTACK_FLASH + 1e-9 : false,
        charging: tug ? !!u.charging : false, // tug pass 11: a Brute running at a Tank (unit ids start at 1)
        stack: tug ? tugStack(match, u) : null
      }))
    };
    if (tug) {
      out.rubble = S.rubble.map((s) => Math.max(0, s));
      out.slotStates = S.towers.map((t, slot) => slotState(match, side, slot));
    }
    return out;
  }

  // Tug: clock { t, total }, front { player, ai } (y of each side's forward-most mob, or null), hits (copies of
  // match.hits: kind "damage" or "gold") and tug { player, ai } price lists ({ towers: { turret: price }, mobs:
  // { id: cost } }); all null elsewhere. Projectiles are frame px in every mode; a gate gun shot has towerId "gate"; a
  // tug shot's color is its shooter's tint when it fired.
  function snapshot(match) {
    const tug = match.tug;
    return {
      mode: tug ? "tug" : (match.evo ? "evolves" : "classic"),
      round: match.round,
      maxRounds: match.maxRounds,
      phase: match.phase,
      battleTime: match.battleTime,
      clock: tug
        ? { t: match.clock, total: tug.time.matchSeconds }
        : (match.evo ? { t: match.battleTime, total: EV.battleSeconds } : null),
      front: tug ? { player: tugFront(match, "player"), ai: tugFront(match, "ai") } : null,
      hits: tug ? match.hits.map((h) => Object.assign({}, h)) : null,
      tug: tug ? { player: tugPrices(match, "player"), ai: tugPrices(match, "ai") } : null,
      seed: match.seed,
      scoring: match.rules.scoring,
      rules: Object.assign({}, match.rules),
      result: match.result ? Object.assign({}, match.result) : null,
      player: snapshotSide(match, "player"),
      ai: snapshotSide(match, "ai"),
      projectiles: match.projectiles.map((p) => ({
        x: tug ? p.x : p.x * W,
        y: tug ? p.y : p.y * H,
        prevX: tug ? p.prevX : p.prevX * W,
        prevY: tug ? p.prevY : p.prevY * H,
        owner: p.owner,
        towerId: p.towerId,
        color: tug && p.color ? p.color : (p.towerId === "tank" ? "#14532d" : (p.towerId === "gate" ? TUG_GATE_GUN_COLOR : TOWER_BY_ID[p.towerId].color))
      })),
      bursts: match.bursts.map((b) => ({ x: b.x, y: b.y, life: b.life / b.maxLife, center: b.center })),
      log: match.log.slice(-6)
    };
  }

  // The whole match log with a short header (tug pass 8: the page's Save log and the runner's --logs). Returns a fresh
  // array, never match.log itself: the title, a "mode | seed | phase | clock" line (tug; classic and evolves give the
  // round instead of the clock), the tug overrides as JSON ("none" when missing or empty; the line is there in every
  // mode), "---", then every match.log line in order, unchanged. snapshot().log keeps its last-six slice.
  function fullLog(match) {
    const rules = match && isPlainObject(match.rules) ? match.rules : {};
    const mode = rules.mode;
    const clock = Number(match.clock);
    const when = mode === "tug"
      ? `clock: ${(Number.isFinite(clock) ? clock : 0).toFixed(1)}s`
      : `round: ${match.round}`;
    const ov = rules.tugOverrides;
    let overrides = "none";
    if (isPlainObject(ov) && Object.keys(ov).length > 0) {
      try { overrides = JSON.stringify(ov); } catch (err) { overrides = "(unprintable)"; }
    }
    const out = [
      "Line Tower Wars greybox log",
      `mode: ${mode} | seed: ${match.seed} | phase: ${match.phase} | ${when}`,
      `tug overrides: ${overrides}`,
      "---"
    ];
    const log = Array.isArray(match.log) ? match.log : [];
    for (const line of log) out.push(line);
    return out;
  }

  return {
    createMatch,
    placeTower,
    sellTower,
    queueCreep,
    unqueueCreep,
    upgradePortal,
    upgradeTower,
    repairTower,
    removeTower,
    evolvesCosts,
    queueMob,
    cancelMob,
    pickUpgrade,
    slotState,
    launchBattle,
    step,
    runBattle,
    snapshot,
    fullLog,
    unitPosition,
    towerPositions,
    slotCount,
    tugSlots,
    tugTowerPrice,
    tugApplyTraits,
    tugTraitCap,
    TUG_TRAIT_KINDS,
    buildTugTable,
    mulberry32,
    rules: RULES,
    SIDES,
    BATTLE_DT,
    GUARD_STEPS,
    TUG_GUARD_STEPS
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ProtoSim;
}
