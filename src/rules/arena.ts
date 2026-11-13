import { CollisionResponse, Grid, SpriteSheet, Tilemap, type Point, type Scene } from "@simpludify/core";

export const TILE = 32;
export const COLS = 30;
export const ROWS = 17;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;
export const RADIUS = 12;
export type Team = "blue" | "red";
export const TEAMS: readonly Team[] = ["blue", "red"];
export const HQ = { blue: { x: 480, y: 464 }, red: { x: 480, y: 80 } };
export const SITES = [
  { id: "A", x: 144, y: 272 },
  { id: "B", x: 480, y: 272 },
  { id: "C", x: 816, y: 272 },
] as const;

const cover = [
  { x: 6, y: 4, w: 4, h: 2 },
  { x: 11, y: 3, w: 2, h: 3 },
  { x: 11, y: 8, w: 2, h: 1 },
];

export const walls = [
  { x: 0, y: 0, w: COLS, h: 1 },
  { x: 0, y: ROWS - 1, w: COLS, h: 1 },
  { x: 0, y: 1, w: 1, h: ROWS - 2 },
  { x: COLS - 1, y: 1, w: 1, h: ROWS - 2 },
  ...cover.flatMap(({ x, y, w, h }) => {
    const ys = y === ROWS - y - h ? [y] : [y, ROWS - y - h];
    return ys.flatMap((row) => [
      { x, y: row, w, h },
      { x: COLS - x - w, y: row, w, h },
    ]);
  }),
];

export const terrain = Grid.generate(COLS, ROWS, (x, y) => {
  if (walls.some((wall) => x >= wall.x && y >= wall.y && x < wall.x + wall.w && y < wall.y + wall.h)) return 3;
  if (Math.abs(y - 8) <= 1 || [4, 14, 15, 25].includes(x)) return 2;
  return (x + y) % 2;
});

export function placeArena(scene: Scene, atlas: string) {
  return new Tilemap({
    sheet: SpriteSheet.grid(atlas, { frameWidth: TILE, frameHeight: TILE }),
    tiles: terrain,
    tileWidth: TILE,
    tileHeight: TILE,
    zIndex: -10,
    collision: { tiles: [{ tile: 3, response: CollisionResponse.Solid }] },
  }).place(scene);
}

export function spawn(team: Team, slot: number): Point {
  return { x: HQ[team].x + (slot - 2) * 57, y: HQ[team].y };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const toward = (from: Point, to: Point): Point => ({ x: to.x - from.x, y: to.y - from.y });

const wallBounds = walls.map(({ x, y, w, h }) => ({
  left: x * TILE, top: y * TILE, right: (x + w) * TILE, bottom: (y + h) * TILE,
}));

export const wallCorners: readonly Point[] = wallBounds.flatMap(({ left, top, right, bottom }) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
]);

// Return the first solid intersection along a finite segment. Padding uses
// the same geometry to test clearance for AI pathing.
export function wallHit(from: Point, dx: number, dy: number, padding = 0): number | null {
  let nearest = 1;
  let hit = false;
  for (const { left, top, right, bottom } of wallBounds) {
    let enter = 0;
    let exit = nearest;
    if (dx === 0) {
      if (from.x < left - padding || from.x > right + padding) continue;
    } else {
      const a = (left - padding - from.x) / dx;
      const b = (right + padding - from.x) / dx;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) continue;
    }
    if (dy === 0) {
      if (from.y < top - padding || from.y > bottom + padding) continue;
    } else {
      const a = (top - padding - from.y) / dy;
      const b = (bottom + padding - from.y) / dy;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) continue;
    }
    nearest = enter;
    hit = true;
    if (nearest === 0) break;
  }
  return hit ? nearest : null;
}

export function clearLine(from: Point, to: Point, padding = 0): boolean {
  return wallHit(from, to.x - from.x, to.y - from.y, padding) === null;
}

const cellOf = (p: Point) => Math.floor(p.y / TILE) * COLS + Math.floor(p.x / TILE);
const center = (cell: number): Point => ({
  x: (cell % COLS + 0.5) * TILE,
  y: (Math.floor(cell / COLS) + 0.5) * TILE,
});
const neighbors = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

export function route(from: Point, goal: Point): Point[] {
  if (clearLine(from, goal, RADIUS)) return [goal];
  const start = cellOf(from);
  const end = cellOf(goal);
  const previous = new Int16Array(COLS * ROWS).fill(-1);
  const queue = [start];
  previous[start] = start;
  for (let i = 0; i < queue.length && previous[end] === -1; i++) {
    const cell = queue[i];
    for (const [dx, dy] of neighbors) {
      const x = cell % COLS + dx;
      const y = Math.floor(cell / COLS) + dy;
      if (!terrain.inBounds(x, y) || terrain.get(x, y) === 3) continue;
      const next = y * COLS + x;
      if (previous[next] !== -1) continue;
      previous[next] = cell;
      queue.push(next);
    }
  }
  if (previous[end] === -1) return [];
  const path = [goal];
  for (let cell = end; cell !== start; cell = previous[cell]) path.push(center(cell));
  path.push(center(start));
  return path.reverse();
}
