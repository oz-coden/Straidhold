import type { Point } from "@simpludify/core";
import { distance, hasClearance, RADIUS, route, TILE, type Arena, type Team } from "../src/rules/arena.ts";
import { recruit, STEP } from "../src/rules/battle.ts";
import { Supply } from "../src/rules/supply.ts";

const round = (n: number) => Number(n.toFixed(2));

function clearancePath(arena: Arena, from: Point, to: Point) {
  const walk = [from];
  const path = route(from, to, arena);
  let first = 0;
  while (first < path.length) {
    let next = path.length - 1;
    while (next >= first && !hasClearance(walk.at(-1)!, path[next], RADIUS, arena)) next--;
    if (next < first) throw new Error(`Cannot measure the route in ${arena.id}`);
    walk.push(path[next]);
    first = next + 1;
  }
  if (walk.at(-1) !== to) throw new Error(`Unreachable destination in ${arena.id}`);
  return walk;
}

function measure(path: readonly Point[], supply?: Supply, team: Team = "blue") {
  let length = 0;
  let seconds = 0;
  const state = { boost: 0, slow: 0 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segment = distance(a, b);
    length += segment;
    if (!supply) {
      seconds += segment / recruit.speed;
      continue;
    }
    for (let traveled = 0; traveled < segment;) {
      const x = a.x + (b.x - a.x) * traveled / segment;
      const y = a.y + (b.y - a.y) * traveled / segment;
      const speed = recruit.speed * supply.speed(state, team, { x, y }, Infinity, true, STEP);
      const advance = Math.min(segment - traveled, speed * STEP);
      seconds += advance / speed;
      traveled += advance;
    }
  }
  return { distance: round(length), seconds: round(seconds) };
}

export function measureTravel(arena: Arena) {
  const first = arena.lanes.filter(({ from }) => from === "blue").sort((a, b) => a.length - b.length)[0];
  const adjacent = arena.lanes.filter(({ from, to }) => ![from, to].some((id) => id === "blue" || id === "red"));
  const walks = adjacent.map(({ a, b }) => measure(clearancePath(arena, a, b)));
  const adjacentCenters = arena.sites.filter(({ x }) => x === arena.width / 2).slice().sort((a, b) => a.y - b.y);
  // Cross between adjacent approach lanes before they converge on the objectives.
  const laneChanges = adjacentCenters.slice(1).map((site, i) => {
    const other = adjacentCenters[i];
    const approach = (id: string) => arena.lanes.find(({ from, to, a }) => a.x < arena.width / 2 && to === id && from !== "blue")!;
    const a = approach(other.id);
    const b = approach(site.id);
    const endAt = (lane: typeof a) => ({
      x: lane.b.x + (lane.a.x - lane.b.x) * 0.2,
      y: lane.b.y + (lane.a.y - lane.b.y) * 0.2,
    });
    return measure(clearancePath(arena, endAt(a), endAt(b)));
  });
  const supply = new Supply(arena);
  supply.rebuild(arena.sites.map(({ id }) => ({ id, owner: id === first.to ? "blue" : null })));
  return {
    tiles: [arena.cols, arena.rows], area: arena.cols * arena.rows,
    hqToHq: measure(clearancePath(arena, arena.hq.blue, arena.hq.red)),
    adjacentSites: {
      distance: [round(Math.min(...walks.map(({ distance }) => distance))), round(Math.max(...walks.map(({ distance }) => distance)))],
      seconds: [Math.min(...walks.map(({ seconds }) => seconds)), Math.max(...walks.map(({ seconds }) => seconds))],
    },
    laneChanges,
    firstLeg: {
      base: measure([first.a, first.b]),
      friendly: measure([first.a, first.b], supply, "blue"),
      enemy: measure([first.b, first.a], supply, "red"),
    },
    laneWidth: arena.laneWidth / TILE,
  };
}
