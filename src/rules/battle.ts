import {
  Actor, Collider, CollisionBody, CollisionResponse, CollisionShape, CollisionWorld,
  Component, defineComponent, Motion, Transform,
  type ComponentType, type Point, type Scene,
} from "@simpludify/core";
import { distance, placeArena, RADIUS, spawn, TEAMS, toward, trainingArena, type Arena, type Team } from "./arena.ts";
import { IDLE, validate, ZERO, type Command } from "./command.ts";
import { seesUnit } from "./vision.ts";
import { CombatEvents } from "./combat-events.ts";
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
  damage: 18,
  attackTicks: 40,
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

  constructor(scene: Scene, atlas: string, seconds: number, source: CommandSource, arena: Arena = trainingArena, started = true, round = 1) {
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
      const actor = scene.add(new Actor({ id }));
      const position = actor.add(new Transform(spawn(team, slot, arena)));
      const motion = actor.add(new Motion({ speed: recruit.speed }));
      actor.add(new CollisionBody());
      // Units share space with each other. Only the terrain layer blocks movement.
      actor.add(new Collider({ shape: CollisionShape.Circle, radius: RADIUS, response: CollisionResponse.Solid, layer: 2, mask: 1 }));
      return {
        id, team, slot, actor, position, motion, profile: recruit,
        hp: recruit.hp, shield: recruit.shield, downUntil: 0, hitAt: -Infinity, attackAt: 0, revealedUntil: 0, supplyMovement: { boost: 0, slow: 0 },
        command: IDLE, facing: { x: Math.sign(arena.hq[team === "blue" ? "red" : "blue"].x - arena.hq[team].x), y: Math.sign(arena.hq[team === "blue" ? "red" : "blue"].y - arena.hq[team].y) },
      };
    }));
    this.stats = new RoundStats(this.fighters);
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
      // Sample after respawns and before Motion and collision resolution.
      const start = this.movementStarts[i] ?? (this.movementStarts[i] = { x: 0, y: 0 });
      start.x = fighter.position.x;
      start.y = fighter.position.y;
      const command = commands[i];
      fighter.command = command;
      Object.assign(fighter.motion.direction, command.move);
      if (fighter.hp > 0 && this.arena.lanes.length) {
        const multiplier = this.supply.speed(fighter.supplyMovement, fighter.team, fighter.position,
          (this.tick - fighter.hitAt) / HZ, command.move !== ZERO, STEP);
        fighter.motion.speed = fighter.profile.speed * multiplier;
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
    const previousStreaks = hits.map(({ to }) => this.stats.currentStreak(to.id));
    for (const [i, hit] of hits.entries()) {
      hit.from.revealedUntil = this.tick + 1.5 * HZ;
      this.damage(hit.to, hit.from, previousStreaks[i]);
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
      for (const fighter of this.fighters) Object.assign(fighter.motion.direction, ZERO);
    }
  }

  private damage(target: Fighter, attacker: Fighter, stoppedStreak: number) {
    if (target.hp <= 0) return;
    const { hp, shield } = target;
    const overflow = Math.max(0, attacker.profile.damage - target.shield);
    target.shield = Math.max(0, target.shield - attacker.profile.damage);
    target.hp = Math.max(0, target.hp - overflow);
    target.hitAt = this.tick;
    if (shield > target.shield || hp > target.hp) {
      this.stats.recordDamage(attacker, target, shield - target.shield, hp - target.hp);
      this.events.record({
        kind: "damage", attacker: attacker.id, target: target.id, team: attacker.team,
        shield: shield - target.shield, hp: hp - target.hp, lethal: target.hp === 0,
      });
    }
    if (target.hp === 0) {
      const { assists, streak } = this.stats.recordDefeat(attacker, target);
      this.events.record({ kind: "defeat", attacker: attacker.id, target: target.id, team: attacker.team, assists, streak, stoppedStreak });
      const elapsed = 1 - this.remaining / (this.duration / HZ);
      target.downUntil = this.tick + Math.round((2 + 8 * Math.min(1, elapsed / 0.8)) * HZ);
      target.target = undefined;
      target.actor.enabled = false;
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
