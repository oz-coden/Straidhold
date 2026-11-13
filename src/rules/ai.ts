import type { Point } from "@simpludify/core";
import { hasClearance, distance, RADIUS, route, toward, type Team } from "./arena.ts";
import { canSee, SITE_RADIUS, type Battle, type Fighter, type Site } from "./battle.ts";
import { IDLE, ZERO, type Command } from "./command.ts";

interface Navigation {
  path: Point[];
  goal: Point;
  refreshAt: number;
  retreat: boolean;
  life: number;
  flankStep: number;
}

export type Strategy = "balanced" | "flank" | "center";

export function createAI(strategies: Partial<Record<Team, Strategy>> = {}, seed = 0) {
  const navigation = new Map<string, Navigation>();
  return (fighter: Fighter, battle: Battle): Command => {
    if (fighter.hp <= 0) return IDLE;
    let state = navigation.get(fighter.id);
    if (!state) {
      state = { path: [], goal: fighter.position, refreshAt: 0, retreat: false, life: fighter.downUntil, flankStep: 0 };
      navigation.set(fighter.id, state);
    }
    const { team, slot, position, profile } = fighter;
    const { arena, supply, sites } = battle;
    if (state.life !== fighter.downUntil) {
      state.life = fighter.downUntil;
      state.flankStep = 0;
      state.path = [];
      state.refreshAt = 0;
    }
    const plans = arena.plans?.[team];
    const strategy = strategies[team] ?? "balanced";
    const group = seed % 5;
    const role = (slot + group) % 5;
    const flanking = !!plans && (strategy === "flank" ? role >= 3 : strategy === "balanced" && role === 4);
    let site: Site;
    let flankWaypoint: Point | undefined;
    if (plans) {
      const planIndex = strategy === "center" && role >= 1 && role <= 3 ? Math.floor(plans.length / 2)
        : Math.round(role * (plans.length - 1) / 4);
      const plan = plans[planIndex];
      const objective = sites.find(({ id }) => id === plan.at(-1))!;
      const supplyStop = plan.map((id) => sites.find((candidate) => candidate.id === id)!)
        .find((candidate) => !supply.connected[team].has(candidate.id) && candidate.owner !== team);
      site = supplyStop ?? objective;
      if (flanking) {
        const flanks = arena.flanks![team];
        while (state.flankStep < flanks.length && distance(position, flanks[state.flankStep]) < 42) state.flankStep++;
        flankWaypoint = flanks[state.flankStep];
        site = objective;
      }
      if (!flankWaypoint && site.owner === team && !site.device && role % 2 === 1) {
        const connected = supply.connected[team];
        const fronts = sites.filter((candidate) => candidate.owner !== team && arena.lanes.some(({ from, to }) =>
          (from === candidate.id && connected.has(to)) || (to === candidate.id && connected.has(from))));
        site = fronts.sort((a, b) => distance(a, position) - distance(b, position))[0] ?? site;
      }
    } else {
      const lanes = [0, 0, 1, 2, 2];
      site = sites[lanes[slot]];
      if (slot % 2 === 1 && site.owner === team && !site.device) {
        site = sites.filter((candidate) => candidate.owner !== team)
          .sort((a, b) => distance(a, position) - distance(b, position))[0] ?? site;
      }
    }
    const enemy = battle.fighters.filter((other) => other.team !== team
      && canSee(battle.collisions, fighter, other, arena, battle.tick))
      .sort((a, b) => distance(a.position, position) - distance(b.position, position))[0];
    const range = enemy ? distance(position, enemy.position) : Infinity;
    const aim = enemy ? toward(position, enemy.position) : null;
    const inSite = distance(position, site) <= SITE_RADIUS;
    if (fighter.hp <= 26 && fighter.shield <= 18) state.retreat = true;
    if (fighter.hp >= 76) state.retreat = false;

    let goal: Point = flankWaypoint ?? {
      x: site.x + (slot % 2 ? 24 : -24) * (team === "blue" ? 1 : -1),
      y: site.y + (plans || team === "blue" ? 22 : -22),
    };
    if (state.retreat) {
      goal = arena.hq[team];
      state.flankStep = 0;
    } else if (enemy && range < 76 && !inSite) {
      const offset = toward(enemy.position, position);
      const away = { x: position.x + offset.x * 0.45, y: position.y + offset.y * 0.45 };
      if (hasClearance(position, away, RADIUS, arena)) goal = away;
    } else if (enemy && !inSite && range <= profile.range * 0.85) {
      // Fire while closing on the objective, with intermittent lateral movement.
      const sidestep = Math.floor((battle.tick + slot * 22) / 95) % 2 === 0 ? 1 : -1;
      const lateral = { x: position.x - (aim?.y ?? 0) * 0.25 * sidestep, y: position.y + (aim?.x ?? 0) * 0.25 * sidestep };
      if (hasClearance(position, lateral, RADIUS, arena) && distance(position, site) < 110) goal = lateral;
    } else if (enemy && !inSite && range > profile.range && distance(enemy.position, site) < 110) {
      goal = enemy.position;
    }

    let waypoint = goal;
    if (!hasClearance(position, goal, RADIUS, arena)) {
      if (battle.tick >= state.refreshAt || distance(state.goal, goal) > 48) {
        state.path = route(position, goal, arena);
        state.goal = { x: goal.x, y: goal.y };
        state.refreshAt = battle.tick + (plans ? 35 : 16);
      }
      waypoint = state.path.findLast((point) => hasClearance(position, point, RADIUS - 0.2, arena)) ?? state.path[0] ?? position;
    }
    const remaining = distance(position, waypoint);
    const offset = toward(position, waypoint);
    const move = remaining < 2 ? ZERO : { x: offset.x / Math.max(remaining, 10), y: offset.y / Math.max(remaining, 10) };
    return {
      move,
      aim,
      attack: range <= profile.range,
      deploy: inSite && !state.retreat && !site.device && site.owner !== team,
    };
  };
}
