import type { Point } from "@simpludify/core";
import { hasClearance, distance, HQ, RADIUS, route, toward } from "./arena.ts";
import { canSee, HZ, SITE_RADIUS, type Battle, type Fighter } from "./battle.ts";
import { IDLE, ZERO, type Command } from "./command.ts";

interface Navigation {
  path: Point[];
  goal: Point;
  refreshAt: number;
  retreat: boolean;
}

export function createAI() {
  const navigation = new Map<string, Navigation>();
  return (fighter: Fighter, battle: Battle): Command => {
    if (fighter.hp <= 0) return IDLE;
    let state = navigation.get(fighter.id);
    if (!state) {
      state = { path: [], goal: fighter.position, refreshAt: 0, retreat: false };
      navigation.set(fighter.id, state);
    }
    const { team, slot, position, profile } = fighter;
    // Mirrored lane assignments. Two slots can rotate away from a secured site.
    const lanes = [0, 0, 1, 2, 2];
    let site = battle.sites[lanes[slot]];
    if (slot % 2 === 1 && site.owner === team && !site.device) {
      site = battle.sites.filter((candidate) => candidate.owner !== team)
        .sort((a, b) => distance(a, position) - distance(b, position))[0] ?? site;
    }
    const enemy = battle.fighters.filter((other) => other.team !== team && canSee(battle.collisions, fighter, other))
      .sort((a, b) => distance(a.position, position) - distance(b.position, position))[0];
    const range = enemy ? distance(position, enemy.position) : Infinity;
    const aim = enemy ? toward(position, enemy.position) : null;
    const inSite = distance(position, site) <= SITE_RADIUS;
    if (fighter.hp <= 26 && fighter.shield <= 18) state.retreat = true;
    if (fighter.hp >= 76) state.retreat = false;

    let goal: Point = {
      x: site.x + (slot % 2 ? 24 : -24) * (team === "blue" ? 1 : -1),
      y: site.y + (team === "blue" ? 22 : -22),
    };
    if (state.retreat) goal = HQ[team];
    else if (enemy && range < 76 && !inSite) {
      const offset = toward(enemy.position, position);
      const away = { x: position.x + offset.x * 0.45, y: position.y + offset.y * 0.45 };
      if (hasClearance(position, away, RADIUS)) goal = away;
    } else if (enemy && !inSite && range <= profile.range * 0.85) {
      // Fire while closing on the objective, with intermittent lateral movement.
      const sidestep = Math.floor((battle.tick + slot * 22) / 95) % 2 === 0 ? 1 : -1;
      const lateral = { x: position.x - (aim?.y ?? 0) * 0.25 * sidestep, y: position.y + (aim?.x ?? 0) * 0.25 * sidestep };
      if (hasClearance(position, lateral, RADIUS) && distance(position, site) < 110) goal = lateral;
    } else if (enemy && !inSite && range > profile.range && distance(enemy.position, site) < 110) {
      goal = enemy.position;
    }

    let waypoint = goal;
    if (!hasClearance(position, goal, RADIUS)) {
      if (battle.tick >= state.refreshAt || distance(state.goal, goal) > 48) {
        state.path = route(position, goal);
        state.goal = { x: goal.x, y: goal.y };
        state.refreshAt = battle.tick + 16;
      }
      waypoint = state.path.findLast((point) => hasClearance(position, point, RADIUS - 0.2)) ?? state.path[0] ?? position;
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
