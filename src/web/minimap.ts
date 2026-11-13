import { screenPoint, type Game } from "@simpludify/web";
import { TEAMS, TILE, type Arena, type Team } from "../rules/arena.ts";
import { ACTIVATE_TICKS, type Battle, type Fighter } from "../rules/battle.ts";
import type { TeamVision } from "../rules/vision.ts";

const namespace = "http://www.w3.org/2000/svg";
const colors = { blue: "#75ddff", red: "#ff948a", neutral: "#b8c8d1" };
const tiles = [
  { id: 2, fill: "#365065" },
  { id: 3, fill: "#657888" },
  { id: 4, fill: "#6b976c" },
];
function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number> = {}) {
  const node = document.createElementNS(namespace, name);
  for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, String(value));
  return node;
}

function viewBox(arena: Arena) {
  return { viewBox: `0 0 ${arena.width} ${arena.height}`, "aria-hidden": "true" };
}

function terrainMap(arena: Arena) {
  const map = svg("svg", viewBox(arena));
  map.append(svg("rect", { width: arena.width, height: arena.height, fill: arena.lanes.length ? "#263c38" : "#1b3040" }));
  for (const { id, fill } of tiles) {
    const runs: string[] = [];
    for (let y = 0; y < arena.rows; y++) {
      let x = 0;
      while (x < arena.cols) {
        if (arena.terrain.get(x, y) !== id) { x++; continue; }
        const start = x;
        while (x < arena.cols && arena.terrain.get(x, y) === id) x++;
        const width = (x - start) * TILE;
        runs.push(`M${start * TILE},${y * TILE}h${width}v${TILE}h-${width}z`);
      }
    }
    if (runs.length) map.append(svg("path", { fill, d: runs.join("") }));
  }
  return map;
}

function addHqs(map: SVGSVGElement, arena: Arena, size: number) {
  for (const team of TEAMS) {
    const { x, y } = arena.hq[team];
    map.append(svg("rect", { x: x - 37 * size, y: y - 18 * size, width: 74 * size, height: 36 * size, rx: 3 * size, fill: "#101f2c", stroke: colors[team], "stroke-width": 9 * size }));
  }
}

export function mapPreview(arena: Arena) {
  const map = terrainMap(arena);
  const size = arena.width / 960;
  addHqs(map, arena, size);
  for (const site of arena.sites) {
    map.append(svg("circle", { cx: site.x, cy: site.y, r: 20 * size, fill: "#d6ebf5", stroke: "#112534", "stroke-width": 5 * size }));
  }
  return map;
}

