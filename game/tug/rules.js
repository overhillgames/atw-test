// Line Tower Wars greybox prototype: rules data. Data only, no logic.
// Every number below is copied from atw-dev/www/game (read 2026-10-07 from feature/jon-menus @ 1eea00c; the gameplay
// lines are unchanged since f004e24). Classic script in the browser (bare globals), CommonJS module in Node.

// The switches. Every default reproduces the shipped game ("Control"); the alternatives are the candidate fixes.
// Key order is the order the page lists them in.
const PROTO_RULES = {
  mode: "classic",            // "classic": the shipped game plus the switches below. "evolves": free portal spawns, kill mana, portal and tower upgrades, a gate per side (numbers in PROTO_EVOLVES). "tug": one shared lane in real time, gold from kills plus a slow drip, a one-at-a-time build queue for mobs (cancel for a refund until a mob starts training), one turret built by tapping a slot with a construction time, rubble when destroyed, XP bars whose levels offer traits, a 5-minute safety clock (numbers in PROTO_TUG, overridable through tugOverrides)
  scoring: "points",          // "points": +1 to the leaker per leak (shipped). "lives": a leak costs the defender lives equal to the creep's cost; 0 lives loses on the spot
  startLives: 20,             // lives each side starts with (lives scoring only)
  leakMana: 1,                // mana the leaker gains per leak (shipped +1, 10-match.js:18-34)
  sendIncomePerCreep: 0,      // each creep queued adds this to that side's permanent per-round income (round income = 9 + round + bonus)
  persistentMobs: false,      // true: every creep bought joins a roster and the whole roster spawns every battle; the queue is this round's additions
  counters: false,            // true: hit damage x PROTO_COUNTERS[tower][creep] (1.5 strong / 1 / 0.5 weak)
  cones: true,                // true: towers fire only inside their facing cone (shipped). false: anything within range
  redCloseOnly: false,        // true: Red may only fire at creeps past the mid line (progress >= 0.5), and then with damage x 1.5
  trueRange: false,           // true: range checks scale dy by 760/420 so a range is as long down the lane as across (shipped: normalised hypot)
  spawnShape: "column",       // "column": shipped offsets (gap, Tank +0.11, random fan). "ranks": three abreast, slowest first. "stream": groups released over time
  spawnGap: 0.035,            // progress gap between spawns (column) or between ranks (ranks, stream)
  streamGroupSize: 3,         // stream: creeps per released group
  streamIntervalSeconds: 1.5, // stream: battle seconds between groups
  kamikaze: false,            // true: towers get hp (10 + cost, level 2 x1.5); a leaking creep hits the enemy tower nearest its exit for its cost; 0 hp removes the tower
  mobHpScalePerRound: 0,      // creep hp x (1 + this x (round - 1)) at spawn (shipped 0)
  sellRefund: 0,              // fraction of a tower's total paid price returned on a sell (0 = selling off, as shipped)
  tugOverrides: {}            // tug only: a partial PROTO_TUG (nested by path, e.g. { gold: { start: 20 } }) deep-merged over it per match; not a rule row
};

// The same comments as data, so the page can show them as tooltips, plus the choices for the enum keys.
const PROTO_RULE_INFO = {
  mode: { note: "classic: the shipped game plus the switches below. evolves: mobs are free and continuous from a portal, kills pay mana, mana evolves the portal or upgrades a tower in place, a gate per side (numbers in PROTO_EVOLVES). Evolves ignores startLives, leakMana, sendIncomePerCreep, persistentMobs, spawnShape, spawnGap and stream*. tug: one lane both sides share in real time. Gold comes from kills (a mob pays its gold value to the side that killed it, a destroyed tower its price + towerKillBonus) plus a slow drip to both sides (one gold every gold.dripSeconds, 6 by default); a mob card puts the mob in a five-deep build queue where every mob trains at once on its own timer (queue.parallel; a queued mob can be cancelled for a full refund); there is one tower, the turret: tapping an empty slot builds one at a fixed price, under construction for 4 s (no shots, full hp); a destroyed turret leaves its slot as rubble for 12 s and pays its price + towerKillBonus + towerKillPerLevel x its level; each turret has an XP bar that fills from kills (its own kills in full, its side's mob and gate gun kills at a quarter) and, when full, blinks and offers three of eight traits (range, rate, HP, damage, Splash, Slow, Multishot, Heavy; each to its own cap), so a turret becomes what it takes; Heal is guaranteed among the three under 50% hp, may show under 75%, and otherwise only once every trait is capped. Mobs fight mobs and turrets, four slots and a gate with a gun per side, a 5-minute safety clock: the higher gate wins, equal is a draw (numbers in PROTO_TUG, overridable through tugOverrides). Tug ignores startLives, leakMana, sendIncomePerCreep, persistentMobs, spawnShape, spawnGap, stream*, mobHpScalePerRound, kamikaze, cones, trueRange and redCloseOnly; counters has no row for the turret or the gate gun, so it changes nothing in tug.", options: ["classic", "evolves", "tug"] },
  scoring: { note: "points: +1 to the leaker per leak (shipped). lives: a leak costs the defender lives equal to the creep's cost; 0 lives loses on the spot.", options: ["points", "lives"] },
  startLives: { note: "Lives each side starts with (lives scoring only)." },
  leakMana: { note: "Mana the leaker gains per leak (shipped +1)." },
  sendIncomePerCreep: { note: "Each creep queued adds this to that side's permanent per-round income (round income = 9 + round + bonus)." },
  persistentMobs: { note: "Every creep bought joins a roster and the whole roster spawns every battle; the queue is this round's additions." },
  counters: { note: "Hit damage x the counter table (1.5 strong / 1 / 0.5 weak)." },
  cones: { note: "On: towers fire only inside their facing cone (shipped). Off: anything within range." },
  redCloseOnly: { note: "Red may only fire at creeps past the mid line (progress >= 0.5), and then with damage x 1.5." },
  trueRange: { note: "Range checks scale dy by 760/420 so a range is as long down the lane as across (shipped: normalised distance)." },
  spawnShape: { note: "column: shipped offsets (gap, Tank +0.11, random fan). ranks: three abreast, slowest first. stream: groups released over time, each in ranks.", options: ["column", "ranks", "stream"] },
  spawnGap: { note: "Progress gap between spawns (column) or between ranks (ranks, stream)." },
  streamGroupSize: { note: "Stream: creeps per released group." },
  streamIntervalSeconds: { note: "Stream: battle seconds between groups." },
  kamikaze: { note: "Towers get hp (10 + cost, level 2 x1.5); a leaking creep hits the enemy tower nearest its exit for its cost; 0 hp removes the tower." },
  mobHpScalePerRound: { note: "Creep hp x (1 + this x (round - 1)) at spawn (shipped 0)." },
  sellRefund: { note: "Fraction of a tower's total paid price returned on a sell (0 = selling off, as shipped)." },
  tugOverrides: { note: "Tug only: a partial PROTO_TUG, nested by path, deep-merged over it when a match starts (plain objects merge, arrays replace whole, numeric strings become numbers). Edited through the Tug numbers section, not as a rule row.", hidden: true }
};

