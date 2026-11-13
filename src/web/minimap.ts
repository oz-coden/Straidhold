import { screenPoint, type Game } from "@simpludify/web";
import { HEIGHT, HQ, TEAMS, terrain, TILE, WIDTH, type Team } from "../rules/arena.ts";
import { ACTIVATE_TICKS, type Battle, type Fighter } from "../rules/battle.ts";
import type { TeamVision } from "../rules/vision.ts";

const namespace = "http://www.w3.org/2000/svg";
const colors = { blue: "#75ddff", red: "#ff948a", neutral: "#b8c8d1" };
const tiles = [
  { fill: "#1b3040", matches: (id: number) => id < 2 },
  { fill: "#304b60", matches: (id: number) => id === 2 },
  { fill: "#5b6e7e", matches: (id: number) => id === 3 },
];
function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number> = {}) {
  const node = document.createElementNS(namespace, name);
  for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, String(value));
  return node;
}

export function createMinimap(game: Game<"briefing" | "match">, host: HTMLElement, battle: Battle, player: Fighter, vision: TeamVision<Fighter>, mask: HTMLCanvasElement) {
  const panel = document.createElement("aside");
  panel.className = "minimap";
  panel.setAttribute("aria-label", "ミニマップ");
  const geometry = { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, "aria-hidden": "true" };
  const map = svg("svg", geometry);
  for (const { fill, matches } of tiles) {
    const cells: string[] = [];
    terrain.forEach((id, x, y) => {
      if (matches(id)) cells.push(`M${x * TILE},${y * TILE}h${TILE}v${TILE}h-${TILE}z`);
    });
    map.append(svg("path", { fill, d: cells.join("") }));
  }
  const icons = svg("svg", geometry);
  const camera = svg("rect", { class: "minimap-camera", rx: 10, fill: "#e5f7ff", "fill-opacity": ".05", stroke: "#e5f7ff", "stroke-opacity": ".8", "stroke-width": 5 });
  icons.append(camera);
  for (const team of TEAMS) {
    const { x, y } = HQ[team];
    icons.append(svg("rect", { x: x - 37, y: y - 18, width: 74, height: 36, rx: 3, fill: "#101f2c", stroke: colors[team], "stroke-width": 9 }));
  }

  const sites = battle.sites.map((site) => {
    const group = svg("g", { class: "minimap-site", transform: `translate(${site.x} ${site.y})` });
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
    camera.setAttribute("height", String(bottomRight.y - topLeft.y));
  }

  function paintUnits() {
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
        marker.setAttribute("transform", `${transform} rotate(${angle.toFixed(1)})`);
      } else {
        marker.setAttribute("transform", transform);
      }
    }
    for (const { site, base, ring, label, contested } of sites) {
      const owner: Team | "neutral" = site.owner ?? "neutral";
      const color = colors[owner];
      base.setAttribute("stroke", color);
      base.setAttribute("stroke-dasharray", owner === "red" ? "14 7" : "");
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
