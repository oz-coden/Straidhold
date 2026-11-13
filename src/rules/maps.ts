import { Grid, type Point } from "@simpludify/core";
import { border, distance, laneDistance, TEAMS, TILE, tileContains, trainingArena, wallGeometry, type Arena, type Lane, type TileRect } from "./arena.ts";

type Coordinate = readonly [x: number, y: number];
type Link = readonly [from: string, to: string];
interface MapLayout {
  id: string;
  name: string;
  description: string;
  size: Coordinate;
  hq: Coordinate;
  home: Readonly<Record<string, { mirror: string; at: Coordinate }>>;
  center: Readonly<Record<string, Coordinate>>;
  links: readonly Link[];
  crossLinks?: readonly Link[];
  objectives: readonly string[];
  cover: readonly TileRect[];
  bushes: readonly TileRect[];
  flanks: readonly Coordinate[];
}

function defineMap(layout: MapLayout): Arena {
  const [cols, rows] = layout.size;
  const point = ([x, y]: Coordinate, mirror = false): Point => ({ x: (mirror ? cols - x : x) * TILE, y: y * TILE });
  const hq = { blue: point(layout.hq), red: point(layout.hq, true) };
  const homeId = (id: string, mirror: boolean) => mirror ? layout.home[id].mirror : id;
  const flankSites = (mirror: boolean) => Object.entries(layout.home)
    .map(([id, { at }]) => ({ id: homeId(id, mirror), ...point(at, mirror) }));
  const sites = [...flankSites(false), ...Object.entries(layout.center).map(([id, coordinate]) => ({ id, ...point(coordinate) })), ...flankSites(true)];
  const nodes = new Map<string, Point>(Object.entries(hq));
  for (const site of sites) nodes.set(site.id, site);
  const nodeId = (id: string, mirror: boolean) => id === "hq" ? mirror ? "red" : "blue"
    : id in layout.home ? homeId(id, mirror) : id;
  const links = [false, true].flatMap((mirror) => layout.links
    .map(([a, b]): Link => [nodeId(a, mirror), nodeId(b, mirror)]));
  links.push(...layout.crossLinks ?? []);
  const lanes: Lane[] = links.map(([from, to]) => {
    const a = nodes.get(from)!;
    const b = nodes.get(to)!;
    return { from, to, a, b, length: distance(a, b) };
  });
  const laneWidth = TILE * 4;
  const symmetric = (rects: readonly TileRect[]) => rects.flatMap((r) => [r, { ...r, x: cols - r.x - r.w }]);
  const wallRects = [...border(cols, rows), ...symmetric(layout.cover)];
  const bushes = symmetric(layout.bushes);
  const laneCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const bushCells = new Int16Array(cols * rows);
  const terrain = Grid.generate(cols, rows, (x, y) => {
    if (wallRects.some((r) => tileContains(r, x, y))) return 3;
    const cell = y * cols + x;
    lanes.forEach((lane, i) => {
      if (laneDistance(lane, (x + 0.5) * TILE, (y + 0.5) * TILE) <= laneWidth / 2) laneCells[cell].push(i);
    });
    const bush = bushes.findIndex((r) => tileContains(r, x, y));
    if (bush >= 0) {
      bushCells[cell] = bush + 1;
      return 4;
    }
    return laneCells[cell].length ? 2 : 5 + (x + y) % 2;
  });

  // All regular orders start at the team's HQ and follow a shortest graph
  // route to the assigned objective. The lanes remain traversable when cut.
  function plans(team: "blue" | "red") {
    const paths = new Map<string, readonly string[]>([[team, []]]);
    const queue: string[] = [team];
    for (const node of queue) for (const { from, to } of lanes) {
      const next = from === node ? to : to === node ? from : undefined;
      if (!next || paths.has(next)) continue;
      paths.set(next, [...paths.get(node)!, next]);
      queue.push(next);
    }
    return layout.objectives.map((id) => paths.get(id)!);
  }

  const spawnAt = (team: "blue" | "red") => Array.from({ length: 5 }, (_, slot) => ({
    x: hq[team].x, y: hq[team].y + (slot - 2) * 36,
  }));
  return {
    id: layout.id, name: layout.name, description: layout.description,
    cols, rows, width: cols * TILE, height: rows * TILE, hq,
    spawns: { blue: spawnAt("blue"), red: spawnAt("red") },
    sites, lanes, laneWidth, laneCells, bushes, bushCells, terrain,
    plans: { blue: plans("blue"), red: plans("red") },
    flanks: {
      blue: layout.flanks.map((p) => point(p)),
      red: layout.flanks.map((p) => point(p, true)),
    },
    ...wallGeometry(wallRects),
  };
}