const PROTO_PRESETS = {
  control: Object.assign({}, PROTO_RULES),
  spine: Object.assign({}, PROTO_RULES, { scoring: "lives", sendIncomePerCreep: 1, leakMana: 0 }),
  evolves: Object.assign({}, PROTO_RULES, {
    mode: "evolves", scoring: "lives", cones: false, trueRange: true, kamikaze: true, leakMana: 0, spawnShape: "column", counters: false
  }),
  tug: Object.assign({}, PROTO_RULES, {
    mode: "tug", scoring: "lives", cones: false, trueRange: true, kamikaze: false, leakMana: 0
  })
};

// Evolves mode (PROTO_RULES.mode = "evolves", plan .plans/ltw-proto-evolves-mode.md): mobs are free and continuous from
// a portal, kills pay mana, mana evolves the portal or upgrades a tower in place, a gate per side, mobs explode on
// towers. Every evolves number is here so it can be retuned in one place; positions are frame px. Placing on an occupied
// slot replaces the tower (no level 2; refund only by sellRefund) and removing a tower is free. Classic never reads this.
const PROTO_EVOLVES = {
  // economy
  startMana: 12,                // mana each side has at round 1
  roundIncome: 5,               // flat mana after every battle, so a losing defender can still act
  killMana: { imp: 1, runner: 2, brute: 2, wisp: 3, tank: 3 }, // mana to the killer's owner per kill (towers and the Tank gun); a leak pays nothing (leakMana is ignored)
  // battle
  battleSeconds: 30,            // the battle clock; at 0 every mob still alive vanishes and projectiles and bursts clear
  // portal
  tiers: ["imp", "runner", "brute", "wisp", "tank"], // the evolution order; a portal spawns its current tier only
  startInterval: 3.0,           // seconds between spawns at Faster rank 0
  intervalStep: 0.4,            // seconds each Faster rank takes off the interval
  minInterval: 1.0,             // the interval never drops below this
  fasterCost: 5,                // mana per Faster rank
  fasterMax: 5,                 // max Faster ranks
  startMaxAlive: 3,             // a portal only spawns while fewer than maxAlive of its mobs are on the field; maxAlive at More rank 0
  moreStep: 1,                  // maxAlive added per More rank
  moreCost: 4,                  // mana per More rank
  moreMax: 8,                   // max More ranks
  evolveCosts: [8, 12, 16, 20], // cost of tier 1, 2, 3, 4 (Imp -> Runner, -> Brute, -> Wisp, -> Tank)
  fanSpread: 0.6,               // mobs spawn with fanSeed uniform in [-0.6, 0.6] (narrower than classic's [-1, 1])
  // lane
  portalPos: { player: { x: 210, y: 440 }, ai: { x: 210, y: 170 } }, // where mobs warp in, just in front of their own front tower row
  gateY: { player: 560, ai: 40 }, // each side's gate line behind its towers; a mob's lane runs from its own portal to the enemy gate
  gateHp: 50,                   // each side's gate hp, shown as lives (startLives is ignored in evolves); 30 -> 50 on 2026-10-07: an unopposed Runner portal took 24 of 30 per battle
  gateDamage: "cost",           // "cost": a mob reaching the enemy gate deals its own cost and dies; a number instead makes every mob deal that flat amount
  // towers
  contactRadiusPx: 28,          // a mob within this many px of an enemy tower explodes on it for its cost (shared kamikaze hit; tower hp = 10 + cost)
  rangeScale: 0.7,              // every tower's range x this (with trueRange on, Green reaches 187 px instead of 267, so a mob has a safe stretch after its portal)
  upgrades: {                   // per-tower ranks: damage and range multiply the base per rank, rate divides fireRate (seconds), hp adds max hp and heals by the same
    damage: { cost: 4, max: 4, mult: 1.25 },
    rate: { cost: 4, max: 4, mult: 1.2 },
    range: { cost: 3, max: 3, mult: 1.1 },
    hp: { cost: 3, max: 4, add: 8 }
  },
  repairCost: 2                 // mana to restore a tower to max hp
};

