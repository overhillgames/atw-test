// Line Tower Wars greybox prototype: the greed-slider bot. One call per prep, drawing only from match.rng() so a seed
// fixes a whole match. Browser: global ProtoBot (after rules.js and sim.js). Node: module.exports = ProtoBot.

const ProtoBot = (function () {
  "use strict";

  const RULES = typeof ProtoRules !== "undefined" ? ProtoRules : require("./rules.js");
  const SIM = typeof ProtoSim !== "undefined" ? ProtoSim : require("./sim.js");
  const TOWERS = RULES.PROTO_TOWERS;
  const CREEPS = RULES.PROTO_CREEPS;
  const LEVELS = RULES.PROTO_LEVEL_RULES;

  const MAX_ROUNDS_GUARD = 100; // playMatch safety net; a real match ends at round 10 or on lives

  // greed = fraction of this prep's mana reserved for creeps. towerPick is irrelevant at greed 1 (no tower budget).
  const PRESETS = {
    safe: { greed: 0.2, towerPick: "expensive", creepPick: "random" },
    mixed: { greed: 0.5, towerPick: "expensive", creepPick: "random" },
    greedy: { greed: 0.8, towerPick: "expensive", creepPick: "random" },
    allTowers: { greed: 0.0, towerPick: "expensive", creepPick: "cheap" },
    allSends: { greed: 1.0, towerPick: null, creepPick: "random" },
    heavySends: { greed: 1.0, towerPick: null, creepPick: "heavy" },
    // Evolves mode: greed = fraction of this prep's mana for the portal (evolve / faster / more).
    evoSafe: { greed: 0.3, towerPick: "expensive" },
    evoMixed: { greed: 0.5, towerPick: "expensive" },
    evoGreedy: { greed: 0.7, towerPick: "expensive" },
    evoAllPortal: { greed: 1.0, towerPick: "expensive" },
    evoAllTowers: { greed: 0.0, towerPick: "expensive" },
    // Tug mode: style react = the reacting bot (see actTugReact). rush / turtle / mixed: greed = chance that a full
    // bank (gold >= 8) goes on a mob rather than a tower, and x0.3 the per-tick chance of an Imp trickle; they upgrade
    // ready towers first. random = pick any affordable legal action, including upgrade picks.
    tugReact: { style: "react" },
    tugRush: { style: "rush", greed: 0.85 },
    tugTurtle: { style: "turtle", greed: 0.25 },
    tugMixed: { style: "mixed", greed: 0.5 },
    tugRandom: { style: "random", greed: 0.5 },
    // plays = the bot with its own plan (opening, wave rhythm, persona) and slow partial eyes (see actTugPlays).
    tugPlays: { style: "plays" }
  };
  const TUG_STYLES = ["react", "rush", "turtle", "mixed", "random", "plays"];
  const TUG_STYLE_GREED = { rush: 0.85, turtle: 0.25, mixed: 0.5, random: 0.5, react: 0.5, plays: 0.5 }; // used when params carry no greed

  const EVO_TOWER_UPGRADES = ["damage", "rate", "hp", "range"]; // rotation order for tower upgrades

  function maxLevelOf(towerId) {
    const rule = LEVELS[towerId];
    return Math.max(1, (rule && rule.maxLevel) || 1);
  }

  function pickByCost(list, mode, rng) {
    if (list.length === 0) return null;
    if (mode === "random") return list[Math.floor(rng() * list.length)];
    if (mode === "cheap") return list.reduce((best, item) => (item.cost < best.cost ? item : best));
    // "expensive" / "heavy": the most expensive
    return list.reduce((best, item) => (item.cost > best.cost ? item : best));
  }

  function resolveParams(params) {
    const p = typeof params === "string" ? PRESETS[params] : params;
    if (!p || typeof p !== "object") throw new Error(`ProtoBot: unknown params ${String(params)}`);
    const towerPick = p.towerPick || "expensive";
    const creepPick = p.creepPick || "random";
    if (!["expensive", "random", "cheap"].includes(towerPick)) throw new Error(`ProtoBot: bad towerPick "${towerPick}"`);
    if (!["cheap", "random", "heavy"].includes(creepPick)) throw new Error(`ProtoBot: bad creepPick "${creepPick}"`);
    const greed = Math.min(1, Math.max(0, Number.isFinite(p.greed) ? p.greed : 0.5));
    return { greed, towerPick, creepPick };
  }

  function resolveTugParams(params) {
    const p = typeof params === "string" ? PRESETS[params] : params;
    if (!p || typeof p !== "object") throw new Error(`ProtoBot: unknown params ${String(params)}`);
    const style = p.style === undefined || p.style === null ? "react" : p.style; // tug default: the reacting bot
    if (!TUG_STYLES.includes(style)) throw new Error(`ProtoBot: bad tug style "${style}"`);
    const fallback = TUG_STYLE_GREED[style];
    const greed = Math.min(1, Math.max(0, Number.isFinite(p.greed) ? p.greed : fallback));
    return { style, greed };
  }

  // Spend this prep's mana for `side`: towers from the tower budget, then creeps from the creep budget plus any
  // unspent tower budget. Mana the bot cannot use stays in the bank.
  function act(match, side, params) {
    if (match.rules.mode === "tug") {
      actTug(match, side, params);
      return;
    }
    if (match.rules.mode === "evolves") {
      actEvolves(match, side, params);
      return;
    }
    const { greed, towerPick, creepPick } = resolveParams(params);
    const S = match[side];
    const rng = match.rng;
    const creepShare = Math.round(S.mana * greed);
    let towerBudget = S.mana - creepShare;
    let creepBudget = creepShare;

    // Towers, step 1: fill empty slots.
    for (let guard = 0; guard < 50; guard += 1) {
      const slot = S.towers.indexOf(null);
      if (slot < 0) break;
      const afford = TOWERS.filter((t) => t.cost <= towerBudget && t.cost <= S.mana);
      const def = pickByCost(afford, towerPick, rng);
      if (!def) break;
      const res = SIM.placeTower(match, side, slot, def.id);
      if (!res.ok) break;
      towerBudget -= def.cost;
    }

    // Towers, step 2: level up level-1 towers in slot order (same id placed again, full card price).
    for (let slot = 0; slot < S.towers.length; slot += 1) {
      const tower = S.towers[slot];
      if (!tower || tower.level >= maxLevelOf(tower.id)) continue;
      const def = TOWERS.find((t) => t.id === tower.id);
      if (def.cost > towerBudget || def.cost > S.mana) continue;
      const res = SIM.placeTower(match, side, slot, tower.id);
      if (res.ok) towerBudget -= def.cost;
    }

    // Unspent tower budget rolls over to creeps.
    creepBudget += towerBudget;

    // Creeps: buy until nothing is affordable.
    for (let guard = 0; guard < 500; guard += 1) {
      const limit = Math.min(creepBudget, S.mana);
      const afford = creepPick === "cheap"
        ? CREEPS.filter((c) => c.id === "imp" && c.cost <= limit)
        : CREEPS.filter((c) => c.cost <= limit);
      const def = pickByCost(afford, creepPick, rng);
      if (!def) break;
      const res = SIM.queueCreep(match, side, def.id);
      if (!res.ok) break;
      creepBudget -= def.cost;
    }
  }

  // Evolves: spend this prep's mana for `side`. greed = share of it for the portal. Order: portal budget on the portal,
  // then tower budget plus the portal's leftover on towers, then the tower leftover back on the portal (one pass each).
  // Portal: evolve when affordable and tier < round / 2, else Faster and More alternating (Faster first, from the ranks).
  // Towers: repair any below half hp, fill empty slots with towerPick, then upgrade damage, rate, hp, range in
  // rotation across towers in slot order. Prices and availability come from SIM.evolvesCosts.
  function actEvolves(match, side, params) {
    const { greed, towerPick } = resolveParams(params);
    const S = match[side];
    const rng = match.rng;
    const portalShare = Math.round(S.mana * greed);
    const towerShare = S.mana - portalShare;

    function spendPortal(budget) {
      for (let guard = 0; guard < 200; guard += 1) {
        const limit = Math.min(budget, S.mana);
        const offers = SIM.evolvesCosts(match, side).portal;
        const can = (o) => o.available && o.cost !== null && o.cost <= limit;
        let kind = null;
        if (can(offers.evolve) && S.portal.tier < match.round / 2) {
          kind = "evolve";
        } else {
          const order = offers.faster.rank <= offers.more.rank ? ["faster", "more"] : ["more", "faster"];
          kind = order.find((k) => can(offers[k])) || null;
        }
        if (!kind) break;
        const cost = offers[kind].cost;
        if (!SIM.upgradePortal(match, side, kind).ok) break;
        budget -= cost;
      }
      return budget;
    }

    function spendTowers(budget) {
      const slots = S.towers.length;
      // Repair any tower below half hp.
      for (let slot = 0; slot < slots; slot += 1) {
        const tower = S.towers[slot];
        if (!tower || tower.hp >= tower.maxHp * 0.5) continue;
        const offer = SIM.evolvesCosts(match, side, slot).tower.repair;
        if (!offer.available || offer.cost > budget || offer.cost > S.mana) continue;
        if (SIM.repairTower(match, side, slot).ok) budget -= offer.cost;
      }
      // Fill empty slots.
      for (let guard = 0; guard < 50; guard += 1) {
        const slot = S.towers.indexOf(null);
        if (slot < 0) break;
        const afford = TOWERS.filter((t) => t.cost <= budget && t.cost <= S.mana);
        const def = pickByCost(afford, towerPick, rng);
        if (!def) break;
        if (!SIM.placeTower(match, side, slot, def.id).ok) break;
        budget -= def.cost;
      }
      // Upgrades: each kind in turn across the towers in slot order, cycling until nothing more is bought.
      for (let guard = 0; guard < 200; guard += 1) {
        let bought = false;
        for (const kind of EVO_TOWER_UPGRADES) {
          for (let slot = 0; slot < slots; slot += 1) {
            if (!S.towers[slot]) continue;
            const offer = SIM.evolvesCosts(match, side, slot).tower[kind];
            if (!offer.available || offer.cost > budget || offer.cost > S.mana) continue;
            if (SIM.upgradeTower(match, side, slot, kind).ok) {
              budget -= offer.cost;
              bought = true;
            }
          }
        }
        if (!bought) break;
      }
      return budget;
    }

    const portalLeft = spendPortal(portalShare);
    const towerLeft = spendTowers(towerShare + portalLeft);
    spendPortal(towerLeft);
  }

  // ---------------------------------------------------------------------------------------------------- tug
  // One think tick for `side`, every number from match.tug (the turret price through SIM.tugTowerPrice). Gold is the only
  // currency; mobs go into the build queue (SIM.queueMob), turrets are built by tapping an empty slot
  // (SIM.placeTower(match, side, slot), no type) and ready turrets are levelled (SIM.pickUpgrade).
  // Styles: react (actTugReact), plays (actTugPlays), rush / turtle / mixed (actTugGreed), random. Only match.rng draws
  // randomness.
  const TUG_BANK = 8; // rush / turtle / mixed: a bank this full goes on a mob (greed chance) or a turret
  const TUG_PICK_TANK = ["slow", "dmg", "heavy"];       // rule 0: an enemy Tank is alive
  const TUG_PICK_SWARM = ["splash", "multi", "rate"];   // rule 0: 3+ enemy Imps, Brutes or Runners alive
  const TUG_PICK_WISPS = ["multi", "range", "rate"];    // rule 0: 2+ enemy Wisps alive
  const TUG_PICK_CALM = ["rate", "range", "dmg", "hp"]; // rule 0: nothing special
  const TUG_SWARM_IDS = ["imp", "brute", "runner"];
  const TUG_SWARM_WANTED = 3;
  const TUG_WISPS_WANTED = 2;

  function tugAliveUnit(u) {
    return u.hp > 0 && !u.isDefeated;
  }

  function actTug(match, side, params) {
    const { style, greed } = resolveTugParams(params);
    if (style === "react") actTugReact(match, side);
    else if (style === "plays") actTugPlays(match, side);
    else if (style === "random") actTugRandom(match, side);
    else actTugGreed(match, side, greed);
  }

  function tugQueueRoom(match, S) {
    return S.build.length < match.tug.queue.max;
  }

  // Empty slots ("empty" state: not rubble, not under construction, not finished), front row first, then slot order.
  function tugEmptySlots(match, side) {
    const slots = SIM.tugSlots(match, side);
    const front = [];
    const rest = [];
    for (let i = 0; i < slots.length; i += 1) {
      if (SIM.slotState(match, side, i) !== "empty") continue;
      (slots[i].row === "front" ? front : rest).push(i);
    }
    return front.concat(rest);
  }

  // First empty slot, front slots first, or -1.
  function tugFirstEmpty(match, side) {
    const list = tugEmptySlots(match, side);
    return list.length > 0 ? list[0] : -1;
  }

  function tugAffordableMobs(match, S) {
    if (!tugQueueRoom(match, S)) return [];
    return CREEPS.map((c) => ({ id: c.id, cost: match.tug.costs.mob[c.id] })).filter((m) => Number.isFinite(m.cost) && m.cost <= S.gold);
  }

  // The turret price when `side` can pay it with `keep` gold left over, else null.
  function tugTurretPrice(match, side, keep) {
    const price = SIM.tugTowerPrice(match, side);
    return price !== null && match[side].gold - price >= keep ? price : null;
  }

  // Rule 0's choice among a ready turret's offers (kind strings), by what the enemy has alive: Heal if offered and hp
  // below half; else with a Tank alive slow > dmg > heavy; else with 3+ Imps / Brutes / Runners splash > multi > rate;
  // else with 2+ Wisps multi > range > rate; else rate > range > dmg > hp. None of the preferred offered: offer[0].
  function tugChoosePick(match, side, t) {
    const foeUnits = match[side === "player" ? "ai" : "player"].units.filter(tugAliveUnit);
    const count = (ids) => foeUnits.filter((u) => ids.includes(u.defId)).length;
    if (t.offer.includes("heal") && t.hp < t.maxHp * 0.5) return "heal";
    let order = TUG_PICK_CALM;
    if (count(["tank"]) > 0) order = TUG_PICK_TANK;
    else if (count(TUG_SWARM_IDS) >= TUG_SWARM_WANTED) order = TUG_PICK_SWARM;
    else if (count(["wisp"]) >= TUG_WISPS_WANTED) order = TUG_PICK_WISPS;
    const kind = order.find((k) => t.offer.includes(k));
    return kind === undefined ? t.offer[0] : kind;
  }

  // Rule 0: pick for every ready own turret (free), by threat (tugChoosePick).
  function tugPickReady(match, side) {
    const S = match[side];
    for (let slot = 0; slot < S.towers.length; slot += 1) {
      const t = S.towers[slot];
      if (!t || !t.ready || !Array.isArray(t.offer) || t.offer.length === 0) continue;
      SIM.pickUpgrade(match, side, slot, tugChoosePick(match, side, t));
    }
  }

  // random: uniform over every legal affordable action: each affordable mob (queue has room), a turret (on a random
  // empty slot, when one is empty and affordable), each offer of each ready turret, each cancel.
  function actTugRandom(match, side) {
    const S = match[side];
    const empty = tugEmptySlots(match, side);
    const options = tugAffordableMobs(match, S).map((m) => ({ kind: "mob", id: m.id }));
    if (empty.length > 0 && tugTurretPrice(match, side, 0) !== null) options.push({ kind: "tower" });
    S.towers.forEach((t, slot) => {
      if (t && t.ready && Array.isArray(t.offer)) t.offer.forEach((_, index) => options.push({ kind: "pick", slot, index }));
    });
    // 2026-10-16 (gate reach): while queue.parallel every queued mob is training and any index may be cancelled; serial keeps the head (index 0) uncancellable.
    const cancelFrom = match.tug.queue && match.tug.queue.parallel === true ? 0 : 1;
    if (S.build.length >= cancelFrom + 1) for (let index = cancelFrom; index < S.build.length; index += 1) options.push({ kind: "cancel", index });
    if (options.length === 0) return;
    const pick = options[Math.floor(match.rng() * options.length)];
    if (pick.kind === "mob") SIM.queueMob(match, side, pick.id);
    else if (pick.kind === "tower") SIM.placeTower(match, side, empty[Math.floor(match.rng() * empty.length)]);
    else if (pick.kind === "cancel") SIM.cancelMob(match, side, pick.index);
    else SIM.pickUpgrade(match, side, pick.slot, pick.index);
  }

  // rush / turtle / mixed: rule 0 first, then with gold >= TUG_BANK a greed chance of the most expensive affordable mob
  // (or always, with no empty slot), else a turret in the first empty slot (front first) if gold - cost >= reserve;
  // otherwise greed x 0.3 chance of an Imp. A full queue skips the mob (the rng draws stay the same).
  function actTugGreed(match, side, greed) {
    const S = match[side];
    const rng = match.rng;
    tugPickReady(match, side);
    const mobs = tugAffordableMobs(match, S);
    const emptyAny = tugFirstEmpty(match, side);
    if (S.gold >= TUG_BANK) {
      if (rng() < greed || emptyAny < 0) {
        const def = pickByCost(mobs, "expensive", rng);
        if (def) SIM.queueMob(match, side, def.id);
      } else if (tugTurretPrice(match, side, match.tug.bot.reserve) !== null) {
        SIM.placeTower(match, side, emptyAny);
      }
      return;
    }
    if (rng() < greed * 0.3 && tugQueueRoom(match, S) && S.gold >= match.tug.costs.mob.imp) SIM.queueMob(match, side, "imp");
  }

  // react: the sparring partner. Rule 0 (upgrades, free) first, then one spend per call, rules in order a-e; every spend
  // except rule a keeps bot.reserve gold back. Deterministic (draws nothing from match.rng).
  const TUG_MELEE = ["imp", "brute"];
  const TUG_TANK_BRUTE_RADIUS = 150;                 // rule a: own Brutes this close to an enemy Tank count as answering it
  const TUG_TANK_BRUTE_WANTED = 1;                   // rule a: Brutes wanted per enemy Tank alive

  function actTugReact(match, side) {
    const S = match[side];
    const foe = side === "player" ? "ai" : "player";
    const F = match[foe];
    const T = match.tug;
    const reserve = T.bot.reserve;
    const inOwnHalf = (u) => (side === "player" ? u.y > 300 : u.y < 300);
    const foeUnits = F.units.filter(tugAliveUnit);
    const ownUnits = S.units.filter(tugAliveUnit);
    const foeInHalf = foeUnits.filter(inOwnHalf);
    const canQueue = (id, strict) => {
      if (!tugQueueRoom(match, S)) return false;
      const left = S.gold - T.costs.mob[id];
      return strict ? left > reserve : left >= reserve;
    };
    const queue = (id) => SIM.queueMob(match, side, id).ok;
    // Build a turret in the first empty slot (front first) if one is empty and gold - cost >= reserve; true if built.
    const buildTurret = () => {
      const slot = tugFirstEmpty(match, side);
      return slot >= 0 && tugTurretPrice(match, side, reserve) !== null && SIM.placeTower(match, side, slot).ok;
    };

    // (0) pick for every ready turret by threat (tugChoosePick). Free.
    tugPickReady(match, side);

    // (a) enemy Tanks are alive: one own Brute per Tank (wanted = Tanks alive x TUG_TANK_BRUTE_WANTED). A Brute answers
    // when it is alive within 150 px of any enemy Tank or waiting in the queue (each counts 1). While answered < wanted
    // and the queue has room, queue a Brute (reserve ignored, one per think).
    const tanks = foeUnits.filter((u) => u.defId === "tank");
    if (tanks.length > 0) {
      const queuedBrutes = S.build.filter((b) => b.defId === "brute").length;
      const nearBrutes = ownUnits.filter((u) => u.defId === "brute" && tanks.some((t) => Math.hypot(u.x - t.x, u.y - t.y) <= TUG_TANK_BRUTE_RADIUS)).length;
      if (nearBrutes + queuedBrutes < tanks.length * TUG_TANK_BRUTE_WANTED && tugQueueRoom(match, S)) {
        queue("brute");
        return;
      }
    }

    // (b) three or more enemy melee mobs in our half: a turret in an empty slot (front first), else a Brute.
    if (foeInHalf.filter((u) => TUG_MELEE.includes(u.defId)).length >= 3) {
      if (buildTurret()) return;
      if (canQueue("brute", false)) { queue("brute"); return; }
    }

    // (b2) two or more enemy Runners alive: a turret in an empty slot (the lane needs covering).
    if (foeUnits.filter((u) => u.defId === "runner").length >= 2 && buildTurret()) return;

    // (c) two or more enemy Wisps in our half: a turret in an empty slot.
    if (foeInHalf.filter((u) => u.defId === "wisp").length >= 2 && buildTurret()) return;

    // (d) nothing of theirs in our half: a turret in an empty slot.
    if (foeInHalf.length === 0 && buildTurret()) return;

    // (e) a full bank: Tank when they have 2 finished turrets (both slots, since two-slots) and fewer than 2 mobs on the lane, else a Brute if none of
    // ours is alive or queued, else a Wisp while the price leaves more than the reserve. Each only while the queue has room.
    if (S.gold >= T.bot.dumpAt) {
      const foeTowers = F.towers.filter((t) => t && !t.building).length;
      if (foeTowers >= 2 && foeUnits.length < 2) {
        if (canQueue("tank", false)) queue("tank");
        return;
      }
      if (!ownUnits.some((u) => u.defId === "brute") && !S.build.some((b) => b.defId === "brute")) {
        if (canQueue("brute", false)) { queue("brute"); return; }
      }
      // Runner: 3+ own mobs in the enemy half (their towers are busy) and fewer than 2 own Runners alive or queued.
      const ownRunners = ownUnits.filter((u) => u.defId === "runner").length + S.build.filter((b) => b.defId === "runner").length;
      if (ownUnits.filter((u) => !inOwnHalf(u)).length >= 3 && ownRunners < 2 && canQueue("runner", false)) { queue("runner"); return; }
      if (canQueue("wisp", true)) queue("wisp");
    }
  }

  // plays (Baz, pass 11: "I don't think it's how a proper AI should work"): an opponent with its own plan and slow,
  // partial eyes. Numbers from match.tug.bot.plays (TUG_PLAYS_DEFAULTS when the block is missing or a leaf is not
  // finite). Memory per side on match.botMemo[side], made on the side's first think. match.rng is drawn only for the
  // persona (once, on that first think) and each wave's jitter (a banked cycle advances nextWaveAt the same way).
  // Breakthrough (plan .plans\ltw-proto-tug-breakthrough.md): it adapts at wave time (a wall and a losing swarm: bank a
  // cycle, then a push; an enemy slot in rubble or no finished enemy turret: Runners ride the wave) and to Tank spam (a
  // bomber kept ready, Heavy picks).
  const TUG_PLAYS_DEFAULTS = {
    openingImps: 2,
    waveSeconds: 20,
    waveJitterSeconds: 3,
    waveMinGold: 6,
    dumpAt: 25,
    maxTurrets: 3,
    turretKeep: 4,
    turretLeadSeconds: 5,
    reactSeconds: 3,
    reactGapSeconds: 5,
    swarmWanted: 4,
    wallLevel: 3,              // an enemy finished turret at this level or more is a wall
    runnersWhenOpen: 2,        // Runners added to a wave when an enemy slot is rubble or the enemy has no finished turret
    tankSpamCount: 3,          // enemy Tanks noticed within tankSpamWindowSeconds that count as Tank spam
    tankSpamWindowSeconds: 60
  };
  const TUG_PLAYS_SETS = {
    swarm: ["imp", "imp", "imp", "wisp"],   // 6 gold; queued in this order so the screen walks ahead of the heavy unit
    siege: ["imp", "imp", "brute", "tank"], // 10 gold
    push: ["imp", "imp", "tank", "tank"]    // 12 gold; replaces a swarm wave after a banked cycle when a wall wins the trade
  };
  const TUG_PLAYS_EPS = 1e-9; // clock comparisons (the clock is a sum of 1/30 s steps)

  // Every bot.plays number, Number(...)-coerced, falling back to TUG_PLAYS_DEFAULTS when not finite.
  function tugPlaysNums(match) {
    const bot = match.tug && match.tug.bot;
    const src = bot && bot.plays && typeof bot.plays === "object" ? bot.plays : {};
    const out = {};
    for (const key of Object.keys(TUG_PLAYS_DEFAULTS)) {
      const v = Number(src[key]);
      out[key] = Number.isFinite(v) ? v : TUG_PLAYS_DEFAULTS[key];
    }
    return out;
  }

  // The next wave time: clock + waveSeconds + jitter, jitter = (rng x 2 - 1) x waveJitterSeconds (one match.rng draw).
  function tugPlaysNextWave(match, N) {
    const jitter = (match.rng() * 2 - 1) * N.waveJitterSeconds;
    return match.clock + N.waveSeconds + jitter;
  }

  // One think: (0) picks, free; (1) the opening; (1b) the rebuild reflex (fewer than maxTurrets and an empty slot = a turret at the bare price, before any wave spending); (2) eyes and at most one reaction; (3) a wave; (4) a turret; (5) bank.
  // Each rule returns after its one action.
  function actTugPlays(match, side) {
    const S = match[side];
    const foe = side === "player" ? "ai" : "player";
    const F = match[foe];
    const N = tugPlaysNums(match);
    const clock = match.clock;

    // Memory: made once per side, persona first (one rng draw), then the first wave time (one rng draw).
    match.botMemo = match.botMemo || {};
    const fresh = !match.botMemo[side];
    if (fresh) {
      const roll = match.rng();
      const persona = roll < 1 / 3 ? "swarm" : roll < 2 / 3 ? "siege" : "mixed";
      match.botMemo[side] = {
        persona,
        waveNo: 0,
        nextWaveAt: tugPlaysNextWave(match, N),
        seen: {},
        lastReactAt: -Infinity,
        opened: false,
        openingQueued: 0,
        lastWaveKills: null,   // own kills (mob + tower + gun) when the last wave went out; null before the first wave
        lastWaveLosses: null,  // the foe's kills (= own mobs lost) at the same moment
        bankedForPush: false,  // a cycle was banked for a push (the next swarm wave against a wall becomes the push)
        tankSeenAt: [],        // clocks at which enemy Tanks were first noticed, kept within tankSpamWindowSeconds
        tankStamped: {},       // ids of enemy Tanks already stamped (pruned with seen)
        tankSpam: false        // tankSeenAt.length >= tankSpamCount (set by the eyes, read by rules 0 and 2a)
      };
    }
    const memo = match.botMemo[side];
    const ownTurrets = () => S.towers.filter((t) => t).length; // finished + under construction
    const buildFront = (keep) => {
      const slot = tugFirstEmpty(match, side);
      return slot >= 0 && tugTurretPrice(match, side, keep) !== null && SIM.placeTower(match, side, slot).ok;
    };

    // (0) picks for every ready own turret, free: while tankSpam (as of the last think's eyes) Heavy when offered, then
    // tugChoosePick for the rest.
    if (memo.tankSpam) {
      for (let slot = 0; slot < S.towers.length; slot += 1) {
        const t = S.towers[slot];
        if (t && t.ready && Array.isArray(t.offer) && t.offer.includes("heavy")) SIM.pickUpgrade(match, side, slot, "heavy");
      }
    }
    tugPickReady(match, side);

    // (1) opening: on the side's first think a turret in the first empty slot (front first) when affordable, else
    // straight to the Imps; then one Imp per think until openingImps are queued; then opened. Owns the think until then.
    if (!memo.opened) {
      if (fresh && buildFront(0)) return;
      if (memo.openingQueued < N.openingImps) {
        if (!SIM.queueMob(match, side, "imp").ok) return;
        memo.openingQueued += 1;
      }
      if (memo.openingQueued >= N.openingImps) memo.opened = true;
      return;
    }

    // (1b) rebuild reflex (2026-10-08, Baz's two-slots logs: the bot sat on one turret for a minute and rebuilt 16 s
    // after its rubble cleared): fewer than maxTurrets own and an empty slot = a turret before anything else, at the
    // bare price (no turretKeep, no wave lead). Rubble is not empty, so a camping Tank's hole still waits for the timer.
    if (ownTurrets() < N.maxTurrets && buildFront(0)) return;

    // (2) eyes: living enemy units in our half, stamped the think they are first seen; entries for dead or gone units
    // are dropped. A unit is noticed reactSeconds after its stamp. Never the enemy queue or gold.
    const lane = match.tug.lane;
    const mid = (Number(lane.gateY.player) + Number(lane.gateY.ai)) / 2;
    const inOwnHalf = (u) => (side === "player" ? u.y > mid : u.y < mid);
    const foeAlive = F.units.filter(tugAliveUnit);
    const aliveIds = {};
    for (const u of foeAlive) aliveIds[u.id] = true;
    for (const id of Object.keys(memo.seen)) if (!aliveIds[id]) delete memo.seen[id];
    for (const id of Object.keys(memo.tankStamped)) if (memo.seen[id] === undefined) delete memo.tankStamped[id];
    const foeInHalf = foeAlive.filter(inOwnHalf);
    for (const u of foeInHalf) if (memo.seen[u.id] === undefined) memo.seen[u.id] = clock;
    const noticed = foeInHalf.filter((u) => clock - memo.seen[u.id] >= N.reactSeconds - TUG_PLAYS_EPS);
    const noticedCount = (ids) => noticed.filter((u) => ids.includes(u.defId)).length;
    const ownCount = (id) => S.units.filter((u) => tugAliveUnit(u) && u.defId === id).length + S.build.filter((b) => b.defId === id).length;

    // Tank spam: each enemy Tank stamps the clock once, the think it is first noticed; stamps older than
    // tankSpamWindowSeconds drop; tankSpam while tankSpamCount or more remain.
    for (const u of noticed) {
      if (u.defId !== "tank" || memo.tankStamped[u.id]) continue;
      memo.tankStamped[u.id] = true;
      memo.tankSeenAt.push(clock);
    }
    memo.tankSeenAt = memo.tankSeenAt.filter((at) => clock - at <= N.tankSpamWindowSeconds + TUG_PLAYS_EPS);
    memo.tankSpam = memo.tankSeenAt.length >= N.tankSpamCount;

    // Reactions, at most one per reactGapSeconds; the first that acts stamps lastReactAt and ends the think. One that
    // cannot be afforded (or finds no room) is not a reaction and the think goes on.
    if (clock - memo.lastReactAt >= N.reactGapSeconds - TUG_PLAYS_EPS) {
      // (2a) wanted = noticed enemy Tanks, at least 1 while tankSpam; more wanted than own Brutes alive + queued: a Brute.
      const brutesWanted = Math.max(noticedCount(["tank"]), memo.tankSpam ? 1 : 0);
      if (brutesWanted > ownCount("brute") && SIM.queueMob(match, side, "brute").ok) {
        memo.lastReactAt = clock;
        return;
      }
      // (2b) noticed enemy Imps + Brutes >= swarmWanted and no own Wisp alive or queued: a Wisp.
      if (noticedCount(["imp", "brute"]) >= N.swarmWanted && ownCount("wisp") < 1 && SIM.queueMob(match, side, "wisp").ok) {
        memo.lastReactAt = clock;
        return;
      }
      // (2c) two or more noticed enemy Runners and fewer than maxTurrets own turrets: a turret (front first).
      if (noticedCount(["runner"]) >= 2 && ownTurrets() < N.maxTurrets && buildFront(0)) {
        memo.lastReactAt = clock;
        return;
      }
    }

    // (3) wave: due (clock >= nextWaveAt) or a full bank (gold >= dumpAt). Below waveMinGold it waits (nextWaveAt kept,
    // the next think checks again) and the think goes on. Else it scores the last wave and reads the enemy's turrets,
    // then the set: the persona's (mixed alternates by wave number), except a swarm wave against a wall while the last
    // wave lost the trade (kills < losses): the first time it banks the cycle instead (nothing queued; the wave number
    // and the score baselines are kept, so the next wave reads the same turn and the whole stretch), the next time the
    // push set. The set's mobs in order while gold covers each and the queue has room; another set only while gold
    // covers a whole one. Then, with the lane open, up to runnersWhenOpen Runners. Leftover gold stays banked.
    if (clock >= memo.nextWaveAt || S.gold >= N.dumpAt) {
      if (S.gold >= N.waveMinGold) {
        const sideKills = (who) => match.stats.mobKills[who] + match.stats.towerKills[who] + match.stats.gunKills[who];
        const killsNow = sideKills(side);
        const lossesNow = sideKills(foe);
        const kills = memo.lastWaveKills === null ? 0 : killsNow - memo.lastWaveKills;
        const losses = memo.lastWaveLosses === null ? 0 : lossesNow - memo.lastWaveLosses;
        let foeFinished = 0;
        let foeMaxLevel = -Infinity;
        for (const t of F.towers) {
          if (!t || t.building) continue;
          foeFinished += 1;
          const level = Number(t.level);
          if (Number.isFinite(level) && level > foeMaxLevel) foeMaxLevel = level;
        }
        const wallAhead = foeMaxLevel >= N.wallLevel;
        let foeRubble = false;
        const foeSlots = SIM.tugSlots(match, foe).length;
        for (let i = 0; i < foeSlots; i += 1) if (SIM.slotState(match, foe, i) === "rubble") foeRubble = true;
        const laneOpen = foeFinished === 0 || foeRubble;

        const waveNo = memo.waveNo + 1;
        let kind = memo.persona;
        if (kind === "mixed") kind = waveNo % 2 === 1 ? "swarm" : "siege";
        const pushWanted = kind === "swarm" && wallAhead && kills < losses;
        if (pushWanted && !memo.bankedForPush) {
          memo.bankedForPush = true; // bank a cycle: nothing queued, nextWaveAt advanced below
        } else {
          memo.waveNo = waveNo;
          const set = TUG_PLAYS_SETS[pushWanted ? "push" : kind];
          const setCost = set.reduce((sum, id) => sum + Number(match.tug.costs.mob[id]), 0);
          sets: for (let n = 0; n < 20; n += 1) {
            if (n > 0 && !(S.gold >= setCost)) break;
            for (const id of set) if (!SIM.queueMob(match, side, id).ok) break sets;
          }
          memo.bankedForPush = false; // a wave went out: the banked cycle (if any) is spent
          if (laneOpen) {
            for (let r = 0; r < N.runnersWhenOpen; r += 1) if (!SIM.queueMob(match, side, "runner").ok) break;
          }
          memo.lastWaveKills = killsNow;
          memo.lastWaveLosses = lossesNow;
        }
        memo.nextWaveAt = tugPlaysNextWave(match, N);
        return;
      }
    }

    // (4) turret, fallback: (1b) normally builds first; kept for a table with turretKeep > 0 and a slot that just opened.
    // Fewer than maxTurrets own, an empty slot (front first), the next wave turretLeadSeconds or more away,
    // and gold >= price + turretKeep.
    if (ownTurrets() < N.maxTurrets && memo.nextWaveAt - clock >= N.turretLeadSeconds && buildFront(N.turretKeep)) return;

    // (5) otherwise bank.
  }

  // Both sides act each prep (player first), launch, run, until the match is over. Presets by name or params objects.
  function playMatch(rules, seed, playerPreset, aiPreset) {
    const match = SIM.createMatch(rules, seed);
    if (match.rules.mode === "tug") {
      // Tug: no preps. The sim calls back every thinkSeconds; player first, then ai.
      const playerTug = resolveTugParams(playerPreset);
      const aiTug = resolveTugParams(aiPreset);
      SIM.runBattle(match, (m) => {
        actTug(m, "player", playerTug);
        actTug(m, "ai", aiTug);
      });
      if (match.phase !== "over") throw new Error("tug match did not finish");
      return match;
    }
    const playerParams = resolveParams(playerPreset);
    const aiParams = resolveParams(aiPreset);
    for (let i = 0; i < MAX_ROUNDS_GUARD && match.phase !== "over"; i += 1) {
      act(match, "player", playerParams);
      act(match, "ai", aiParams);
      const launched = SIM.launchBattle(match);
      if (!launched.ok) throw new Error(`launchBattle failed: ${launched.reason}`);
      SIM.runBattle(match);
    }
    if (match.phase !== "over") throw new Error(`match did not finish within ${MAX_ROUNDS_GUARD} preps`);
    return match;
  }

  return { act, actEvolves, actTug, playMatch, PRESETS };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ProtoBot;
}
