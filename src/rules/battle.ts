import {
  Actor, Collider, CollisionBody, CollisionResponse, CollisionShape, CollisionWorld,
  Component, defineComponent, Motion, Transform,
  type ComponentType, type Point, type Scene,
} from "@simpludify/core";
import { clearLine, distance, HQ, placeArena, RADIUS, SITES, spawn, TEAMS, toward, type Team } from "./arena.ts";
import { IDLE, validate, ZERO, type Command } from "./command.ts";
import { seesPoint } from "./vision.ts";

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

export function canSee(observer: Fighter, target: Fighter): boolean {
  return target.hp > 0 && seesPoint(observer, target.position);
}

export function selectTarget(fighter: Fighter, fighters: readonly Fighter[], aim: Point | null): Fighter | undefined {
  let best: Fighter | undefined;
  let bestScore = -Infinity;
  for (const target of fighters) {
    if (target.team === fighter.team || target.hp <= 0) continue;
    const offset = toward(fighter.position, target.position);
    const range = Math.hypot(offset.x, offset.y);
    if (range > Math.min(fighter.profile.range, fighter.profile.vision)) continue;
    const alignment = aim && range > 0 ? (aim.x * offset.x + aim.y * offset.y) / range : 1;
    if (aim && alignment < (target === fighter.target ? 0.48 : 0.57)) continue;
    if (!clearLine(fighter.position, target.position)) continue;
    const score = 1.45 * alignment - range / fighter.profile.range + (target === fighter.target ? 0.23 : 0);
    if (score > bestScore || (score === bestScore && best && target.id < best.id)) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

export class Battle {
  readonly fighters: readonly Fighter[];
  readonly sites: Site[] = SITES.map((site) => ({ ...site, owner: null, device: null }));
  readonly scores = { blue: 0, red: 0 };
  readonly kills = { blue: 0, red: 0 };
  readonly shots: Shot[] = [];
  readonly duration: number;
  tick = 0;
  result: Team | "draw" | null = null;

  private readonly source: CommandSource;

  constructor(scene: Scene, atlas: string, seconds: number, source: CommandSource) {
    this.source = source;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > ROUND_SECONDS) throw new RangeError("Invalid round duration");
    this.duration = seconds * HZ;
    new CollisionWorld(scene);
    placeArena(scene, atlas);
    scene.add(new Actor({ id: "commands" })).add(new ReadCommands(() => this.read()));
    this.fighters = TEAMS.flatMap((team) => Array.from({ length: 5 }, (_, slot) => {
      const id = `${team}-${slot}`;
      const actor = scene.add(new Actor({ id }));
      const position = actor.add(new Transform(spawn(team, slot)));
      const motion = actor.add(new Motion({ speed: recruit.speed }));
      actor.add(new CollisionBody());
      // Units share space with each other. Only the terrain layer blocks movement.
      actor.add(new Collider({ shape: CollisionShape.Circle, radius: RADIUS, response: CollisionResponse.Solid, layer: 2, mask: 1 }));
      return {
        id, team, slot, actor, position, motion, profile: recruit,
        hp: recruit.hp, shield: recruit.shield, downUntil: 0, hitAt: -Infinity, attackAt: 0,
        command: IDLE, facing: { x: 0, y: team === "blue" ? -1 : 1 },
      };
    }));
    scene.onUpdate(() => this.resolve());
  }

  get remaining() { return (this.duration - this.tick) / HZ; }

  private read() {
    if (this.result) return;
    this.tick++;
    // Read every source against the same state before applying any commands.
    for (const fighter of this.fighters) {
      if (fighter.hp === 0 && this.tick >= fighter.downUntil) {
        Object.assign(fighter.position, spawn(fighter.team, fighter.slot));
        fighter.hp = fighter.profile.hp;
        fighter.shield = fighter.profile.shield;
        fighter.hitAt = -Infinity;
        fighter.attackAt = this.tick;
        fighter.target = undefined;
        fighter.actor.enabled = true;
      }
    }
    const commands = this.fighters.map((fighter) => {
      const command = this.source(fighter, this);
      return fighter.hp > 0 ? validate(command) : IDLE;
    });
    this.fighters.forEach((fighter, i) => {
      const command = commands[i];
      fighter.command = command;
      Object.assign(fighter.motion.direction, command.move);
      if (command.aim) fighter.facing = command.aim;
      else if (command.move !== ZERO) fighter.facing = command.move;
    });
  }

  private resolve() {
    if (this.result) return;
    const cutoff = this.tick - Math.round(HZ * 0.22);
    while (this.shots.length && this.shots[0].tick < cutoff) this.shots.shift();
    const hits: Shot[] = [];
    for (const fighter of this.fighters) {
      if (fighter.hp <= 0) continue;
      fighter.target = selectTarget(fighter, this.fighters, fighter.command.aim);
      if (fighter.target && fighter.command.attack && this.tick >= fighter.attackAt) {
        fighter.attackAt = this.tick + fighter.profile.attackTicks;
        hits.push({
          tick: this.tick, from: fighter, to: fighter.target,
          origin: { x: fighter.position.x, y: fighter.position.y },
          impact: { x: fighter.target.position.x, y: fighter.target.position.y },
        });
      }
    }
    for (const hit of hits) this.damage(hit.to, hit.from);
    this.shots.push(...hits);

    for (const fighter of this.fighters) {
      if (fighter.hp <= 0) continue;
      const quiet = this.tick - fighter.hitAt;
      if (quiet > fighter.profile.shieldDelay) {
        fighter.shield = Math.min(fighter.profile.shield, fighter.shield + fighter.profile.shieldPerSecond / HZ);
      }
      if (quiet > fighter.profile.shieldDelay && distance(fighter.position, HQ[fighter.team]) <= 84) {
        fighter.hp = Math.min(fighter.profile.hp, fighter.hp + fighter.profile.hqHealPerSecond / HZ);
      }
    }
    for (const site of this.sites) this.updateSite(site);
    if (this.tick % HZ === 0) {
      for (const { owner } of this.sites) if (owner) this.scores[owner]++;
    }
    if (this.tick === this.duration) {
      const owned = (team: Team) => this.sites.filter((site) => site.owner === team).length;
      const lead = this.scores.blue - this.scores.red || owned("blue") - owned("red") || this.kills.blue - this.kills.red;
      this.result = lead === 0 ? "draw" : lead > 0 ? "blue" : "red";
      for (const fighter of this.fighters) Object.assign(fighter.motion.direction, ZERO);
    }
  }

  private damage(target: Fighter, attacker: Fighter) {
    if (target.hp <= 0) return;
    const overflow = Math.max(0, attacker.profile.damage - target.shield);
    target.shield = Math.max(0, target.shield - attacker.profile.damage);
    target.hp = Math.max(0, target.hp - overflow);
    target.hitAt = this.tick;
    if (target.hp === 0) {
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
      }
      return;
    }
    const device = site.device;
    const guarding = inside.some((fighter) => fighter.team === device.team);
    device.contested = inside.some((fighter) => fighter.team !== device.team);
    device.abandoned = guarding ? 0 : device.abandoned + 1;
    if (device.abandoned >= ABANDON_TICKS) {
      site.device = null;
    } else if (guarding && !device.contested && ++device.progress >= ACTIVATE_TICKS) {
      site.owner = device.team;
      this.scores[device.team] += 4;
      site.device = null;
    }
  }
}