// Tug mode (PROTO_RULES.mode = "tug"; plan .plans/ltw-proto-tug-mode.md, re-rolled by .plans/ltw-proto-tug-pass2.md and
// .plans/ltw-proto-tug-pass3.md, economy rebuilt by .plans/ltw-proto-tug-pass4.md, towers made to cost time by
// .plans/ltw-proto-tug-pass5.md, one turret levelled into identities by .plans/ltw-proto-tug-pass7.md): one lane both
// sides share in real time. Age of War's economy: gold comes from kills (whoever trades better gets ahead) plus a slow
// drip (gold.dripSeconds) so money is always coming in, a mob card pays gold and puts the mob in a build queue that
// trains one at a time (a queued mob not yet training can be cancelled for a full refund). There is one tower, the
// turret: tapping an empty slot builds it at turret.cost, under construction for turret.buildSeconds (no shots, hp
// full hp); a destroyed turret leaves its slot as rubble for build.rubbleSeconds. Baz's twist: every turret
// has an XP bar that fills from kills, blinks when full and offers upgrade.offers of the eight traits (each stackable
// to its own cap), so a turret's identity is the traits it took; Heal joins the offer by the turret's hp (upgrade).
// Mobs fight the enemy mobs they meet and the structures they reach, turrets have hp, a gate with a gun at each end,
// and a safety clock (at 0 the higher gate wins, equal is a draw). Every tug number is here, in frame px, seconds, hp
// and gold. rules.tugOverrides is deep-merged over this table when a match starts (match.tug); the sim reads
// match.tug, never this table, after createMatch. An occupied slot refuses a new turret; removing one is free (refund
// only by sellRefund, into gold). Classic and evolves never read this. Pass 1's sheet is kept in
// .plans/ltw-proto-tug-mode.md.
const PROTO_TUG = {
  time: {
    matchSeconds: 300,          // the safety clock: at 0 the higher gate wins, equal = draw while overtime is "draw"; "crumble": at matchSeconds the match goes on and both gates lose crumbleHpPerSecond until one falls
    overtime: "draw",           // 2026-10-17 (finish levers): "draw" = at matchSeconds the higher gate wins, equal is a draw (today); "crumble" = the walls crumble instead, both gates lose hp every second until one falls
    crumbleHpPerSecond: 1       // 2026-10-17 (finish levers): hp both gates lose per second once the walls crumble (whole points are taken); read only when overtime is "crumble"
  },
  gold: {
    start: 10,                  // gold both sides start with (no cap)
    dripSeconds: 6,             // one gold to each side every this many seconds regardless of kills, so money is always coming in (Baz); 0 = off. 0 -> 6 in the tug pass 4 build: at 0 the bots earned ~25 gold a game, built under two towers, almost never upgraded and drew 30%; at 6, 463/750 gate endings, 19% draws, 5-9 upgrades a game, react on top (75%); faster drips (2-4) raised draws again (the extra gold went into towers)
    perKill: {
      imp: 1,                   // gold to the killer's side when an Imp dies (any killer: mob, tower, gate gun, splash, chain)
      runner: 2,                // gold to the killer's side when a Runner dies
      brute: 2,                 // gold to the killer's side when a Brute dies. 3 -> 2 in bomber (2026-10-08): equals its cost
      wisp: 3,                  // gold to the killer's side when a Wisp dies
      tank: 2                   // gold to the killer's side when a Tank dies. 5 -> 2 (breakthrough, 2026-10-08): what the bomber that killed it cost; pushes stop bankrolling the wall
    },
    towerKillBonus: 0,          // gold for destroying a turret = turret.cost + this + towerKillPerLevel x its level. 2 -> 0 in tug pass 8: a level-0 turret pays its price (4), level 3 pays 7; a tower kill refunds a Tank, it does not fund the next one
    towerKillPerLevel: 1,       // gold per level of the destroyed turret on top (a level-0 turret pays 4 + 0 + 0 = 4, a level-3 turret 4 + 0 + 3 = 7); the attacker's xp share uses the same value
    perGateDamage: 0,           // 2026-10-17 (finish levers): gold to a side for every this many points of gate damage its mobs deal (whole gold; the remainder is banked); 0 = off. The crumble pays nothing
    hold: {                     // 2026-10-21 (scout eyes, Baz): on every drip a side also earns perMob x its living mobs in the enemy half (past the lane midline), at most cap; perMob 0 = off. Holding the enemy's side pays, so one unit across is worth sending and a held push compounds
      perMob: 1,                // gold per living mob of the side in the enemy half, paid on each drip; 0 = off
      cap: 3                    // the most hold pay one side earns on one drip
    }
  },
  queue: {
    max: 5,                     // mobs in the queue (all training while parallel, the head only otherwise); a full queue refuses the card
    parallel: true              // every queued mob trains at once on its own timer (build.* seconds) and walks when its own timer ends, so mobs bought together leave together (Baz, 2026-10-16: "we can't make like an army"); false = only the head trains (the pre-2026-10-16 queue)
  },
  build: {
    imp: 1.0,                   // seconds an Imp trains before it walks
    runner: 1.5,                // seconds a Runner trains
    brute: 2.5,                 // seconds a Brute trains
    wisp: 2.5,                  // seconds a Wisp trains
    tank: 4.0,                  // seconds a Tank trains
    rubbleSeconds: 20           // a slot whose turret was destroyed (built or under construction) refuses a new turret this long; 0 = off. Removing a turret leaves no rubble. 12 -> 20 (breakthrough, 2026-10-08): a kill opens a 24 s hole with the 4 s build
  },
  costs: {
    mob: {
      imp: 1,                   // gold per Imp, paid when the card is tapped (the mob joins the queue)
      runner: 2,                // gold per Runner
      brute: 2,                 // gold per Brute. 3 -> 2 in bomber (2026-10-08)
      wisp: 3,                  // gold per Wisp
      tank: 5                   // gold per Tank
    }
  },
  lane: {
    x: 210,                     // the lane centre; mobs walk straight down the frame along their spawn x
    halfWidth: 60,              // the lane strip's half width (the page draws it); the slots sit on its edge
    spawnY: {
      player: 548,              // Player mobs appear on this line, at their own gate
      ai: 52                    // AI mobs appear on this line, at their own gate
    },
    gateY: {
      player: 560,              // the Player gate line: an AI mob here may attack the Player gate; the Player gun fires from (lane x, this)
      ai: 40                    // the AI gate line: a Player mob here may attack the AI gate; the AI gun fires from (lane x, this)
    },
    jitterPx: 30                // spawn x = lane x + uniform(-jitterPx, jitterPx) from match.rng
  },
  slots: {
    player: [                           // two slots per side (two-slots, 2026-10-08): the pass-5 back pair, 60 px in front of the gate line; the front pair (y 440) is gone. Baz: "only have two turrets at the gate… those are the ones that we upgrade"
      { x: 150, y: 500, row: "front" }, // slot 1: left, on the lane edge
      { x: 270, y: 500, row: "front" }  // slot 2: right, on the lane edge
    ],
    ai: [                               // the Player's slots mirrored: 60 px from the AI gate line (y 40)
      { x: 150, y: 100, row: "front" }, // slot 1: left, on the lane edge
      { x: 270, y: 100, row: "front" }  // slot 2: right, on the lane edge
    ]
  },
  gate: {
    hp: 60,                     // each side's gate hp, shown as lives (startLives is ignored in tug); back to pass 2's 60 in tug pass 4
    gun: {
      enabled: true,            // false: the gates never shoot
      dmg: 4,                   // gate gun damage per hit. 2 -> 4 in tug pass 11: the last line kills what reaches it and pays the defender (Baz: "the base turret should do more damage")
      rate: 0.5,                // gate gun seconds per shot
      range: 160                // gate gun range in px from the gate line's centre (along the lane while combat.laneBand); nearest enemy mob first. 110 -> 160 (2026-10-16, gate reach): 10 px past the Wisp's gate reach 150, so nothing hits a gate from outside its gun (Baz: the base gun must reach the snipers in the back)
    }
  },
  // The turret (tug pass 7): the one tower. Tapping an empty slot builds it; every turret starts as the same plain gun
  // and becomes what its traits make it. range in px from the slot (a circle; along the lane while combat.laneBand), rate in seconds per shot, targeting
  // "nearest" | "lowestHp" | "highestHp" (hp ties go to the nearest). Shots home at combat.projectileSpeedPx.
  turret: {
    cost: 4,                    // gold to build one (tap an empty slot); no ramp
    buildSeconds: 4,            // seconds a new turret is under construction: full hp from the start (2026-10-08, Baz: the build is only a timer; before it climbed from 1), no shots until done; 0 = instant
    buildSafe: true,            // tug pass 11: a turret under construction cannot be targeted or hit by mobs (it has full hp during the build); false = killable while building
    hp: 40,                     // the plain turret's max hp. 24 -> 40 in tug pass 8 (with dmg 2 -> 4): the plain turret is the best gun on the board (5.7/s vs the gate gun's 4.0 and 4 gold of Imps' 6.0) and beats a lone Tank
    dmg: 4,                     // the plain turret's damage per hit. 2 -> 4 in tug pass 8 (see hp)
    rate: 0.7,                  // the plain turret's seconds per shot
    range: 170,                 // the plain turret's range (px). 120 -> 170 in tug pass 8: the Tank's 140 band stops it 152-166 px from the slot (hypot of 140 along the lane and 60-90 px lateral with jitter 30), so no range under 167 lets the turret fire on a lone walking Tank; 170 covers it from every lane position (and from either row the lane centre, 60 px off it)
    targets: 1,                 // the plain turret's mobs per volley (each a separate shot); multi adds to it
    targeting: "nearest"        // the plain turret hits the closest mob in range; heavy switches it to highestHp
  },
  // Traits: each level offers upgrade.offers of these eight; a pick takes one rank, up to the trait's cap. Every derived
  // stat is recomputed from the plain turret and the ranks after each pick (sim tugApplyTraits).
  traits: {
    range: {
      cap: 3,                   // range ranks a turret can take. 5 -> 3 in tug pass 9: five ranks (300 px) covered half the board; three is 239 px
      pct: 0.12                 // range = base x (1 + pct x rank): rank 1 = 190.4 px (134.4 before tug pass 8's range 170)
    },
    rate: {
      cap: 5,                   // fire-rate ranks a turret can take
      mult: 0.85                // seconds per shot = base x mult^rank (then heavy's rateMult): rank 1 = 0.595 s
    },
    hp: {
      cap: 5,                   // hp ranks a turret can take
      pct: 0.25                 // max hp = base x (1 + pct x rank), and the turret heals to the new max on each hp pick: rank 1 = 50 (30 before tug pass 8's hp 40)
    },
    dmg: {
      cap: 5,                   // damage ranks a turret can take
      add: 1                    // damage = base + add x rank (+ heavy's add x its rank)
    },
    splash: {
      cap: 3,                   // splash ranks a turret can take
      px: 35,                   // rank 1 unlocks splash: full damage to every other enemy mob within this many px of the target
      pxPerRank: 12             // each splash rank after the first adds this to the radius (rank 3 = 59 px)
    },
    slow: {
      cap: 3,                   // slow ranks a turret can take
      factor: 0.7,              // rank 1: a hit mob walks and attacks at x this
      factorPerRank: 0.1,       // each slow rank after the first takes this off the factor (rank 3 = x0.5)
      seconds: 1.5,             // how long a slow lasts (a fresh hit restarts it)
      chainAtRank: 3,           // from this slow rank each hit chains once to the nearest other enemy mob within chainPx of the target
      chainPx: 48,              // the chain's reach (px) from the target
      chainFraction: 0.5        // the chain deals this fraction of the damage and slows for this fraction of the seconds
    },
    multi: {
      cap: 2,                   // multishot ranks a turret can take
      add: 1                    // targets = the plain turret's targets + add x rank (separate shots at different mobs)
    },
    heavy: {
      cap: 3,                   // heavy ranks a turret can take
      add: 3,                   // each heavy rank adds this much damage per hit
      rateMult: 1.25            // rank 1 switches targeting to highestHp and multiplies seconds per shot by this once (a heavy gun is slower, not ever slower)
    }
  },
  // Mobs: speed in px per second, dmg per hit on mobs, towers and the gate (gateDmg replaces it on the gate, mobDmg on a
  // mob), rate in seconds per hit (a hit is instant, no projectile), reach in px to an enemy mob (a circle); a melee mob
  // (reach <= 40) uses combat.structureReachMelee against towers, a ranged one its reach, unless it has its own
  // structureReach (structureBand measures that along the lane only). A mob with gateReach > 0 (Runner 120, Wisp 150,
  // Tank 140 since 2026-10-16) hits the gate from that many px before its line; the rest (Imp, Brute: melee) only at the line. Target order: an enemy mob in reach, then a tower in reach, then the
  // gate; structuresFirst puts the mob last; gateOnly targets the gate and nothing else (tug pass 6).
  mobs: {
    imp: {
      hp: 14,                   // Imp hp
      speed: 45,                // Imp px per second
      dmg: 1.5,                 // Imp damage per hit
      rate: 1.0,                // Imp seconds per hit
      reach: 40                 // Imp reach (px, melee)
    },
    runner: {
      hp: 16,                   // Runner hp
      speed: 65,                // Runner px per second
      dmg: 0,                   // Runner never hits mobs or towers (kept for the table shape)
      rate: 0.85,               // Runner seconds per hit (on the gate)
      reach: 40,                // unused while gateOnly (kept for the table shape)
      gateOnly: true,           // Runner targets nothing but the enemy gate: it walks past mobs and towers (mobs and towers may still target it); tug pass 6
      gateReach: 120,           // it stops and shoots the gate from this many px (along the lane) before the gate line; 0 = only at the line. 100 -> 120 (lane-bands): inside the gate gun's 160 since 2026-10-16 (it was outside the old 110)
      gateDmg: 3                // Runner damage per hit on the gate
    },
    brute: {
      hp: 14,                   // Brute hp. 45 -> 14 in bomber (2026-10-08): an Imp's body with the charge
      speed: 45,                // Brute px per second; 40 -> 45 in tug pass 7 so it walks with the Imps (45)
      dmg: 1.5,                 // Brute damage per hit. 4 -> 1.5 in bomber (2026-10-08)
      rate: 1.0,                // Brute seconds per hit. 1.2 -> 1.0 in bomber (2026-10-08)
      reach: 40,                // Brute reach (px, melee)
      charge: {                 // tug pass 11: a Brute that sees an enemy Tank charges it and blows up on contact (Baz: "if a tank is in range, it runs to the tank and kamikazes… kill it in one hit")
        targets: ["tank"],      // mob ids that set it off
        sightPx: 80,            // a target within this many px (a circle; along the lane while combat.laneBand) sets it off; 80 so a Tank 100 px behind its escort is out of sight: the escort is the counter
        speed: 90,              // px per second while charging (double its walk), slowed like a walk
        contactPx: 24,          // within this many px of the target it blows up
        kill: false,            // true = the target dies outright; false = it takes charge.dmg instead. true -> false (lane-bands): the bomber wounds, two kill a Tank
        dmg: 25,                // damage on contact when kill is false (unused at true; kept so the panel has the knob). 40 -> 25 (lane-bands): half a Tank; a Tank that takes one hit walks on at 25
        structures: false,      // 2026-10-17 (balance sweep 1): true = an enemy turret (finished; a building one is skipped while turret.buildSafe) or the enemy gate within sightPx also sets off the charge when no listed mob is in sight; it runs at it and blows up for structureDmg. Off: Tanks only (pass 11)
        structureDmg: 10        // damage of a charge blow on a turret or the gate when structures is on (the Tank blow keeps kill / dmg). 10: four Brutes for a plain turret (40), six for a gate (60)
      }
    },
    wisp: {
      hp: 12,                   // Wisp hp. 24 -> 12 in tug pass 11: the rocket dies to anything that reaches it
      speed: 55,                // Wisp px per second
      dmg: 4,                   // Wisp damage per hit. 3 -> 4 in tug pass 11
      rate: 1.0,                // Wisp seconds per hit
      reach: 150,               // Wisp reach (px, ranged: on mobs and towers alike). 100 -> 150 in tug pass 11: shoots from afar (a plain turret's 170 still out-reaches it)
      splashPx: 35,             // tug pass 11: a hit on a mob also deals its full damage to every other enemy mob within this many px of the victim (0 = off; towers and the gate never splash)
      gateReach: 150,           // it stops and shoots the gate from this many px (along the lane) before the gate line, like the Runner; 0 = only at the line (2026-10-16: it walked to the line before)
      structureReach: 150       // reach (px, along the lane) to an enemy turret; reach (mobs) and gateReach (the gate) are separate. 150 = its reach, so nothing changes. 2026-10-17 (worth-relative-soak): a turret at 120 can never reach a Wisp at 150, so Wisp spam is unanswerable; 110 (under the turret) is under test, so a Wisp needs a Tank in front of it to kill a turret
    },
    tank: {
      hp: 50,                   // Tank hp
      speed: 32,                // Tank px per second
      dmg: 6,                   // Tank damage per hit on a tower. 5 -> 6 (breakthrough, 2026-10-08): a plain turret in seven hits, a maxed one in fifteen
      rate: 1.6,                // Tank seconds per hit
      reach: 100,               // Tank reach (px, ranged) to a mob (a circle; along the lane while combat.laneBand); towers use structureReach
      gateDmg: 10,              // Tank damage per hit on the gate
      mobDmg: 2,                // Tank damage per hit on a mob (weak: three Imps still kill it; tug pass 5)
      turretDamageTaken: 0.5,   // tug pass 10: a turret's shot, splash or chain does this x its damage to a Tank (the gate gun does full damage; mobs do full damage); 1 = off. Baz: "tanks receive 50% less damage from turrets… all the ranges can stay the same"
      hitsBuilding: true,       // breakthrough (2026-10-08): the Tank may target and hit a turret under construction even while turret.buildSafe is on (a camping Tank denies the rebuild); other mobs never can
      structuresFirst: true,    // an enemy tower in reach first, then the gate at its line, then an enemy mob in reach (so it stops with the army instead of walking through the fight); false = the usual mob-first order
      structureReach: 140,      // reach (px) to an enemy tower; measured along the lane when structureBand is on (tug pass 6: at 100 a mob was always in reach first)
      structureBand: true,      // true = a tower counts when within structureReach along the lane (|dy|), whatever its lateral offset; false = a circle; redundant while combat.laneBand is on
      gateReach: 140            // it hits the gate from this many px (along the lane) before the gate line, its turret reach (structureReach); 0 = only at the line (2026-10-16: it walked to the line before)
    }
  },
  combat: {
    laneBand: true,             // lane-bands (2026-10-08): true = every reach, range and sight in tug (mob to mob, mob to turret, turret and gate gun to mob, Brute sight) is measured along the lane only (|dy|), lateral offset ignored; false = circles. Splash, the Slow chain and the Brute's contact stay circles. Baz: "instead of a range of a circle around them, it needs to be the range of how far ahead of them"
    structureReachMelee: 70,   // a melee mob's reach (px) to a tower; 70 (not 60) so a mob on the lane centre reaches a front slot 60 px off it
    engagementWidth: 99,        // a target (mob, tower or gate) accepts at most this many attacking mobs; 99 = free stacking. 3 -> 99 (2026-10-21, Baz): three attackers per target made a group useless against one unit; every mob that reaches a target now hits it
    columnSpacingPx: 0,         // 0 = off (really off since tug pass 4); > 0: a walking mob stays this far behind an ally further along within 20 px across, at its pace
    projectileSpeedPx: 560      // tower and gate gun shots fly at this many px per second, homing
  },
  // Turret XP: every kill pays xp in gold value (a mob's gold.perKill; a turret's turret.cost + gold.towerKillBonus +
  // gold.towerKillPerLevel x its level: level 0 pays 4, level 3 pays 7 since tug pass 8), and a turret's own damage on enemy mobs pays perDamage per point (tug pass 7,
  // so a fighting turret levels more often).
  xp: {
    need: {
      base: 8,                  // xp a turret needs for its first level
      perLevel: 3               // ... plus this x the levels it already took (8, 11, 14, ...; 4 until tug pass 7)
    },
    perDamage: 0.125,           // xp per point of damage a turret's own shots (splash and chain included) deal to enemy mobs, overkill not counted (the gate gun pays none); 0 = kills only. 0.25 -> 0.125 in tug pass 9: pass 8 doubled the gun to 4, so this is pass 7's half xp per shot again (first level ~10 s after the first shot, not 5)
    ownKillShare: 1,            // a turret's own kill (its shot, splash or chain) pays it this x the kill's gold value in xp (turrets never kill turrets)
    unitKillShare: 0.25,        // a kill by this side's mobs or gate gun pays EVERY turret this side owns this x the kill's gold value
    holdWhileReady: true,       // true: a turret whose bar is full earns nothing (no damage or kill xp) until it picks (limit break); false = xp banks past the bar and carries over
    maxLevel: 0                 // 5 -> 0 (trait-slots): no level cap; the owned traits' caps end the build (upgrade.slots). Pass 9's cap, kept as a knob. tug pass 9: picks a turret can take (Baz: "evolve up to five"); at this level the bar keeps filling and a full bar is a Heal charge: Heal is the only offer, shown only below upgrade.healPool hp (a full bar waits, not blinking, above it); the pick heals and the level stays. 0 = no cap (pass 8)
  },
  // Upgrades: a ready turret offers `offers` distinct traits still below their caps, drawn at random; Heal (hp to max,
  // no rank) is guaranteed among them below healAlways hp, joins the random pool below healPool, and otherwise shows
  // only once every trait is capped (then it is the only offer). Every pick (a heal too) is a level, so the next bar is
  // longer, until xp.maxLevel (tug pass 9): a turret at that level takes no more traits; its full bar is a Heal charge,
  // offered alone and only below healPool hp, and the heal spends the bar without raising the level or the need.
  upgrade: {
    offers: 3,                  // traits offered per level (2 until tug pass 7)
    healAlways: 0.5,            // hp / max hp below which Heal is guaranteed among the offers (its position shuffled); 1 = always
    healPool: 0.75,             // hp / max hp below which Heal joins the random pool; at or above it Heal never shows unless every trait is capped; 0 = only then
    slots: 3                    // trait-slots (2026-10-08): distinct traits a turret can own; once it owns this many, offers draw only from them until each is at its cap, then a full bar is a Heal charge. 0 = no limit. Baz: "you could only have a turret with three different attributes… you could max those traits out through the level"
  },
  bot: {
    thinkSeconds: 0.5,          // a think callback (the bot) runs every this many seconds of sim time and acts at most once
    reserve: 3,                 // the react bot keeps this much gold back (except to answer a Tank with Imps)
    dumpAt: 12,                 // the react bot spends on an attack from this much gold
    plays: {                    // the "plays" bot (Baz, pass 11: "I don't think it's how a proper AI should work"): its own plan, slow partial eyes
      skill: null,              // 2026-10-21 (ladder): 0..1, or null. null = the explicit numbers below. A number replaces reactSeconds, reactGapSeconds, waveSeconds, waveJitterSeconds and waveMinGold with a blend of a weak table (0: 8, 12, 28, 8, 10) and a sharp table (1: 1, 1.5, 15, 1, 4) and adds reactChance (0.3 -> 1.0, the chance a due reaction is taken); 0.6 lands near today's values. The game sets it from Difficulty (0.3 / 0.6 / 0.9) and the Gauntlet (per stage); the proto page and run.js leave it null
      openingImps: 2,           // after its first turret it queues this many Imps, then banks for the first wave
      waveSeconds: 20,          // seconds between waves (it banks in between)
      waveJitterSeconds: 3,     // each wave time is waveSeconds +- up to this (match.rng), so it is not a metronome
      waveMinGold: 6,           // a wave needs at least this much gold, else it waits (checks again every think)
      dumpAt: 25,               // gold at or above this starts the next wave at once
      maxTurrets: 2,            // it never holds more than this many turrets (building ones count); 3 -> 2 in two-slots (2026-10-08): two slots
      turretKeep: 4,            // it builds a turret only when gold >= price + this, and the next wave is turretLeadSeconds or more away; since 2026-10-08 the rebuild reflex builds at the bare price first, so this only shapes the fallback
      turretLeadSeconds: 5,
      reactSeconds: 3,          // it notices an enemy unit this long after the unit first appears in its half
      reactGapSeconds: 5,       // at most one reaction per this many seconds
      swarmWanted: 4,           // noticed enemy Imps + Brutes at or above this = a swarm (reaction 2)
      wallLevel: 3,             // breakthrough (2026-10-08): an enemy finished turret at this level or more is a wall (adaptation 1)
      runnersWhenOpen: 2,       // breakthrough: Runners added to a wave when an enemy slot is rubble or the enemy has no finished turret (adaptation 2)
      tankSpamCount: 3,         // breakthrough: enemy Tanks noticed within tankSpamWindowSeconds that count as Tank spam (adaptation 3)
      tankSpamWindowSeconds: 60 // breakthrough: the window (seconds) for tankSpamCount
    },
    opportunist: {              // the "opportunist" bot (2026-10-17): the runner's yardstick bot, not the shipped AI; deterministic, full information
      turretsWanted: 2,         // it keeps this many turrets (building ones count) and rebuilds at the bare price before anything else
      reserve: 3,               // gold it keeps back on every rule except answering a Tank and the all-in
      waveAt: 12,               // it banks to this much gold, then sends a set
      wallPushAt: 20,           // against a wall (2+ finished enemy turrets, or one at wallLevel) with none of their mobs in its half, it banks to this instead of waveAt, then sends one big push
      openWindowSeconds: 6,    // the all-in (enemy has no finished turret) keeps going this long after the lane closed
      runnersWhenOpen: 2,       // Runners in an all-in before the Imps
      wallLevel: 3,             // an enemy finished turret at this level or more is a wall: siege sets, not swarms
      tankBruteRadius: 150,     // an own Brute this close to an enemy Tank counts as its answer (px)
      outnumberedBy: 2          // enemy mobs in its half minus its own mobs alive at or above this = trade Imps
    }
  }
};