const rect = (x: number, y: number, w: number, h: number): TileRect => ({ x, y, w, h });
const branchLinks = [["hq", "D"], ["hq", "E"], ["D", "A"], ["D", "B"], ["E", "B"], ["E", "C"]] as const;
const forkLinks = [["hq", "D"], ["D", "A"], ["D", "C"]] as const;

export const tacticalMaps = [
  defineMap({
    id: "twin-forks", name: "両側分岐", description: "上下の前進拠点から中央へ。中央を横断する近道はジャングル。",
    size: [106, 42], hq: [6, 21], home: { D: { mirror: "F", at: [27, 11] }, E: { mirror: "G", at: [27, 31] } },
    center: { A: [53, 10], B: [53, 21], C: [53, 32] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[22, 21], [39, 21]],
    cover: [rect(13, 20, 4, 3), rect(29, 18, 4, 3), rect(37, 22, 3, 2), rect(41, 4, 4, 2), rect(45, 35, 4, 2)],
    bushes: [rect(20, 20, 4, 3), rect(37, 18, 3, 3), rect(43, 20, 3, 2), rect(34, 34, 4, 2)],
  }),
  defineMap({
    id: "three-crossings", name: "中央三拠点", description: "上下の広い外周と中央の横断路から、離れた三拠点を攻める。",
    size: [108, 46], hq: [6, 23], home: { D: { mirror: "F", at: [27, 15] }, E: { mirror: "G", at: [27, 31] } },
    center: { A: [54, 8], B: [54, 23], C: [54, 38] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[18, 9], [36, 6]],
    cover: [rect(14, 22, 4, 3), rect(24, 9, 4, 2), rect(30, 22, 4, 3), rect(39, 13, 4, 3), rect(42, 29, 4, 3), rect(29, 37, 3, 3)],
    bushes: [rect(18, 21, 4, 2), rect(35, 5, 4, 3), rect(39, 21, 3, 3), rect(46, 31, 3, 3)],
  }),
  defineMap({
    id: "central-line", name: "中央防衛線", description: "単一の前進拠点が三つの中央拠点を支える。前進拠点の確保が重要。",
    size: [104, 42], hq: [6, 21], home: { D: { mirror: "F", at: [28, 21] } },
    center: { A: [52, 8], B: [52, 21], C: [52, 34] },
    links: [...forkLinks, ["D", "B"]], objectives: ["A", "B", "C"], flanks: [[23, 32], [38, 37]],
    cover: [rect(13, 13, 4, 3), rect(16, 26, 4, 3), rect(29, 7, 4, 3), rect(40, 16, 3, 2), rect(40, 24, 3, 2), rect(44, 14, 4, 3), rect(43, 35, 3, 2)],
    bushes: [rect(20, 30, 4, 3), rect(33, 35, 4, 3), rect(45, 17, 3, 2), rect(48, 27, 3, 2)],
  }),
  defineMap({
    id: "split-merge", name: "分岐と合流", description: "前進拠点の先で上下に分岐。拠点のない中央や外周から迂回できる。",
    size: [102, 40], hq: [6, 20], home: { D: { mirror: "F", at: [28, 20] } },
    center: { A: [51, 11], C: [51, 29] }, links: forkLinks,
    objectives: ["A", "C"], flanks: [[28, 26], [42, 20]],
    cover: [rect(14, 12, 4, 3), rect(16, 26, 4, 3), rect(31, 10, 4, 3), rect(36, 19, 4, 2), rect(45, 21, 3, 3), rect(44, 34, 4, 3)],
    bushes: [rect(24, 24, 4, 3), rect(31, 28, 4, 3), rect(41, 18, 4, 3), rect(46, 15, 3, 2)],
  }),
  defineMap({
    id: "cross-supply", name: "交差補給路", description: "交差点Bで上下の補給路を結ぶ。Bを奪えば斜めの連絡を遮断できる。",
    size: [108, 46], hq: [6, 23], home: { D: { mirror: "F", at: [28, 12] }, E: { mirror: "G", at: [28, 34] } },
    center: { A: [54, 11], B: [54, 23], C: [54, 35] },
    links: branchLinks, crossLinks: [["A", "B"], ["B", "C"]],
    objectives: ["A", "B", "C"], flanks: [[23, 23], [41, 23]],
    cover: [rect(13, 21, 4, 3), rect(25, 18, 4, 3), rect(26, 26, 4, 3), rect(36, 22, 4, 3), rect(42, 7, 4, 2), rect(44, 39, 4, 3)],
    bushes: [rect(20, 22, 4, 3), rect(31, 23, 4, 3), rect(41, 21, 4, 3), rect(48, 27, 3, 2)],
  }),
] as const;

export const arenas = [...tacticalMaps, trainingArena];
