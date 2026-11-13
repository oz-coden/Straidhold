import type { Point } from "@simpludify/core";
import { cellOf, laneDistance, laneFraction, TEAMS, TILE, type Arena, type Team } from "./arena.ts";

const MAX_BOOST = 0.28;
const RAMP_SECONDS = 2.4;
const HIT_DELAY_SECONDS = 1.5;
const MAX_SLOW = 0.24;
const FULL_DEPTH = 46 * TILE;
const RECOVERY_SECONDS = 1.6;

export interface SupplyMovement {
  boost: number;
  slow: number;
}

export class Supply {
  readonly connected = { blue: new Set<string>(), red: new Set<string>() };
  readonly lanes: (Team | null)[];
  private readonly depth = { blue: new Map<string, number>(), red: new Map<string, number>() };
  revision = 0;

  readonly arena: Arena;

  constructor(arena: Arena) {
    this.arena = arena;
    this.lanes = arena.lanes.map(() => null);
    this.rebuild([]);
  }

  rebuild(sites: readonly { id: string; owner: Team | null }[]): void {
    const owners = new Map<string, Team | null>(sites.map(({ id, owner }) => [id, owner]));
    owners.set("blue", "blue");
    owners.set("red", "red");
    const { lanes } = this.arena;
    this.lanes.fill(null);
    for (const team of TEAMS) {
      const connected = this.connected[team];
      connected.clear();
      connected.add(team);
      const queue: string[] = [team];
      for (const node of queue) for (const { from, to } of lanes) {
        const other = from === node ? to : to === node ? from : undefined;
        if (other && owners.get(other) === team && !connected.has(other)) {
          connected.add(other);
          queue.push(other);
        }
      }
      const frontier = new Set<string>();
      lanes.forEach(({ from, to }, index) => {
        const a = connected.has(from);
        const b = connected.has(to);
        if (a && b) this.lanes[index] = team;
        else if (a || b) frontier.add(a ? from : to);
      });
      if (!frontier.size) frontier.add(team);
      const depth = this.depth[team];
      depth.clear();
      for (const node of frontier) depth.set(node, 0);
      // The graph is small. Repeated relaxation gives shortest distances to
      // any connected frontier, including maps with cycles and alternate links.
      for (let pass = 1; pass < connected.size; pass++) lanes.forEach(({ from, to, length }, i) => {
        if (this.lanes[i] !== team) return;
        const a = depth.get(from) ?? Infinity;
        const b = depth.get(to) ?? Infinity;
        if (a + length < b) depth.set(to, a + length);
        if (b + length < a) depth.set(from, b + length);
      });
    }
    this.revision++;
  }

  laneAt(point: Point): number {
    const candidates = this.arena.laneCells[cellOf(this.arena, point)];
    if (!candidates?.length) return -1;
    let closest = -1;
    let minimum = Infinity;
    for (const i of candidates) {
      const proximity = laneDistance(this.arena.lanes[i], point.x, point.y);
      if (proximity < minimum || (proximity === minimum && this.lanes[i] && !this.lanes[closest])) {
        closest = i;
        minimum = proximity;
      }
    }
    return closest;
  }

  invasionDepth(laneIndex: number, point: Point): number {
    const team = this.lanes[laneIndex];
    if (!team) return 0;
    const lane = this.arena.lanes[laneIndex];
    const traveled = laneFraction(lane, point.x, point.y) * lane.length;
    const depth = this.depth[team];
    return Math.min(depth.get(lane.from)! + traveled, depth.get(lane.to)! + lane.length - traveled);
  }

  speed(state: SupplyMovement, team: Team, point: Point, quiet: number, moving: boolean, dt: number): number {
    if (!this.lanes.length) return 1;
    const index = this.laneAt(point);
    const owner = this.lanes[index];
    state.boost = owner === team && quiet >= HIT_DELAY_SECONDS
      ? Math.min(MAX_BOOST, state.boost + (moving ? MAX_BOOST * dt / RAMP_SECONDS : 0)) : 0;
    state.slow = owner && owner !== team
      ? MAX_SLOW * Math.min(1, this.invasionDepth(index, point) / FULL_DEPTH)
      : Math.max(0, state.slow - MAX_SLOW * dt / RECOVERY_SECONDS);
    return index < 0 ? 1 : 1 + state.boost - state.slow;
  }
}