// 01-defs.js:193-199 towerDefs (BASE_TOWER_CONE_DEGREES = 130, 01-defs.js:37). fireRate is seconds per shot; range is
// in normalised frame units (fraction of 420 across, of 760 down).
const PROTO_BASE_TOWER_CONE_DEGREES = 130;
const PROTO_TOWERS = [
  { id: "violet", name: "Violet", letter: "V", cost: 3, damage: 2, range: 0.416, fireRate: 0.935, color: "#7c3aed", coneDegrees: 220, maxTargets: 1 },
  { id: "yellow", name: "Yellow", letter: "Y", cost: 5, damage: 2, range: 0.520, fireRate: 0.95, color: "#eab308", coneDegrees: PROTO_BASE_TOWER_CONE_DEGREES * 1.1, maxTargets: 1 },
  { id: "red", name: "Red", letter: "R", cost: 7, damage: 3.45, range: 0.434, fireRate: 1.05, color: "#dc2626", coneDegrees: PROTO_BASE_TOWER_CONE_DEGREES, maxTargets: 1 },
  { id: "green", name: "Green", letter: "G", cost: 9, damage: 4, range: 0.635, fireRate: 1.15, color: "#22c55e", coneDegrees: PROTO_BASE_TOWER_CONE_DEGREES * 0.9, maxTargets: 1 },
  { id: "blue", name: "Blue", letter: "B", cost: 11, damage: 4, range: 0.492, fireRate: 1.375, color: "#2563eb", coneDegrees: 200, maxTargets: 2 }
];