export function createMinimap(game: Game<"briefing" | "match">, host: HTMLElement, battle: Battle, player: Fighter, vision: TeamVision<Fighter>, mask: HTMLCanvasElement) {
  const { arena } = battle;
  const size = arena.width / 960;
  const panel = document.createElement("aside");
  panel.className = "minimap";
  panel.dataset.map = arena.id;
  panel.style.aspectRatio = `${arena.width} / ${arena.height}`;
  panel.setAttribute("aria-label", "ミニマップ");
  const map = terrainMap(arena);
  const icons = svg("svg", viewBox(arena));
  const lines = arena.lanes.map(({ a, b }) => {
    const node = svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, "stroke-width": 6 * size });
    icons.append(node);
    return node;
  });
  const camera = svg("rect", { class: "minimap-camera", rx: 10, fill: "#e5f7ff", "fill-opacity": ".05", stroke: "#e5f7ff", "stroke-opacity": ".8", "stroke-width": 5 });
  icons.append(camera);
  addHqs(icons, arena, size);

  const sites = battle.sites.map((site) => {
    const group = svg("g", { class: "minimap-site", transform: `translate(${site.x} ${site.y}) scale(${size})` });
    const base = svg("rect", { x: -29, y: -29, width: 58, height: 58, rx: 9, fill: "#142431", "stroke-width": 7 });
    const ring = svg("circle", { r: 41, fill: "none", "stroke-width": 8, pathLength: 100, transform: "rotate(-90)" });
    const label = svg("text", { y: 14, "text-anchor": "middle", "font-size": 42, "font-weight": 800 });
    label.textContent = site.id;
    const contested = svg("path", { d: "M-16 39l32 24m0-24l-32 24", stroke: "#ffe1a6", "stroke-width": 8 });
    group.append(base, ring, label, contested);
    icons.append(group);
    return { site, base, ring, label, contested };
  });

  const markers = battle.fighters.map((fighter) => {
    const isPlayer = fighter === player;
    const marker = isPlayer
      ? svg("path", { d: "M0,-24L17,18 0,10 -17,18Z", fill: "#fff", stroke: "#07111a", "stroke-width": 4, "stroke-linejoin": "round" })
      : fighter.team === player.team
        ? svg("circle", { r: 13, fill: colors[fighter.team], stroke: "#0a1621", "stroke-width": 3 })
        : svg("path", { d: "M0,-17L17,0 0,17 -17,0Z", fill: colors[fighter.team], stroke: "#190f19", "stroke-width": 4 });
    marker.setAttribute("class", isPlayer ? "minimap-player" : "minimap-unit");
    marker.setAttribute("data-team", fighter.team);
    return { fighter, marker, isPlayer };
  });
  for (const { marker, isPlayer } of markers) if (!isPlayer) icons.append(marker);
  icons.append(markers.find(({ isPlayer }) => isPlayer)!.marker);
  panel.append(map, mask, icons);

  let previousView = game.view;
  let paintedTick = -1;
  let supplyRevision = -1;
  function paintCamera() {
    const view = game.view;
    if (view === previousView && camera.hasAttribute("width")) return;
    previousView = view;
    const { clip } = view;
    const topLeft = game.screenToWorld(screenPoint(clip.x, clip.y));
    const bottomRight = game.screenToWorld(screenPoint(clip.x + clip.width, clip.y + clip.height));
    camera.setAttribute("x", String(topLeft.x));
    camera.setAttribute("y", String(topLeft.y));
    camera.setAttribute("width", String(bottomRight.x - topLeft.x));
    camera.setAttribute("stroke-width", String(5 * size));
    camera.setAttribute("height", String(bottomRight.y - topLeft.y));
  }

  function groupSupply(base: SVGRectElement, owner: Team | "neutral", connected: boolean) {
    base.setAttribute("fill", owner === "neutral" || !connected ? "#142431" : owner === "blue" ? "#2a6073" : "#733e42");
  }

  function paintUnits() {
    if (supplyRevision !== battle.supply.revision) {
      supplyRevision = battle.supply.revision;
      lines.forEach((line, i) => {
        const owner = battle.supply.lanes[i];
        line.setAttribute("stroke", owner ? colors[owner] : "none");
        line.setAttribute("stroke-dasharray", owner === "red" ? `${11 * size} ${7 * size}` : "");
      });
    }
    for (const { fighter, marker, isPlayer } of markers) {
      if (!vision.shows(fighter)) {
        marker.removeAttribute("transform");
        marker.style.display = "none";
        continue;
      }
      const { x, y } = fighter.position;
      const transform = `translate(${x.toFixed(1)} ${y.toFixed(1)})`;
      marker.style.display = "";
      if (isPlayer) {
        const angle = Math.atan2(fighter.facing.y, fighter.facing.x) * 180 / Math.PI + 90;
        marker.setAttribute("transform", `${transform} rotate(${angle.toFixed(1)})${size === 1 ? "" : ` scale(${size})`}`);
      } else {
        marker.setAttribute("transform", size === 1 ? transform : `${transform} scale(${size})`);
      }
    }
    for (const { site, base, ring, label, contested } of sites) {
      const owner: Team | "neutral" = site.owner ?? "neutral";
      const color = colors[owner];
      base.setAttribute("stroke", color);
      base.setAttribute("stroke-dasharray", owner === "red" ? "14 7" : "");
      const connected = owner !== "neutral" && battle.supply.connected[owner].has(site.id);
      groupSupply(base, owner, connected);
      base.setAttribute("stroke-width", owner === "neutral" ? "4" : "8");
      label.setAttribute("fill", color);
      ring.style.display = site.device ? "" : "none";
      contested.style.display = site.device?.contested ? "" : "none";
      if (!site.device) continue;
      ring.setAttribute("stroke", colors[site.device.team]);
      ring.setAttribute("stroke-dasharray", `${Math.max(3, 100 * site.device.progress / ACTIVATE_TICKS)} 100`);
    }
  }

  return {
    mount() { host.append(panel); },
    paint() {
      paintCamera();
      if (paintedTick === battle.tick) return;
      paintedTick = battle.tick;
      paintUnits();
    },
    dispose() { panel.remove(); },
  };
}
