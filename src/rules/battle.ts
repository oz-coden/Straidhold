import { ClassAbilities } from "./class-abilities.ts";
import { CLASSES, STANDARD_LINEUP, type ClassId, type Lineup } from "./classes.ts";
import {
  Actor, Collider, CollisionBody, CollisionResponse, CollisionShape, CollisionWorld,
  Component, defineComponent, Motion, Transform,
  type ComponentType, type Point, type Scene,
} from "@simpludify/core";
import { distance, placeArena, RADIUS, spawn, TEAMS, toward, trainingArena, type Arena, type Team } from "./arena.ts";
import { IDLE, validate, ZERO, type Command } from "./command.ts";
import { seesUnit } from "./vision.ts";
import { CombatEvents } from "./combat-events.ts";
import { barrierResult, beginDamage, resolveDamage, transferDamage, type DamageContext, type DamageResult } from "./damage.ts";
import { CaptureContribution, RoundStats } from "./contribution.ts";
import { Supply, type SupplyMovement } from "./supply.ts";

export const HZ = 60;
export const STEP = 1 / HZ;
export const ROUND_SECONDS = 300;
export const SITE_RADIUS = 54;
export const ACTIVATE_TICKS = 5 * HZ;
export const ABANDON_TICKS = 2.5 * HZ;

export interface FighterProfile {
  readonly hp: number;
  readonly shield: number;
  readonly speed: number;
  readonly damage: number;
  readonly attackTicks: number;
  readonly range: number;
  readonly vision: number;
  readonly shieldDelay: number;
  readonly shieldPerSecond: number;
  readonly hqHealPerSecond: number;
}

export const recruit: FighterProfile = {
  hp: 100,
  shield: 100,
  speed: 151,
  damage: 10,
  attackTicks: 30,
  range: 165,
  vision: 235,
  shieldDelay: 3 * HZ,
  shieldPerSecond: 20,
  hqHealPerSecond: 24,
};

export interface Fighter {
  readonly id: string;
  readonly team: Team;
  readonly slot: number;
  readonly classId: ClassId;
  readonly actor: Actor;
  readonly position: Transform;
  readonly motion: Motion;
  readonly profile: FighterProfile;
  hp: number;
  shield: number;
  downUntil: number;
  hitAt: number;
  revealedUntil: number;
  readonly supplyMovement: SupplyMovement;
  attackAt: number;
  command: Command;
  facing: Point;
  target?: Fighter;
}

export interface Site {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  owner: Team | null;
  device: { team: Team; progress: number; abandoned: number; contested: boolean } | null;
}

export interface Shot {
  readonly tick: number;
  readonly from: Fighter;
  readonly to: Fighter;
  readonly origin: Point;
  readonly impact: Point;
}

type CommandSource = (fighter: Fighter, battle: Battle) => Command;

class ReadCommands extends Component {
  static readonly type: ComponentType<ReadCommands> = defineComponent<ReadCommands>("StraidholdCommands");
  readonly type = ReadCommands.type;
  constructor(read: () => void) {
    super();
    this.read = read;
  }
  private readonly read: () => void;
  override update() { this.read(); }
}

export function canSee(collisions: CollisionWorld, observer: Fighter, target: Fighter, arena = trainingArena, tick = 0): boolean {
  return seesUnit(collisions, arena, tick, observer, target);
}

