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
    // Tug mode: style react = the reacting bot (see actTugReact; it answers what crosses into its half and, since 2026-10-17,
    // pushes a whole set when its lane is quiet and its bank is full). rush / turtle / mixed: greed = chance that a full
    // bank (gold >= 8) goes on a mob rather than a tower, and x0.3 the per-tick chance of an Imp trickle; they upgrade
    // ready towers first. random = pick any affordable legal action, including upgrade picks.
    tugReact: { style: "react" },
    tugRush: { style: "rush", greed: 0.85 },
    tugTurtle: { style: "turtle", greed: 0.25 },
    tugMixed: { style: "mixed", greed: 0.5 },
    tugRandom: { style: "random", greed: 0.5 },
    // wispRush = the Wisp-spam habit bot (2026-10-17): Rush that buys a Wisp whenever it can afford one, the priciest mob
    // otherwise; it exists so scorecard line 2 tests Wisp spam on purpose (Rush found it by accident when the Wisp's price
    // tied the Tank's).
    tugWispRush: { style: "rush", greed: 0.85, favour: "wisp" },
    // plays = the bot with its own plan (opening, wave rhythm, persona) and slow partial eyes (see actTugPlays).
    tugPlays: { style: "plays" },
    // opportunist = the yardstick bot: deterministic, full information, plays situations (an open lane, a broke foe, Runners,
    // a Tank) rather than a persona (see actTugOpportunist). Not the shipped AI.
    tugOpportunist: { style: "opportunist" }
  };
  const TUG_STYLES = ["react", "rush", "turtle", "mixed", "random", "plays", "opportunist"];
  const TUG_STYLE_GREED = { rush: 0.85, turtle: 0.25, mixed: 0.5, random: 0.5, react: 0.5, plays: 0.5, opportunist: 0.5 }; // used when params carry no greed

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
    return { style, greed, favour: p.favour };
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
  // Styles: react (actTugReact), plays (actTugPlays), opportunist (actTugOpportunist, the deterministic full-information
  // yardstick), rush / turtle / mixed (actTugGreed), random. Only match.rng draws randomness (opportunist and react draw none).
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
    const { style, greed, favour } = resolveTugParams(params);
    if (style === "react") actTugReact(match, side);
    else if (style === "plays") actTugPlays(match, side);
    else if (style === "opportunist") actTugOpportunist(match, side);
    else if (style === "random") actTugRandom(match, side);
    else actTugGreed(match, side, greed, favour);
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
  // otherwise greed x 0.3 chance of an Imp. A full queue skips the mob (the rng draws stay the same). A preset's favour
  // (tugWispRush: "wisp") is bought instead whenever it is affordable.
  function actTugGreed(match, side, greed, favour) {
    const S = match[side];
    const rng = match.rng;
    tugPickReady(match, side);
    const mobs = tugAffordableMobs(match, S);
    const emptyAny = tugFirstEmpty(match, side);
    if (S.gold >= TUG_BANK) {
      if (rng() < greed || emptyAny < 0) {
        const fav = favour ? mobs.find((m) => m.id === favour) : undefined;
        const def = fav || pickByCost(mobs, "expensive", rng);
        if (def) SIM.queueMob(match, side, def.id);
      } else if (tugTurretPrice(match, side, match.tug.bot.reserve) !== null) {
        SIM.placeTower(match, side, emptyAny);
      }
      return;
    }
    if (rng() < greed * 0.3 && tugQueueRoom(match, S) && S.gold >= match.tug.costs.mob.imp) SIM.queueMob(match, side, "imp");
  }

  // react: the sparring partner. Rule 0 (upgrades, free) first, then one spend per call (rule d2 queues a whole push set),
  // rules in order a-e with d2 between d and e; every spend except rule a keeps bot.reserve gold back. Deterministic (draws
  // nothing from match.rng). Rule d2 (plan .plans\ltw-tug-bots-push.md, 2026-10-17): with a quiet lane and a full bank it
  // pushes instead of trickling one unit at a time.
  const TUG_MELEE = ["imp", "brute"];
  const TUG_REACT_PUSH_SIEGE = ["imp", "imp", "wisp", "brute"];  // rule d2, the enemy has a finished turret (8 gold)
  const TUG_REACT_PUSH_OPEN = ["imp", "imp", "runner", "runner"]; // rule d2, the enemy has no finished turret (6 gold)
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

    // (d2) push when the lane is quiet: nothing of theirs in our half and a full bank (dumpAt): queue a whole set this think, in
    // order, while the price leaves the reserve and the queue has room, stopping at the first refusal (loop capped at
    // queue.max). The siege set when the enemy has a finished turret (the Wisp out-ranges a sub-150 turret, the Brute answers a
    // Tank), else the open set. Returns only if something was queued; otherwise falls through to (e). Draws no rng.
    if (foeInHalf.length === 0 && S.gold >= T.bot.dumpAt) {
      const set = F.towers.some((t) => t && !t.building) ? TUG_REACT_PUSH_SIEGE : TUG_REACT_PUSH_OPEN;
      let queued = 0;
      for (let i = 0; i < set.length && i < T.queue.max; i += 1) {
        if (!canQueue(set[i], false) || !queue(set[i])) break;
        queued += 1;
      }
      if (queued > 0) return;
    }

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
  // persona (once, on that first think), each wave's jitter (a banked cycle advances nextWaveAt the same way) and, with
  // a skill set and reactChance below 1, once per due reaction (the miss roll; TUG_PLAYS_SKILL).
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
  // The skill dial (plan .plans\ltw-tug-ladder-scout-eyes.md, 2026-10-21): a number at bot.plays.skill (0..1, clamped)
  // replaces these five knobs with the linear blend weak + (sharp - weak) x skill and sets reactChance (the chance a due
  // reaction is taken; a miss waits a full reactGapSeconds). null leaves the explicit knobs and reactChance 1, so every
  // existing seeded match is unchanged. 0.6 lands near today's values (3.8 / 5.7 / 0.72 / 20.2 / 3.8 / 6.4).
  const TUG_PLAYS_SKILL = {
    weak: { reactSeconds: 8, reactGapSeconds: 12, reactChance: 0.3, waveSeconds: 28, waveJitterSeconds: 8, waveMinGold: 10 },
    sharp: { reactSeconds: 1, reactGapSeconds: 1.5, reactChance: 1.0, waveSeconds: 15, waveJitterSeconds: 1, waveMinGold: 4 }
  };
  const TUG_PLAYS_SETS = {
    swarm: ["imp", "imp", "imp", "wisp"],   // 6 gold; queued in this order so the screen walks ahead of the heavy unit
    siege: ["imp", "imp", "brute", "tank"], // 10 gold
    push: ["imp", "imp", "tank", "tank"]    // 12 gold; replaces a swarm wave after a banked cycle when a wall wins the trade
  };
  const TUG_PLAYS_EPS = 1e-9; // clock comparisons (the clock is a sum of 1/30 s steps)

  // Every bot.plays number, Number(...)-coerced, falling back to TUG_PLAYS_DEFAULTS when not finite; then, when
  // bot.plays.skill is a finite number, the TUG_PLAYS_SKILL blend over its knobs (reactChance 1 otherwise).
  function tugPlaysNums(match) {
    const bot = match.tug && match.tug.bot;
    const src = bot && bot.plays && typeof bot.plays === "object" ? bot.plays : {};
    const out = {};
    for (const key of Object.keys(TUG_PLAYS_DEFAULTS)) {
      const v = Number(src[key]);
      out[key] = Number.isFinite(v) ? v : TUG_PLAYS_DEFAULTS[key];
    }
    out.reactChance = 1;
    const skill = typeof src.skill === "number" && Number.isFinite(src.skill) ? Math.min(1, Math.max(0, src.skill)) : null;
    if (skill !== null) {
      const { weak, sharp } = TUG_PLAYS_SKILL;
      for (const key of Object.keys(weak)) out[key] = weak[key] + (sharp[key] - weak[key]) * skill;
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
    // Miss roll (skill dial, reactChance < 1 only): when the gap is open and one of 2a-2c wants to act (its condition
    // without the price or the queue), one match.rng draw; at or above reactChance the bot missed it: nothing is
    // queued, lastReactAt = clock (a full reactGapSeconds before the next try) and the think goes on. reactChance 1
    // (skill null) never draws.
    let reactOpen = clock - memo.lastReactAt >= N.reactGapSeconds - TUG_PLAYS_EPS;
    const brutesWanted = Math.max(noticedCount(["tank"]), memo.tankSpam ? 1 : 0);
    if (reactOpen && N.reactChance < 1) {
      const wanted = brutesWanted > ownCount("brute") ||
        (noticedCount(["imp", "brute"]) >= N.swarmWanted && ownCount("wisp") < 1) ||
        (noticedCount(["runner"]) >= 2 && ownTurrets() < N.maxTurrets && tugFirstEmpty(match, side) >= 0);
      if (wanted && match.rng() >= N.reactChance) {
        memo.lastReactAt = clock;
        reactOpen = false;
      }
    }
    if (reactOpen) {
      // (2a) wanted = noticed enemy Tanks, at least 1 while tankSpam; more wanted than own Brutes alive + queued: a Brute.
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

  // opportunist (plan .plans\ltw-tug-scorecard-opportunist.md, 2026-10-17): the runner's yardstick bot, not the shipped
  // AI (the game keeps "plays"). Deterministic (draws nothing from match.rng, so a seed still fixes a match) and FULL
  // INFORMATION: it reads the whole board (enemy units, turrets, slots, gold, queue). It plays situations, not a persona.
  // Numbers from match.tug.bot.opportunist (TUG_OPP_DEFAULTS when the block is missing or a leaf is not finite). Memory per
  // side on match.botMemo[side]. One think: free picks first, then rules in order, each returning after it acts, at most one
  // spend per think except the all-in (4), rule 5's Imps and rule 9's set (each loop capped at queue.max, breaking on the
  // first refusal). Rules: 0 picks; 1 opening (a turret, then 2 Imps); 2 home guard (keep turretsWanted turrets, bare
  // price); 3 answer a Tank (a Brute near it, reserve ignored); 4 lane open (enemy has no finished turret): all in,
  // Runners then Imps, reserve ignored, kept going openWindowSeconds after it closes; 5 they're broke (no gold, no queue,
  // nothing in our half) and we have waveAt: push a Tank or Imps; 6 answer Runners in our half (turret, else Imps);
  // 7 answer 2+ Wisps in our half with a Wisp; 8 outnumbered in the middle: an Imp (7-8 stand down while "banking":
  // a wall ahead and fewer than wallThreat enemy mobs in our half); 9 wave at waveAt gold (siege set imp, wisp,
  // brute, tank against a wall (the Wisp out-ranges a sub-150 turret), swarm set otherwise, alternating while they have a turret); wall mode (2+ finished enemy turrets or one at wallLevel,
  // whatever is in our half): bank to wallPushAt, then the wall-push set imp, imp, wisp, wisp, tank followed by swarm sets
  // while gold covers them, as one army; 10 bank. Every rule but 3 and 4 keeps the reserve.
  const TUG_OPP_DEFAULTS = {
    turretsWanted: 2,     // keep this many turrets (building ones count); rebuild at the bare price before anything else
    reserve: 3,           // gold kept back by every rule except Tank answers and the all-in
    waveAt: 12,           // bank to this, then send a set
    wallPushAt: 20,       // against a wall, bank to this before a push (instead of waveAt)
    wallThreat: 3,        // against a wall, fewer than this many enemy mobs in our half is a trickle, not a push: bank, don't trade
    openWindowSeconds: 6, // the all-in keeps going this long after the lane closed, so Runners queued late still ride it
    runnersWhenOpen: 2,   // Runners in an all-in before the Imps
    wallLevel: 3,         // an enemy finished turret at this level or more = a wall: send siege sets, not swarms
    tankBruteRadius: 150, // an own Brute within this of an enemy Tank counts as its answer
    outnumberedBy: 2      // enemy mobs in our half minus our mobs alive >= this = trade Imps
  };
  const TUG_OPP_SWARM = ["imp", "imp", "imp", "wisp"]; // rule 9, against no wall
  // rule 9, against a wall (11 gold). The Wisp (2026-10-17 reach sweep) out-ranges a sub-150 turret and does the siege.
  const TUG_OPP_SIEGE = ["imp", "wisp", "brute", "tank"];
  // rule 9, wall mode (13 gold, sent in order): two Imps screen, two Wisps out-range a sub-150 turret and splash the
  // escorts, the Tank sieges what the Wisps soften.
  const TUG_OPP_WALL_PUSH = ["imp", "imp", "wisp", "wisp", "tank"];

  // Every bot.opportunist number, Number(...)-coerced, falling back to TUG_OPP_DEFAULTS when not finite.
  function tugOppNums(match) {
    const bot = match.tug && match.tug.bot;
    const src = bot && bot.opportunist && typeof bot.opportunist === "object" ? bot.opportunist : {};
    const out = {};
    for (const key of Object.keys(TUG_OPP_DEFAULTS)) {
      const v = Number(src[key]);
      out[key] = Number.isFinite(v) ? v : TUG_OPP_DEFAULTS[key];
    }
    return out;
  }

  function actTugOpportunist(match, side) {
    const S = match[side];
    const foe = side === "player" ? "ai" : "player";
    const F = match[foe];
    const T = match.tug;
    const N = tugOppNums(match);
    const clock = match.clock;
    const reserve = N.reserve;
    const cost = (id) => Number(T.costs.mob[id]);
    const queueMax = Math.floor(Number(T.queue.max));
    const cap = Number.isFinite(queueMax) ? Math.max(0, queueMax) : 0; // hard cap on every spend loop
    const queue = (id) => SIM.queueMob(match, side, id).ok;

    // Memory: made once per side.
    match.botMemo = match.botMemo || {};
    const fresh = !match.botMemo[side];
    if (fresh) {
      match.botMemo[side] = { opened: false, openingImps: 0, laneOpenedAt: null, laneShutAt: null, lastSetKind: null };
    }
    const memo = match.botMemo[side];
    const ownTurrets = () => S.towers.filter((t) => t).length; // finished + under construction
    const buildFront = (keep) => {
      const slot = tugFirstEmpty(match, side);
      return slot >= 0 && tugTurretPrice(match, side, keep) !== null && SIM.placeTower(match, side, slot).ok;
    };
    const ownCount = (id) => S.units.filter((u) => tugAliveUnit(u) && u.defId === id).length + S.build.filter((b) => b.defId === id).length;

    // The board, read every think. Our half by the lane midpoint (the plays bot's test).
    const lane = T.lane;
    const mid = (Number(lane.gateY.player) + Number(lane.gateY.ai)) / 2;
    const inOwnHalf = (u) => (side === "player" ? u.y > mid : u.y < mid);
    const foeAlive = F.units.filter(tugAliveUnit);
    const ownAlive = S.units.filter(tugAliveUnit);
    const foeInHalf = foeAlive.filter(inOwnHalf);
    let foeFinished = 0;
    let foeTurrets = 0; // finished or under construction
    let foeMaxLevel = -Infinity;
    for (const t of F.towers) {
      if (!t) continue;
      foeTurrets += 1;
      if (t.building) continue;
      foeFinished += 1;
      const level = Number(t.level);
      if (Number.isFinite(level) && level > foeMaxLevel) foeMaxLevel = level;
    }
    // A wall ahead (2+ finished enemy turrets, or one at wallLevel or more). Against a wall, fewer than wallThreat enemy
    // mobs in our half is a trickle, not a push: banking = bank for the wall push instead of trading (rules 7-8).
    const wallAhead = foeFinished >= 2 || foeMaxLevel >= N.wallLevel;
    const banking = wallAhead && foeInHalf.length < N.wallThreat;

    // The lane window, kept every think (before any rule can return): laneOpenedAt = clock of the first think the lane was
    // open (no enemy turret at all, finished or building: "both towers are down"; a turret under construction is not an
    // opening, and at match start both sides are still building); laneShutAt = clock of the first think it stopped being
    // open; once it has been shut for longer than openWindowSeconds both clear. The all-in runs while the lane is open or
    // the window is still on.
    if (foeTurrets === 0) {
      if (memo.laneOpenedAt === null) memo.laneOpenedAt = clock;
      memo.laneShutAt = null;
    } else if (memo.laneOpenedAt !== null) {
      if (memo.laneShutAt === null) memo.laneShutAt = clock;
      if (clock - memo.laneShutAt > N.openWindowSeconds + TUG_PLAYS_EPS) {
        memo.laneOpenedAt = null;
        memo.laneShutAt = null;
      }
    }

    // (0) picks for every ready own turret, by threat (tugChoosePick). Free.
    tugPickReady(match, side);

    // (1) opening: on the side's first think a turret in the first empty slot (front first) when affordable, else
    // straight to the Imps; then one Imp per think until 2 are queued; then opened. Owns the think until then.
    if (!memo.opened) {
      if (fresh && buildFront(0)) return;
      if (memo.openingImps < 2) {
        if (!queue("imp")) return;
        memo.openingImps += 1;
      }
      if (memo.openingImps >= 2) memo.opened = true;
      return;
    }

    // (2) home guard: fewer than turretsWanted own turrets (building ones count) and an empty slot: a turret at the bare
    // price. Rubble is not empty, so a hole waits for its timer.
    if (ownTurrets() < N.turretsWanted && buildFront(0)) return;

    // (3) answer a Tank: one own Brute per enemy Tank alive. A Brute answers when alive within tankBruteRadius of any
    // enemy Tank or waiting in the queue. Reserve ignored. (React rule a.)
    const tanks = foeAlive.filter((u) => u.defId === "tank");
    if (tanks.length > 0) {
      const queuedBrutes = S.build.filter((b) => b.defId === "brute").length;
      const nearBrutes = ownAlive.filter((u) => u.defId === "brute" && tanks.some((t) => Math.hypot(u.x - t.x, u.y - t.y) <= N.tankBruteRadius)).length;
      if (nearBrutes + queuedBrutes < tanks.length && queue("brute")) return;
    }

    // (4) the opportunity, lane open: all in. Runners up to runnersWhenOpen (alive + queued count toward it), then Imps
    // while gold covers one. The only rule that spends below the reserve and more than once per think.
    if (memo.laneOpenedAt !== null) {
      let acted = false;
      for (let i = 0, have = ownCount("runner"); i < cap && have < N.runnersWhenOpen; i += 1) {
        if (!queue("runner")) break;
        have += 1;
        acted = true;
      }
      for (let i = 0; i < cap; i += 1) {
        if (!queue("imp")) break;
        acted = true;
      }
      if (acted) return;
    }

    // (5) the opportunity, they're broke: enemy gold below its cheapest mob and nothing queued, nothing of theirs in our
    // half, and we hold waveAt: a Tank if it leaves the reserve, else Imps (up to 3) while the reserve is kept.
    const cheapest = Math.min(...Object.values(T.costs.mob).map(Number).filter(Number.isFinite));
    if (F.gold < cheapest && F.build.length === 0 && foeInHalf.length === 0 && S.gold >= N.waveAt) {
      if (S.gold - cost("tank") >= reserve && queue("tank")) return;
      let acted = false;
      for (let i = 0; i < Math.min(3, cap); i += 1) {
        if (S.gold - cost("imp") < reserve || !queue("imp")) break;
        acted = true;
      }
      if (acted) return;
    }

    // (6) answer Runners: enemy Runners alive in our half. A turret first when one is wanted and an empty slot is
    // affordable; else (or when it cannot be paid) one Imp per Runner not yet matched, one per think, reserve kept. A match
    // is an own Imp alive in our half or queued. Runners at the gate are a threat whatever the count, so this rule does not
    // stand down while banking (rules 7 and 8 still do).
    const runnersIn = foeInHalf.filter((u) => u.defId === "runner").length;
    if (runnersIn >= 1) {
      if (ownTurrets() < N.turretsWanted && buildFront(reserve)) return;
      const matched = ownAlive.filter((u) => u.defId === "imp" && inOwnHalf(u)).length + S.build.filter((b) => b.defId === "imp").length;
      if (runnersIn > matched && S.gold - cost("imp") >= reserve && queue("imp")) return;
    }

    // (7) answer Wisps: two or more enemy Wisps in our half and none of ours alive or queued: a Wisp, reserve kept.
    if (!banking && foeInHalf.filter((u) => u.defId === "wisp").length >= 2 && ownCount("wisp") === 0 && S.gold - cost("wisp") >= reserve && queue("wisp")) return;

    // (8) trade in the middle: enemy mobs in our half minus our mobs alive >= outnumberedBy: an Imp, reserve kept.
    if (!banking && foeInHalf.length - ownAlive.length >= N.outnumberedBy && S.gold - cost("imp") >= reserve && queue("imp")) return;

    // (9) wave: own gold >= waveAt. Against a wall (an enemy finished turret at wallLevel or more) the siege set, else
    // the swarm set; the same kind twice running while the enemy has a finished turret flips to the other. The set goes
    // out in order while gold - cost keeps the reserve; the first refusal stops it.
    // Wall mode (plan .plans\ltw-tug-opportunist-wall-push.md): a wall ahead (2+ finished enemy turrets, or one at
    // wallLevel or more): bank to wallPushAt (never the waveAt path), then send the wall-push set and keep sending swarm
    // sets while gold covers each mob with the reserve kept, as one army (capped at queue.max). Rules 6-8 stand down
    // while banking, so a trickle in our half does not eat the bank.
    if (wallAhead) {
      if (S.gold >= N.wallPushAt) {
        let sent = 0;
        for (const id of TUG_OPP_WALL_PUSH) {
          if (sent >= cap || S.gold - cost(id) < reserve || !queue(id)) break;
          sent += 1;
        }
        for (let more = sent >= TUG_OPP_WALL_PUSH.length; more && sent < cap;) {
          let swarmSent = 0;
          for (const id of TUG_OPP_SWARM) {
            if (sent >= cap || S.gold - cost(id) < reserve || !queue(id)) { more = false; break; }
            sent += 1;
            swarmSent += 1;
          }
          if (swarmSent === 0) more = false;
        }
        if (sent > 0) {
          memo.lastSetKind = "wall";
          return;
        }
      }
    } else if (S.gold >= N.waveAt) {
      let kind = foeMaxLevel >= N.wallLevel ? "siege" : "swarm";
      if (memo.lastSetKind === kind && foeFinished >= 1) kind = kind === "siege" ? "swarm" : "siege";
      const set = kind === "siege" ? TUG_OPP_SIEGE : TUG_OPP_SWARM;
      let sent = 0;
      for (const id of set) {
        if (sent >= cap || S.gold - cost(id) < reserve || !queue(id)) break;
        sent += 1;
      }
      if (sent > 0) {
        memo.lastSetKind = kind;
        return;
      }
    }

    // (10) otherwise bank.
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
