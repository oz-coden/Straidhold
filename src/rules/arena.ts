import { CollisionResponse, Grid, SpriteSheet, Tilemap, type CollisionWorld, type Point, type RaycastOptions, type Scene } from "@simpludify/core";

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

export interface TileRect { x: number; y: number; w: number; h: number }
export interface SiteDefinition extends Point { readonly id: string }
export interface Lane {
  readonly from: string;
  readonly to: string;
  readonly a: Point;
  readonly b: Point;
  readonly length: number;
}
export interface Arena {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly hq: Readonly<Record<Team, Point>>;
  readonly spawns: Readonly<Record<Team, readonly Point[]>>;
  readonly sites: readonly SiteDefinition[];
  readonly lanes: readonly Lane[];
  readonly laneWidth: number;
  readonly laneCells: readonly (readonly number[])[];
  readonly bushes: readonly TileRect[];
  readonly bushCells: Int16Array;
  readonly plans?: Readonly<Record<Team, readonly (readonly string[])[]>>;
  readonly flanks?: Readonly<Record<Team, readonly Point[]>>;
  readonly terrain: Grid<number>;
  readonly wallBounds: readonly { left: number; top: number; right: number; bottom: number }[];
  readonly wallCorners: readonly Point[];
}

export const cover = [
  { x: 6, y: 4, w: 4, h: 2 },
  { x: 11, y: 3, w: 2, h: 3 },
  { x: 11, y: 8, w: 2, h: 1 },
];

export function border(cols: number, rows: number): TileRect[] {
  return [
    { x: 0, y: 0, w: cols, h: 1 }, { x: 0, y: rows - 1, w: cols, h: 1 },
    { x: 0, y: 1, w: 1, h: rows - 2 }, { x: cols - 1, y: 1, w: 1, h: rows - 2 },
  ];
}

export const walls = [
  ...border(COLS, ROWS),
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

export function placeArena(scene: Scene, atlas: string, arena = trainingArena) {
  return new Tilemap({
    sheet: SpriteSheet.grid(atlas, { frameWidth: TILE, frameHeight: TILE }),
    tiles: arena.terrain,
    tileWidth: TILE,
    tileHeight: TILE,
    zIndex: -10,
    collision: { tiles: [{ tile: 3, response: CollisionResponse.Solid }] },
  }).place(scene);
}

export function spawn(team: Team, slot: number, arena = trainingArena): Point {
  return arena.spawns[team][slot];
}

export const tileContains = (rect: TileRect, x: number, y: number) =>
  x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;

export function cellOf(arena: Arena, p: Point): number {
  const x = Math.floor(p.x / TILE);
  const y = Math.floor(p.y / TILE);
  return arena.terrain.inBounds(x, y) ? y * arena.cols + x : -1;
}

export function laneFraction(lane: Lane, x: number, y: number): number {
  return Math.max(0, Math.min(1, ((x - lane.a.x) * (lane.b.x - lane.a.x)
    + (y - lane.a.y) * (lane.b.y - lane.a.y)) / (lane.length * lane.length)));
}

export function laneDistance(lane: Lane, x: number, y: number): number {
  const t = laneFraction(lane, x, y);
  return Math.hypot(x - (lane.a.x + t * (lane.b.x - lane.a.x)), y - (lane.a.y + t * (lane.b.y - lane.a.y)));
}

export function bushAt(arena: Arena, point: Point): number {
  return arena.bushCells[cellOf(arena, point)] ?? 0;
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const toward = (from: Point, to: Point): Point => ({ x: to.x - from.x, y: to.y - from.y });

export function wallGeometry(rectangles: readonly TileRect[]) {
  const wallBounds = rectangles.map(({ x, y, w, h }) => ({
    left: x * TILE, top: y * TILE, right: (x + w) * TILE, bottom: (y + h) * TILE,
  }));
  const wallCorners = wallBounds.flatMap(({ left, top, right, bottom }) => [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
  ]);
  return { wallBounds, wallCorners };
}

export const trainingArena: Arena = {
  id: "training", name: "試作演習場", description: "旧試作版の小さな3拠点戦場。",
  cols: COLS, rows: ROWS, width: WIDTH, height: HEIGHT, hq: HQ, sites: SITES,
  spawns: {
    blue: Array.from({ length: 5 }, (_, slot) => ({ x: HQ.blue.x + (slot - 2) * 57, y: HQ.blue.y })),
    red: Array.from({ length: 5 }, (_, slot) => ({ x: HQ.red.x + (slot - 2) * 57, y: HQ.red.y })),
  },
  lanes: [], laneWidth: 0, laneCells: [], bushes: [], bushCells: new Int16Array(0),
  terrain, ...wallGeometry(walls),
};
export const wallCorners = trainingArena.wallCorners;

const terrainRaycast = { targets: "tiles", layers: 1 } satisfies RaycastOptions;

export function castTerrain(collisions: CollisionWorld, from: Point, to: Point) {
  return collisions.raycast({ from, to }, terrainRaycast);
}

// Navigation checks a segment against expanded rectangles to leave room for
// the fighter's collider. An ordinary terrain ray has no clearance.
export function hasClearance(from: Point, to: Point, padding: number, arena = trainingArena): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const { left, top, right, bottom } of arena.wallBounds) {
    let enter = 0;
    let exit = 1;
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
    return false;
  }
  return true;
}

const center = (arena: Arena, cell: number): Point => ({
  x: (cell % arena.cols + 0.5) * TILE,
  y: (Math.floor(cell / arena.cols) + 0.5) * TILE,
});
const neighbors = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

export function route(from: Point, goal: Point, arena = trainingArena): Point[] {
  if (hasClearance(from, goal, RADIUS, arena)) return [goal];
  const { cols, rows, terrain } = arena;
  const start = cellOf(arena, from);
  const end = cellOf(arena, goal);
  if (start < 0 || end < 0 || terrain.get(end % cols, Math.floor(end / cols)) === 3) return [];
  const previous = new Int32Array(cols * rows).fill(-1);
  const cost = new Uint16Array(cols * rows);
  const heuristic = (x: number, y: number) => arena === trainingArena ? 0
    : Math.abs(x - end % cols) + Math.abs(y - Math.floor(end / cols));
  // Manhattan A* has nondecreasing integer priorities. FIFO buckets preserve
  // a stable order for equal costs and avoid sorting the frontier on each step.
  const buckets: number[][] = [];
  let priority = heuristic(start % cols, Math.floor(start / cols));
  let highest = priority;
  buckets[priority] = [start];
  previous[start] = start;
  search: for (; priority <= highest; priority++) {
    const queue = buckets[priority];
    if (!queue) continue;
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      const x = cell % cols;
      const y = Math.floor(cell / cols);
      if (cost[cell] + heuristic(x, y) !== priority) continue;
      if (cell === end) break search;
      const nextCost = cost[cell] + 1;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (!terrain.inBounds(nx, ny) || terrain.get(nx, ny) === 3) continue;
        const next = ny * cols + nx;
        if (previous[next] !== -1 && cost[next] <= nextCost) continue;
        previous[next] = cell;
        cost[next] = nextCost;
        const rank = nextCost + heuristic(nx, ny);
        (buckets[rank] ??= []).push(next);
        highest = Math.max(highest, rank);
      }
    }
  }
  if (previous[end] === -1) return [];
  const path = [goal];
  for (let cell = end; cell !== start; cell = previous[cell]) path.push(center(arena, cell));
  path.push(center(arena, start));
  return path.reverse();
}
