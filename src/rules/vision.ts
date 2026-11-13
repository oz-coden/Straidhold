import type { CollisionWorld, Point } from "@simpludify/core";
import { bushAt, castTerrain, distance, trainingArena, type Arena, type Team } from "./arena.ts";

export interface VisionUnit {
  readonly team: Team;
  readonly hp: number;
  readonly position: Point;
  readonly revealedUntil?: number;
  readonly profile: { readonly vision: number };
}

export function seesPoint(collisions: CollisionWorld, observer: VisionUnit, point: Point): boolean {
  return observer.hp > 0 && distance(observer.position, point) <= observer.profile.vision
    && !castTerrain(collisions, observer.position, point);
}

/** Terrain can be visible while an occupant remains concealed. */
export function seesUnit(collisions: CollisionWorld, arena: Arena, tick: number, observer: VisionUnit, target: VisionUnit): boolean {
  if (target.hp <= 0 || observer.hp <= 0) return false;
  const bush = bushAt(arena, target.position);
  if (bush && (target.revealedUntil ?? 0) <= tick && bushAt(arena, observer.position) !== bush
    && distance(observer.position, target.position) > 48) return false;
  return seesPoint(collisions, observer, target.position);
}

const TAU = 2 * Math.PI;
const circleAngles = Array.from({ length: 96 }, (_, i) => i * TAU / 96 - Math.PI);
const cornerOffset = 0.0001;

/** Approximate the circular arc while explicitly tracing both sides of each wall corner. */
export function sightOutline(collisions: CollisionWorld, origin: Point, radius: number, arena = trainingArena): readonly Point[] {
  const angles = [...circleAngles];
  for (const corner of arena.wallCorners) {
    const dx = corner.x - origin.x;
    const dy = corner.y - origin.y;
    if (dx * dx + dy * dy > radius * radius) continue;
    const angle = Math.atan2(dy, dx);
    angles.push(angle - cornerOffset, angle, angle + cornerOffset);
  }
  angles.sort((a, b) => a - b);
  return angles.map((angle) => {
    const to = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
    return castTerrain(collisions, origin, to)?.point ?? to;
  });
}

interface Source<T> {
  unit: T;
  x: number;
  y: number;
  radius: number;
  outline: readonly Point[] | null;
}

/** A team view of the resolved simulation step. Reuses storage across steps. */
export class TeamVision<T extends VisionUnit> {
  private readonly sources: Source<T>[];
  private readonly visible = new Set<T>();
  private revision = 0;

  private readonly arena: Arena;
  private readonly collisions: CollisionWorld;
  private readonly team: Team;
  private readonly units: readonly T[];

  constructor(collisions: CollisionWorld, team: Team, units: readonly T[], arena = trainingArena) {
    this.arena = arena;
    this.collisions = collisions;
    this.team = team;
    this.units = units;
    this.sources = units.filter((unit) => unit.team === team)
      .map((unit) => ({ unit, x: 0, y: 0, radius: 0, outline: null }));
  }

  update(tick = 0): void {
    for (const source of this.sources) {
      const { unit } = source;
      const { x, y } = unit.position;
      const radius = unit.hp > 0 ? unit.profile.vision : 0;
      if (source.x === x && source.y === y && source.radius === radius) continue;
      source.x = x;
      source.y = y;
      source.radius = radius;
      source.outline = null;
      this.revision++;
    }
    this.visible.clear();
    for (const unit of this.units) {
      if (unit.hp > 0 && (unit.team === this.team || this.sources.some(({ unit: observer }) => seesUnit(this.collisions, this.arena, tick, observer, unit)))) this.visible.add(unit);
    }
  }

  sees(point: Point): boolean {
    return this.sources.some(({ unit }) => seesPoint(this.collisions, unit, point));
  }

  shows(unit: T): boolean {
    return this.visible.has(unit);
  }

  get outlineRevision() { return this.revision; }

  /** Geometry is generated lazily, once for both visual consumers, without affecting detection. */
  visitOutlines(visit: (outline: readonly Point[]) => void): void {
    for (const source of this.sources) {
      if (source.radius === 0) continue;
      source.outline ??= sightOutline(this.collisions, source, source.radius, this.arena);
      visit(source.outline);
    }
  }
}
