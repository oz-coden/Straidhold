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
  home: Readonly<Record<string, Coordinate>>;
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
  const homeId = (id: string, mirror: boolean) => mirror ? ({ D: "F", E: "G" } as Record<string, string>)[id] : id;
  const flankSites = (mirror: boolean) => Object.entries(layout.home)
    .map(([id, coordinate]) => ({ id: homeId(id, mirror), ...point(coordinate, mirror) }));
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
    return laneCells[cell].length ? 2 : (x + y) % 2;
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
    size: [210, 82], hq: [8, 41], home: { D: [47, 24], E: [47, 58] },
    center: { A: [105, 24], B: [105, 41], C: [105, 58] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[47, 41], [79, 41]],
    cover: [rect(26, 34, 8, 4), rect(51, 34, 7, 4), rect(68, 43, 6, 4), rect(88, 49, 6, 4), rect(73, 13, 8, 3), rect(80, 66, 5, 4)],
    bushes: [rect(37, 41, 5, 3), rect(76, 37, 5, 4), rect(83, 54, 4, 2), rect(94, 29, 5, 3)],
  }),
  defineMap({
    id: "three-crossings", name: "中央三拠点", description: "上下の広い外周と中央の横断路から、離れた三拠点を攻める。",
    size: [216, 88], hq: [8, 44], home: { D: [48, 30], E: [48, 58] },
    center: { A: [108, 15], B: [108, 44], C: [108, 73] }, links: branchLinks,
    objectives: ["A", "B", "C"], flanks: [[35, 18], [70, 12]],
    cover: [rect(26, 41, 8, 4), rect(43, 19, 7, 4), rect(58, 42, 6, 4), rect(68, 29, 8, 4), rect(68, 55, 8, 4), rect(88, 27, 6, 5), rect(88, 56, 6, 5)],
    bushes: [rect(41, 43, 5, 3), rect(66, 11, 5, 4), rect(83, 34, 5, 3), rect(94, 67, 5, 3)],
  }),
  defineMap({
    id: "central-line", name: "中央防衛線", description: "単一の前進拠点が三つの中央拠点を支える。前進拠点の確保が重要。",
    size: [208, 84], hq: [8, 42], home: { D: [52, 42] },
    center: { A: [104, 18], B: [104, 42], C: [104, 66] },
    links: [...forkLinks, ["D", "B"]], objectives: ["A", "B", "C"], flanks: [[45, 63], [79, 72]],
    cover: [rect(28, 26, 9, 4), rect(30, 53, 8, 4), rect(59, 16, 7, 4), rect(67, 36, 9, 3), rect(71, 47, 8, 3), rect(89, 29, 6, 5), rect(91, 51, 6, 4)],
    bushes: [rect(40, 60, 6, 4), rect(63, 64, 5, 4), rect(86, 36, 5, 3), rect(87, 63, 5, 3)],
  }),
  defineMap({
    id: "split-merge", name: "分岐と合流", description: "前進拠点の先で上下に分岐。拠点のない中央や外周から迂回できる。",
    size: [202, 78], hq: [8, 39], home: { D: [51, 39] },
    center: { A: [101, 22], C: [101, 56] }, links: forkLinks,
    objectives: ["A", "C"], flanks: [[53, 47], [77, 40]],
    cover: [rect(28, 24, 8, 4), rect(30, 52, 8, 4), rect(60, 22, 6, 4), rect(65, 36, 7, 4), rect(72, 50, 6, 4), rect(91, 34, 7, 3), rect(89, 64, 8, 4)],
    bushes: [rect(43, 48, 6, 4), rect(56, 46, 5, 3), rect(74, 37, 6, 4), rect(87, 42, 5, 4)],
  }),
  defineMap({
    id: "cross-supply", name: "交差補給路", description: "交差点Bで上下の補給路を結ぶ。Bを奪えば斜めの連絡を遮断できる。",
    size: [214, 90], hq: [8, 45], home: { D: [51, 24], E: [51, 66] },
    center: { A: [107, 24], B: [107, 45], C: [107, 66] },
    links: branchLinks, crossLinks: [["A", "B"], ["B", "C"]],
    objectives: ["A", "B", "C"], flanks: [[45, 44], [77, 45]],
    cover: [rect(26, 40, 8, 4), rect(42, 34, 7, 4), rect(50, 51, 7, 4), rect(68, 44, 7, 4), rect(84, 45, 6, 3), rect(77, 12, 8, 4), rect(82, 74, 8, 4)],
    bushes: [rect(38, 42, 6, 4), rect(57, 45, 5, 4), rect(77, 39, 6, 4), rect(95, 54, 5, 3)],
  }),
] as const;

export const arenas = [...tacticalMaps, trainingArena];