export function selectTarget(collisions: CollisionWorld, fighter: Fighter, fighters: readonly Fighter[], aim: Point | null, arena = trainingArena, tick = 0): Fighter | undefined {
  let best: Fighter | undefined;
  let bestScore = -Infinity;
  for (const target of fighters) {
    if (target.team === fighter.team || target.hp <= 0) continue;
    const offset = toward(fighter.position, target.position);
    const range = Math.hypot(offset.x, offset.y);
    if (range > Math.min(fighter.profile.range, fighter.profile.vision)) continue;
    const alignment = aim && range > 0 ? (aim.x * offset.x + aim.y * offset.y) / range : 1;
    if (aim && alignment < (target === fighter.target ? 0.48 : 0.57)) continue;
    if (!canSee(collisions, fighter, target, arena, tick)) continue;
    const score = 1.45 * alignment - range / fighter.profile.range + (target === fighter.target ? 0.23 : 0);
    if (score > bestScore || (score === bestScore && best && target.id < best.id)) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

export class Battle {
  readonly arena: Arena;
  readonly collisions: CollisionWorld;
  readonly fighters: readonly Fighter[];
  readonly sites: Site[];
  readonly supply: Supply;
  readonly abilities: ClassAbilities;
  readonly scores = { blue: 0, red: 0 };
  readonly kills = { blue: 0, red: 0 };
  readonly shots: Shot[] = [];
  readonly duration: number;
  tick = 0;
  result: Team | "draw" | null = null;

  private readonly events: CombatEvents;
  private readonly stats: RoundStats;
  private readonly movementStarts: { x: number; y: number }[] = [];
  private readonly captures = new Map<Site, CaptureContribution>();
  private readonly source: CommandSource;
  private started: boolean;

  constructor(scene: Scene, atlas: string, seconds: number, source: CommandSource, arena: Arena = trainingArena, started = true, round = 1, lineup: Lineup = STANDARD_LINEUP) {
    this.source = source;
    this.started = started;
    this.arena = arena;
    this.events = new CombatEvents(round);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > ROUND_SECONDS) throw new RangeError("Invalid round duration");
    this.duration = seconds * HZ;
    this.collisions = new CollisionWorld(scene);
    placeArena(scene, atlas, arena);
    this.sites = arena.sites.map((site) => ({ ...site, owner: null, device: null }));
    this.supply = new Supply(arena);
    scene.add(new Actor({ id: "commands" })).add(new ReadCommands(() => this.read()));
    this.fighters = TEAMS.flatMap((team) => Array.from({ length: 5 }, (_, slot) => {
      const id = `${team}-${slot}`;
      const classId = lineup[team][slot];
      const profile = classId === "recon"
        ? { ...recruit, vision: recruit.vision * (1 + CLASSES.recon.visionBoost) }
        : recruit;
      const actor = scene.add(new Actor({ id }));
      const position = actor.add(new Transform(spawn(team, slot, arena)));
      const motion = actor.add(new Motion({ speed: recruit.speed }));
      actor.add(new CollisionBody());
      // Units share space with each other. Only the terrain layer blocks movement.
      actor.add(new Collider({ shape: CollisionShape.Circle, radius: RADIUS, response: CollisionResponse.Solid, layer: 2, mask: 1 }));
      return {
        id, team, slot, classId, actor, position, motion, profile,
        hp: recruit.hp, shield: recruit.shield, downUntil: 0, hitAt: -Infinity, attackAt: 0, revealedUntil: 0, supplyMovement: { boost: 0, slow: 0 },
        command: IDLE, facing: { x: Math.sign(arena.hq[team === "blue" ? "red" : "blue"].x - arena.hq[team].x), y: Math.sign(arena.hq[team === "blue" ? "red" : "blue"].y - arena.hq[team].y) },
      };
    }));
    this.stats = new RoundStats(this.fighters);
    this.abilities = new ClassAbilities(this, HZ);
    scene.onUpdate(() => this.resolve());
  }

  get remaining() { return (this.duration - this.tick) / HZ; }

  get combatEvents() { return this.events.events; }

  currentStreak(id: string) { return this.stats.currentStreak(id); }

  participantStats() { return this.stats.snapshot(); }

  start() { this.started = true; }

  private read() {
    if (!this.started || this.result) return;
    this.tick++;
    this.abilities.expire(this.tick);
    // Read every source against the same state before applying any commands.
    for (const fighter of this.fighters) {
      if (fighter.hp === 0 && this.tick >= fighter.downUntil) {
        Object.assign(fighter.position, spawn(fighter.team, fighter.slot, this.arena));
        fighter.hp = fighter.profile.hp;
        fighter.shield = fighter.profile.shield;
        fighter.hitAt = -Infinity;
        fighter.attackAt = this.tick;
        fighter.revealedUntil = 0;
        fighter.supplyMovement.boost = fighter.supplyMovement.slow = 0;
        fighter.target = undefined;
        fighter.actor.enabled = true;
      }
    }
    const commands = this.fighters.map((fighter) => {
      const command = this.source(fighter, this);
      return fighter.hp > 0 ? validate(command) : IDLE;
    });
    this.fighters.forEach((fighter, i) => {
      const skill = commands[i].skill;
      if (skill && this.abilities.activate(fighter, skill)) this.stats.recordSkill(fighter.id);
    });
    this.fighters.forEach((fighter, i) => {
      // Sample after respawns and before Motion and collision resolution.
      const start = this.movementStarts[i] ?? (this.movementStarts[i] = { x: 0, y: 0 });
      start.x = fighter.position.x;
      start.y = fighter.position.y;
      const command = commands[i];
      fighter.command = command;
      Object.assign(fighter.motion.direction, command.move);
      if (fighter.hp > 0) {
        const assassin = fighter.classId === "assassin" ? CLASSES.assassin : undefined;
        const supply = this.supply.speed(fighter.supplyMovement, fighter.team, fighter.position,
          (this.tick - fighter.hitAt) / HZ, command.move !== ZERO, STEP, assassin);
        const slow = this.abilities.effects.total(fighter, "movementSlow");
        fighter.motion.speed = fighter.profile.speed * (1 + (assassin?.speedBoost ?? 0)) * Math.max(0, supply - slow);
      }
      if (command.aim) fighter.facing = command.aim;
      else if (command.move !== ZERO) fighter.facing = command.move;
    });
  }

  private resolve() {
    if (!this.started || this.result) return;
    this.events.beginTick(this.tick);
    for (let i = 0; i < this.fighters.length; i++) {
      const fighter = this.fighters[i];
      if (fighter.hp > 0) this.stats.recordMovement(fighter.id, distance(this.movementStarts[i], fighter.position));
    }
    const cutoff = this.tick - Math.round(HZ * 0.22);
    while (this.shots.length && this.shots[0].tick < cutoff) this.shots.shift();
    const hits: Shot[] = [];
    for (const fighter of this.fighters) {
      if (fighter.hp <= 0) continue;
      const { aim, attack } = fighter.command;
      fighter.target = aim || attack
        ? selectTarget(this.collisions, fighter, this.fighters, aim, this.arena, this.tick)
        : undefined;
      if (fighter.target && attack && this.tick >= fighter.attackAt) {
        fighter.attackAt = this.tick + fighter.profile.attackTicks;
        hits.push({
          tick: this.tick, from: fighter, to: fighter.target,
          origin: { x: fighter.position.x, y: fighter.position.y },
          impact: { x: fighter.target.position.x, y: fighter.target.position.y },
        });
      }
    }
    // Reveal after collecting all attacks to preserve simultaneous decisions.
    // Both sides can land shots captured at the start of this tick. End
    // their streaks after all such shots resolve, regardless of roster order.
    const previousStreaks = hits.length ? new Map(this.fighters.map(({ id }) => [id, this.stats.currentStreak(id)])) : undefined;
    const damageBonuses = hits.map(({ from }) => this.abilities.effects.total(from, "outgoingDamage"));
    for (const [i, hit] of hits.entries()) {
      hit.from.revealedUntil = this.tick + 1.5 * HZ;
      const context = beginDamage({
        attackId: `${this.tick}:${i}`, attackerId: hit.from.id, targetId: hit.to.id,
        baseDamage: hit.from.profile.damage,
      });
      this.resolveHit({ ...context, amount: context.amount * Math.max(0, 1 + damageBonuses[i]) },
        hit.from, hit.to, previousStreaks!);
    }
    for (const event of this.combatEvents) {
      if (event.kind === "defeat") this.stats.resetStreak(event.target);
    }
    this.shots.push(...hits);

    for (const fighter of this.fighters) {
      if (fighter.hp <= 0) continue;
      const quiet = this.tick - fighter.hitAt;
      const { hp, shield } = fighter;
      if (quiet > fighter.profile.shieldDelay) {
        fighter.shield = Math.min(fighter.profile.shield, fighter.shield + fighter.profile.shieldPerSecond / HZ);
      }
      if (quiet > fighter.profile.shieldDelay && distance(fighter.position, this.arena.hq[fighter.team]) <= 84) {
        fighter.hp = Math.min(fighter.profile.hp, fighter.hp + fighter.profile.hqHealPerSecond / HZ);
      }
      if (fighter.hp > hp || fighter.shield > shield) {
        this.stats.recordRecovery(fighter.id, Math.max(0, fighter.shield - shield), Math.max(0, fighter.hp - hp));
      }
    }
    let changed = false;
    for (const site of this.sites) {
      const previous = site.owner;
      this.updateSite(site);
      changed ||= previous !== site.owner;
    }
    if (changed && this.arena.lanes.length) this.supply.rebuild(this.sites);
    if (this.tick % HZ === 0) {
      for (const { owner } of this.sites) if (owner) this.scores[owner]++;
    }
    if (this.tick === this.duration) {
      const owned = (team: Team) => this.sites.filter((site) => site.owner === team).length;
      const lead = this.scores.blue - this.scores.red || owned("blue") - owned("red") || this.kills.blue - this.kills.red;
      this.result = lead === 0 ? "draw" : lead > 0 ? "blue" : "red";
      this.stats.finishRound();
      this.abilities.clear();
      for (const fighter of this.fighters) Object.assign(fighter.motion.direction, ZERO);
    }
  }

  private resolveHit(context: DamageContext, attacker: Fighter, target: Fighter, previousStreaks: ReadonlyMap<string, number>) {
    if (target.hp <= 0) return;
    const reduction = this.abilities.effects.total(target, "damageReduction");
    let amount = context.amount * Math.max(0, 1 - reduction);
    if (amount <= 0 || !Number.isFinite(amount)) return;

    // A barrier takes the entire hit, including the overflow on its breaking blow.
    const stoppedStreak = previousStreaks.get(target.id) ?? 0;
    const absorbed = this.abilities.absorb(target, amount);
    if (absorbed > 0) {
      this.applyDamage(barrierResult(context, target, absorbed), attacker, target, stoppedStreak);
      return;
    }

    // All links divide the same primary amount. Derived hits keep attribution
    // and restart at the recipient's defenses, with no outgoing modifiers or links.
    if (!context.transferred) {
      const guards = this.abilities.protectors(target).filter(({ source }) => source.hp > 0)
        .sort((a, b) => a.source.slot - b.source.slot);
      const share = amount * CLASSES.tank.share;
      amount -= share * guards.length;
      for (const { source } of guards) {
        this.resolveHit(transferDamage(context, source.id, share), attacker, source, previousStreaks);
      }
    }
    const damage = resolveDamage({ ...context, amount }, target);
    if (damage) this.applyDamage(damage, attacker, target, stoppedStreak);
  }

  private applyDamage(damage: DamageResult, attacker: Fighter, target: Fighter, stoppedStreak: number) {
    const { request, targetId, shieldDamage, hpDamage, barrierDamage, remaining, lethal } = damage;
    target.shield = remaining.shield;
    target.hp = remaining.hp;
    target.hitAt = this.tick;

    this.stats.recordDamage(attacker, target, shieldDamage, hpDamage, barrierDamage);
    this.events.record({
      kind: "damage", attackId: request.attackId, attacker: request.attackerId,
      originalTarget: request.targetId, target: targetId, team: attacker.team,
      shield: shieldDamage, hp: hpDamage, ...(barrierDamage ? { barrier: barrierDamage } : {}), lethal,
    });
    if (lethal) {
      const { assists, streak } = this.stats.recordDefeat(attacker, target);
      this.events.record({ kind: "defeat", attacker: request.attackerId, target: targetId, team: attacker.team, assists, streak, stoppedStreak });
      const elapsed = 1 - this.remaining / (this.duration / HZ);
      target.downUntil = this.tick + Math.round((2 + 8 * Math.min(1, elapsed / 0.8)) * HZ);
      target.target = undefined;
      target.actor.enabled = false;
      this.abilities.onDefeat(target);
      this.kills[attacker.team]++;
      this.scores[attacker.team] += 2;
    }
  }

  private updateSite(site: Site) {
    const inside = this.fighters.filter((fighter) => fighter.hp > 0 && distance(fighter.position, site) <= SITE_RADIUS);
    if (!site.device) {
      const installers = inside.filter((fighter) => fighter.team !== site.owner && fighter.command.deploy);
      const first = installers[0];
      if (first && installers.every((fighter) => fighter.team === first.team)) {
        site.device = { team: first.team, progress: 0, abandoned: 0, contested: false };
        this.captures.set(site, new CaptureContribution(first.id));
      }
      return;
    }
    const device = site.device;
    const guards = inside.filter((fighter) => fighter.team === device.team);
    device.contested = inside.some((fighter) => fighter.team !== device.team);
    device.abandoned = guards.length ? 0 : device.abandoned + 1;
    if (device.abandoned >= ABANDON_TICKS) {
      this.captures.delete(site);
      site.device = null;
    } else if (guards.length && !device.contested) {
      const contribution = this.captures.get(site)!;
      contribution.advance(guards);
      if (++device.progress >= ACTIVATE_TICKS) {
        const previous = site.owner;
        site.owner = device.team;
        this.scores[device.team] += 4;
        const participants = this.stats.recordCapture(contribution);
        this.events.record({
          kind: "capture", site: site.id, team: device.team, previous,
          installer: contribution.installer, guards: participants,
        });
        this.captures.delete(site);
        site.device = null;
      }
    }
  }
}