// 03-config.js:6-12 attackerDefs. speed is lane progress per second.
const PROTO_CREEPS = [
  { id: "imp", name: "Imp", letter: "I", cost: 2, hp: 18, speed: 0.09, color: "#1f2937" },
  { id: "runner", name: "Runner", letter: "R", cost: 3, hp: 16.2, speed: 0.126, color: "#d97706" },
  { id: "brute", name: "Brute", letter: "B", cost: 4, hp: 39.6, speed: 0.0825, color: "#15803d" },
  { id: "wisp", name: "Wisp", letter: "W", cost: 5, hp: 30.8, speed: 0.132, color: "#8b5cf6" },
  { id: "tank", name: "Tank", letter: "T", cost: 6, hp: 57.2, speed: 0.0682, color: "#0f766e" }
];

// 01-defs.js:262-304 TOWER_LEVEL_RULES. Level n multiplies by perLevel^(n-1); fireRate (seconds) is divided.
const PROTO_LEVEL_RULES = {
  violet: { maxLevel: 2, damagePerLevel: 1, rangePerLevel: 1.2, fireRatePerLevel: 1.5, iconScalePerLevel: 1.2 },
  yellow: { maxLevel: 2, damagePerLevel: 1, rangePerLevel: 1, fireRatePerLevel: 1.25, iconScalePerLevel: 1.2, slowDurationPerLevel: 1.5 },
  red: { maxLevel: 2, damagePerLevel: 1.5, rangePerLevel: 1.1, fireRatePerLevel: 1, iconScalePerLevel: 1.2, shrapnelDamagePerLevel: 1.5 },
  green: { maxLevel: 2, damagePerLevel: 1.5, rangePerLevel: 1.1, fireRatePerLevel: 1.2, iconScalePerLevel: 1.2, poisonDotPerLevel: 1.5 },
  blue: { maxLevel: 2, damagePerLevel: 1.2, rangePerLevel: 1.1, fireRatePerLevel: 1, iconScalePerLevel: 1.2, maxTargetsByLevel: { 2: 3 } }
};

