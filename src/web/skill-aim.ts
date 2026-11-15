import type { Point } from "@simpludify/core";
import { distance } from "../rules/arena.ts";
import type { Battle, Fighter } from "../rules/battle.ts";
import { CLASSES } from "../rules/classes.ts";
import type { SkillOrder } from "../rules/command.ts";

export interface SkillAim {
  readonly point?: Point;
  readonly order?: SkillOrder;
  readonly ally?: Fighter;
}

export function aimSkill(battle: Battle, player: Fighter, point?: Point, directional = false): SkillAim {
  if (!point) return {};
  const ability = CLASSES[player.classId];
  if (ability.target === "point") {
    return { point, order: battle.abilities.canPlace(player, point) ? { kind: "point", point } : undefined };
  }
  if (ability.target !== "ally") return {};

  let ally: Fighter | undefined;
  let bestScore = Infinity;
  const dx = point.x - player.position.x;
  const dy = point.y - player.position.y;
  const aimLength = Math.hypot(dx, dy);
  for (const other of battle.fighters) {
    if (!battle.abilities.canTarget(player, other)) continue;
    const miss = distance(other.position, point);
    if (directional) {
      const fromPlayer = distance(other.position, player.position);
      const projection = (dx * (other.position.x - player.position.x) + dy * (other.position.y - player.position.y));
      if (projection < 0.72 * fromPlayer * aimLength) continue;
    } else if (miss > 26) continue;
    if (miss < bestScore) { ally = other; bestScore = miss; }
  }
  return { point, ally, order: ally ? { kind: "ally", id: ally.id } : undefined };
}

export function radialSkillPoint(player: Fighter, offset: Point): Point {
  const ability = CLASSES[player.classId];
  if (ability.target === "self") return player.position;
  const scale = ability.range / Math.max(1, Math.hypot(offset.x, offset.y));
  return { x: player.position.x + offset.x * scale, y: player.position.y + offset.y * scale };
}
