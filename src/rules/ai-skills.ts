import type { Point } from "@simpludify/core";
import { distance } from "./arena.ts";
import { canSee, HZ, type Battle, type Fighter, type Site } from "./battle.ts";
import { CLASSES } from "./classes.ts";
import type { SkillOrder } from "./command.ts";

export function chooseSkill(fighter: Fighter, battle: Battle, site: Site, attackable: boolean): SkillOrder | undefined {
  const { abilities, tick, fighters } = battle;
  if (abilities.cooldown(fighter)) return;
  const { classId, team, position } = fighter;
  if (classId === "assassin") return attackable ? { kind: "self" } : undefined;

  const allies = fighters.filter((other) => other.team === team && other.hp > 0);
  const enemies = fighters.filter((enemy) => enemy.team !== team && allies.some((ally) =>
    canSee(battle.collisions, ally, enemy, battle.arena, tick)));
  if (classId === "tank" || classId === "support") {
    let best: Fighter | undefined;
    let bestScore = -Infinity;
    for (const ally of allies) {
      if (!abilities.canTarget(fighter, ally)) continue;
      const threatened = enemies.some((enemy) => distance(ally.position, enemy.position) <= enemy.profile.range);
      if (!threatened && tick - ally.hitAt > HZ) continue;
      const score = (threatened ? 50 : 0) + (1 - ally.hp / ally.profile.hp) * 80
        + (1 - ally.shield / ally.profile.shield) * 25 - distance(position, ally.position) / 8;
      if (score > bestScore) { best = ally; bestScore = score; }
    }
    return best ? { kind: "ally", id: best.id } : undefined;
  }

  const nearby = enemies.filter((enemy) => distance(position, enemy.position) <= CLASSES.recon.radius);
  const contacts = [...abilities.recon(team).values()].filter(({ id, position: lastSeen }) =>
    !enemies.some((enemy) => enemy.id === id) && distance(position, lastSeen) <= CLASSES.recon.radius);
  if (classId === "recon") {
    const nearFront = distance(position, site) <= CLASSES.recon.radius
      && (site.owner !== team || site.device?.team !== team && site.device !== null);
    return nearFront && nearby.length + contacts.length < 2 ? { kind: "self" } : undefined;
  }

  // Score only publicly observed positions, remembered snapshots and the objective.
  const known: readonly Point[] = [...nearby.map((enemy) => enemy.position), ...contacts.map((contact) => contact.position)];
  const candidates = [...known];
  if (site.device && site.device.team !== team) candidates.push(site);
  let best: Point | undefined;
  let bestScore = -Infinity;
  for (const point of candidates) {
    if (!abilities.canPlace(fighter, point)) continue;
    const score = known.filter((observed) => distance(observed, point) <= CLASSES.control.radius).length * 100
      + (distance(site, point) <= CLASSES.control.radius ? 35 : 0) - distance(position, point) / 8;
    if (score > bestScore) { best = point; bestScore = score; }
  }
  return best ? { kind: "point", point: best } : undefined;
}
