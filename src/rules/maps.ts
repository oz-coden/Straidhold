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
    size: [80, 38], hq: [6, 19], home: { D: { mirror: "F", at: [21, 10] }, E: { mirror: "G", at: [21, 28] } },
    center: { A: [40, 9], B: [40, 19], C: [40, 29] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[16, 19], [29, 19]],
    cover: [rect(10, 18, 3, 2), rect(22, 16, 3, 3), rect(28, 20, 3, 2), rect(31, 4, 3, 2), rect(34, 32, 3, 2)],
    bushes: [rect(14, 17, 4, 3), rect(27, 16, 3, 3), rect(31, 18, 3, 2), rect(27, 31, 3, 2)],
  }),
  defineMap({
    id: "three-crossings", name: "中央三拠点", description: "上下の広い外周と中央の横断路から、離れた三拠点を攻める。",
    size: [82, 42], hq: [6, 21], home: { D: { mirror: "F", at: [21, 13] }, E: { mirror: "G", at: [21, 29] } },
    center: { A: [41, 7], B: [41, 21], C: [41, 35] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[14, 8], [27, 5]],
    cover: [rect(10, 20, 3, 2), rect(18, 7, 3, 2), rect(23, 20, 3, 3), rect(31, 13, 3, 2), rect(31, 27, 3, 3), rect(23, 34, 3, 3)],
    bushes: [rect(14, 20, 4, 2), rect(26, 4, 3, 3), rect(29, 20, 3, 3), rect(35, 28, 3, 3)],
  }),
  defineMap({
    id: "central-line", name: "中央防衛線", description: "単一の前進拠点が三つの中央拠点を支える。前進拠点の確保が重要。",
    size: [78, 38], hq: [6, 19], home: { D: { mirror: "F", at: [21, 19] } },
    center: { A: [39, 7], B: [39, 19], C: [39, 31] },
    links: [...forkLinks, ["D", "B"]], objectives: ["A", "B", "C"], flanks: [[18, 29], [29, 33]],
    cover: [rect(10, 11, 3, 3), rect(13, 24, 3, 3), rect(22, 6, 3, 3), rect(29, 15, 3, 2), rect(30, 22, 3, 2), rect(34, 12, 3, 3), rect(32, 32, 3, 2)],
    bushes: [rect(15, 28, 4, 3), rect(25, 32, 3, 3), rect(34, 15, 3, 2), rect(35, 24, 3, 2)],
  }),
  defineMap({
    id: "split-merge", name: "分岐と合流", description: "前進拠点の先で上下に分岐。拠点のない中央や外周から迂回できる。",
    size: [76, 36], hq: [6, 18], home: { D: { mirror: "F", at: [21, 18] } },
    center: { A: [38, 10], C: [38, 26] }, links: forkLinks,
    objectives: ["A", "C"], flanks: [[21, 23], [32, 18]],
    cover: [rect(10, 10, 3, 3), rect(13, 23, 3, 3), rect(23, 8, 3, 3), rect(27, 17, 3, 2), rect(34, 19, 3, 3), rect(33, 30, 3, 3)],
    bushes: [rect(17, 22, 4, 3), rect(23, 25, 3, 3), rect(31, 16, 3, 3), rect(34, 14, 3, 2)],
  }),
  defineMap({
    id: "cross-supply", name: "交差補給路", description: "交差点Bで上下の補給路を結ぶ。Bを奪えば斜めの連絡を遮断できる。",
    size: [82, 42], hq: [6, 21], home: { D: { mirror: "F", at: [22, 11] }, E: { mirror: "G", at: [22, 31] } },
    center: { A: [41, 10], B: [41, 21], C: [41, 32] },
    links: branchLinks, crossLinks: [["A", "B"], ["B", "C"]],
    objectives: ["A", "B", "C"], flanks: [[17, 21], [31, 21]],
    cover: [rect(10, 20, 3, 2), rect(19, 16, 3, 3), rect(20, 24, 3, 3), rect(27, 20, 3, 3), rect(32, 5, 3, 2), rect(33, 35, 3, 3)],
    bushes: [rect(15, 20, 4, 3), rect(23, 21, 3, 3), rect(31, 19, 3, 3), rect(36, 26, 3, 2)],
  }),
] as const;

export const arenas = [...tacticalMaps, trainingArena];
