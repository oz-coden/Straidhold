import type { Point } from "@simpludify/core";
import { castTerrain, distance, hasClearance, type Team } from "./arena.ts";
import type { Battle, Fighter } from "./battle.ts";
import { CLASSES } from "./classes.ts";
import type { SkillOrder } from "./command.ts";
import { StatusEffects } from "./status.ts";

export interface Barrier {
  readonly sourceId: string;
  readonly endsAt: number;
  capacity: number;
}

interface Guard {
  readonly source: Fighter;
  readonly target: Fighter;
  readonly endsAt: number;
}

export interface ReconContact {
  readonly id: string;
  readonly position: Point;
  readonly endsAt: number;
}

interface Scan {
  readonly team: Team;
  readonly origin: Point;
  readonly endsAt: number;
}

export const EFFECT_IDS = {
  surge: "class.assassin.surge",
  tank: "class.tank.reduction",
  slow: "class.control.slow",
  debuff: "class.control.debuff-power",
  buff: "class.support.buff-power",
} as const;

const enemyTeam = (team: Team): Team => team === "blue" ? "red" : "blue";

export class ClassAbilities {
  readonly effects = new StatusEffects();
  private readonly ready = new Map<string, number>();
  private readonly barriers = new Map<string, Barrier>();
  private readonly guards: Guard[] = [];
  private readonly contacts = { blue: new Map<string, ReconContact>(), red: new Map<string, ReconContact>() };
  private readonly pulses: Scan[] = [];

  private readonly battle: Battle;
  private readonly hz: number;

  constructor(battle: Battle, hz: number) {
    this.battle = battle;
    this.hz = hz;
    for (const fighter of battle.fighters) {
      const { classId, id, team } = fighter;
      if (classId === "tank") this.effects.add({
        id: EFFECT_IDS.tank, sourceId: id, target: id, modifier: "damageReduction", strength: CLASSES.tank.reduction, endsAt: Infinity,
      });
      if (classId === "control" || classId === "support") this.effects.add({
        id: classId === "control" ? EFFECT_IDS.debuff : EFFECT_IDS.buff,
        sourceId: id, target: { team, excludeSource: true },
        modifier: classId === "control" ? "debuffPower" : "buffPower",
        strength: classId === "control" ? CLASSES.control.debuffBoost : CLASSES.support.buffBoost,
        endsAt: Infinity,
      });
    }
  }

  cooldown(fighter: Fighter): number {
    return Math.max(0, (this.ready.get(fighter.id) ?? 0) - this.battle.tick);
  }

  barrier(fighter: Fighter): Readonly<Barrier> | undefined { return this.barriers.get(fighter.id); }

  absorb(fighter: Fighter, amount: number): number {
    const barrier = this.barriers.get(fighter.id);
    if (!barrier) return 0;
    const absorbed = Math.min(amount, barrier.capacity);
    barrier.capacity -= absorbed;
    if (barrier.capacity <= 0) this.barriers.delete(fighter.id);
    return absorbed;
  }

  protecting(fighter: Fighter) { return this.guards.find(({ source }) => source === fighter); }

  protectors(fighter: Fighter): readonly Guard[] {
    return this.guards.filter(({ target }) => target === fighter);
  }

  recon(team: Team): ReadonlyMap<string, ReconContact> { return this.contacts[team]; }

  scans(): readonly Scan[] { return this.pulses; }

  expire(tick: number) {
    this.effects.expire(tick);
    for (const [id, barrier] of this.barriers) if (barrier.endsAt <= tick) this.barriers.delete(id);
    for (let i = this.guards.length - 1; i >= 0; i--) if (this.guards[i].endsAt <= tick) this.guards.splice(i, 1);
    for (const contacts of Object.values(this.contacts)) {
      for (const [id, contact] of contacts) if (contact.endsAt <= tick) contacts.delete(id);
    }
    while (this.pulses.length && this.pulses[0].endsAt <= tick) this.pulses.shift();
  }

  onDefeat(fighter: Fighter) {
    this.effects.clearTarget(fighter.id);
    this.barriers.delete(fighter.id);
    for (let i = this.guards.length - 1; i >= 0; i--) {
      const { source, target } = this.guards[i];
      if (source === fighter || target === fighter) this.guards.splice(i, 1);
    }
  }

  clear() {
    this.effects.clear();
    this.ready.clear();
    this.barriers.clear();
    this.guards.length = this.pulses.length = 0;
    this.contacts.blue.clear();
    this.contacts.red.clear();
  }

  canTarget(caster: Fighter, target: Fighter): boolean {
    const { classId } = caster;
    if (classId !== "tank" && classId !== "support") return false;
    if (target === caster || target.hp <= 0 || target.team !== caster.team
      || !this.inRange(caster, target.position, CLASSES[classId].range)) return false;
    return classId === "support" ? !this.barriers.has(target.id)
      : !this.protecting(caster) && this.protectors(target).length < CLASSES.tank.maxLinks;
  }

  canPlace(caster: Fighter, point: Point): boolean {
    return caster.classId === "control" && this.inRange(caster, point, CLASSES.control.range);
  }

  private inRange(caster: Fighter, point: Point, range: number): boolean {
    const { arena, collisions } = this.battle;
    return Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.y >= 0 && point.x < arena.width && point.y < arena.height
      && distance(caster.position, point) <= range + 1e-8 && hasClearance(point, point, 0, arena)
      && !castTerrain(collisions, caster.position, point);
  }

  activate(caster: Fighter, order: SkillOrder): boolean {
    if (caster.hp <= 0 || this.cooldown(caster) > 0) return false;
    const { classId, id, team, position } = caster;
    const { tick } = this.battle;
    const ability = CLASSES[classId];
    const endsAt = tick + ability.duration * this.hz;

    if (classId === "assassin" && order.kind === "self") {
      this.effects.add({
        id: EFFECT_IDS.surge, sourceId: id, target: id, modifier: "outgoingDamage",
        strength: CLASSES.assassin.damageBoost * (1 + this.effects.total(caster, "buffPower")), endsAt,
      });
    } else if (classId === "recon" && order.kind === "self") {
      this.pulses.push({ team, origin: { x: position.x, y: position.y }, endsAt: tick + this.hz / 2 });
      for (const enemy of this.battle.fighters) {
        if (enemy.team === team || enemy.hp <= 0 || distance(position, enemy.position) > CLASSES.recon.radius) continue;
        this.contacts[team].set(enemy.id, { id: enemy.id, position: { x: enemy.position.x, y: enemy.position.y }, endsAt });
      }
    } else if (classId === "control" && order.kind === "point" && this.canPlace(caster, order.point)) {
      this.effects.add({
        id: EFFECT_IDS.slow, sourceId: id, modifier: "movementSlow", endsAt,
        target: { team: enemyTeam(team), center: { ...order.point }, radius: CLASSES.control.radius },
        strength: CLASSES.control.slow * (1 + this.effects.total(caster, "debuffPower")),
      });
    } else if ((classId === "tank" || classId === "support") && order.kind === "ally") {
      const target = this.battle.fighters.find(({ id }) => id === order.id);
      if (!target || !this.canTarget(caster, target)) return false;
      if (classId === "tank") this.guards.push({ source: caster, target, endsAt });
      else this.barriers.set(target.id, {
        sourceId: id, endsAt, capacity: CLASSES.support.capacity * (1 + this.effects.total(caster, "buffPower")),
      });
    } else return false;

    this.ready.set(id, tick + ability.cooldown * this.hz);
    return true;
  }
}