// The counter ring from the 2026-10-07 chat (used only when rules.counters is on). 1.5 strong, 0.5 weak, 1 otherwise.
const PROTO_COUNTERS = {
  violet: { imp: 0.5, runner: 1, brute: 1, wisp: 1.5, tank: 1 },
  yellow: { imp: 1, runner: 1.5, brute: 0.5, wisp: 1.5, tank: 1 },
  red: { imp: 1, runner: 0.5, brute: 1.5, wisp: 1, tank: 1 },
  green: { imp: 1, runner: 1, brute: 1.5, wisp: 0.5, tank: 1.5 },
  blue: { imp: 1.5, runner: 1, brute: 1, wisp: 1, tank: 0.5 }
};

// The real 420 x 760 frame (01-defs.js:38-39) and positions from 04-state.js:259-283. Lanes are normalised as in
// atw-dev; tower slots are given in frame px (atw-dev stores px / 420 and px / 760).
const PROTO_GEOMETRY = {
  width: 420,
  height: 760,
  laneStarts: { player: { x: 0.5, y: 560 / 760 }, ai: { x: 0.5, y: 40 / 760 } },
  laneEnds: { player: { x: 0.5, y: 80 / 760 }, ai: { x: 0.5, y: 520 / 760 } },
  towerPosPx: {
    player: [{ x: 147, y: 479 }, { x: 273, y: 479 }, { x: 95, y: 539 }, { x: 210, y: 539 }, { x: 324, y: 539 }],
    ai: [{ x: 147, y: 130 }, { x: 273, y: 130 }, { x: 95, y: 70 }, { x: 210, y: 70 }, { x: 324, y: 70 }]
  },
  midLineY: 300,
  // Dock card centres (01-defs.js:175-188 minus the artboard offsets 105 / 50), for the page.
  cardCentersPx: {
    towers: [{ x: 56, y: 641 }, { x: 132, y: 641 }, { x: 208, y: 641 }, { x: 284, y: 641 }, { x: 360, y: 641 }],
    creeps: [{ x: 56, y: 722 }, { x: 132, y: 722 }, { x: 208, y: 722 }, { x: 284, y: 722 }, { x: 360, y: 722 }]
  }
};

// Match and combat constants, each with its atw-dev source.
const PROTO_CONSTANTS = {
  maxRounds: 10,                 // 01-defs.js MAX_ROUNDS
  manaCap: 99,                   // 01-defs.js MANA_CAP
  startMana: 9,                  // 10-match.js resetMatch
  roundIncomeBase: 9,            // 12-rounds.js openRoundShop: gain = 9 + waveNumber (the round just played)
  slotCount: 5,                  // 04-state.js towerPosPlayer / towerPosAI
  slowSpeedFactor: 0.7,          // 16-effects.js updateAttackers
  yellowSlowSeconds: 1.2,        // 10-match.js createTowerInstance
  yellowLeapPx: 48,              // 14-battle.js findYellowLeapTarget
  yellowLeapDamage: 0.5,         // 14-battle.js applyProjectileDamage (leap at half damage)
  yellowLeapSlow: 0.5,           // ... and half the slow
  poisonSeconds: 3,              // 14-battle.js applyProjectileDamage (green)
  poisonTicks: 3,
  poisonTickInterval: 1,
  poisonRatios: [0.3, 0.2, 0.1], // 16-effects.js updateAttackers (indexed there by 4 - ticksRemaining, see sim.js)
  redShrapnelFraction: 0.33,     // 14-battle.js applyProjectileDamage: each piece = 0.33 x hit x shrapnel multiplier
  redSplashPieces: 3,            // greybox approximation (sim.js applyHit): three pieces per creep in the radius
  redSplashRadiusPx: 60,         // greybox approximation radius
  projectileSpeed: 1.35,         // 14-battle.js spawnProjectile default speed
  projectileHitRadius: 0.012,    // 16-effects.js updateProjectiles
  tankProjectileSpeed: 1.15,     // 14-battle.js updateTankCreepFire speedOverride
  tankRangeOfViolet: 0.5,        // 14-battle.js getTankWeaponStats: 0.5 x Violet range
  tankDamageOfViolet: 0.5,       // ... 0.5 x Violet damage
  tankFireRate: 1.1,             // ... seconds per shot
  tankConeDegrees: 180,          // ... facing its travel direction
  columnTankGapBonus: 0.11,      // 12-rounds.js buildSpawnOffsets: leadGapBonus after a Tank
  ranksFan: [-0.6, 0, 0.6],      // greybox ranks: fan seeds for a full rank of three
  kamikazeHpBase: 10,            // greybox kamikaze: tower hp = 10 + cost
  kamikazeHpLevelMultiplier: 1.5,// ... level 2 x 1.5
  redCloseProgress: 0.5,         // greybox redCloseOnly: progress threshold
  redCloseDamage: 1.5,           // ... damage multiplier
  burstLifeSeconds: 0.25         // greybox: how long a Red splash dot stays on screen (visual only)
};

const ProtoRules = {
  PROTO_RULES,
  PROTO_RULE_INFO,
  PROTO_PRESETS,
  PROTO_EVOLVES,
  PROTO_TUG,
  PROTO_TOWERS,
  PROTO_CREEPS,
  PROTO_LEVEL_RULES,
  PROTO_COUNTERS,
  PROTO_GEOMETRY,
  PROTO_CONSTANTS
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = ProtoRules;
}
